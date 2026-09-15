# Panduan Deployment & Keamanan Sistem Input 2027

Dokumen ini adalah SOP (Standard Operating Procedure) untuk mengelola pembaruan kode dan lingkungan (environment) agar koneksi antara Vercel dan Google Apps Script (GAS) tidak pernah terputus.

---

## 1. Mencegah Perubahan URL Web App Google Apps Script

Kesalahan paling umum yang menyebabkan Vercel gagal terhubung ke GAS (muncul error 500 atau 404 pada API) adalah karena pembuatan *deployment* baru yang menghasilkan URL baru.

### Cara Benar Memperbarui Kode di Apps Script (`Kode.gs`):
Jika Anda mengubah fungsi di `Kode.gs` dan menyalinnya ke editor Google Apps Script:
1. Klik tombol **Deploy** di sudut kanan atas editor Apps Script.
2. Pilih **Manage deployments** (Kelola deployment). **JANGAN** pilih *New deployment*.
3. Pada jendela yang muncul, klik ikon pensil (**Edit**) di sebelah deployment aktif Anda.
4. Di bagian **Version**, klik menu dropdown dan pilih **New version** (Versi baru).
5. Klik tombol **Deploy**.

> Dengan cara ini, kode terbaru Anda akan langsung aktif, dan URL Web App Anda `https://script.google.com/macros/s/.../exec` akan **tetap sama**, sehingga Vercel tidak perlu di-update.

---

## 2. Pengaturan Variabel Lingkungan (Environment Variables) di Vercel

Sistem keamanan baru menggunakan **Shared Secret Token** untuk mencegah eksekusi API liar yang langsung menyasar GAS. 

