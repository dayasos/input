# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DJPM 2027 — a web app for Dinas Sosial / Kemenag Kota Medan to collect and verify recipient data for a government assistance program ("Dana Jasa Pelayanan"). Live production system used by ~21 kecamatan + Kemenag admins. Data is sensitive PII (NIK, bank accounts, addresses) — treat changes to auth/access-control logic with extra care.

## Current architecture (production, live today)

```
Browser (index.html, vanilla JS, Tailwind via CDN — no build step, no framework)
  → js/api-bridge.js  (shim: window.google.script.run.<fn>(...) → fetch('/api/gas'))
  → api/gas.js         (Vercel serverless function: proxy, injects shared secret, retry/fallback)
  → Kode.gs             (Google Apps Script Web App — doPost() dispatcher, ~60-fn ALLOWED{} whitelist)
  → Google Sheets (2 spreadsheets, ~20 tabs) + Google Drive (uploaded berkas)
```

**This diagram predates the Supabase migration and is now the legacy fallback path, not the live one.** The primary path today is `api/gas.js` → Supabase Edge Function (`supabase/functions/api/index.ts`) → Postgres, with file uploads going to Supabase Storage — see "In-progress migration to Supabase" below for what's actually live.

`Kode.gs` is the single source of truth for all business logic not yet migrated to Supabase: RBAC (role = "UTAMA" / "KECAMATAN" / a Kemenag layanan name), session handling via `CacheService`, quota/duplicate-NIK/duplicate-rekening validation, file uploads to Drive, and the daily trigger that expires unfinished verifications. `appsscript.json` runs as `executeAs: USER_DEPLOYING` on a **personal** (non-Workspace) Google account — this matters because a Service Account cannot create new files in that Drive (0-byte quota), only edit already-shared files/sheets.

