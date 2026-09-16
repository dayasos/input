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

// Signed READ url berumur panjang utk 1 path -- dipanggil dari domains/upload.ts SETELAH
// browser selesai PUT berkas langsung ke Storage (lihat konfirmasiUploadBerkas).
export async function buatSignedUrlBaca(path: string): Promise<HasilUpload> {
  const { data, error } = await storageClient
    .from(NAMA_BUCKET_BERKAS)
    .createSignedUrl(path, UMUR_SIGNED_URL_DETIK);

  if (error || !data) {
    return { sukses: false, pesan: "Gagal membuat link: " + (error ? error.message : "tidak diketahui") };
  }
  return { sukses: true, url: data.signedUrl };
}

// URL upload sekali-pakai (signed upload URL) -- dipakai browser untuk PUT berkas LANGSUNG ke
// Supabase Storage, TIDAK lewat body request Vercel (yang punya batas keras 4.5 MB). Diterbitkan
// di sini (Service Role Key, setelah wajibSesi() di domains/upload.ts) supaya browser tidak
// pernah pegang kredensial Storage -- cuma pegang satu URL bertanda-tangan yang hanya berlaku
// untuk SATU path spesifik dan kedaluwarsa cepat (beda dari signed READ url di atas yang umurnya
// ~10 tahun -- ini cuma jendela upload sekali pakai, expiry default dari Supabase, ~2 jam).
export type HasilUrlUpload =
  | { sukses: true; uploadUrl: string; token: string; path: string }
  | { sukses: false; pesan: string };

export async function buatUrlUploadSigned(path: string): Promise<HasilUrlUpload> {
  const { data, error } = await storageClient
    .from(NAMA_BUCKET_BERKAS)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return { sukses: false, pesan: "Gagal membuat URL upload: " + (error ? error.message : "tidak diketahui") };
  }
  return { sukses: true, uploadUrl: data.signedUrl, token: data.token, path: data.path };
}
