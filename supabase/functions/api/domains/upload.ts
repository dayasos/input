import { wajibSesi } from "../_shared/sesi.ts";
import { buatSignedUrlBaca, buatUrlUploadSigned } from "../_shared/storage.ts";

const MIME_BERKAS_DIIZINKAN = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  "image/bmp", "image/gif",
  "application/pdf",
];

interface FileInfoRingan {
  namaFile?: string;
  mimeType?: string;
  label?: string;
}

interface KonteksBerkas {
  kecamatan?: string;
  layanan?: string;
  nama?: string;
  nik?: string;
  folderId?: string;
}

// Slug path aman (huruf/angka/underscore saja) -- dipakai sbg prefix "folder virtual" di
// Storage, pengganti folder fisik Drive (dapatkanFolderPendaftar_ di Kode.gs).
function slugPath(s: unknown): string {
  return (s == null ? "" : String(s)).trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// Upload berkas: browser -> Supabase Storage LANGSUNG (tidak lewat body request Vercel, yang
// punya batas keras 4.5 MB -- versi awal 2026-09-15 sempat mengirim seluruh bytes lewat body
// request via aksi tunggal `uploadSemuaBerkasKeSupabase`, tapi itu bikin upload gagal utk
// layanan dgn banyak berkas wajib, mis. Guru Maghrib Mengaji, walau tiap berkas sendiri jauh di
// bawah batas 25 MB per berkas. Diganti 2026-09-16 ke pola signed-upload-URL di bawah ini;
// fungsi lama sudah dihapus total, bukan cuma tidak dipanggil -- lihat riwayat git kalau perlu
// referensi implementasi lama).
//
// Alur 2 langkah:
//   1. mintaUrlUploadBerkas() -- terima cuma metadata (nama file + tipe MIME, BUKAN isinya),
//      balikin signed upload URL per berkas. Browser lalu PUT byte-nya LANGSUNG ke Storage,
//      tidak lewat Vercel sama sekali. Ukuran TIDAK bisa dicek di sini (bytes belum sampai ke
//      server), jadi batas 25 MB/berkas jadi tanggung jawab bucket Storage sendiri (lihat
//      migrasi 20260915120000_bucket_berkas_penerima.sql: file_size_limit).
//   2. konfirmasiUploadBerkas() -- dipanggil browser SETELAH semua PUT sukses, buat signed READ
//      url jangka panjang (~10 tahun, lihat _shared/storage.ts) utk tiap path.
//
// Kontrak balikan konfirmasiUploadBerkas: `{ sukses, link: { <kunci>: url, idFolderBerkas } }` --
// bentuk ini dipertahankan sejak versi Google Drive (uploadSemuaBerkasKeDrive di Kode.gs, masih
// ada di sana sbg cadangan darurat, tidak dipanggil lagi) supaya index.html
// (simpanDataKeSheet/editDataPenerima) tidak perlu tahu/peduli ke mana berkas sebenarnya
// tersimpan.
// ---------------------------------------------------------------------------

export async function mintaUrlUploadBerkas(
  token: string,
  konteks: KonteksBerkas,
  daftarFile: Record<string, FileInfoRingan>,
) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const K = konteks || {};
    const D = daftarFile || {};

    // Validasi format tiap berkas dulu (fail-fast).
    for (const kunci of Object.keys(D)) {
      const item = D[kunci];
      if (!item) continue;
      const mime = (item.mimeType || "").toString().trim().toLowerCase();
      if (MIME_BERKAS_DIIZINKAN.indexOf(mime) === -1) {
        return {
          sukses: false,
          pesan: `GAGAL: Berkas "${item.label || kunci}" (${item.namaFile || "tanpa nama"}) memakai format file yang tidak didukung${mime ? " (" + mime + ")" : ""}. Gunakan JPG, PNG, WEBP, HEIC, atau PDF.`,
        };
      }
    }

    const prefixTersimpan = (K.folderId || "").toString().trim();
    const prefix = prefixTersimpan || `${slugPath(K.kecamatan)}/${slugPath(K.layanan)}/${slugPath(K.nama)}_${slugPath(K.nik)}`;

    // Diparalelkan (Promise.all, bukan await berurutan) -- layanan dgn banyak berkas wajib
    // (mis. Guru Maghrib Mengaji: bisa 8-9 berkas) akan menumpuk latensi kalau tiap
    // createSignedUploadUrl() menunggu yang sebelumnya selesai dulu satu-satu.
    const kunciList = Object.keys(D).filter((k) => D[k]);
    const hasilTiapBerkas = await Promise.all(kunciList.map(async (kunci) => {
      const item = D[kunci];
      const namaAman = slugPath(item.namaFile || kunci) || kunci;
      const path = `${prefix}/${kunci}_${namaAman}`;
      const hasilUrl = await buatUrlUploadSigned(path);
      return { kunci, item, hasilUrl };
    }));

    const daftarUrl: Record<string, { path: string; uploadUrl: string }> = {};
    for (const { kunci, item, hasilUrl } of hasilTiapBerkas) {
      if (!hasilUrl.sukses) {
        return { sukses: false, pesan: `GAGAL menyiapkan upload "${item.label || kunci}": ${hasilUrl.pesan}` };
      }
      daftarUrl[kunci] = { path: hasilUrl.path, uploadUrl: hasilUrl.uploadUrl };
    }

    return { sukses: true, prefix, daftarUrl };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menyiapkan upload: " + String(e) };
  }
}

export async function konfirmasiUploadBerkas(
  token: string,
  prefix: string,
  daftarPath: Record<string, string>,
) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const P = daftarPath || {};
    const kunciList = Object.keys(P).filter((k) => (P[k] || "").toString().trim());
    // Diparalelkan sama seperti mintaUrlUploadBerkas -- alasan sama, hindari latensi menumpuk
    // utk layanan dgn banyak berkas.
    const hasilTiapBerkas = await Promise.all(kunciList.map(async (kunci) => {
      const path = P[kunci].toString().trim();
      const hasilSigned = await buatSignedUrlBaca(path);
      return { kunci, hasilSigned };
    }));

    const hasil: Record<string, string> = {};
    for (const { kunci, hasilSigned } of hasilTiapBerkas) {
      if (!hasilSigned.sukses) {
        return { sukses: false, pesan: `GAGAL mengonfirmasi berkas "${kunci}": ${hasilSigned.pesan}` };
      }
      hasil[kunci] = hasilSigned.url;
    }
    hasil.idFolderBerkas = (prefix || "").toString().trim();

    return { sukses: true, link: hasil };
  } catch (e) {
    return { sukses: false, pesan: "Gagal konfirmasi upload: " + String(e) };
  }
}
