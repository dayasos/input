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
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
  max_lifetime: 30,
});
