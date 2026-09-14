// Port dari pola format tanggal berulang di Kode.gs (getSnapshotSheetInput_, getSnapshotDataDetail_,
// ambilDetailPenerimaPerBaris — ketiganya menulis loop `("0"+d.getDate()).slice(-2)` yang sama persis).
// Di sini cukup satu fungsi, dipakai di semua tempat yang butuh format dd-MM-yyyy.
export function formatTanggalDDMMYYYY(nilai: Date | string | null | undefined): string {
  if (!nilai) return "";
  const d = nilai instanceof Date ? nilai : new Date(nilai);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Port dari `Utilities.formatDate(new Date(), "GMT+7", "dd-MM-yyyy HH:mm")` — dipakai Kode.gs
 * KHUSUS untuk tanggal_verifikasi (verifikasiSatuData baris 2988) dan tanggal_lapor_perbaikan
 * (laporkanPerbaikanBerkas baris 3054). Beda dari tanggal_lahir/batas_waktu_perbaikan yang
 * cuma tanggal (tanpa jam) — dua kolom timestamp ini SELALU menyertakan jam:menit WIB (UTC+7).
 */
export function formatTanggalWaktuWIB(nilai: Date | string | null | undefined): string {
  if (!nilai) return "";
  const d = nilai instanceof Date ? nilai : new Date(nilai);
  if (isNaN(d.getTime())) return "";
  // Geser ke UTC+7 lalu baca komponen sbg UTC, supaya tidak tergantung timezone mesin yg menjalankan.
  const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(wib.getUTCDate()).padStart(2, "0");
  const mm = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = wib.getUTCFullYear();
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const min = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

/**
 * Port dari loop pembersih di ambilDetailPenerimaPerBaris (Kode.gs baris 1446-1455): tiap sel
 * bertipe Date diformat dd-MM-yyyy, null/undefined jadi string kosong, selain itu apa adanya.
 * HANYA untuk kolom tanggal MURNI (tanggal_lahir, batas_waktu_perbaikan) — tanggal_verifikasi &
 * tanggal_lapor_perbaikan pakai formatTanggalWaktuWIB() di atas (sertakan jam:menit).
 */
export function bersihkanSelUntukArray(nilai: unknown): unknown {
  if (nilai instanceof Date) return formatTanggalDDMMYYYY(nilai);
  if (nilai === null || nilai === undefined) return "";
  return nilai;
}
