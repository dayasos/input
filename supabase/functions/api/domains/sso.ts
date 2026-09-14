import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";

// ---------------------------------------------------------------------------
// Port dari buatTokenSSORetur() — Kode.gs baris 3920-3975.
//
// Perbedaan implementasi:
// - Kode.gs: Utilities.computeHmacSha256Signature() (GAS-specific)
//   → Supabase: crypto.subtle.sign("HMAC", ...) (Web Crypto API, tersedia di Deno)
// - Kode.gs: membaca nama+jabatan dari sheet db_admin (SpreadsheetApp)
//   → Supabase: membaca dari tabel `akun` di Postgres
// - Kunci SSO: Kode.gs baca dari PropertiesService.getScriptProperties().get('SSO_SECRET_KEY')
//   → Supabase: baca dari Deno.env.get("SSO_SECRET_KEY")
// - URL Retur: Kode.gs baca dari PropertiesService ('SSO_URL_RETUR')
//   → Supabase: baca dari Deno.env.get("SSO_URL_RETUR") (fallback ke default hardcoded)
//
// Kontrak respons IDENTIK: { sukses: true, url: string } — app Retur memvalidasi token ini.
// Payload format identik: base64url("{ u, r, k, n, j, t }") + "." + hex(HMAC-SHA256)
// ---------------------------------------------------------------------------

const DEFAULT_URL_RETUR = "https://retur2027.vercel.app";

async function hitungHmacSha256Hex(pesan: string, kunci: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(kunci),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(pesan));
  return Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Base64URL encode DENGAN padding "=" dipertahankan — Utilities.base64EncodeWebSafe() di GAS
// TETAP menyertakan padding (dikonfirmasi dari contoh resmi dokumentasi Google: 'A string here'
// -> 'QSBzdHJpbmcgaGVyZQ=='), berbeda dari asumsi sebelumnya. Kalau padding dibuang di sini,
// payloadStr (dan signature HMAC yang dihitung di atasnya) akan berbeda literal dari token yang
// dihasilkan GAS untuk payload yang sama panjang — berisiko token dari backend ini gagal
// didekode oleh app Retur 2027 kalau dekodernya butuh padding yang pas. Disamakan persis dengan
// perilaku GAS yang sudah terbukti jalan, bukan diasumsikan app penerima toleran.
// `btoa()` bawaan hanya aman untuk karakter Latin1 (0-255) — kalau `str` mengandung karakter
// non-ASCII (mis. nama/jabatan admin ada tanda baca/huruf aksen), btoa() melempar
// "characters outside of the Latin1 range". Kode.gs meng-encode string sebagai UTF-8 dulu
// (perilaku standar Utilities.base64EncodeWebSafe() untuk argumen String) sebelum base64 —
// disamakan di sini lewat TextEncoder supaya tidak diam-diam berbeda/error untuk nama tertentu.
function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

export async function buatTokenSSORetur(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const kunci = Deno.env.get("SSO_SECRET_KEY") || "";
    if (!kunci) return { sukses: false, pesan: "Kunci SSO belum diset. Hubungi developer." };

    // Ambil nama lengkap & jabatan dari tabel akun (port dari pencarian db_admin di Kode.gs baris 3937-3948)
    let nama = sesi.username || "";
    let jabatan = "";
    try {
      const rowsAkun = await sql`
        select nama_lengkap, jabatan from akun
        where username = ${sesi.username}
        limit 1
      `;
      if (rowsAkun.length > 0) {
        nama = rowsAkun[0].nama_lengkap ? String(rowsAkun[0].nama_lengkap).trim() : nama;
        jabatan = rowsAkun[0].jabatan ? String(rowsAkun[0].jabatan).trim() : "";
      }
    } catch (_eNama) {
      // Fallback: gunakan username, jabatan kosong (sama seperti Kode.gs)
    }

    const payload = {
      u: sesi.username || "",
      r: sesi.role || "",
      k: sesi.kecamatan || "",
      n: nama,
      j: jabatan,
      t: Date.now(),
    };
    const payloadStr = base64UrlEncode(JSON.stringify(payload));
    const sig = await hitungHmacSha256Hex(payloadStr, kunci);
    const ssoToken = payloadStr + "." + sig;

    // Ambil URL Retur dari env (dengan fallback ke default)
    let baseUrl = (Deno.env.get("SSO_URL_RETUR") || DEFAULT_URL_RETUR).trim();
    // Jika masih mengarah ke URL GAS lama, pakai default (port logika Kode.gs baris 3913-3918)
    if (baseUrl.includes("script.google.com")) baseUrl = DEFAULT_URL_RETUR;
    if (/^https?:\/\/[^/]+$/.test(baseUrl)) baseUrl += "/";

    const separator = baseUrl.includes("?") ? "&" : "?";
    return { sukses: true, url: baseUrl + separator + "sso=" + encodeURIComponent(ssoToken) };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}
