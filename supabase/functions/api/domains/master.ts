import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";

// Port 1:1 dari getSheetName() di Kode.gs. Dipertahankan meski tampaknya tidak lagi dipanggil
// langsung dari index.html (tidak ditemukan referensinya di frontend) — tetap diekspos untuk
// paritas penuh dengan daftar ALLOWED lama.
export function getSheetName(kategori: string): string | null {
  switch (String(kategori || "").trim().toUpperCase()) {
    case "IMAM MASJID":
    case "KHATIB JUMAT":
    case "NAZIR MASJID":
      return "db_masjid";
    case "NAZIR MUSHOLLA":
      return "db_musholla";
    case "PENGURUS GEREJA":
      return "db_gereja";
    case "PENGURUS VIHARA/KLENTENG/KUIL":
      return "db_vihara_klenteng_kuil";
    case "GURU SEKOLAH BUDDHA":
      return "db_vihara";
    case "GURU SEKOLAH HINDU":
      return "db_kuil";
    case "PETUGAS GEREJA KATOLIK":
      return "db_pgk";
    default:
      return null;
  }
}

// Turunan dari getSheetName() - dipakai internal untuk query kolom `jenis` di tabel rumah_ibadah
// (yang mengunifikasi sheet db_masjid/db_musholla/db_gereja/db_pgk/db_vihara_klenteng_kuil/db_vihara/db_kuil).
function jenisDariSheetName(sheetName: string | null): string | null {
  switch (sheetName) {
    case "db_masjid":
      return "MASJID";
    case "db_musholla":
      return "MUSHOLLA";
    case "db_gereja":
      return "GEREJA";
    case "db_vihara_klenteng_kuil":
      return "VIHARA_KLENTENG_KUIL";
    case "db_vihara":
      return "VIHARA";
    case "db_kuil":
      return "KUIL";
    case "db_pgk":
      return "PGK";
    default:
      return null;
  }
}

// Port 1:1 dari getMasterLayanan() — SENGAJA TIDAK memvalidasi sesi (perilaku asli Kode.gs juga
// begitu; dipanggil termasuk sebelum login untuk mengisi dropdown layanan).
export async function getMasterLayanan() {
  try {
    const rows = await sql`
      select kategori, nama_layanan
      from layanan_master
      order by kategori, urutan
    `;
    const kecamatan: string[] = [];
    const kemenag: string[] = [];
    for (const r of rows) {
      if (r.kategori === "KECAMATAN") kecamatan.push(String(r.nama_layanan || ""));
      else if (r.kategori === "KEMENAG") kemenag.push(String(r.nama_layanan || ""));
    }
    return { kecamatan, kemenag };
  } catch (error) {
    throw new Error("Gagal mengambil data layanan: " + String(error));
  }
}

// Port 1:1 dari getKelurahanByKecamatan() — wajibSesi() DILUAR try/catch, sama seperti asli:
// kalau sesi tidak sah, error dilempar apa adanya (tidak diubah jadi pesan "Gagal memproses...").
export async function getKelurahanByKecamatan(token: string, kecamatanTerpilih: string) {
  await wajibSesi(token);
  try {
    const rows = await sql`select kecamatan, kelurahan from wilayah`;
    const dataMap: Record<string, string[]> = {};
    for (const r of rows) {
      const kec = String(r.kecamatan || "").trim().toUpperCase();
      const kel = String(r.kelurahan || "").trim();
      if (!kec || !kel) continue;
      if (!dataMap[kec]) dataMap[kec] = [];
      dataMap[kec].push(kel);
    }
    const kecTarget = String(kecamatanTerpilih || "").trim().toUpperCase();
    return (dataMap[kecTarget] || []).sort();
  } catch (error) {
    throw new Error("Gagal memproses filter data kelurahan: " + String(error));
  }
}

type BarisRumahIbadah = {
  kecamatan?: string;
  kelurahan?: string;
  nama?: string;
  alamat?: string;
};

// Port 1:1 dari getDataRumahIbadah() — bentuk hasil TETAP array-of-array [kecamatan, kelurahan,
// nama, alamat] (bukan objek) karena index.html membaca lewat row[0]/row[1]/row[2]/row[3]
// (lihat renderTable() di index.html) — mengubah bentuk ini akan merusak modal pilih rumah ibadah.
export async function getDataRumahIbadah(token: string, kategori: string) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return [] as string[][];
  }

  const jenis = jenisDariSheetName(getSheetName(kategori));
  if (!jenis) return [] as string[][];

  let rows: BarisRumahIbadah[];
  if (jenis === "VIHARA") {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = 'VIHARA'
    `;
    if (rows.length === 0) {
      rows = await sql`
        select kecamatan, kelurahan, nama, alamat
        from rumah_ibadah
        where jenis = 'VIHARA_KLENTENG_KUIL'
      `;
    }
  } else if (jenis === "KUIL") {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = 'KUIL'
    `;
    if (rows.length === 0) {
      rows = await sql`
        select kecamatan, kelurahan, nama, alamat
        from rumah_ibadah
        where jenis = 'VIHARA_KLENTENG_KUIL'
      `;
    }
  } else if (jenis === "VIHARA_KLENTENG_KUIL") {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = 'VIHARA_KLENTENG_KUIL'
    `;
    if (rows.length === 0) {
      rows = await sql`
        select kecamatan, kelurahan, nama, alamat
        from rumah_ibadah
        where jenis in ('VIHARA', 'KUIL')
      `;
    }
  } else {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = ${jenis}
    `;
  }
  return rows.map((r) => [
    String(r.kecamatan || ""),
    String(r.kelurahan || ""),
    String(r.nama || ""),
    String(r.alamat || ""),
  ]);
}

