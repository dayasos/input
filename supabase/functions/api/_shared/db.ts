import postgres from "npm:postgres@3.4.4";

const connectionString = Deno.env.get("SUPABASE_DB_URL");

if (!connectionString) {
  throw new Error(
    "Env var SUPABASE_DB_URL belum diset. Set lewat: supabase secrets set SUPABASE_DB_URL=... " +
    "(connection string Postgres project Supabase, lihat Dashboard > Project Settings > Database).",
  );
}

export const sql = postgres(connectionString, {
  prepare: false,
  // max 2 (bukan 1): query paralel (mis. Promise.all di dashboard) benar-benar jalan bersamaan.
  // Sengaja kecil karena tiap isolate Deno punya pool sendiri & pooler Supabase punya batas klien.
  // max_lifetime 30 detik dulu memaksa buka koneksi baru terus-menerus -> dinaikkan ke 5 menit.
  max: 2,
  connect_timeout: 5,
  idle_timeout: 10,
  max_lifetime: 300,
});
