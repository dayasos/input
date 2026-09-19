-- ============================================================================
-- Migrasi: fn_broadcast_realtime_event jadi trigger PER STATEMENT, bukan PER ROW
-- ============================================================================
-- Ditemukan saat code review (2026-09-20): trigger di 20260917040000 didaftarkan
-- "for each row", tapi isi fungsinya TIDAK PERNAH memakai data baris (NEW/OLD) -- v_id selalu
-- diisi null, dan v_domain cuma bergantung pada TG_TABLE_NAME (konstan per tabel, sama untuk
-- semua baris dalam 1 statement). Akibatnya 1 UPDATE yang mengenai 500 baris sekaligus (mis.
-- verifikasiMassalMemenuhiSyarat) memicu 500x INSERT ke realtime_event_bus DAN 500 pesan
-- WebSocket terpisah ke SETIAP klien yang terhubung -- padahal 1 sinyal saja sudah cukup utk
-- memberi tahu "domain X berubah, silakan invalidasi cache" (lihat pemakainya di
-- app-admin.js .on('postgres_changes', ...)/.on('broadcast', ...), yang cuma peduli nama domain,
-- bukan baris mana yang berubah).
--
-- Perbaikan: ganti ke "for each statement" -- 1 sinyal per statement SQL, apa pun jumlah baris
-- yang kena. NEW/OLD tidak tersedia di trigger level-statement, jadi fungsi tidak lagi
-- mereferensikannya sama sekali (sebelumnya juga tidak dipakai isinya, cuma dipakai di
-- `return coalesce(NEW, OLD)` yang untuk AFTER trigger nilainya diabaikan Postgres).

create or replace function public.fn_broadcast_realtime_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain varchar(50);
begin
  if TG_TABLE_NAME in ('penerima_2027', 'penerima', 'penerima_2026') then
    v_domain := 'penerima';
  elsif TG_TABLE_NAME in ('data_detail_2027', 'data_detail') then
    v_domain := 'data_detail';
  elsif TG_TABLE_NAME = 'kuota' or TG_TABLE_NAME = 'kuota_katolik' then
    v_domain := 'kuota';
  elsif TG_TABLE_NAME = 'setelan' then
    v_domain := 'setelan';
  elsif TG_TABLE_NAME = 'akun' then
    v_domain := 'akun';
  else
    v_domain := TG_TABLE_NAME;
  end if;

  insert into public.realtime_event_bus (domain, aksi, entitas_id, created_at)
  values (v_domain, TG_OP, null, now());

  return null; -- diabaikan Postgres utk AFTER STATEMENT trigger
exception when others then
  -- Jangan gagalkan statement utama jika logging sinyal mengalami kendala
  return null;
end;
$$;

revoke execute on function public.fn_broadcast_realtime_event() from public, anon, authenticated;
grant execute on function public.fn_broadcast_realtime_event() to postgres, service_role;

-- Ganti trigger dari FOR EACH ROW ke FOR EACH STATEMENT di kelima tabel yang sama.
drop trigger if exists trg_event_penerima_2027 on public.penerima_2027;
create trigger trg_event_penerima_2027
after insert or update or delete on public.penerima_2027
for each statement execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_kuota on public.kuota;
create trigger trg_event_kuota
after insert or update or delete on public.kuota
for each statement execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_setelan on public.setelan;
create trigger trg_event_setelan
after insert or update or delete on public.setelan
for each statement execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_akun on public.akun;
create trigger trg_event_akun
after insert or update or delete on public.akun
for each statement execute function public.fn_broadcast_realtime_event();

drop trigger if exists trg_event_data_detail_2027 on public.data_detail_2027;
create trigger trg_event_data_detail_2027
after insert or update or delete on public.data_detail_2027
for each statement execute function public.fn_broadcast_realtime_event();

-- PENTING untuk pergantian tahun berikutnya (mis. partisi penerima_2028/data_detail_2028):
-- trigger event bus HARUS dibuat eksplisit "for each statement" pada partisi baru itu juga --
-- tidak diwariskan otomatis dari partisi lama, sama seperti catatan RLS di
-- 20260914130000_enable_rls_partisi_penerima.sql.
