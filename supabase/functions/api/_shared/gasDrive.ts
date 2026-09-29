// Pemanggil aksi ADMIN di microservice Google Drive (gas/Kode.gs: hapusBerkasDrive, hapusFolderDrive).
// Hanya Edge Function yang boleh memanggil ini -- setelah memverifikasi role UTAMA -- karena
// ADMIN_SECRET tidak pernah dikirim ke browser. GAS memindahkan ke Sampah Drive (bisa dipulihkan),
// bukan menghapus permanen.
//
// Env (supabase secrets set):
//   GAS_DRIVE_URL     = URL deployment web app GAS (https://script.google.com/macros/s/.../exec)
//   GAS_ADMIN_SECRET  = nilai yang sama dengan Script Property ADMIN_SECRET di Apps Script

export interface HasilGasDrive {
  sukses: boolean;
  pesan?: string;
  sudahTiada?: boolean;
}

// GAS normalnya menjawab dalam 5-8 dtk. Dijaga pendek supaya satu permintaan (dengan 2 percobaan,
// atau paket hapus massal) tetap selesai sebelum batas waktu klien 58 dtk.
const TIMEOUT_MS = 20_000;
const MAKS_PERCOBAAN = 2;
// Pesan GAS yang bersifat permanen: mengulang tidak akan mengubah hasilnya.
const PERMANEN = /ditolak|tidak valid|konfigurasi|bukan tautan|bukan folder|bukan berkas/i;

function tidur(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function panggilGasAdmin(
  aksi: "hapusBerkasDrive" | "hapusFolderDrive",
  konteks: Record<string, unknown>,
): Promise<HasilGasDrive> {
  const url = (Deno.env.get("GAS_DRIVE_URL") || "").trim();
  const secret = (Deno.env.get("GAS_ADMIN_SECRET") || "").trim();
  if (!url || !secret) {
    return { sukses: false, pesan: "Konfigurasi server belum lengkap (GAS_DRIVE_URL/GAS_ADMIN_SECRET)." };
  }

  let terakhir: HasilGasDrive = { sukses: false, pesan: "Tidak ada respons dari layanan Drive." };
  for (let i = 0; i < MAKS_PERCOBAAN; i++) {
    if (i > 0) await tidur(800 + Math.floor(Math.random() * 600));
    try {
      // GAS menjawab POST dengan 302 ke googleusercontent; fetch mengikutinya otomatis.
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: aksi, args: [secret, konteks] }),
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const teks = await res.text();
      let json: { result?: HasilGasDrive; sukses?: boolean; pesan?: string } | null = null;
      try {
        json = JSON.parse(teks);
      } catch (_e) { /* bukan JSON: halaman error Google */ }
      if (!json) {
        terakhir = { sukses: false, pesan: "Respons layanan Drive tidak valid." };
        continue;
      }
      const hasil = (json.result || json) as HasilGasDrive;
      if (hasil.sukses) return hasil;
      terakhir = { sukses: false, pesan: hasil.pesan || json.pesan || "Layanan Drive menolak permintaan." };
      if (PERMANEN.test(terakhir.pesan || "")) return terakhir;
    } catch (e) {
      terakhir = { sukses: false, pesan: "Gagal menghubungi layanan Drive: " + (e instanceof Error ? e.message : String(e)) };
    }
  }
  return terakhir;
}
