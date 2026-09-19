// Pengganti hashString_() di Kode.gs (Utilities.computeDigest SHA_256) — SHA-256 hex standar,
// hasilnya identik byte-per-byte sehingga password_hash lama (disalin apa adanya saat backfill
// dari db_admin) tetap valid tanpa perlu reset password pengguna.
export async function hashString(teks: string): Promise<string> {
  const data = new TextEncoder().encode(teks);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Bandingkan 2 hex digest TANPA short-circuit di karakter pertama yang beda -- `===` biasa pada
// V8 berhenti di byte pertama yang tidak cocok, jadi durasi perbandingannya bocor sedikit info
// soal seberapa jauh tebakan penyerang sudah benar (timing side-channel). Selalu proses SELURUH
// panjang string sebelum mengembalikan hasil, dan panjang berbeda tetap dianggap "tidak cocok"
// tanpa membocorkan panjang aslinya lewat waktu eksekusi.
export function bandingkanHashConstantTime(a: string, b: string): boolean {
  const panjang = Math.max(a.length, b.length);
  let hasil = a.length === b.length ? 0 : 1;
  for (let i = 0; i < panjang; i++) {
    const kodeA = i < a.length ? a.charCodeAt(i) : 0;
    const kodeB = i < b.length ? b.charCodeAt(i) : 0;
    hasil |= kodeA ^ kodeB;
  }
  return hasil === 0;
}
