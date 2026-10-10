import { sql } from "./db.ts";
import { rapikanTeks } from "./config.ts";
import { kelurahanTerkunciDari } from "./akses.ts";
import type { DataSesi } from "./sesi.ts";

// ---------------------------------------------------------------------------
// Wilayah tugas (Rencana Perbaikan Wilayah Tugas dan Domisili, 2026-10-09).
//
// Kolom penerima.kecamatan/kelurahan = WILAYAH TUGAS (dasar kuota & hak akses). Aturannya:
// - Tempat tugas yang cocok dengan tabel rumah_ibadah (nama + alamat): kecamatan & kelurahan
//   mengikuti rumah ibadah itu. Akun yang punya kecamatan ditolak bila rumah ibadahnya di
//   kecamatan lain. Batasan hanya di tingkat kecamatan -- kelurahan rumah ibadah TIDAK dibatasi.
// - Tidak cocok (RUMAH / LAINNYA / layanan tanpa data rumah ibadah): kecamatan dari sesi login
//   (kalau akunnya punya), kelurahan harus ada di kecamatan itu dan terkunci untuk akun kelurahan.
// - Akun UTAMA tidak terkena aturan ini.
//
// "Terikat" di sini = akun punya kecamatan di sesi. Sama dengan syarat yang sudah dipakai
// simpanDataKeSheet ("kecSesi && kecamatan !== kecSesi" -> tolak), jadi akun Kemenag bebas &
// GMM se-Kota Medan (kecamatan kosong) otomatis tidak dibatasi wilayah.
// Penolakan di formulir saja bisa dilewati -- pemeriksaan di server ini yang wajib.
// ---------------------------------------------------------------------------

// Layanan yang tempat tugasnya WAJIB rumah ibadah terdaftar (tidak punya opsi RUMAH/LAINNYA di
// formulir). Sama dengan kategoriModal (app-admin.js) + Kemenag bebas (ROLE_KEMENAG_BEBAS di
// app-core.js). GMM & USTADZ sengaja TIDAK di sini: punya opsi RUMAH/LAINNYA (isi manual).
// Hanya diberlakukan untuk input baru -- 250 dari 335 baris lama tidak cocok dengan tabel.
export const LAYANAN_WAJIB_RUMAH_IBADAH = [
  "IMAM MASJID",
  "KHATIB JUMAT",
  "NAZIR MASJID",
  "NAZIR MUSHOLLA",
  "PENGURUS GEREJA",
  "PENGURUS VIHARA/KLENTENG/KUIL",
  "PETUGAS GEREJA KATOLIK",
  "GURU SEKOLAH BUDDHA",
  "GURU SEKOLAH HINDU",
  "GURU SEKOLAH KONG HU CHU",
  "GURU SEKOLAH MINGGU",
  "PENATUA GEREJA",
];

type LokasiRumahIbadah = { kecamatan: string; kelurahan: string };

// Semua rumah ibadah dengan nama + alamat yang sama persis (setelah rapikanTeks, normalisasi
// yang sama dipakai saat menyimpan tempat_tugas/alamat_tugas). Bisa >1 baris: nama+alamat
// kembar di kelurahan/kecamatan berbeda.
export async function cariRumahIbadah(tempatTugas: string, alamatTugas: string): Promise<LokasiRumahIbadah[]> {
  const nama = rapikanTeks(tempatTugas);
  const alamat = rapikanTeks(alamatTugas);
  if (!nama) return [];
  const rows = await sql`
    select kecamatan, kelurahan, alamat
    from rumah_ibadah
    where upper(btrim(regexp_replace(nama, '\\s+', ' ', 'g'))) = ${nama}
  `;
  const hasil: LokasiRumahIbadah[] = [];
  for (const r of rows) {
    if (rapikanTeks(r.alamat) !== alamat) continue;
    hasil.push({ kecamatan: rapikanTeks(r.kecamatan), kelurahan: rapikanTeks(r.kelurahan) });
  }
  return hasil;
}

export async function kelurahanAdaDiKecamatan(kecamatan: string, kelurahan: string): Promise<boolean> {
  const kec = rapikanTeks(kecamatan);
  const kel = rapikanTeks(kelurahan);
  if (!kec || !kel) return false;
  const rows = await sql`
    select 1 from wilayah
    where upper(btrim(regexp_replace(kecamatan, '\\s+', ' ', 'g'))) = ${kec}
      and upper(btrim(regexp_replace(kelurahan, '\\s+', ' ', 'g'))) = ${kel}
    limit 1
  `;
  return rows.length > 0;
}

function unik(daftar: string[]): string[] {
  return Array.from(new Set(daftar)).sort();
}

export type HasilWilayahTugas =
  | { ok: true; kecamatan: string; kelurahan: string; dariRumahIbadah: boolean }
  | { ok: false; pesan: string; soalKelurahan?: boolean };

/**
 * Tentukan kecamatan & kelurahan wilayah tugas yang sah untuk input baru (simpanDataKeSheet,
 * validasiDataBaru). `kecamatan`/`kelurahan` = kiriman formulir; hasilnya yang harus disimpan.
 * Formulir lama (cache PWA) yang mengirim kelurahan domisili tetap lolos: kalau tempat tugasnya
 * rumah ibadah, kelurahan diambil dari rumah ibadah itu.
 */
