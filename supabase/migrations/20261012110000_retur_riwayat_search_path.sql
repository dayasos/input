-- Kunci search_path fungsi trigger retur_riwayat_tolak_ubah (temuan penasihat keamanan Supabase:
-- "function_search_path_mutable"). Badan fungsi hanya `raise exception` dan tidak merujuk objek skema mana pun,
-- jadi search_path kosong aman dan perilakunya tidak berubah (riwayat Retur tetap append-only).
-- Kembali ke keadaan semula: alter function public.retur_riwayat_tolak_ubah() reset search_path;

alter function public.retur_riwayat_tolak_ubah() set search_path = '';
