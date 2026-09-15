import { createClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY otomatis disediakan Supabase untuk tiap Edge
// Function -- BEDA dari SUPABASE_DB_URL yang wajib di-set manual (lihat _shared/db.ts) --
// tidak perlu `supabase secrets set` untuk dua env var ini.
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Env var SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY tidak tersedia di runtime Edge Function ini.",
  );
}

const storageClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
}).storage;

export const NAMA_BUCKET_BERKAS = "berkas-penerima";

// URL bertanda-tangan (signed) berumur sangat panjang (~10 tahun) -- bucket TETAP privat (tidak
// bisa ditelusuri/ditebak orang lain), tapi link yang tersimpan di kolom `link_*` berfungsi
// permanen tanpa perlu digenerate ulang tiap kali dibuka -- meniru perilaku 1-link-dipakai-
// selamanya dari Google Drive yang lama, supaya index.html tidak perlu berubah cara
// menyimpan/menampilkan link berkas.
const UMUR_SIGNED_URL_DETIK = 10 * 365 * 24 * 60 * 60;

export type HasilUpload =
  | { sukses: true; url: string }
  | { sukses: false; pesan: string };

// Upload satu berkas ke Storage lalu langsung buat signed URL-nya. `path` harus unik per
// berkas (lihat pemanggil di domains/upload.ts untuk pola penamaannya).
export async function uploadBerkasKeStorage(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<HasilUpload> {
  const { error: errUpload } = await storageClient
    .from(NAMA_BUCKET_BERKAS)
    .upload(path, bytes, { contentType, upsert: true });

  if (errUpload) {
    return { sukses: false, pesan: "Gagal upload ke Storage: " + errUpload.message };
  }

  const { data: dataSigned, error: errSigned } = await storageClient
    .from(NAMA_BUCKET_BERKAS)
    .createSignedUrl(path, UMUR_SIGNED_URL_DETIK);

  if (errSigned || !dataSigned) {
    return {
      sukses: false,
      pesan: "Berkas ter-upload tapi gagal membuat link: " + (errSigned ? errSigned.message : "tidak diketahui"),
    };
  }

  return { sukses: true, url: dataSigned.signedUrl };
}
