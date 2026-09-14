"use strict";

// ID spreadsheet SAMA PERSIS dengan konstanta di Kode.gs (baris 4-5) — bukan rahasia,
// jadi aman dijadikan default, tapi tetap bisa dioverride lewat env var kalau perlu
// (mis. menunjuk ke salinan staging spreadsheet dulu sebelum menyentuh yang asli).
const DEFAULT_SS_ID_MASTER_DROPDOWN = "1wB2xHthdlMzZWG80jkmIPDNkCwtu_9p1zplF8yePGk4";
const DEFAULT_SS_ID_PENYIMPANAN = "1FqXYvce8wvFtWgDmMgXlWhX3AQ_9teHCa_WpftTrJSU";

/**
 * Memuat & memvalidasi env var yang dibutuhkan skrip backfill. SENGAJA melempar error yang
 * jelas dan langsung menghentikan proses (bukan lanjut dengan nilai kosong/default berbahaya)
 * kalau kredensial belum lengkap — ini pagar keamanan utama supaya skrip tidak bisa "kebobolan"
 * jalan tanpa kredensial asli sebelum user benar-benar siap.
 */
function muatEnv() {
  const masalah = [];

  const googleKeyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  const googleKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!googleKeyJson && !googleKeyPath) {
    masalah.push(
      "GOOGLE_SERVICE_ACCOUNT_KEY_JSON atau GOOGLE_SERVICE_ACCOUNT_KEY_PATH belum diset " +
        "(kredensial Service Account Google untuk baca Sheets API).",
    );
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    masalah.push("SUPABASE_DB_URL belum diset (connection string Postgres project Supabase).");
  }

  if (masalah.length > 0) {
    throw new Error(
      "Skrip backfill tidak bisa jalan — env var berikut belum lengkap:\n  - " +
        masalah.join("\n  - ") +
        "\n\nIsi dulu di .env.local (lihat DEPLOYMENT_GUIDE.md), lalu jalankan lagi.",
    );
  }

  return {
    googleKeyJson,
    googleKeyPath,
    dbUrl,
    ssIdMasterDropdown: process.env.SS_ID_MASTER_DROPDOWN || DEFAULT_SS_ID_MASTER_DROPDOWN,
    ssIdPenyimpanan: process.env.SS_ID_PENYIMPANAN || DEFAULT_SS_ID_PENYIMPANAN,
  };
}

module.exports = { muatEnv };
