-- ============================================================
-- Migration: Tambah Layanan Guru Sekolah Kong Hu Chu ke Kemenag & SK Layanan
-- ============================================================

-- 1. Tambah layanan ke layanan_master di bawah kategori KEMENAG
insert into layanan_master (kategori, nama_layanan, urutan)
values ('KEMENAG', 'GURU SEKOLAH KONG HU CHU', 5)
on conflict (kategori, nama_layanan) do nothing;

-- 2. Tambah kode layanan GSK ke sk_layanan untuk modul pembayaran & SK
insert into sk_layanan (layanan_kode, jumlah_sk)
values ('GSK', 0)
on conflict (layanan_kode) do nothing;
