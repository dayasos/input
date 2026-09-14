-- Ekstensi dasar
create extension if not exists citext;
create extension if not exists pgcrypto;

-- ============================================================
-- AKUN (pengganti sheet db_admin)
-- ============================================================
create table if not exists akun (
  id            uuid primary key default gen_random_uuid(),
  username      citext unique not null,
  password_hash text not null,              -- SHA-256 hex, disalin apa adanya dari db_admin saat backfill
  role          text not null,              -- 'UTAMA' | 'KECAMATAN' | nama layanan (mis. 'IMAM MASJID')
  kecamatan     text not null default '',
  user_id       text not null default '',   -- kolom H lama: kunci sakelar per-user, prefix 'KELURAHAN ' dsb
  nama_lengkap  text not null default '',
  nomor_hp      text not null default '',
  jabatan       text not null default '',
  aktif         boolean not null default true,
  dibuat_at     timestamptz not null default now(),
  diperbarui_at timestamptz not null default now()
);
create index if not exists idx_akun_role_kecamatan on akun(role, kecamatan);

-- ============================================================
-- SESI LOGIN (pengganti CacheService sesi_&lt;token&gt;, TTL 6 jam)
-- UNLOGGED: data ephemeral, boleh hilang saat crash DB (sama seperti CacheService)
-- ============================================================
create unlogged table if not exists sesi_login (
  token          text primary key,          -- format: uuid-uuid, sama seperti Utilities.getUuid()x2
  akun_id        uuid not null references akun(id) on delete cascade,
  username       citext not null,
  role           text not null,
  kecamatan      text not null default '',
  user_id        text not null default '',
  dibuat_at      timestamptz not null default now(),
  kedaluwarsa_at timestamptz not null
);
create index if not exists idx_sesi_kedaluwarsa on sesi_login(kedaluwarsa_at);

-- ============================================================
-- BRUTE-FORCE LOCK LOGIN (pengganti CacheService counter, 5x gagal / 15 menit)
-- ============================================================
create unlogged table if not exists login_percobaan_gagal (
  username_upper text primary key,
  jumlah_gagal   int not null default 0,
  jendela_mulai  timestamptz not null default now()
);

-- Pembersihan sesi kedaluwarsa & jendela brute-force lama (dijadwalkan via pg_cron, lihat migrasi cron)
