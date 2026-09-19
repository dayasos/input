// Proxy PUT byte upload ke Google Drive lewat Edge Function -- pengganti pola lama (browser PUT
// LANGSUNG ke uploadSessionUri googleapis.com), yang TERBUKTI diblokir CORS 100% oleh browser
// ("No 'Access-Control-Allow-Origin' header is present" -- dikonfirmasi via test langsung browser
// nyata 2026-09-18, lihat riwayat percakapan). Endpoint googleapis.com/upload/drive/v3/* memang
// tidak pernah mengirim header CORS utk origin sembarang, beda dari Supabase Storage/GCS signed
// URL yang didesain utk direct-upload browser.
//
// Solusi: browser PUT ke origin KITA SENDIRI (Edge Function ini, yang sudah set
// access-control-allow-origin: * -- lihat index.ts), lalu Edge Function yang forward byte itu ke
// Google server-to-server (fetch antar server tidak pernah kena CORS, itu aturan khusus browser).
//
// uploadSessionUri asli dari Google DIKIRIM ke browser dlm bentuk ter-enkode di query string
// (?u=...) -- bukan rahasia baru: itu toh sudah dikirim mentah2 ke browser di desain lama (isinya
// cuma upload_id sekali-pakai scoped ke satu file, bukan credential jangka panjang). Proteksi di
// sini: (1) wajib x-session-token valid (cegah endpoint ini dipakai jadi open relay), (2) target
// divalidasi HARUS berawalan domain upload Drive resmi (cegah disalahgunakan jadi SSRF proxy ke
// domain sembarang).
//
// CATATAN RISIKO (2026-09-19): body diteruskan APA ADANYA dalam SATU request (tidak di-chunk/
// stream terpisah) -- artinya utk file besar (client cap 25MB, lihat app-transaksi.js) dan koneksi
// lambat, request ini menahan 1 invocation Edge Function selama durasi PUT PENUH dari browser
// (bukan cuma durasi PUT Edge Function->Google yang biasanya jauh lebih cepat). Kalau ada laporan
// "upload lambat/timeout" utk file besar di koneksi lambat, ini kandidat pertama yang perlu dicek
// -- termasuk apakah kena limit waktu eksekusi/memori Edge Function pada plan Supabase yang dipakai.

import { ambilSesi } from "./sesi.ts";

const GOOGLE_UPLOAD_PREFIX = "https://www.googleapis.com/upload/drive/v3/";

export const CORS_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, PUT, OPTIONS, GET",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-session-token, content-range",
  // WAJIB ada supaya browser (XHR/fetch) BOLEH baca header "Range" dari respons cross-origin ini
  // lewat getResponseHeader() -- tanpa expose eksplisit ini, browser diam2 menyembunyikan header
  // non-standar dari JS walau header-nya ADA di response mentah. "Range" dipakai frontend utk
  // resume upload resumable yg terputus di tengah jalan (lihat cekStatusSesiUpload di
  // app-transaksi.js) drpd restart total dari byte 0.
  "access-control-expose-headers": "Range",
};

function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const sisaPad = padded.length % 4;
    const withPad = sisaPad === 0 ? padded : padded + "=".repeat(4 - sisaPad);
    return atob(withPad);
  } catch {
    return null;
  }
}

/** Bungkus uploadSessionUri asli Google jadi URL proxy same-origin yg aman di-PUT browser. */
export function bangunUrlProxyUpload(supabaseFunctionBaseUrl: string, uploadSessionUri: string): string {
  const base = supabaseFunctionBaseUrl.replace(/\/+$/, "");
  return `${base}/drive-proxy-upload?u=${base64UrlEncode(uploadSessionUri)}`;
}

function jsonErr(pesan: string, status: number): Response {
  return new Response(JSON.stringify({ sukses: false, pesan }), { status, headers: CORS_HEADERS });
}

// Tangani PUT proxy: teruskan byte body persis apa adanya (termasuk PUT kosong ber-header
// Content-Range: "bytes star/star" yg dipakai cekStatusSesiUpload di frontend utk cek status sesi
// resumable SEBELUM retry) ke uploadSessionUri Google asli, lalu teruskan balik respons Google ke
// browser.
export async function tanganiProxyUploadDrive(req: Request, url: URL): Promise<Response> {
  const sessionToken = req.headers.get("x-session-token");
  const sesi = await ambilSesi(sessionToken);
  if (!sesi || !sesi.role) {
    return jsonErr("Akses ditolak: sesi tidak sah.", 401);
  }

  const encoded = url.searchParams.get("u") || "";
  const target = base64UrlDecode(encoded);
  if (!target || !target.startsWith(GOOGLE_UPLOAD_PREFIX)) {
    return jsonErr("Target upload tidak valid.", 400);
  }

  const headersKeGoogle: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headersKeGoogle["Content-Type"] = contentType;
  const contentRange = req.headers.get("content-range");
  if (contentRange) headersKeGoogle["Content-Range"] = contentRange;

  const bodyBytes = await req.arrayBuffer();

  let resGoogle: Response;
  try {
    resGoogle = await fetch(target, {
      method: "PUT",
      headers: headersKeGoogle,
      body: bodyBytes.byteLength > 0 ? bodyBytes : undefined,
    });
  } catch (e) {
    return jsonErr("Gagal meneruskan upload ke Drive: " + String(e), 502);
  }

  const teksRespons = await resGoogle.text();
  const headersRespons: Record<string, string> = {
    ...CORS_HEADERS,
    "content-type": resGoogle.headers.get("content-type") || "application/json",
  };
  // Teruskan header "Range" dari Google (muncul pada respons 308 "Resume Incomplete" -- menandakan
  // byte 0..N sudah diterima Google) -- SEBELUMNYA header ini dibuang begitu saja di sini, jadi
  // frontend tidak pernah bisa tahu berapa byte yg sudah masuk utk resume yg benar (selalu restart
  // total dari byte 0 walau protokol Google sebenarnya mendukung lanjut dari offset).
  const rangeHeader = resGoogle.headers.get("range");
  if (rangeHeader) headersRespons["range"] = rangeHeader;

  return new Response(teksRespons, {
    status: resGoogle.status,
    headers: headersRespons,
  });
}
