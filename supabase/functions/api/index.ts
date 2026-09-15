// Dispatcher utama — meniru persis pola doPost(e) di Kode.gs (ALLOWED{} + {action,args} -> {result}/{error})
// supaya api/gas.js (proxy Vercel) & js/api-bridge.js di frontend nyaris tidak perlu berubah,
// cukup ganti target URL dari script.google.com ke URL Edge Function ini.
//
// FASE 4 SELESAI (2026-09-14) — SEMUA domain telah diporting ke Edge Function:
// - auth, master (read-only), validasi (realtime cek NIK/rekening/tempat tugas/kuota)
// - penerima: READ (ambilDataLihatDataHakAkses, ambilDetailPenerimaPerBaris) +
//             WRITE (simpanDataKeSheet, editDataPenerima — Fase 4)
// - riwayat (ambilTahunTersedia, ambilDataTahunHakAkses, ambilRiwayatEdit)
// - dashboard (getDashboardProgresVerifikasi)
// - kuota (getSemuaKuota, simpanKuota, getProgresKuota)
// - verifikasi (verifikasiSatuData, laporkanPerbaikanBerkas, tandaiSudahDiperbaiki,
//               verifikasiMassalMemenuhiSyarat, getDaftarBerkasTidakLengkapUntukWA,
//               cekBatasWaktuVerifikasi — Fase 4)
// - setelan (statusInputKecKem, setInputKecKem, ambilStatusDetailSetelan, setSakelarUserByAdmin,
//            resetSakelarUserByAdmin, ambilDaftarUserDenganStatus, bulkSakelarPerKecamatan)
// - akun (ubahAkunSendiri, ambilDaftarAkun, resetPasswordUser, simpanProfilUser, ubahProfilUser)
// - ekspor (eksporDataKeSpreadsheet — Fase 4, via npm:xlsx)
// - sso (buatTokenSSORetur — Fase 4, via Web Crypto HMAC-SHA256)
// - dataDetail (ambilDataDetail — 2026-09-15, fitur baru murni Supabase, bukan porting dari
//   Kode.gs; pengganti sheet eksternal "Data Detail" + formula QUERY() yang sudah dihapus total)
// - upload (uploadSemuaBerkasKeSupabase — 2026-09-15, pengganti uploadSemuaBerkasKeDrive: upload
//   berkas sekarang ke Supabase Storage bucket privat + signed URL, BUKAN lagi ke Google Drive.
//   Kode.gs TIDAK diubah/dihapus, fungsi lamanya cuma tidak dipanggil lagi dari index.html.)
//
// Yang TIDAK diporting (sengaja):
// - setHeaderUserId: utilitas sekali-jalan yang tidak dipanggil frontend (lihat setelan.ts)
// - chat: fitur dihapus total 2026-09-12

import { loginPengguna, logoutPengguna, pulihkanSesi } from "./domains/auth.ts";
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
import { uploadSemuaBerkasKeSupabase } from "./domains/upload.ts";
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
  uploadSemuaBerkasKeSupabase,
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
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS,
  });
}

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
        "Endpoint ini hanya melayani permintaan POST dari proxy Vercel.",
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

  // Verifikasi Keamanan (Shared Secret Token dari Vercel) - pola sama seperti doPost() di Kode.gs.
  // WAJIB diset lewat `supabase secrets set` -- TIDAK ADA LAGI fallback ke nilai default yang
  // tertulis di kode (2026-09-15: nilai default itu ketahuan masih dipakai di produksi, celah
  // keamanan nyata karena siapa pun yang baca source code tahu nilainya). `!expectedSecret` WAJIB
  // dicek eksplisit -- tanpa ini, secret kosong di kedua sisi (env var lupa diset DAN body._secret
  // tidak dikirim) akan lolos begitu saja lewat `undefined !== undefined`.
  const expectedSecret = Deno.env.get("GAS_SECRET_TOKEN");
  if (!expectedSecret || body._secret !== expectedSecret) {
    return json({
      error: "Akses Ditolak: Kredensial API tidak sah",
      sukses: false,
      pesan: "Akses Ditolak",
    });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const args = Array.isArray(body.args) ? body.args : [];

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