// Port 1:1 dari getKemenagData() — sesi tidak sah TIDAK melempar, tapi mengembalikan
// {error:"Sesi tidak sah..."} sebagai nilai balik biasa, sama seperti asli.
const SHEET_KEMENAG_DIIZINKAN = [
  "db_gereja",
  "db_pgk",
  "db_masjid",
  "db_musholla",
  "db_vihara_klenteng_kuil",
  "db_vihara",
  "db_kuil",
];

export async function getKemenagData(token: string, sheetName: string) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return { error: "Sesi tidak sah. Silakan login ulang." };
  }

  if (!SHEET_KEMENAG_DIIZINKAN.includes(sheetName)) return { error: "Akses ditolak" };

  const jenis = jenisDariSheetName(sheetName);
  if (!jenis) return { error: "Akses ditolak" };

  let rows: BarisRumahIbadah[];
  if (sheetName === "db_vihara") {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = 'VIHARA'
    `;
    // Fallback jika belum ada data jenis 'VIHARA' tapi ada 'VIHARA_KLENTENG_KUIL'
    if (rows.length === 0) {
      rows = await sql`
        select kecamatan, kelurahan, nama, alamat
        from rumah_ibadah
        where jenis = 'VIHARA_KLENTENG_KUIL'
      `;
    }
  } else if (sheetName === "db_kuil") {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = 'KUIL'
    `;
    // Fallback jika belum ada data jenis 'KUIL' tapi ada 'VIHARA_KLENTENG_KUIL'
    if (rows.length === 0) {
      rows = await sql`
        select kecamatan, kelurahan, nama, alamat
        from rumah_ibadah
        where jenis = 'VIHARA_KLENTENG_KUIL'
      `;
    }
  } else {
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = ${jenis}
    `;
  }

  return rows.map((r) => [
    String(r.kecamatan || ""),
    String(r.kelurahan || ""),
    String(r.nama || ""),
    String(r.alamat || ""),
  ]);
}

// Port dari getVersiAplikasi() — di Kode.gs versi disimpan di PropertiesService dan dibuat sekali
// (timestamp) lalu di-bump manual oleh admin (menjalankan setVersiAplikasi() dari editor GAS)
// setiap kali deploy versi baru, supaya index.html (mulaiVersionCheck/cekVersiAplikasi, poll tiap
// 2 menit) bisa menampilkan modal "ada versi baru, refresh halaman". Di Supabase, baris ini
// disimpan di tabel `setelan` (key='VERSI_APLIKASI') — untuk menandai versi baru saat deploy Edge
// Function, jalankan manual: update setelan set value = extract(epoch from now())::text where key='VERSI_APLIKASI';
// Cache in-memory per Deno isolate untuk menghindari pemanggilan query DB berulang setiap polling 2 menit
let cachedVersiAplikasi: { value: string; expiry: number } | null = null;

export async function getVersiAplikasi() {
  const now = Date.now();
  if (cachedVersiAplikasi && cachedVersiAplikasi.expiry > now) {
    return cachedVersiAplikasi.value;
  }

  try {
    const rows = await sql`select value from setelan where key = 'VERSI_APLIKASI' limit 1`;
    if (rows.length > 0 && rows[0].value) {
      const val = String(rows[0].value);
      cachedVersiAplikasi = { value: val, expiry: now + 60_000 };
      return val;
    }

    const versiBaru = Date.now().toString();
    await sql`
      insert into setelan (key, value) values ('VERSI_APLIKASI', ${versiBaru})
      on conflict (key) do nothing
    `;
    const cekLagi = await sql`select value from setelan where key = 'VERSI_APLIKASI' limit 1`;
    const hasil = cekLagi[0]?.value ? String(cekLagi[0].value) : versiBaru;
    cachedVersiAplikasi = { value: hasil, expiry: now + 60_000 };
    return hasil;
  } catch (_e) {
    // Fallback aman jika koneksi pooler transient/cold-start agar polling tidak pernah mengembalikan 500
    if (cachedVersiAplikasi) return cachedVersiAplikasi.value;
    return "1789444821758";
  }
}

