-- Migrasi: Tabel log_arsip_data_detail
-- Dibuat: 2026-10-12
-- Tujuan: Menyimpan jejak audit setiap baris data_detail yang dihapus dari tabel aktif
--         karena status penerima berubah dari "Memenuhi Syarat" ke status lain.
--         Independen dari Google Sheets (fallback apabila backup Sheets gagal).
-- ============================================================================

create table if not exists log_arsip_data_detail (
  id            bigserial primary key,
  penerima_id   bigint not null,
  tahun         int not null,
  nik           text,
  nama          text,
  alasan        text,                    -- status baru yang menyebabkan penghapusan
  waktu_arsip   timestamptz not null default now(),
  diarsip_oleh  text                     -- username admin atau 'SISTEM' jika otomatis
);

-- Index untuk pencarian cepat berdasarkan penerima_id (mis. audit trail per orang)
create index if not exists idx_log_arsip_data_detail_penerima_id
  on log_arsip_data_detail (penerima_id);

-- Index untuk pencarian berdasarkan tahun
create index if not exists idx_log_arsip_data_detail_tahun
  on log_arsip_data_detail (tahun);

-- Komentar tabel
comment on table log_arsip_data_detail is
  'Jejak audit baris data_detail yang dihapus saat status penerima berubah dari Memenuhi Syarat. '
  'Data asli di-backup ke tab "Arsip Data Detail" di Google Sheets sebelum dihapus dari data_detail.';
