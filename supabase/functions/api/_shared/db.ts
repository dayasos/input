import postgres from "npm:postgres@3.4.4";

const connectionString = Deno.env.get("SUPABASE_DB_URL");

if (!connectionString) {
  throw new Error(
    "Env var SUPABASE_DB_URL belum diset. Set lewat: supabase secrets set SUPABASE_DB_URL=... " +
    "(connection string Postgres project Supabase, lihat Dashboard > Project Settings > Database).",
  );
}

// prepare:false -> aman dipakai di belakang connection pooler (Supavisor/pgbouncer transaction mode).
// Konfigurasi timeout diperketat 2026-09-17:
//   - connect_timeout: 5s  (dikurangi dari 10s) — cepat gagal jika Supavisor sibuk/cold
//   - idle_timeout: 5s     (dikurangi dari 15s) — edge function short-lived, koneksi idle bukan aset
//   - max_lifetime: 30s    — paksa daur-ulang koneksi agar tidak memakai soket basi dari isolat lama

export const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 10,
  max_lifetime: 30,
});
