-- ============================================================
-- OUTBOX SINKRONISASI KE GOOGLE SHEETS (cermin/backup)
-- Ditulis dalam transaksi yang sama dengan perubahan data utama, diproses async
-- oleh Edge Function terjadwal `sync-worker` supaya jalur input utama tidak pernah
-- menunggu Google Sheets API (lihat rencana migrasi § Strategi Sinkronisasi).
-- ============================================================
create table if not exists sync_outbox (
  id             bigserial primary key,
  dibuat_at      timestamptz not null default now(),
  jenis_operasi  text not null,        -- 'INSERT_PENERIMA' | 'UPDATE_PENERIMA' | 'UPDATE_VERIFIKASI' | dst
  sheet_tujuan   text not null,        -- mis. 'Data Input 2027', 'db_riwayat_edit', 'db_setelan'
  entity_ref     jsonb not null,       -- {tabel:'penerima', id:.., tahun:..} - dipakai utk update sheet_row_number balik
  payload        jsonb not null,       -- baris siap tulis (array nilai kolom, urutan sesuai header sheet tujuan)
  status         text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SUKSES', 'GAGAL')),
  percobaan      int not null default 0,
  next_retry_at  timestamptz not null default now(),
  terakhir_error text,
  diproses_at    timestamptz
);
create index if not exists idx_outbox_status_retry on sync_outbox(status, next_retry_at);

create table if not exists sync_dead_letter (
  id             bigserial primary key,
  outbox_id      bigint,
  dibuat_at      timestamptz not null default now(),
  jenis_operasi  text,
  sheet_tujuan   text,
  payload        jsonb,
  error_terakhir text,
  ditangani      boolean not null default false
);
create index if not exists idx_dead_letter_ditangani on sync_dead_letter(ditangani) where ditangani = false;
