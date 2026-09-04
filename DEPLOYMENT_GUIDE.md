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
* **Value:** `https://script.google.com/macros/s/AKfycbynxqlpYro4mIOLqTizr6JYbFVXvVcJc7axlvuaz44DvSOTr8aORzNgaHSWuOp52smPYQ/exec`
* **Target:** Centang Production, Preview, dan Development.

### B. Secret Token (Wajib)
Token rahasia ini memastikan hanya server Vercel Anda yang bisa menyuruh GAS mengeksekusi operasi database.
* **Key:** `GAS_SECRET_TOKEN`
* **Value:** `DJPM2027_DEFAULT_SECRET` (Ubah nilai ini jika ingin lebih aman, namun pastikan nilai yang sama di-update ke PropertiesService di Apps Script).
* **Target:** Centang Production, Preview, dan Development.

---

## 3. Batas Ukuran Unggahan Berkas (Payload Limit)

Sistem menggunakan Vercel Serverless Function yang membatasi muatan payload maksimal **4.5 MB** per *request*.
* Aplikasi di sisi klien (`index.html`) akan otomatis mengompresi gambar (JPG, PNG) di browser pengguna.
* Jika pengguna mengunggah dokumen PDF dalam jumlah banyak dan total ukurannya mendekati **3.5 MB**, sistem akan menolak dan meminta pengguna mengunggah berkas yang lebih kecil sebelum melakukan proses upload.
* Jangan mengubah batas aman ini kembali ke 60MB, karena upload tetap akan dicekal oleh mesin cloud Vercel (HTTP 413 Payload Too Large) dan formulir gagal disubmit.
