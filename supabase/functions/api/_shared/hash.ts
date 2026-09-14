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
