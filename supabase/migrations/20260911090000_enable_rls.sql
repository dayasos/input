-- ============================================================
-- KRITIKAL — aktifkan Row Level Security di SEMUA tabel.
--
-- Temuan code review: supabase/config.toml TIDAK men-set `auto_expose_new_tables = false`,
-- jadi memakai default Supabase (`true`) — setiap tabel baru di schema `public` otomatis
-- bisa diakses langsung lewat PostgREST Data API (https://<ref>.supabase.co/rest/v1/<tabel>)
-- pakai anon key publik, TANPA melalui Edge Function sama sekali. Tanpa migrasi ini, begitu
-- skema di-push ke project live, siapa pun yang punya anon key (nilai publik, aman ditaruh di
-- frontend) bisa baca/tulis LANGSUNG ke `akun` (password_hash), `sesi_login` (token sesi aktif),
-- `penerima` (NIK, nomor rekening, alamat — PII lengkap), `capil`, dst — melewati
-- SELURUH validasi RBAC yang sudah dibangun hati-hati di supabase/functions/api/domains/*.ts.
--
-- Perbaikan: aktifkan RLS TANPA satu pun policy (default: tolak semua) di setiap tabel. Ini
-- AMAN bagi Edge Function karena `sql` di _shared/db.ts konek pakai SUPABASE_DB_URL — connection
-- string Postgres langsung dengan role `postgres` (superuser, otomatis BYPASSRLS) — BUKAN lewat
-- PostgREST/anon key. RLS di sini murni untuk mengunci PostgREST Data API (peran anon/authenticated),
-- bukan menghalangi Edge Function. Kalau nanti ada kebutuhan akses langsung dari klien (browser)
-- ke tabel tertentu via supabase-js, tambahkan policy eksplisit saat itu — jangan andalkan
-- "belum ada yang pakai jalur itu" sebagai alasan menunda RLS.
-- ============================================================

alter table akun enable row level security;
alter table sesi_login enable row level security;
alter table login_percobaan_gagal enable row level security;

alter table layanan_master enable row level security;
alter table wilayah enable row level security;
alter table kuota enable row level security;
alter table kuota_katolik enable row level security;
alter table rumah_ibadah enable row level security;
alter table capil enable row level security;

-- RLS di tabel induk partisi otomatis berlaku ke semua partisi (penerima_2027, dst),
-- sama seperti index/constraint — lihat catatan di 20260907090200_penerima_partitioned.sql.
alter table penerima enable row level security;
alter table detail_berkas enable row level security;

alter table setelan enable row level security;
alter table riwayat_setelan enable row level security;
alter table riwayat_edit enable row level security;

alter table sync_outbox enable row level security;
alter table sync_dead_letter enable row level security;
