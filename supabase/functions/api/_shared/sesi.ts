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

type CacheSesiEntry = { data: DataSesi; expiryMs: number };
const _sesiCache = new Map<string, CacheSesiEntry>();
// Cache in-memory ini PER-ISOLATE Deno -- Supabase Edge Function jalan di banyak isolate paralel,
// dan hapusSesi() cuma bersihkan cache di isolate yang menangani request logout itu (lihat
// invalidasiSesiCache di bawah). Isolate LAIN yang kebetulan sudah cache token yang sama tetap
// menganggap sesi valid sampai TTL ini habis, walau baris di DB sudah dihapus -- celah desain
// bawaan, bukan bug baru. TTL sengaja pendek (bukan 60 detik seperti semula) utk memperkecil
// jendela "logout belum berlaku di semua request" ini, sambil tetap dapat manfaat cache utk
// request beruntun dalam 1 isolate yang sama.
const SESI_CACHE_TTL_MS = 10_000; // 10 detik

function _ambilDariCache(token: string): DataSesi | null {
  const entry = _sesiCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiryMs) {
    _sesiCache.delete(token);
    return null;
  }
  return entry.data;
}

function _simpanKeCache(token: string, data: DataSesi): void {
  _sesiCache.set(token, { data, expiryMs: Date.now() + SESI_CACHE_TTL_MS });
  // Bersihkan entry kedaluwarsa secara oportunistik (hindari memory leak di isolat panjang umur)
  if (_sesiCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _sesiCache) {
      if (now > v.expiryMs) _sesiCache.delete(k);
    }
  }
}

/** Hapus sesi dari cache in-memory — WAJIB dipanggil saat logout. */
export function invalidasiSesiCache(token: string): void {
  _sesiCache.delete(token);
}

/** Pengganti buatSesi_() — dulu menulis ke CacheService, sekarang ke tabel sesi_login (UNLOGGED). */
export async function buatSesi(akun: DataSesi): Promise<string> {
  const token = buatToken();
  const kedaluwarsaAt = new Date(Date.now() + DURASI_SESI_DETIK * 1000);
  await sql`
    insert into sesi_login (token, akun_id, username, role, kecamatan, user_id, kedaluwarsa_at)
    values (${token}, ${akun.akunId}, ${akun.username}, ${akun.role}, ${akun.kecamatan}, ${akun.userId}, ${kedaluwarsaAt})
  `;
  // Langsung cache setelah dibuat
  _simpanKeCache(token, akun);
  return token;
}

/** Pengganti ambilSesi_() — null jika token tidak ada/kedaluwarsa. Cache in-memory 60 detik. */
export async function ambilSesi(token: string | null | undefined): Promise<DataSesi | null> {
  if (!token) return null;

  // Cek cache in-memory dulu (hindari round-trip DB untuk request burst)
  const fromCache = _ambilDariCache(token);
  if (fromCache) return fromCache;

  // Fallback ke DB
  const rows = await sql`
    select akun_id, username, role, kecamatan, user_id
    from sesi_login
    where token = ${token} and kedaluwarsa_at > now()
    limit 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  const sesi: DataSesi = {
    akunId: r.akun_id,
    username: r.username,
    role: r.role,
    kecamatan: r.kecamatan,
    userId: r.user_id,
  };
  _simpanKeCache(token, sesi);
  return sesi;
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
  invalidasiSesiCache(token); // hapus dari cache dulu (fail-fast)
  await sql`delete from sesi_login where token = ${token}`;
}
