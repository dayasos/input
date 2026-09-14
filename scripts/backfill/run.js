#!/usr/bin/env node
"use strict";

// Orkestrator skrip backfill Sheets -> Supabase Postgres. Lihat rencana migrasi
// (C:\Users\user\.claude\plans\saya-ingin-migrasi-ke-humble-codd.md, § Rencana Backfill)
// untuk konteks lengkap kenapa & bagaimana urutan step ini disusun.
//
// PENTING - INI BELUM PERNAH DIJALANKAN. Cara pakai yang aman:
//   1. Isi dulu .env.local: GOOGLE_SERVICE_ACCOUNT_KEY_JSON (atau _PATH) dan SUPABASE_DB_URL.
//   2. Jalankan TANPA --write dulu (mode dry-run, default) untuk SATU step:
//        node scripts/backfill/run.js --step=akun
//      Ini hanya membaca dari Sheets & mencetak ringkasan — TIDAK menulis apa pun ke Postgres.
//   3. Periksa hasil dry-run (jumlah baris, contoh sampel data). Kalau sudah yakin benar:
//        BACKFILL_CONFIRM=YA node scripts/backfill/run.js --step=akun --write
//      (perlu DUA konfirmasi sekaligus: flag --write DAN env var BACKFILL_CONFIRM=YA — supaya
//      tidak ada penulisan ke database live yang terjadi tanpa sengaja.)
//   4. Ulangi per step, urut sesuai daftar LANGKAH di bawah. Step "all" menjalankan semuanya
//      berurutan, tapi tetap disarankan satu-satu dulu untuk step berisiko tinggi (07, 08).

const { muatEnv } = require("./lib/env");
const { buatKlienSheets } = require("./lib/sheets");
const { buatPool } = require("./lib/db");
const log = require("./lib/log");

const TAHUN_AKTIF = Number(process.env.TAHUN_AKTIF) || 2027;

const LANGKAH = [
  require("./steps/01_akun"),
  require("./steps/02_master_data"),
  require("./steps/03_capil"),
  require("./steps/04_setelan"),
  // 05_chat dihapus — fitur chat grup dihapus dari aplikasi 2026-09-12, tidak perlu diporting.
  require("./steps/06_arsip_tahun_lalu"),
  require("./steps/07_data_input_aktif"),
  require("./steps/08_riwayat_edit"),
];

function parseArgs(argv) {
  const args = { step: null, write: false };
  for (const a of argv) {
    if (a === "--write") args.write = true;
    else if (a.startsWith("--step=")) args.step = a.slice("--step=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.step) {
    console.error("Wajib isi --step=<nama-step|all>. Step tersedia: " + LANGKAH.map((l) => l.nama).join(", "));
    process.exit(1);
  }

  const mode = args.write ? "write" : "dry-run";
  if (args.write && process.env.BACKFILL_CONFIRM !== "YA") {
    console.error(
      "Menolak jalan dengan --write: butuh env var BACKFILL_CONFIRM=YA sebagai konfirmasi kedua.\n" +
      'Contoh: BACKFILL_CONFIRM=YA node scripts/backfill/run.js --step=' + args.step + " --write",
    );
    process.exit(1);
  }

  console.log(`Mode: ${mode.toUpperCase()}${mode === "dry-run" ? " (baca-saja, TIDAK menulis ke Postgres)" : " (MENULIS ke Postgres sungguhan)"}`);

  const env = muatEnv();
  const sheetsClient = await buatKlienSheets(env);
  const pool = buatPool(env);

  const langkahDipilih = args.step === "all" ? LANGKAH : LANGKAH.filter((l) => l.nama === args.step);
  if (langkahDipilih.length === 0) {
    console.error(`Step "${args.step}" tidak dikenal. Step tersedia: ` + LANGKAH.map((l) => l.nama).join(", "));
    process.exit(1);
  }

  try {
    for (const langkah of langkahDipilih) {
      await langkah.jalankan({ sheetsClient, pool, env, mode, tahunAktif: TAHUN_AKTIF });
    }
    console.log(`\nSelesai (${mode}). ${mode === "dry-run" ? "Tidak ada perubahan di database — jalankan ulang dengan --write kalau hasil di atas sudah sesuai." : ""}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nGAGAL:", err.message || err);
  process.exit(1);
});
