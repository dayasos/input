// Tahun periode input yang sedang berjalan — identik dengan angka di akhir NAMA_SHEET_INPUT
// ("Data Input 2027") di Kode.gs, dan nama partisi `penerima_2027` (lihat migrasi
// 20260907090200_penerima_partitioned.sql). Dibaca dari env var TAHUN_AKTIF (fallback ke 2027)
// SUPAYA SATU SUMBER dengan skrip backfill (scripts/backfill/run.js juga baca env var yang sama)
// — sebelumnya nilai ini hardcode terpisah dari default skrip backfill, berisiko tidak sinkron
// saat pergantian tahun (ditemukan saat code review). Saat pergantian periode (mis. ke 2028):
//   1. Jalankan: create table penerima_2028 partition of penerima for values in (2028);
//      (index & constraint unik otomatis ikut, lihat komentar di migrasi tsb)
//   2. Set env var TAHUN_AKTIF=2028 di Supabase secrets, lalu deploy ulang Edge Function.
export const TAHUN_AKTIF = Number(Deno.env.get("TAHUN_AKTIF")) || 2027;

// ID spreadsheet Penyimpanan (SS_ID_PENYIMPANAN di Kode.gs baris 5) — dipakai sync-worker untuk
// menulis mirror "Data Input <tahun>" ke Google Sheets. Bukan rahasia (sama seperti env.js skrip
// backfill), aman hardcode dengan fallback env var kalau suatu saat perlu dialihkan ke salinan lain.
export const SS_ID_PENYIMPANAN = Deno.env.get("SS_ID_PENYIMPANAN") || "1FqXYvce8wvFtWgDmMgXlWhX3AQ_9teHCa_WpftTrJSU";

// ID spreadsheet Master Dropdown & Arsip (SS_ID_MASTER_DROPDOWN di Kode.gs baris 4) — memuat db_2026
export const SS_ID_MASTER_DROPDOWN = Deno.env.get("SS_ID_MASTER_DROPDOWN") || "1wB2xHthdlMzZWG80jkmIPDNkCwtu_9p1zplF8yePGk4";

// ID folder induk Google Drive tempat seluruh berkas penerima diupload (sama persis
// FOLDER_ID_INDUK di Kode.gs/kode_gas.js) -- sejak migrasi upload dari GAS ke Drive API v3
// langsung (2026-09-18), folder ini WAJIB sudah di-share ke client_email Service Account
// (kredensial GOOGLE_SHEETS_SA_KEY_JSON, lihat _shared/googleAuth.ts) sebagai Editor/Content
// Manager -- tanpa share ini Service Account tidak bisa membuat subfolder/file di dalamnya.
export const DRIVE_FOLDER_ID_INDUK = Deno.env.get("DRIVE_FOLDER_ID_INDUK") || "19rMR3gd6tQUh-l2JSdBim09EFzwePCg3";

// 21 kecamatan Kota Medan, urutan tetap (sama persis KECAMATAN_MEDAN_URUT di Kode.gs baris
// 1712-1717) — dipakai getDashboardProgresVerifikasi untuk mode "kemenag tanpa kecamatan tetap"
// (pecah jadi 1 kartu per kecamatan) dan untuk mengurutkan kartu hasil akhir.
export const KECAMATAN_MEDAN_URUT = [
  "MEDAN AMPLAS", "MEDAN AREA", "MEDAN BARAT", "MEDAN BARU", "MEDAN BELAWAN",
  "MEDAN DELI", "MEDAN DENAI", "MEDAN HELVETIA", "MEDAN JOHOR", "MEDAN KOTA",
  "MEDAN LABUHAN", "MEDAN MAIMUN", "MEDAN MARELAN", "MEDAN PERJUANGAN", "MEDAN PETISAH",
  "MEDAN POLONIA", "MEDAN SELAYANG", "MEDAN SUNGGAL", "MEDAN TEMBUNG", "MEDAN TIMUR", "MEDAN TUNTUNGAN",
];

// Layanan yang hanya boleh punya 1 penerima per tempat tugas (sama persis
// LAYANAN_BATASI_TEMPAT_TUGAS di Kode.gs). Layanan lain (Khatib Jumat, Guru Mengaji, dst.)
// tidak dibatasi.
export const LAYANAN_BATASI_TEMPAT_TUGAS = [
  "IMAM MASJID",
  "NAZIR MASJID",
  "NAZIR MUSHOLLA",
  "PENGURUS GEREJA",
  "PENGURUS VIHARA/KLENTENG/KUIL",
];

// Port dari rapikanTeks_() di Kode.gs: uppercase + rapikan spasi ganda agar pencocokan konsisten.
export function rapikanTeks(s: unknown): string {
  return (s == null ? "" : String(s)).trim().toUpperCase().replace(/\s+/g, " ");
}

// Port dari ikonRumahIbadah_() di Kode.gs — dipakai di pesan validasi tempat tugas ganda.
export function ikonRumahIbadah(layanan: unknown): string {
  const lay = (layanan == null ? "" : String(layanan)).trim().toUpperCase();
  switch (lay) {
    case "IMAM MASJID":
    case "NAZIR MASJID":
    case "NAZIR MUSHOLLA":
      return "🕌";
    case "PENGURUS GEREJA":
      return "⛪";
    case "PENGURUS VIHARA/KLENTENG/KUIL":
      return "🛕";
    default:
      return "🛐";
  }
}
