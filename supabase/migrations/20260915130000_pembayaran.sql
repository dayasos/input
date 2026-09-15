-- ============================================================
-- PEMBAYARAN (halaman "Tools", khusus role UTAMA) — pengganti alur manual
-- "Kode.gs Data Bayar" (Google Sheets: sheet per layanan + REKAP + mirroring ke Drive).
--
-- KEPUTUSAN DESAIN PENTING: `pembayaran_baris` adalah SNAPSHOT BEKU, bukan hasil query
-- live dari `data_detail`. Alasannya: `data_detail` adalah data HIDUP (rekening/status bisa
-- berubah kapan saja, termasuk nanti lewat Aplikasi Retur) — dokumen pembayaran yang sudah
-- dibuat untuk bulan tertentu TIDAK BOLEH diam-diam berubah kalau dibuka/diunduh ulang di
-- kemudian hari. Setiap "Buat Data Bulan Ini" menyalin nilai APA ADANYA saat itu (termasuk
-- hasil kalkulasi kompensasi) ke `pembayaran_baris` -- perubahan pada `data_detail` setelahnya
-- TIDAK memengaruhi batch yang sudah dibuat, sampai ada "Buat Ulang" (menimpa) secara sengaja.
-- ============================================================

-- Satu batch = satu kombinasi (tahun, bulan, jenis). "Buat Ulang" MENIMPA baris batch yang
-- sama (bukan bikin versi baru) -- lihat unique constraint di bawah.
create table if not exists pembayaran_batch (
  id                  bigserial primary key,
  tahun               int not null,
  bulan               text not null,  -- "JANUARI".."DESEMBER", sama persis penulisan di Kode.gs asli
  jenis               text not null check (jenis in ('DJPM', 'BPJS')),
  dibuat_oleh_akun_id uuid references akun(id),
  dibuat_at           timestamptz not null default now(),
  diperbarui_at       timestamptz not null default now(),

  unique (tahun, bulan, jenis)
);

-- Baris snapshot beku -- salinan nilai `data_detail` PADA SAAT batch dibuat, plus hasil
-- kalkulasi kompensasi yang sudah dihitung saat itu. Kolom kalkulasi (jumlah_kotor, jkm, jkk,
-- jumlah_diterima) SENGAJA disimpan sebagai angka jadi (bukan dihitung ulang saat baca) --
-- itulah inti dari "beku": kalau formula/nominal berubah di masa depan, batch lama tetap
-- menampilkan angka yang berlaku SAAT batch itu dibuat.
create table if not exists pembayaran_baris (
  id              bigserial primary key,
  batch_id        bigint not null references pembayaran_batch(id) on delete cascade,

  -- Jejak ke baris sumber -- informasional saja, SENGAJA TANPA foreign key constraint (snapshot
  -- harus berdiri sendiri sepenuhnya, tidak boleh ikut rusak/gagal kalau baris data_detail
  -- sumbernya suatu saat dihapus). Boleh NULL kalau baris sumbernya sudah tidak ada.
  tahun           int not null,
  data_detail_id  bigint,

  nama            text not null,
  nik             text not null,
  layanan         text not null,
  layanan_kode    text not null,  -- kode singkat hasil mapping (BILAL, GMM, P. KUBUR, dst.)
  nomor_rekening  text,
  kecamatan       text,
  kelurahan       text,
  umur            int not null,

  jumlah_kotor      int not null,
  jkm               int not null,
  jkk               int not null,
  jumlah_potongan   int not null,
  jumlah_diterima   int not null,

  unique (batch_id, nik)
);

create index if not exists idx_pembayaran_baris_batch on pembayaran_baris (batch_id);

-- 3 pejabat penandatangan blok TTD di dokumen REKAP/sheet layanan. Diseed dengan nilai yang
-- SAMA PERSIS dengan yang di-hardcode di Kode.gs asli (isiRekapOtomatis / distribusiDataLayanan)
-- -- supaya perilakunya identik sampai memang ada yang mengedit lewat halaman Tools.
create table if not exists pejabat_ttd (
  id             bigserial primary key,
  peran          text not null unique check (peran in ('KEPALA_DINAS', 'PPTK', 'BENDAHARA')),
  nama           text not null,
  jabatan        text not null,
  nip            text not null,
  diperbarui_at  timestamptz not null default now()
);

insert into pejabat_ttd (peran, nama, jabatan, nip) values
  ('KEPALA_DINAS', 'KHOIRUDDIN S.Sos., SE., MM', 'PEMBINA UTAMA MUDA', 'NIP. 197011171990071001'),
  ('PPTK', 'RONALD FREDY SIHOTANG, S.IP., M.Si', 'PEMBINA', 'NIP. 198810122007011003'),
  ('BENDAHARA', 'NETTY ABDIATI NINGSIH, SE', 'PENATA', 'NIP. 197109262008012003')
on conflict (peran) do nothing;

alter table pembayaran_batch enable row level security;
alter table pembayaran_baris enable row level security;
alter table pejabat_ttd enable row level security;
