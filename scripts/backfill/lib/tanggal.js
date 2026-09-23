"use strict";

/**
 * Parse tanggal dari string sheet (format "DD-MM-YYYY", "DD/MM/YYYY", atau "YYYY-MM-DD")
 * jadi string ISO "YYYY-MM-DD" untuk kolom `date` Postgres. Balikan null kalau tidak bisa
 * diparse (dibiarkan NULL di database, bukan bikin backfill gagal total).
 * Pola sama seperti parsing tanggal di Kode.gs (fungsi hitung umur, baris ~3290-3303).
 */
function keTanggalIso(nilai) {
  if (!nilai) return null;
  if (typeof nilai === "number" || (typeof nilai === "string" && /^\d{4,6}$/.test(nilai.trim()))) {
    const num = Number(nilai);
    if (!isNaN(num) && num > 0) {
      const ms = Math.round((num - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const str = nilai.toString().trim();
  if (!str) return null;

  const parts = str.split(/[-/]/);
  if (parts.length !== 3) return null;

  let tahun, bulan, tanggal;
  if (parts[0].length === 4) {
    // YYYY-MM-DD
    tahun = Number(parts[0]);
    bulan = Number(parts[1]);
    tanggal = Number(parts[2]);
  } else {
    // DD-MM-YYYY / DD/MM/YYYY
    tanggal = Number(parts[0]);
    bulan = Number(parts[1]);
    tahun = Number(parts[2]);
  }

  if (!tahun || !bulan || !tanggal) return null;
  if (bulan < 1 || bulan > 12 || tanggal < 1 || tanggal > 31) return null;

  const bulanStr = String(bulan).padStart(2, "0");
  const tanggalStr = String(tanggal).padStart(2, "0");
  return `${tahun}-${bulanStr}-${tanggalStr}`;
}

/**
 * Konversi nilai sel jadi angka atau null — TIDAK memakai `Number(v) || null` (bug falsy-zero:
 * umur/nilai bernilai 0 yang SAH akan salah dianggap "kosong" dan hilang jadi NULL). Ditemukan
 * saat code review pada kolom `umur` di step 06 & 07.
 */
function angkaAtauNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sama seperti angkaAtauNull() tapi dengan fallback saat nilai benar-benar kosong/invalid
 * (bukan `Number(v) || fallback` — bug falsy-zero yang sama, ditemukan saat code review pada
 * `nomor_urut` di step 06 & 07: NO=0 yang sah akan salah dianggap kosong lalu diganti nomor urut
 * otomatis i+1, berisiko bentrok dgn constraint unik (tahun, nomor_urut) baris lain).
 */
function angkaAtauFallback(v, fallback) {
  const n = angkaAtauNull(v);
  return n === null ? fallback : n;
}

module.exports = { keTanggalIso, angkaAtauNull, angkaAtauFallback };
