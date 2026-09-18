// Helper Drive API v3 murni lewat fetch() (tanpa library `googleapis`, konsisten dengan pola
// _shared/googleAuth.ts & domains/backup-spreadsheet). Dipakai domains/upload.ts untuk migrasi
// upload berkas dari GAS (Apps Script) ke Drive API v3 langsung via Service Account -- lihat
// riwayat komentar di domains/upload.ts untuk konteks lengkap kenapa GAS ditinggalkan.
//
// Struktur folder & konvensi penamaan sengaja PERSIS meniru dapatkanFolderPendaftar_() /
// uploadBerkasPenerima_() di kode_gas.js (baris 346-382) supaya folder/file lama di Drive tetap
// konsisten dengan yang baru dibuat lewat jalur ini.

import { sql } from "./db.ts";
import { DRIVE_FOLDER_ID_INDUK } from "./config.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const MIME_FOLDER = "application/vnd.google-apps.folder";

function escapeNilaiQuery(s: string): string {
  // Query Drive API v3 pakai syntax mirip SQL: ' dan \ wajib di-escape dengan backslash.
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function driveFetch(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${DRIVE_API}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      ...(init.headers || {}),
    },
  });
}

// Port dari dapatkanOrBuatSubfolder_() -- cari subfolder dengan nama persis di dalam parentId,
// buat baru kalau belum ada. supportsAllDrives/includeItemsFromAllDrives disertakan supaya tetap
// jalan kalau folder induk nanti dipindah ke Shared Drive (rekomendasi di README migrasi).
async function cariAtauBuatSubfolder(accessToken: string, parentId: string, nama: string): Promise<string> {
  const q = `name='${escapeNilaiQuery(nama)}' and '${parentId}' in parents and mimeType='${MIME_FOLDER}' and trashed=false`;
  const resCari = await driveFetch(
    accessToken,
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1`,
  );
  if (!resCari.ok) {
    throw new Error(`Gagal mencari folder Drive "${nama}": ${resCari.status} ${await resCari.text()}`);
  }
  const dataCari = await resCari.json();
  if (Array.isArray(dataCari.files) && dataCari.files.length > 0) {
    return dataCari.files[0].id as string;
  }

  const resBuat = await driveFetch(accessToken, `/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    body: JSON.stringify({ name: nama, mimeType: MIME_FOLDER, parents: [parentId] }),
  });
  if (!resBuat.ok) {
    throw new Error(`Gagal membuat folder Drive "${nama}": ${resBuat.status} ${await resBuat.text()}`);
  }
  const dataBuat = await resBuat.json();
  return dataBuat.id as string;
}

function rapikanNamaFolder(s: unknown, fallback: string): string {
  const bersih = (s == null ? "" : String(s)).trim().toUpperCase();
  return bersih || fallback;
}

export interface KonteksFolderPendaftar {
  kecamatan?: string;
  layanan?: string;
  nama?: string;
  nik?: string;
  folderId?: string;
}

// Port dari dapatkanFolderPendaftar_(): FOLDER_ID_INDUK -> Kecamatan -> Layanan -> "NAMA (NIK)".
async function bangunRantaiFolderPendaftar(accessToken: string, K: KonteksFolderPendaftar): Promise<string> {
  const folderKec = await cariAtauBuatSubfolder(
    accessToken,
    DRIVE_FOLDER_ID_INDUK,
    rapikanNamaFolder(K.kecamatan, "(TANPA KECAMATAN)"),
  );
  const folderLayanan = await cariAtauBuatSubfolder(
    accessToken,
    folderKec,
    rapikanNamaFolder(K.layanan, "(TANPA LAYANAN)"),
  );
  const namaClean = rapikanNamaFolder(K.nama, "");
  const nikBersih = String(K.nik || "").replace(/[^0-9]/g, "");
  const namaFolderPendaftar = `${namaClean} (${nikBersih || "TANPA-NIK"})`;
  return cariAtauBuatSubfolder(accessToken, folderLayanan, namaFolderPendaftar);
}

