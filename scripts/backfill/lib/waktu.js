"use strict";

/**
 * Parse timestamp dari string sheet jadi objek Date JS (pg lalu menyerialisasikannya dengan
 * benar ke kolom timestamptz — JANGAN cast string mentah lewat SQL, format Indonesia di bawah
 * TIDAK bisa langsung di-cast Postgres).
 *
 * TIGA format yang dipakai Kode.gs untuk kolom "Waktu"/timestamp di berbagai sheet:
 *   - ISO 8601: new Date().toISOString() -> "2027-01-15T08:30:00.000Z"
 *   - Locale id-ID, dipakai db_riwayat_setelan & db_riwayat_edit:
 *     new Date().toLocaleString("id-ID", {timeZone:"Asia/Jakarta"}) -> mis. "15/1/2027, 08.30.00"
 *     (PERHATIKAN: pemisah jam pakai TITIK, bukan titik dua — bukan format ISO/SQL biasa)
 *   - "dd-MM-yyyy HH:mm" WIB, dipakai kolom TANGGAL VERIFIKASI & TANGGAL LAPOR PERBAIKAN di
 *     "Data Input <tahun>" (ditulis verifikasiSatuData_/laporkanPerbaikanBerkas_ Kode.gs via
 *     Utilities.formatDate(..., "dd-MM-yyyy HH:mm") — selalu zero-padded 2 digit, TANPA detik).
 *     BUG SERIUS yang ditemukan & diperbaiki di sini (2026-09-14, sebelum --write pertama
 *     dijalankan): tanpa pola eksplisit ini, string seperti "07-08-2026 10:30" (7 Agustus)
 *     jatuh ke fallback new Date(str) yang MENAFSIRKANNYA SEBAGAI MM-DD-YYYY (gaya Amerika)
 *     kalau harinya <=12 -> diam-diam jadi 8 Juli (hari & bulan TERTUKAR, tanpa error). Kalau
 *     harinya >12, fallback malah gagal total jadi Invalid Date -> data hilang jadi null. Pola
 *     ketiga ini HARUS dicek PALING AWAL (sebelum pola locale id-ID) karena keduanya sama-sama
 *     bisa cocok dengan angka pendek, urutan pengecekan menentukan mana yang menang.
 */
function keWaktuJs(nilai) {
  if (!nilai) return null;
  const str = nilai.toString().trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // Hari/bulan/jam/menit TIDAK selalu zero-padded di data nyata (mis. "15-08-2026 1:44" —
  // ditemukan saat spot-check langsung ke sheet, sebelum diasumsikan selalu 2 digit) — toleran
  // 1-2 digit di semua bagian. Tidak menimbulkan ambiguitas baru karena posisi tiap kelompok
  // (hari lalu bulan lalu jam) sudah ditentukan eksplisit oleh pola ini, tidak mengandalkan
  // tebakan new Date() seperti bug aslinya.
  const matchDdMmYyyy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4}) (\d{1,2}):(\d{1,2})$/);
  if (matchDdMmYyyy) {
    const tgl = Number(matchDdMmYyyy[1]);
    const bln = Number(matchDdMmYyyy[2]);
    const thn = Number(matchDdMmYyyy[3]);
    const jam = Number(matchDdMmYyyy[4]);
    const mnt = Number(matchDdMmYyyy[5]);
    return new Date(Date.UTC(thn, bln - 1, tgl, jam - 7, mnt, 0));
  }

  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2})[.:](\d{1,2})[.:](\d{1,2})$/);
  if (match) {
    const tgl = Number(match[1]);
    const bln = Number(match[2]);
    const thn = Number(match[3]);
    const jam = Number(match[4]);
    const mnt = Number(match[5]);
    const dtk = Number(match[6]);
    // Dibuat eksplisit sebagai waktu Asia/Jakarta (UTC+7), bukan mengikuti zona waktu mesin
    // yang menjalankan skrip backfill ini.
    return new Date(Date.UTC(thn, bln - 1, tgl, jam - 7, mnt, dtk));
  }

  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

module.exports = { keWaktuJs };