`index.html` is a single ~7000-line file: all tabs (Input Data, Lihat Data, Dashboard Progres Verifikasi, kuota, akses per-user, akun) and all JS logic live here. (The chat/messaging feature that used to live here was removed entirely — backend and UI — on 2026-09-12; don't reintroduce it as part of the migration.) Every backend call goes through `google.script.run.<namaFungsi>(...)`, which the `api-bridge.js` shim turns into `fetch('/api/gas', {action, args})`.

## In-progress migration to Supabase

The app is being migrated to Supabase (Postgres + Edge Functions) as the primary backend, with Google Sheets kept as an auto-synced mirror/backup (not the other way around). Full architecture, schema design, and phased rollout plan: `C:\Users\user\.claude\plans\saya-ingin-migrasi-ke-humble-codd.md` (outside this repo — read it before continuing migration work).

Key decisions already locked in (don't re-litigate without asking):
- **Supabase is now the ONLY data store (decided 2026-09-15)** — superseded the earlier "Sheets stay as a synced mirror/backup" plan. `penerima` data is still mirrored to Google Sheets via the outbox/`sync-worker` pattern (`sync_outbox` table + `pg_cron` every 1 minute, see `20260915090000_pg_net_dan_cron_sync.sql`) as of this writing, but this is scheduled to be retired — don't build new features that assume Sheets will keep receiving that mirror indefinitely.
- Full rewrite of business logic into Supabase Edge Functions (Deno), one dispatcher mirroring `doPost()`'s `{action, args} → {result}/{error}` contract, so `index.html`/`api-bridge.js` barely change.
- Custom auth table (`akun`) replaces `db_admin` 1:1 — NOT Supabase Auth. Password hashes are copied as-is (SHA-256 hex) so existing users don't need to reset passwords.
- **File uploads moved to Supabase Storage (decided + shipped 2026-09-15)** — superseded the earlier "file uploads stay on Google Drive" plan. See the "Upload berkas" bullet below for details. Decision was only feasible because production data/berkas were still empty at the time — this was a clean cutover, not a live migration.
- The Input app ("Aplikasi Input", this repo) is one of 3 apps meant to eventually share this same Supabase database: **Aplikasi Retur** (currently a separate GAS+Sheets app, `../Retur 2027/`, not yet migrated) and **Aplikasi Pembayaran** (currently a fully manual Excel-based process, no code exists yet). Both read what used to be the "Data Detail" Google Sheet — see the `data_detail` table below, which is their intended shared read target once they're migrated. Don't build anything that assumes Retur/Pembayaran stay Sheets-based long-term.

Structure:
- `supabase/migrations/*.sql` — Postgres schema, chronologically numbered. `penerima` (the core recipient table) is `PARTITION BY LIST (tahun)` — indexes/constraints are created on the **parent** table so new year-partitions inherit them automatically; never add them to a child partition only.
- `supabase/functions/api/index.ts` — the dispatcher; `domains/*.ts` — one file per functional area, ported from `Kode.gs` with `// Port 1:1 dari <fn>()` comments citing exact source line numbers. **Fase 4 SELESAI (2026-09-14)**: semua domain sudah diporting: `auth`, `master`, `validasi`, `penerima` (full CRUD: `ambilDataLihatDataHakAkses`, `ambilDetailPenerimaPerBaris`, `simpanDataKeSheet`, `editDataPenerima`), `riwayat`, `dashboard`, `kuota`, `verifikasi` (termasuk `cekBatasWaktuVerifikasi`), `setelan`, `akun`, `ekspor` (via npm:xlsx), `sso`.
  - **TIDAK diporting (sengaja)**: `setHeaderUserId` (utilitas sekali-jalan tidak dipanggil frontend); `chat` (dihapus total 2026-09-12).
  - **Fitur "Data Detail" lama (per-baris, NIK-matched ke sheet eksternal) dihapus total 2026-09-15** — jangan diporting kembali dengan bentuk itu. **Dibangun ulang di hari yang sama sebagai fitur baru murni Supabase** (bukan porting dari `Kode.gs`, tidak ada padanan di GAS): satu tombol di header tab Lihat Data (`ambilDataDetail` di `domains/dataDetail.ts`) yang menampilkan rekap penerima berstatus "Memenuhi Syarat" dari tabel `data_detail` (partisi per tahun, migrasi `20260915110000_data_detail.sql`) — ini pengganti sheet "Data Detail" + formula `QUERY()` lama, dipakai sebagai sumber proses Pembayaran di luar aplikasi ini. Diisi lewat upsert idempoten (`INSERT ... ON CONFLICT DO NOTHING` dari `penerima`) tiap kali tombol dibuka, BUKAN trigger di setiap fungsi verifikasi. Kolom `status`/`tgl_status` (siklus AKTIF/MENINGGAL/TIDAK AKTIF/dst) SENGAJA tidak pernah ditulis aplikasi ini setelah baris dibuat — itu wewenang Aplikasi Retur begitu nanti tersambung ke database yang sama (lihat rencana migrasi Retur 2027 & Aplikasi Pembayaran).
  - **Upload berkas dipindah ke Supabase Storage 2026-09-15** (`uploadSemuaBerkasKeSupabase` di `domains/upload.ts`, helper di `_shared/storage.ts`) — GAS's `uploadSemuaBerkasKeDrive` is no longer called from `index.html` (left in `Kode.gs` untouched as an emergency fallback, not deleted). Files go to a **private** bucket `berkas-penerima` (provisioned via `20260915120000_bucket_berkas_penerima.sql`); each upload gets a ~10-year signed URL stored directly in `penerima.link_*` / `id_folder_berkas`, so `index.html` didn't need to change how it stores/renders these links. Uses `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (auto-provided to every Edge Function, unlike `SUPABASE_DB_URL` which must be set manually). `simpanDataKeSheet`/`editDataPenerima` still receive `formObject.__linkBerkas` (dict of URLs) — that request contract didn't change, only where the URLs point to.
- Shared access-control logic (instansi/layanan/kecamatan/kelurahan-lock/sub-filter GSM Katolik-Kristen) lives in `_shared/akses.ts`'s `lolosAksesBarisLihatData` — reuse it for any new row-level read/write function instead of re-deriving the cascade inline (a hand-copied version of this exact cascade in `Kode.gs` is what caused a real PII-leak bug in `ambilDataDetailByNik`).
- **Row Level Security is enabled with zero policies on every `public` table** (`20260911090000_enable_rls.sql`) — required because `supabase/config.toml` leaves `auto_expose_new_tables` at its default `true`, which would otherwise expose every table (including `akun` password hashes and `penerima` PII) directly over the public PostgREST Data API. Edge Functions are unaffected (they connect via `SUPABASE_DB_URL`, a direct Postgres connection as the `postgres` superuser role, which bypasses RLS). Any new migration that adds a table must `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` in the same migration — don't rely on remembering a separate follow-up.
- `supabase/functions/api/_shared/config.ts` — `TAHUN_AKTIF` (active year) is read from an env var here, matching the same env var the backfill script uses. Keep these in sync when the year rolls over.
- `scripts/backfill/` — one-time Node.js script to copy existing Sheets data into Postgres. **Has not been run yet** (no Supabase/Google credentials configured). Defaults to dry-run (read Sheets, print report, write nothing); real writes require both `--write` AND env var `BACKFILL_CONFIRM=YA`.

When porting another function from `Kode.gs`: read the source function fully (including how `index.html` consumes its return value — response shapes like array-of-arrays vs. named object, exact field names, exact error messages) before writing the Deno port. Field-for-field parity matters because the frontend is not being rewritten.

## Commands

Install dependencies (Supabase CLI, `googleapis`, `pg` for the backfill script, `pptxgenjs` for generating the admin guide `.pptx`):
```
npm install
```

Supabase CLI must be invoked via the local install — a bare `npx supabase@latest` fails with "No matching Supabase CLI binary package found for win32-x64" on this machine:
```
npx supabase <command>
```

Run the backfill script (see `scripts/backfill/run.js` header comment for full usage):
```
node scripts/backfill/run.js --step=<akun|master-data|capil|setelan|arsip-tahun-lalu|data-input-aktif|riwayat-edit|all>
# add --write plus env var BACKFILL_CONFIRM=YA to actually write to Postgres
```

Deploying a `Kode.gs` change: in the Apps Script editor use **Deploy → Manage deployments → edit the existing deployment → New version** — never "New deployment", or the Web App URL changes and the Vercel proxy breaks. Full SOP and required env vars (`GAS_API_URL`, `GAS_SECRET_TOKEN`, and the Supabase secrets once deploy starts) are in `DEPLOYMENT_GUIDE.md`.

There is no build step, linter, or test suite configured in this repo.
