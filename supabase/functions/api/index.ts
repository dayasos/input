
import { loginPengguna, logoutPengguna, pulihkanSesi } from "./domains/auth.ts";
import { ambilSesi } from "./_shared/sesi.ts";
import {
  getDataRumahIbadah,
  getKelurahanByKecamatan,
  getKemenagData,
  getMasterLayanan,
  getSheetName,
  getVersiAplikasi,
} from "./domains/master.ts";
import {
  cekKuotaRealtime,
  cekKuotaTersedia,
  cekNikRealtime,
  cekRekeningRealtime,
  cekTempatTugasGandaRealtime,
  validasiDataBaru,
} from "./domains/validasi.ts";
import {
  ambilDataLihatDataHakAkses,
  ambilDetailPenerimaPerBaris,
  simpanDataKeSheet,
  editDataPenerima,
} from "./domains/penerima.ts";
import { eksporDataKeSpreadsheet } from "./domains/ekspor.ts";
import { ambilDataDetail } from "./domains/dataDetail.ts";
import {
  konfirmasiUploadBerkas,
  konfirmasiUploadBerkasDrive,
  mintaUrlUploadBerkas,
  mintaUrlUploadBerkasDrive,
} from "./domains/upload.ts";
import {
  ambilDaftarBatchPembayaran,
  ambilDetailBatchPembayaran,
  ambilPejabatTtd,
  ambilReferensiSkWalikota,
  ambilSkLayanan,
  buatBatchPembayaran,
  simpanPejabatTtd,
  simpanReferensiSkWalikota,
  simpanSkLayanan,
  unduhExcelBatch,
} from "./domains/pembayaran.ts";
import { buatTokenSSORetur } from "./domains/sso.ts";
import { ambilDataTahunHakAkses, ambilRiwayatEdit, ambilTahunTersedia } from "./domains/riwayat.ts";
import { getDashboardProgresVerifikasi } from "./domains/dashboard.ts";
import { getProgresKuota, getSemuaKuota, simpanKuota } from "./domains/kuota.ts";
import {
  cekBatasWaktuVerifikasi,
  getDaftarBerkasTidakLengkapUntukWA,
  laporkanPerbaikanBerkas,
  tandaiSudahDiperbaiki,
  verifikasiMassalMemenuhiSyarat,
  verifikasiSatuData,
} from "./domains/verifikasi.ts";
import {
  ambilDaftarUserDenganStatus,
  ambilStatusDetailSetelan,
  bulkSakelarPerKecamatan,
  resetSakelarUserByAdmin,
  setInputKecKem,
  setSakelarUserByAdmin,
  statusInputKecKem,
} from "./domains/setelan.ts";
import {
  ambilDaftarAkun,
  ambilDaftarAkunLengkap,
  tambahUserBaru,
  ubahDataUserOlehAdmin,
  hapusUser,
  resetPasswordUser,
  simpanProfilUser,
  ubahAkunSendiri,
  ubahProfilUser,
} from "./domains/akun.ts";

// deno-lint-ignore no-explicit-any
type Handler = (...args: any[]) => unknown | Promise<unknown>;

const ALLOWED: Record<string, Handler> = {
  loginPengguna,
  logoutPengguna,
  pulihkanSesi,
  getMasterLayanan,
  getKelurahanByKecamatan,
  getDataRumahIbadah,
  getKemenagData,
  getSheetName,
  getVersiAplikasi,
  cekNikRealtime,
  cekRekeningRealtime,
  cekTempatTugasGandaRealtime,
  cekKuotaRealtime,
  cekKuotaTersedia,
  validasiDataBaru,
  ambilDataLihatDataHakAkses,
  ambilDetailPenerimaPerBaris,
  simpanDataKeSheet,
  editDataPenerima,
  ambilDataDetail,
  mintaUrlUploadBerkas,
  konfirmasiUploadBerkas,
  mintaUrlUploadBerkasDrive,
  konfirmasiUploadBerkasDrive,
  ambilTahunTersedia,
  ambilDataTahunHakAkses,
  ambilRiwayatEdit,
  getDashboardProgresVerifikasi,
  getSemuaKuota,
  simpanKuota,
  getProgresKuota,
  verifikasiSatuData,
  laporkanPerbaikanBerkas,
  tandaiSudahDiperbaiki,
  verifikasiMassalMemenuhiSyarat,
  getDaftarBerkasTidakLengkapUntukWA,
  cekBatasWaktuVerifikasi,
  statusInputKecKem,
  setInputKecKem,
  ambilStatusDetailSetelan,
  setSakelarUserByAdmin,
  resetSakelarUserByAdmin,
  ambilDaftarUserDenganStatus,
  bulkSakelarPerKecamatan,
  ubahAkunSendiri,
  ambilDaftarAkun,
  ambilDaftarAkunLengkap,
  tambahUserBaru,
  ubahDataUserOlehAdmin,
  hapusUser,
  resetPasswordUser,
  simpanProfilUser,
  ubahProfilUser,
  eksporDataKeSpreadsheet,
  buatTokenSSORetur,
  buatBatchPembayaran,
  ambilDaftarBatchPembayaran,
  ambilDetailBatchPembayaran,
  ambilPejabatTtd,
  simpanPejabatTtd,
  unduhExcelBatch,
  ambilSkLayanan,
  simpanSkLayanan,
  ambilReferensiSkWalikota,
  simpanReferensiSkWalikota,
  ping: () => ({ pong: true, status: "ok", timestamp: new Date().toISOString() }),
};

