import { sql } from "./db.ts";

// Sama persis DURASI_SESI_DETIK di Kode.gs (6 jam)
const DURASI_SESI_DETIK = 6 * 60 * 60;

export interface DataSesi {
  akunId: string;
  username: string;
  role: string;
  kecamatan: string;
  userId: string;
}

function buatToken(): string {
  // format sama seperti Utilities.getUuid() + "-" + Utilities.getUuid() di Kode.gs
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

/** Pengganti buatSesi_() — dulu menulis ke CacheService, sekarang ke tabel sesi_login (UNLOGGED). */
export async function buatSesi(akun: DataSesi): Promise<string> {
  const token = buatToken();
  const kedaluwarsaAt = new Date(Date.now() + DURASI_SESI_DETIK * 1000);
  await sql`
    insert into sesi_login (token, akun_id, username, role, kecamatan, user_id, kedaluwarsa_at)
    values (${token}, ${akun.akunId}, ${akun.username}, ${akun.role}, ${akun.kecamatan}, ${akun.userId}, ${kedaluwarsaAt})
  `;
  return token;
}

/** Pengganti ambilSesi_() — null jika token tidak ada/kedaluwarsa, sama seperti CacheService.get(). */
export async function ambilSesi(token: string | null | undefined): Promise<DataSesi | null> {
  if (!token) return null;
  const rows = await sql`
    select akun_id, username, role, kecamatan, user_id
    from sesi_login
    where token = ${token} and kedaluwarsa_at > now()
    limit 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    akunId: r.akun_id,
    username: r.username,
    role: r.role,
    kecamatan: r.kecamatan,
    userId: r.user_id,
  };
}

/** Pengganti wajibSesi_() — melempar error yang sama persis pesannya agar frontend tidak berubah. */
export async function wajibSesi(token: string | null | undefined): Promise<DataSesi> {
  const sesi = await ambilSesi(token);
  if (!sesi || !sesi.role) {
    throw new Error("SESI TIDAK SAH: Silakan login ulang.");
  }
  return sesi;
}

export async function hapusSesi(token: string): Promise<void> {
  await sql`delete from sesi_login where token = ${token}`;
}