Di dashboard Vercel ([https://vercel.com/dashboard](https://vercel.com/dashboard)), pastikan Anda memiliki 2 variabel berikut di menu **Settings -> Environment Variables**:

### A. URL Backend (Wajib)
* **Key:** `GAS_API_URL`
* **Value:** `https://script.google.com/macros/s/AKfycbwQvkJ_6McDWi6erkIfP6CAnRu0L1f8ipIk18k7SltwQS-xhXyd-atnbaTNBdq0hjHyVg/exec`
* **Target:** Centang Production, Preview, dan Development.

### B. Secret Token (Wajib)
Token rahasia ini memastikan hanya server Vercel Anda yang bisa menyuruh GAS mengeksekusi operasi database.
* **Key:** `GAS_SECRET_TOKEN`
* **Value:** `DJPM2027_DEFAULT_SECRET` (Ubah nilai ini jika ingin lebih aman, namun pastikan nilai yang sama di-update ke PropertiesService di Apps Script).
* **Target:** Centang Production, Preview, dan Development.

---

## 3. Langkah Deployment Backend Supabase (Fase 4 - Siap Deploy)

Seluruh logika bisnis (48 aksi) telah berhasil diporting ke Supabase Edge Functions (`supabase/functions/api/`). Ikuti langkah-langkah berikut untuk melakukan deployment ke proyek Supabase (`wwqxbscumaakvziwzwjx`):

### Langkah 3.1: Hubungkan Proyek Supabase Lokal ke Cloud
Buka terminal di root proyek (`Input 2027`):
```bash
# 1. Login ke akun Supabase Anda (hanya jika belum login)
npx supabase login

# 2. Tautkan repository lokal ke proyek Supabase DJPM 2027
npx supabase link --project-ref wwqxbscumaakvziwzwjx
```

### Langkah 3.2: Terapkan Migrasi Skema Database & RLS
```bash
# Menerapkan seluruh file SQL di folder supabase/migrations/ ke PostgreSQL Supabase
npx supabase db push
```
> **Catatan Keamanan:** Seluruh tabel `public` telah dilindungi oleh Row Level Security (RLS) dengan zero-public-access (`20260911090000_enable_rls.sql`). Hanya Edge Function (via connection string pooler) yang memiliki akses baca-tulis penuh.

### Langkah 3.3: Atur Secret di Supabase Edge Functions
Jalankan perintah berikut untuk menyetel variabel lingkungan rahasia di cloud Supabase:
```bash
npx supabase secrets set SUPABASE_DB_URL="postgresql://postgres.[PROJECT_REF]:[PASSWORD_DATABASE]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
npx supabase secrets set GAS_SECRET_TOKEN="DJPM2027_DEFAULT_SECRET"
npx supabase secrets set SSO_SECRET_KEY="<SALIN_DARI_SCRIPT_PROPERTIES_APPS_SCRIPT>"
npx supabase secrets set TAHUN_AKTIF="2027"
```

### Langkah 3.4: Deploy Supabase Edge Function API
```bash
# Deploy fungsi api (parameter --no-verify-jwt diperlukan karena fungsi menggunakan custom token auth sesi)
npx supabase functions deploy api --no-verify-jwt
```
Setelah proses selesai, URL endpoint Edge Function Anda akan aktif di:
`https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api`

### Langkah 3.5: Migrasi Data Eksisting (Backfill dari Google Sheets)
Sebelum mengalihkan traffic, salin seluruh data yang ada di Google Sheets ke PostgreSQL Supabase:
```bash
# 1. Uji coba (Dry Run - hanya membaca dan menampilkan rekap tanpa menulis ke DB)
node scripts/backfill/run.js --step=all

# 2. Eksekusi penulisan nyata ke database Supabase
$env:BACKFILL_CONFIRM="YA"; node scripts/backfill/run.js --step=all --write
```

### Langkah 3.6: Pengalihan Traffic di Vercel

**Update 2026-09-15 — murni Supabase, fallback ke GAS sudah dihapus total.** Proxy `api/gas.js` sekarang HANYA berbicara ke Supabase Edge Function — tidak ada lagi mode transisi maupun percobaan otomatis ke Google Apps Script kalau Supabase gagal (GAS punya cold-start & keandalan lebih rendah, jadi fallback ke sana dulu justru menambah titik gagal, bukan mengurangi).

Isi `GAS_API_URL` (nama env var lama, dipertahankan untuk kompatibilitas) atau `SUPABASE_EDGE_FUNCTION_URL` dengan `https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api`. Kalau env var kosong/tidak valid, proxy otomatis memakai URL Supabase itu sebagai default (`DEFAULT_TARGET_URL` di `api/gas.js`) — bukan lagi default ke GAS seperti sebelumnya.

## 4. Batas Ukuran Unggahan Berkas (Payload Limit)

Sistem menggunakan Vercel Serverless Function yang membatasi muatan payload maksimal **4.5 MB** per *request*.
* Aplikasi di sisi klien (`index.html`) akan otomatis mengompresi gambar (JPG, PNG) di browser pengguna.
* Jika pengguna mengunggah dokumen PDF dalam jumlah banyak dan total ukurannya mendekati **3.5 MB**, sistem akan menolak dan meminta pengguna mengunggah berkas yang lebih kecil sebelum melakukan proses upload.
* Jangan mengubah batas aman ini kembali ke 60MB, karena upload tetap akan dicekal oleh mesin cloud Vercel (HTTP 413 Payload Too Large) dan formulir gagal disubmit.

---

## 5. Variabel Lingkungan Tambahan (Fase 4 — Supabase sepenuhnya aktif)

Setelah Fase 4 migrasi selesai dan Edge Function Supabase di-deploy, tambahkan variabel-variabel ini ke Vercel Dashboard **Settings → Environment Variables**:

### C. URL Edge Function Supabase (Backend Utama Baru)
* **Key:** `SUPABASE_EDGE_FUNCTION_URL`
* **Value:** `https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api`
* **Target:** Centang Production, Preview, dan Development.
* **Keterangan:** Digunakan oleh `api/gas.js` untuk mengalihkan pemanggilan API utama ke Supabase Edge Function, serta digunakan oleh `api/cron.js` untuk menjalankan tugas cron harian.

### D. SSO Secret Key
* **Key:** `SSO_SECRET_KEY`
* **Value:** Salin nilai kunci yang sama yang ada di Script Properties Apps Script DJPM (nama property: `SSO_SECRET_KEY`). Jalankan `generateDanTampilkanKunciSSO()` sekali dari editor Apps Script untuk mendapatkan nilainya.
* **Target:** Centang Production, Preview, dan Development.
* **Keterangan:** Digunakan oleh `buatTokenSSORetur` di Edge Function untuk menandatangani token SSO ke app Retur 2027.

### E. Cron Secret (Opsional tapi Disarankan)
* **Key:** `CRON_SECRET`
* **Value:** String acak yang panjang (mis. UUID). Buat sendiri: `openssl rand -hex 32`
* **Target:** Production saja.
* **Keterangan:** Melindungi endpoint `/api/cron` dari akses tidak sah. Vercel Cron otomatis mengirim header `Authorization: Bearer <nilai>` saat schedule berjalan.

### F. URL Retur 2027 (Opsional)
* **Key:** `SSO_URL_RETUR`
* **Value:** `https://retur2027.vercel.app` (atau URL deployment Retur yang berlaku)
* **Keterangan:** Bila tidak diset, Edge Function menggunakan default `https://retur2027.vercel.app`.

---

## 6. Jadwal Cron Otomatis

`vercel.json` sudah dikonfigurasi dengan satu cron job:

| Path | Schedule | Keterangan |
|---|---|---|
| `/api/cron` | `0 18 * * *` | Setiap hari 01.00 WIB (18:00 UTC) — jalankan `cekBatasWaktuVerifikasi` |

Cron ini otomatis mengubah data "Berkas Tidak Lengkap" yang melewati batas waktu perbaikan menjadi "Tidak Memenuhi Syarat", menggantikan trigger harian Apps Script yang sebelumnya menangani tugas ini.

---

## 7. Arsitektur Smart SWR Cache & Realtime Synchronization

Aplikasi dilengkapi dengan sistem caching dan sinkronisasi realtime cerdas:

1. **Smart SWR Cache (`js/api-bridge.js`)**:
   - Menghasilkan respon instan (0ms) dari memori/sessionStorage untuk mempercepat navigasi UI.
   - Mengambil data mutakhir di latar belakang (revalidation).
   - Menggunakan hashing DJB2 untuk mencegah UI berkedip jika data server tidak berubah.
   - Pengecekan duplikat kritis (NIK, Rekening, Tempat Tugas, Kuota) **selalu langsung live** ke database (tidak pernah di-cache).

2. **Realtime Multi-Device Sync (Supabase Broadcast Channel)**:
   - Setiap mutasi data (simpan, edit, verifikasi, ubah sakelar) menyiarkan event ke channel `djpm-sync`.
   - Seluruh tab browser dan perangkat pengguna lain yang sedang membuka aplikasi akan otomatis membatalkan cache lokal dan memperbarui data secara transparan tanpa refresh halaman.
   - Dilengkapi status badge di header aplikasi:
     - 🟢 **Realtime Sync**: Terhubung aktif ke WebSocket Supabase.
     - 🟡 **Menghubungkan...**: Proses negosiasi WebSocket.
     - ⚪ **SWR Mode**: Jaringan offline/terputus; cache lokal SWR tetap melayani data instan.