const CORS_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS, GET",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-session-token",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

// ---------------------------------------------------------------------------
// ARSITEKTUR AUTH GANDA (2026-09-17):
//
// MODE 1 — _secret (Vercel Proxy / internal cron):
//   Body JSON wajib punya field _secret yang cocok dengan env var GAS_SECRET_TOKEN.
//   _secret TIDAK PERNAH dikirim ke browser — hanya Vercel yang menyuntikkannya.
//
// MODE 2 — X-Session-Token header (browser langsung):
//   Browser mengirim session token via header "x-session-token" (bukan body).
//   Edge Function memvalidasi token ke tabel sesi_login (sudah punya cache in-memory
//   di _shared/sesi.ts). _secret tidak diperlukan — browser tidak pernah tahu nilainya.
//   Keamanan setara: hanya pengguna yang sudah login (punya token sesi valid) yang bisa akses.
//
// Dua mode ini saling eksklusif tapi TIDAK konflik: request yang punya _secret valid
// diproses sebagai mode 1; yang tidak punya _secret tapi punya X-Session-Token valid
// diproses sebagai mode 2. Kalau keduanya tidak ada → Ditolak.
// ---------------------------------------------------------------------------


Deno.serve(async (req: Request) => {
  // Tangani CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({
      status: "ok",
      pesan:
        "API Edge Function Supabase untuk Sistem Layanan Data Penerima Dana Jasa Pelayanan Kota Medan 2027. " +
        "Endpoint ini melayani permintaan POST dari proxy Vercel maupun langsung dari browser (via X-Session-Token).",
    });
  }

  let body: { action?: string; args?: unknown[]; _secret?: string } | null = null;
  try {
    body = await req.json();
  } catch (_e) {
    return json({
      error: "Payload JSON tidak valid",
      sukses: false,
      pesan: "Payload JSON tidak valid",
    });
  }

  if (!body || typeof body !== "object") {
    return json({
      error: "Payload JSON harus berupa objek",
      sukses: false,
      pesan: "Payload JSON harus berupa objek",
    });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const args = Array.isArray(body.args) ? body.args : [];

  // ── Mode 1: Autentikasi via _secret (Vercel / cron internal) ──────────────
  const expectedSecret = Deno.env.get("GAS_SECRET_TOKEN");
  const syncSecret = Deno.env.get("SYNC_WORKER_SECRET");
  const isValidSecret =
    (Boolean(expectedSecret) && body._secret === expectedSecret) ||
    (Boolean(syncSecret) && body._secret === syncSecret);

  // ── Mode 2: Autentikasi via X-Session-Token header (browser langsung) ─────
  // Header ini dikirim browser ketika memanggil Edge Function langsung (bypass Vercel).
  // _secret tidak ada di payload, tapi token sesi user yang valid cukup untuk autentikasi.
  // Catatan: args[0] untuk fungsi-fungsi yang membutuhkan token (mis. simpanDataKeSheet,
  // cekNikRealtime, dll.) TETAP dikirim sebagai args[0] — tidak perlu ubah kontrak frontend.
  // Header hanya dipakai untuk memverifikasi boleh-tidaknya request ini masuk.
  let isValidSessionHeader = false;
  const sessionTokenFromHeader = req.headers.get("x-session-token");
  if (!isValidSecret && sessionTokenFromHeader) {
    const sesiDariHeader = await ambilSesi(sessionTokenFromHeader);
    isValidSessionHeader = Boolean(sesiDariHeader && sesiDariHeader.role);
  }

  if (!isValidSecret && !isValidSessionHeader) {
    return json({
      error: "Akses Ditolak: Kredensial API tidak sah",
      sukses: false,
      pesan: "Akses Ditolak",
    });
  }

  const fn = ALLOWED[action];
  if (!fn) {
    const pesan = "Aksi tidak diizinkan: " + action;
    return json({ error: pesan, sukses: false, pesan });
  }

  try {
    const hasil = await fn(...args);
    return json({ result: hasil });
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    return json({ error: pesan, sukses: false, pesan });
  }
});

