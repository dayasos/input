-- ============================================================================
-- Migrasi: Lepas tabel PII dari publikasi supabase_realtime (tersisa dari 20260916160000)
-- ============================================================================
-- 20260916160000_realtime_auth_and_backup_cron.sql mendaftarkan penerima, kuota, setelan,
-- akun, data_detail ke publikasi supabase_realtime supaya perubahannya disiarkan via WAL/CDC.
-- SEHARI setelahnya, 20260917040000_realtime_event_bus_and_cleanup.sql sengaja membangun
-- tabel `realtime_event_bus` yang BEBAS PII khusus supaya klien tidak perlu (dan tidak boleh)
-- subscribe langsung ke tabel-tabel berisi data asli (NIK, rekening, alamat, password_hash, dst)
-- -- tapi lupa melepas 5 tabel lama ini dari publikasi.
--
-- Ditemukan saat code review (2026-09-20): tidak ada satu pun kode frontend yang subscribe
-- `postgres_changes` ke kelima tabel ini lagi (grep public/js/*.js -- cuma ada 1 subscription,
-- ke realtime_event_bus). RLS tanpa policy SELECT untuk anon/authenticated saat ini MENAHAN agar
-- baris tidak benar-benar terkirim ke klien (lihat 20260911090000_enable_rls.sql), tapi itu
-- pertahanan tidak langsung yang rapuh -- begitu suatu saat ada yang menambah policy SELECT di
-- salah satu tabel ini untuk kebutuhan lain (mis. akses baca terbatas via PostgREST), jalur CDC
-- PII ini otomatis aktif lagi tanpa disadari siapa pun. Melepasnya dari publikasi sekarang,
-- selagi memang tidak dipakai, juga mengurangi beban decode WAL logical replication tanpa
-- kehilangan fungsi apa pun (realtime_event_bus tetap menjadi satu-satunya sumber CDC ke browser).
do $$
begin
  begin
    alter publication supabase_realtime drop table public.penerima;
  exception when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime drop table public.kuota;
  exception when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime drop table public.setelan;
  exception when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime drop table public.akun;
  exception when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime drop table public.data_detail;
  exception when undefined_object then null;
  end;
end $$;