export async function tentukanWilayahTugas(params: {
  sesi: DataSesi;
  layanan: string;
  tempatTugas: string;
  alamatTugas: string;
  kecamatan: string;
  kelurahan: string;
}): Promise<HasilWilayahTugas> {
  const { sesi } = params;
  const layanan = rapikanTeks(params.layanan);
  const kecKirim = rapikanTeks(params.kecamatan);
  const kelKirim = rapikanTeks(params.kelurahan);
  const peran = rapikanTeks(sesi.role);
  const kecSesi = rapikanTeks(sesi.kecamatan);
  const kelTerkunci = rapikanTeks(kelurahanTerkunciDari(sesi));

  if (peran === "UTAMA") return { ok: true, kecamatan: kecKirim, kelurahan: kelKirim, dariRumahIbadah: false };

  const lokasi = await cariRumahIbadah(params.tempatTugas, params.alamatTugas);

  if (lokasi.length > 0) {
    const daftarKec = unik(lokasi.map((l) => l.kecamatan));
    if (kecSesi && !daftarKec.includes(kecSesi)) {
      const l = lokasi[0];
      return {
        ok: false,
        pesan: "GAGAL: " + rapikanTeks(params.tempatTugas) + " tercatat di Kec. " + l.kecamatan +
          ", Kel. " + l.kelurahan + " -- di luar wilayah akun Anda (Kecamatan " + kecSesi + ").",
      };
    }
    let kecTugas: string;
    if (kecSesi) kecTugas = kecSesi;
    else if (daftarKec.includes(kecKirim)) kecTugas = kecKirim;
    else if (daftarKec.length === 1) kecTugas = daftarKec[0];
    else {
      return {
        ok: false,
        pesan: "GAGAL: " + rapikanTeks(params.tempatTugas) + " tercatat di beberapa kecamatan (" +
          daftarKec.join(", ") + "). Silakan pilih ulang rumah ibadah dari daftar.",
      };
    }
    // Kelurahan kosong di data rumah ibadah diabaikan; kalau semuanya kosong, kelurahan dipilih
    // manual oleh petugas dan diperiksa ke tabel wilayah seperti input langsung.
    const daftarKel = unik(lokasi.filter((l) => l.kecamatan === kecTugas && l.kelurahan).map((l) => l.kelurahan));

    // Akun kelurahan: rumah ibadah wajib di kelurahannya sendiri (keputusan 2026-10-10), dan kelurahan
    // tugas disimpan persis dgn ejaan kelurahan akun supaya baris ini tetap tampil di Lihat Data
    // akun itu (filter lolosAksesBarisLihatData: kelurahan === kelurahanTerkunci).
    if (kelTerkunci) {
      if (daftarKel.length > 0 && !daftarKel.includes(kelTerkunci)) {
        return {
          ok: false,
          pesan: "GAGAL: " + rapikanTeks(params.tempatTugas) + " tercatat di Kel. " + daftarKel.join(" / ") +
            " -- di luar kelurahan akun Anda (Kelurahan " + kelTerkunci + ").",
        };
      }
      return { ok: true, kecamatan: kecTugas, kelurahan: kelTerkunci, dariRumahIbadah: true };
    }

    if (daftarKel.length === 0) {
      if (!kelKirim) return { ok: false, pesan: "GAGAL: Kelurahan wilayah tugas wajib dipilih.", soalKelurahan: true };
      if (!(await kelurahanAdaDiKecamatan(kecTugas, kelKirim))) {
        return {
          ok: false,
          pesan: "GAGAL: Kelurahan " + kelKirim + " tidak berada di Kecamatan " + kecTugas + ".",
          soalKelurahan: true,
        };
      }
      return { ok: true, kecamatan: kecTugas, kelurahan: kelKirim, dariRumahIbadah: true };
    }
    let kelTugas: string;
    if (daftarKel.includes(kelKirim)) kelTugas = kelKirim;
    else if (daftarKel.length === 1) kelTugas = daftarKel[0];
    else {
      return {
        ok: false,
        pesan: "GAGAL: " + rapikanTeks(params.tempatTugas) + " tercatat di beberapa kelurahan (" +
          daftarKel.join(", ") + "). Silakan pilih ulang rumah ibadah dari daftar.",
      };
    }
    return { ok: true, kecamatan: kecTugas, kelurahan: kelTugas, dariRumahIbadah: true };
  }

  // Tidak cocok dengan rumah ibadah terdaftar = input langsung oleh petugas.
  if (LAYANAN_WAJIB_RUMAH_IBADAH.includes(layanan)) {
    return {
      ok: false,
      pesan: "GAGAL: Tempat tugas untuk layanan " + layanan + " wajib dipilih dari daftar rumah ibadah. " +
        "Silakan klik tombol \"Pilih Rumah Ibadah\" lalu pilih ulang.",
    };
  }
  const kecTugas = kecSesi || kecKirim;
  if (!kecTugas) return { ok: false, pesan: "GAGAL: Kecamatan wilayah tugas wajib dipilih." };
  if (kelTerkunci && kelKirim !== kelTerkunci) {
    return {
      ok: false,
      pesan: "GAGAL: Akun Anda hanya berwenang mengisi data untuk Kelurahan " + kelTerkunci + ".",
      soalKelurahan: true,
    };
  }
  if (!kelKirim) return { ok: false, pesan: "GAGAL: Kelurahan wilayah tugas wajib dipilih.", soalKelurahan: true };
  if (!(await kelurahanAdaDiKecamatan(kecTugas, kelKirim))) {
    return {
      ok: false,
      pesan: "GAGAL: Kelurahan " + kelKirim + " tidak berada di Kecamatan " + kecTugas + ".",
      soalKelurahan: true,
    };
  }
  return { ok: true, kecamatan: kecTugas, kelurahan: kelKirim, dariRumahIbadah: false };
}