// Advisory lock Postgres -- pengganti LockService.getScriptLock() di kode_gas.js (baris 390-402).
// Transaction-scoped (pg_advisory_xact_lock): otomatis terlepas begitu transaksi selesai, tidak
// mungkin lupa unlock walau terjadi error di tengah.
//
// PENTING: kunci lock HANYA berdasar `kecamatan` (bukan kecamatan|layanan|nama|nik seperti versi
// sebelumnya). bangunRantaiFolderPendaftar() bikin 3 folder bersarang -- Kecamatan -> Layanan ->
// "Nama (NIK)" -- dan folder Kecamatan/Layanan itu DIPAKAI BERSAMA oleh SEMUA registrant di
// kecamatan itu, lintas layanan sekalipun. Kalau kunci lock ikut mengandung layanan/nama/nik
// (versi lama), dua submission BEDA registrant (nik beda) yang nyaris bersamaan dapat lock key
// BEDA -> keduanya bisa lolos cariAtauBuatSubfolder() bersamaan tanpa saling tahu -> folder
// Kecamatan atau Layanan ke-DUPLIKAT di Drive (masing2 cuma diisi sebagian file, terlihat spt
// "file/folder berantakan" saat banyak warga di kecamatan yang sama submit bersamaan).
//
// Konsekuensinya: semua submission dalam SATU kecamatan (apa pun layanannya) diserialisasi
// selama tahap resolusi folder saja (beberapa panggilan Drive API, <1-2 detik) -- BUKAN selama
// upload byte-nya (itu tetap paralel penuh, lock sudah lepas begitu folder ID didapat). Submission
// lintas KECAMATAN BEDA tetap berjalan penuh paralel (lock key beda), jadi skala tetap terjaga di
// kota dengan banyak kecamatan.
async function resolveFolderPendaftarDenganLock(
  accessToken: string,
  K: KonteksFolderPendaftar,
): Promise<string> {
  const kunciTeks = String(K.kecamatan || "");
  return await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${kunciTeks}, 0))`;
    return await bangunRantaiFolderPendaftar(accessToken, K);
  });
}

/**
 * Resolusi folder pendaftar: reuse folderId lama kalau valid (mis. saat edit data), kalau tidak
 * bangun/cari rantai folder baru dengan proteksi advisory lock. Port dari blok
 * folderIdTersimpan/resolveFolderPendaftarDenganLock_ di uploadSemuaBerkasKeDrive
 * (kode_gas.js baris 430-444).
 */
export async function resolveFolderPendaftar(accessToken: string, K: KonteksFolderPendaftar): Promise<string> {
  const folderIdTersimpan = (K.folderId || "").toString().trim();
  if (folderIdTersimpan) {
    const resCek = await driveFetch(
      accessToken,
      `/files/${folderIdTersimpan}?fields=id,trashed&supportsAllDrives=true`,
    );
    if (resCek.ok) {
      const data = await resCek.json();
      if (!data.trashed) return folderIdTersimpan;
    }
    // folderId tersimpan tidak valid/sudah terhapus -> fallback ke resolusi rantai baru di bawah.
  }
  return resolveFolderPendaftarDenganLock(accessToken, K);
}

export interface HasilSesiResumable {
  uploadSessionUri: string;
}

// Langkah 1 protokol resumable upload Drive: minta "sesi upload" (Location header), belum kirim
// byte apa pun. Browser yang nanti PUT langsung ke uploadSessionUri ini -- byte file TIDAK PERNAH
// singgah di Edge Function/Vercel.
export async function mulaiSesiResumable(
  accessToken: string,
  folderId: string,
  namaFile: string,
  mimeType: string,
  ukuranByte?: number,
): Promise<HasilSesiResumable> {
  const headers: Record<string, string> = {};
  if (typeof ukuranByte === "number" && ukuranByte > 0) {
    headers["X-Upload-Content-Length"] = String(ukuranByte);
  }
  if (mimeType) headers["X-Upload-Content-Type"] = mimeType;

  const res = await driveFetch(
    accessToken,
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: namaFile, parents: [folderId], mimeType }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gagal memulai sesi upload Drive untuk "${namaFile}": ${res.status} ${await res.text()}`);
  }
  const uploadSessionUri = res.headers.get("Location");
  if (!uploadSessionUri) {
    throw new Error(`Drive tidak mengembalikan session URI untuk "${namaFile}".`);
  }
  return { uploadSessionUri };
}

// Port dari file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
// (kode_gas.js baris 377). SENGAJA dibuat idempoten (cek dulu sebelum membuat) -- ini yang
// dipanggil dari konfirmasiUploadBerkasDrive, yang di sisi frontend boleh di-retry
// (panggilAksiDenganRetry di app-transaksi.js) kalau 1 file gagal karena error transient. Tanpa
// idempotensi ini, retry atas file yang IZINNYA SUDAH kepasang di percobaan sebelumnya berisiko
// bikin permission dobel/ambigu -- dicek dulu supaya retry selalu konvergen ke sukses.
export async function setPermissionAnyoneReader(accessToken: string, fileId: string): Promise<void> {
  const resCek = await driveFetch(
    accessToken,
    `/files/${fileId}/permissions?fields=permissions(id,type,role)&supportsAllDrives=true`,
  );
  if (resCek.ok) {
    const dataCek = await resCek.json();
    const sudahPublik = Array.isArray(dataCek.permissions) &&
      dataCek.permissions.some((p: { type?: string; role?: string }) =>
        p.type === "anyone" && (p.role === "reader" || p.role === "writer")
      );
    if (sudahPublik) return;
  }

  const res = await driveFetch(accessToken, `/files/${fileId}/permissions?supportsAllDrives=true`, {
    method: "POST",
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) {
    throw new Error(`Gagal set izin akses file Drive ${fileId}: ${res.status} ${await res.text()}`);
  }
}

export function tautanLihatDrive(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// Bersihkan label jenis berkas jadi nama file Drive: "<label> .<ekstensi>" -- port dari
// uploadBerkasPenerima_() (kode_gas.js baris 367-382): nama asli DIBUANG, cuma ekstensinya
// dipakai, nama filenya diganti label jenis berkas ("KTP.jpg", bukan nama asli dari kamera HP).
export function namaFileDrive(namaAsli: string, label: string): string {
  const idx = namaAsli.lastIndexOf(".");
  const ekstensi = idx !== -1 ? namaAsli.slice(idx) : "";
  const labelBersih = (label || "").trim().replace(/\s+/g, " ");
  return `${labelBersih}${ekstensi}`;
}
