-- Cek SEBELUM rilis fitur "domisili lintas kecamatan" (HANYA SELECT, tidak mengubah data).
--
-- Akun kelurahan ("KELURAHAN X[_penanda]") sekarang hanya bisa memilih rumah ibadah yang kolom
-- kelurahan-nya SAMA PERSIS (setelah huruf besar + rapikan spasi) dengan nama kelurahan akun.
-- Kalau ejaan di tabel rumah_ibadah berbeda (mis. "TEGALSARI MANDALA I" vs "TEGAL SARI MANDALA I"),
-- rumah ibadah itu hilang dari pop up akun tersebut dan inputnya terblokir.
--
-- Hasil: akun kelurahan aktif yang TIDAK punya satu pun rumah ibadah dengan ejaan kelurahan yang
-- sama di kecamatannya. Baris yang muncul = perlu diperiksa (ejaan beda, atau memang belum ada data).

with akun_kel as (
  select username,
         upper(btrim(regexp_replace(kecamatan, '\s+', ' ', 'g'))) as kec,
         upper(btrim(regexp_replace(split_part(substr(upper(btrim(user_id)), length('KELURAHAN ') + 1), '_', 1), '\s+', ' ', 'g'))) as kel
  from akun
  where aktif and upper(btrim(user_id)) like 'KELURAHAN %'
),
ri as (
  select upper(btrim(regexp_replace(kecamatan, '\s+', ' ', 'g'))) as kec,
         upper(btrim(regexp_replace(kelurahan, '\s+', ' ', 'g'))) as kel,
         count(*) as jumlah
  from rumah_ibadah
  group by 1, 2
)
select a.username, a.kec, a.kel as kelurahan_akun,
       (select string_agg(ri.kel || ' (' || ri.jumlah || ')', ', ' order by ri.kel)
          from ri where ri.kec = a.kec) as kelurahan_di_data_rumah_ibadah
from akun_kel a
where not exists (select 1 from ri where ri.kec = a.kec and ri.kel = a.kel)
order by a.kec, a.kel;
