import postgres from "npm:postgres@3.4.4";

const connectionString = Deno.env.get("SUPABASE_DB_URL");

if (!connectionString) {
  throw new Error(
    "Env var SUPABASE_DB_URL belum diset. Set lewat: supabase secrets set SUPABASE_DB_URL=... " +
    "(connection string Postgres project Supabase, lihat Dashboard > Project Settings > Database).",
  );
}

// prepare:false -> aman dipakai di belakang connection pooler (Supavisor/pgbouncer transaction mode)
// max:1 -> tiap isolate Edge Function cukup 1 koneksi; tanpa ini defaultnya bisa buka beberapa
// koneksi sekaligus per isolate dan menghabiskan slot pool Supavisor saat trafik ramai bersamaan.
// connect_timeout:10 -> putuskan koneksi jika pooler tidak merespon dalam 10 detik agar tidak hang 45 detik.
// idle_timeout:15 -> bebaskan slot koneksi pooler lebih cepat ketika fungsi sedang menganggur.
export const sql = postgres(connectionString, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 15,
});

