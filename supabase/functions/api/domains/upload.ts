import { wajibSesi } from "../_shared/sesi.ts";
import { uploadBerkasKeStorage } from "../_shared/storage.ts";

// Sama persis MAKS_BYTE_PER_BERKAS / MAKS_TOTAL_BYTE_BERKAS / MIME_BERKAS_DIIZINKAN di Kode.gs
// (validasiBerkasSebelumUpload_, uploadSemuaBerkasKeDrive) -- dipertahankan identik supaya
// pesan error yang dilihat user tidak berubah.
const MAKS_BYTE_PER_BERKAS = 25 * 1024 * 1024;
const MAKS_TOTAL_BYTE_BERKAS = 60 * 1024 * 1024;
const MIME_BERKAS_DIIZINKAN = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  "image/bmp", "image/gif",
  "application/pdf",
];

interface ItemBerkas {
  namaFile?: string;
  mimeType?: string;
  dataBase64?: string;
  label?: string;
}

interface KonteksBerkas {
  kecamatan?: string;
  layanan?: string;
  nama?: string;
  nik?: string;
  folderId?: string;
}

function base64KeBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Slug path aman (huruf/angka/underscore saja) -- dipakai sbg prefix "folder virtual" di
// Storage, pengganti folder fisik Drive (dapatkanFolderPendaftar_ di Kode.gs).
function slugPath(s: unknown): string {
  return (s == null ? "" : String(s)).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// Pengganti uploadSemuaBerkasKeDrive() di Kode.gs -- dibangun 2026-09-15 sebagai bagian dari
// keputusan "murni Supabase" (data & berkas masih kosong saat keputusan ini diambil, jadi
// migrasi langsung total, bukan hybrid dengan Drive).
//
// KONTRAK request/response SENGAJA dipertahankan identik dengan uploadSemuaBerkasKeDrive
// supaya index.html cukup mengganti NAMA aksi yang dipanggil (lihat dua titik pemanggilan di
// index.html), tanpa mengubah cara mengirim payload atau membaca hasilnya. Bedanya cuma
// tujuan penyimpanan: Supabase Storage (bucket privat + signed URL berumur panjang), bukan
// Google Drive. `Kode.gs` dibiarkan tidak berubah (fungsi lama tetap ada, cuma tidak dipanggil
// lagi) -- bukan dihapus, sebagai cadangan darurat.
// ---------------------------------------------------------------------------
export async function uploadSemuaBerkasKeSupabase(
  token: string,
  konteks: KonteksBerkas,
  berkasMap: Record<string, ItemBerkas>,
) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const K = konteks || {};
    const B = berkasMap || {};

    // Validasi total ukuran gabungan SEBELUM upload dimulai (fail-fast) -- sama pola dengan
    // Kode.gs, supaya tidak ada berkas ter-upload sebagian kalau total ternyata kelebihan.
    let totalPerkiraanByte = 0;
    for (const k of Object.keys(B)) {
      const item = B[k];
      if (item && item.dataBase64) totalPerkiraanByte += item.dataBase64.length * 0.75;
    }
    if (totalPerkiraanByte > MAKS_TOTAL_BYTE_BERKAS) {
      return { sukses: false, pesan: "GAGAL: Total ukuran seluruh berkas terlalu besar (maksimal 60 MB gabungan). Perkecil ukuran file lalu coba lagi." };
    }

    // Validasi format & ukuran TIAP berkas sebelum upload dimulai (fail-fast) -- sama pola
    // dengan Kode.gs (validasiBerkasSebelumUpload_ dipanggil utk semua berkas dulu, baru upload).
    for (const kunci of Object.keys(B)) {
      const item = B[kunci];
      if (!item || !item.dataBase64) continue;
      const labelUntukPesan = item.label || kunci;
      const namaTampil = item.namaFile || "tanpa nama";
      const mime = (item.mimeType || "").toString().trim().toLowerCase();
      if (MIME_BERKAS_DIIZINKAN.indexOf(mime) === -1) {
        return {
          sukses: false,
          pesan: `GAGAL: Berkas "${labelUntukPesan}" (${namaTampil}) memakai format file yang tidak didukung${mime ? " (" + mime + ")" : ""}. Gunakan JPG, PNG, WEBP, HEIC, atau PDF.`,
        };
      }
      const perkiraanByte = item.dataBase64.length * 0.75;
      if (perkiraanByte > MAKS_BYTE_PER_BERKAS) {
        return { sukses: false, pesan: `GAGAL: Berkas "${labelUntukPesan}" (${namaTampil}) ukurannya melebihi 25 MB.` };
      }
    }

    // Prefix path pengganti folder Drive -- pakai yang tersimpan (alur edit, meneruskan
    // `id_folder_berkas` lama) kalau ada, kalau tidak dibuat baru dari kecamatan/layanan/nama/NIK
    // (persis pola dapatkanFolderPendaftar_ di Kode.gs).
    const prefixTersimpan = (K.folderId || "").toString().trim();
    const prefix = prefixTersimpan || `${slugPath(K.kecamatan)}/${slugPath(K.layanan)}/${slugPath(K.nama)}_${slugPath(K.nik)}`;

    const hasil: Record<string, string> = {};
    for (const kunci of Object.keys(B)) {
      const item = B[kunci];
      if (!item || !item.dataBase64) continue;

      const bytes = base64KeBytes(item.dataBase64);
      const namaAman = slugPath(item.namaFile || kunci) || kunci;
      const path = `${prefix}/${kunci}_${namaAman}`;

      const hasilUpload = await uploadBerkasKeStorage(path, bytes, item.mimeType || "application/octet-stream");
      if (!hasilUpload.sukses) {
        return { sukses: false, pesan: `GAGAL upload "${item.label || kunci}": ${hasilUpload.pesan}` };
      }
      hasil[kunci] = hasilUpload.url;
    }
    hasil.idFolderBerkas = prefix;

    return { sukses: true, link: hasil };
  } catch (e) {
    return { sukses: false, pesan: "Gagal upload berkas: " + String(e) };
  }
}
