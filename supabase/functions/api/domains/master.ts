import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";

const JENIS_RUMAH_IBADAH_VALID = [
  "MASJID", "MUSHOLLA", "GEREJA", "GEREJA_KATOLIK", "VIHARA", "KLENTENG", "KUIL",
];
const JENIS_LEGACY_GABUNGAN = "VIHARA_KLENTENG_KUIL";
const JENIS_PER_ROLE: Record<string, string[]> = {
  UTAMA: JENIS_RUMAH_IBADAH_VALID,
  KECAMATAN: JENIS_RUMAH_IBADAH_VALID,
  "GURU SEKOLAH BUDDHA": ["VIHARA"],
  "GURU SEKOLAH HINDU": ["KUIL"],
  "GURU SEKOLAH KONG HU CHU": ["KLENTENG"],
  "GURU SEKOLAH MINGGU": ["GEREJA", "GEREJA_KATOLIK"],
  "PENATUA GEREJA": ["GEREJA"],
  "GURU MAGHRIB MENGAJI": ["MASJID", "MUSHOLLA"],
};

function jenisDiizinkanUntukSesi(sesi: { role: string }, jenis: string): boolean {
  const role = String(sesi.role || "").trim().toUpperCase();
  return (JENIS_PER_ROLE[role] || []).includes(jenis);
}

function sesiTerikatKecamatan(sesi: { role: string }): boolean {
  const role = String(sesi.role || "").trim().toUpperCase();
  return role === "KECAMATAN" || role === "GURU MAGHRIB MENGAJI";
}

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
    case "GURU SEKOLAH KONG HU CHU":
      return "db_klenteng";
    case "PETUGAS GEREJA KATOLIK":
      return "db_pgk";
    default:
      return null;
  }
}

// Turunan dari getSheetName() - dipakai internal untuk query kolom `jenis` di tabel rumah_ibadah.
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
    case "db_klenteng":
      return "KLENTENG";
    case "db_kuil":
      return "KUIL";
    case "db_pgk":
      return "GEREJA_KATOLIK";
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
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (_e) {
    return [] as string[][];
  }

  const jenis = jenisDariSheetName(getSheetName(kategori));
  if (!jenis || !jenisDiizinkanUntukSesi(sesi, jenis)) return [] as string[][];

  let rows: BarisRumahIbadah[];
  if (sesiTerikatKecamatan(sesi)) {
    const kecamatan = String(sesi.kecamatan || "").trim().toUpperCase();
    if (!kecamatan) return [] as string[][];
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = ${jenis} and upper(kecamatan) = ${kecamatan}
    `;
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
  "db_vihara",
  "db_klenteng",
  "db_kuil",
];

export async function getKemenagData(token: string, sheetName: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (_e) {
    return { error: "Sesi tidak sah. Silakan login ulang." };
  }

  if (!SHEET_KEMENAG_DIIZINKAN.includes(sheetName)) return { error: "Akses ditolak" };

  const jenis = jenisDariSheetName(sheetName);
  if (!jenis || !jenisDiizinkanUntukSesi(sesi, jenis)) return { error: "Akses ditolak" };

  let rows: BarisRumahIbadah[];
  if (sesiTerikatKecamatan(sesi)) {
    const kecamatan = String(sesi.kecamatan || "").trim().toUpperCase();
    if (!kecamatan) return { error: "Akses ditolak" };
    rows = await sql`
      select kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where jenis = ${jenis} and upper(kecamatan) = ${kecamatan}
    `;
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

// =========================================================================
// CRUD DATA RUMAH IBADAH KHUSUS ADMIN UTAMA (SUPERADMIN / DINAS SOSIAL)
// =========================================================================

export interface FilterRumahIbadahAdmin {
  cari?: string;
  jenis?: string;
  kecamatan?: string;
  statusKlasifikasi?: "PERLU_KLASIFIKASI" | "SELESAI";
  page?: number;
  limit?: number;
}

export async function ambilDaftarRumahIbadahAdmin(
  token: string,
  params?: FilterRumahIbadahAdmin,
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: Hanya Admin Utama yang dapat mengelola data rumah ibadah." };
  }

  const cari = String(params?.cari || "").trim();
  const jenis = String(params?.jenis || "").trim().toUpperCase();
  const kecamatan = String(params?.kecamatan || "").trim().toUpperCase();
  const statusKlasifikasi = String(params?.statusKlasifikasi || "").trim().toUpperCase();
  const page = Math.max(1, Number(params?.page || 1));
  const limit = Math.min(100, Math.max(5, Number(params?.limit || 25)));
  const offset = (page - 1) * limit;

  if (jenis && !JENIS_RUMAH_IBADAH_VALID.includes(jenis)) {
    return { sukses: false, pesan: "Filter jenis rumah ibadah tidak valid." };
  }
  if (statusKlasifikasi && statusKlasifikasi !== "PERLU_KLASIFIKASI" && statusKlasifikasi !== "SELESAI") {
    return { sukses: false, pesan: "Filter status klasifikasi tidak valid." };
  }

  try {
    const cariPattern = cari ? `%${cari}%` : "";

    const countResult = await sql`
      select count(*)::int as total
      from rumah_ibadah
      where 1=1
        ${jenis ? sql`and jenis = ${jenis}` : sql``}
        ${kecamatan ? sql`and upper(kecamatan) = ${kecamatan}` : sql``}
        ${statusKlasifikasi === "PERLU_KLASIFIKASI" ? sql`and jenis = ${JENIS_LEGACY_GABUNGAN}` : sql``}
        ${statusKlasifikasi === "SELESAI" ? sql`and jenis in ('MASJID', 'MUSHOLLA', 'GEREJA', 'GEREJA_KATOLIK', 'VIHARA', 'KLENTENG', 'KUIL')` : sql``}
        ${cari ? sql`and (nama ilike ${cariPattern} or alamat ilike ${cariPattern} or kelurahan ilike ${cariPattern})` : sql``}
    `;
    const total = Number(countResult[0]?.total || 0);

    const rows = await sql`
      select id, jenis, kecamatan, kelurahan, nama, alamat
      from rumah_ibadah
      where 1=1
        ${jenis ? sql`and jenis = ${jenis}` : sql``}
        ${kecamatan ? sql`and upper(kecamatan) = ${kecamatan}` : sql``}
        ${statusKlasifikasi === "PERLU_KLASIFIKASI" ? sql`and jenis = ${JENIS_LEGACY_GABUNGAN}` : sql``}
        ${statusKlasifikasi === "SELESAI" ? sql`and jenis in ('MASJID', 'MUSHOLLA', 'GEREJA', 'GEREJA_KATOLIK', 'VIHARA', 'KLENTENG', 'KUIL')` : sql``}
        ${cari ? sql`and (nama ilike ${cariPattern} or alamat ilike ${cariPattern} or kelurahan ilike ${cariPattern})` : sql``}
      order by kecamatan asc, kelurahan asc, nama asc
      limit ${limit} offset ${offset}
    `;

    return {
      sukses: true,
      total,
      halaman: page,
      totalHalaman: Math.ceil(total / limit) || 1,
      limit,
      daftar: rows.map((r: { id: unknown; jenis: unknown; kecamatan: unknown; kelurahan: unknown; nama: unknown; alamat: unknown }) => ({
        id: Number(r.id),
        jenis: String(r.jenis || ""),
        kecamatan: String(r.kecamatan || ""),
        kelurahan: String(r.kelurahan || ""),
        nama: String(r.nama || ""),
        alamat: String(r.alamat || ""),
      })),
    };
  } catch (err) {
    return { sukses: false, pesan: "Gagal mengambil data rumah ibadah: " + (err instanceof Error ? err.message : String(err)) };
  }
}

export async function tambahRumahIbadah(
  token: string,
  payload: { jenis: string; kecamatan: string; kelurahan: string; nama: string; alamat?: string },
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: Hanya Admin Utama yang dapat menambah data rumah ibadah." };
  }

  const jenis = String(payload?.jenis || "").trim().toUpperCase();
  const kecamatan = String(payload?.kecamatan || "").trim().toUpperCase();
  const kelurahan = String(payload?.kelurahan || "").trim().toUpperCase();
  const nama = String(payload?.nama || "").trim().toUpperCase();
  const alamat = String(payload?.alamat || "").trim().toUpperCase();

  if (!JENIS_RUMAH_IBADAH_VALID.includes(jenis)) {
    return { sukses: false, pesan: `Jenis tempat ibadah tidak valid. Pilihan: ${JENIS_RUMAH_IBADAH_VALID.join(", ")}` };
  }
  if (!kecamatan) return { sukses: false, pesan: "Kecamatan wajib dipilih." };
  if (!kelurahan) return { sukses: false, pesan: "Kelurahan wajib dipilih." };
  if (!nama || nama.length < 3) return { sukses: false, pesan: "Nama tempat ibadah wajib diisi minimal 3 karakter." };

  try {
    const inserted = await sql`
      insert into rumah_ibadah (jenis, kecamatan, kelurahan, nama, alamat)
      values (${jenis}, ${kecamatan}, ${kelurahan}, ${nama}, ${alamat})
      returning id
    `;
    return {
      sukses: true,
      pesan: `Data rumah ibadah "${nama}" berhasil ditambahkan.`,
      id: Number(inserted[0]?.id),
    };
  } catch (err) {
    return { sukses: false, pesan: "Gagal menambah rumah ibadah: " + (err instanceof Error ? err.message : String(err)) };
  }
}

export async function ubahRumahIbadah(
  token: string,
  payload: { id: number; jenis: string; kecamatan: string; kelurahan: string; nama: string; alamat?: string },
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: Hanya Admin Utama yang dapat mengubah data rumah ibadah." };
  }

  const id = Number(payload?.id);
  if (!id || id <= 0) return { sukses: false, pesan: "ID rumah ibadah tidak valid." };

  const jenis = String(payload?.jenis || "").trim().toUpperCase();
  const kecamatan = String(payload?.kecamatan || "").trim().toUpperCase();
  const kelurahan = String(payload?.kelurahan || "").trim().toUpperCase();
  const nama = String(payload?.nama || "").trim().toUpperCase();
  const alamat = String(payload?.alamat || "").trim().toUpperCase();

  if (!JENIS_RUMAH_IBADAH_VALID.includes(jenis)) {
    return { sukses: false, pesan: `Jenis tempat ibadah tidak valid. Pilihan: ${JENIS_RUMAH_IBADAH_VALID.join(", ")}` };
  }
  if (!kecamatan) return { sukses: false, pesan: "Kecamatan wajib dipilih." };
  if (!kelurahan) return { sukses: false, pesan: "Kelurahan wajib dipilih." };
  if (!nama || nama.length < 3) return { sukses: false, pesan: "Nama tempat ibadah wajib diisi minimal 3 karakter." };

  try {
    const updated = await sql`
      update rumah_ibadah
      set jenis = ${jenis}, kecamatan = ${kecamatan}, kelurahan = ${kelurahan}, nama = ${nama}, alamat = ${alamat}
      where id = ${id}
      returning id
    `;
    if (updated.length === 0) {
      return { sukses: false, pesan: "Data rumah ibadah tidak ditemukan atau sudah dihapus." };
    }
    return { sukses: true, pesan: `Data rumah ibadah "${nama}" berhasil diperbarui.` };
  } catch (err) {
    return { sukses: false, pesan: "Gagal memperbarui rumah ibadah: " + (err instanceof Error ? err.message : String(err)) };
  }
}

export async function hapusRumahIbadah(token: string, idRumahIbadah: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if (sesi.role !== "UTAMA") {
    return { sukses: false, pesan: "Akses ditolak: Hanya Admin Utama yang dapat menghapus data rumah ibadah." };
  }

  const id = Number(idRumahIbadah);
  if (!id || id <= 0) return { sukses: false, pesan: "ID rumah ibadah tidak valid." };

  try {
    const deleted = await sql`
      delete from rumah_ibadah
      where id = ${id}
      returning id, nama
    `;
    if (deleted.length === 0) {
      return { sukses: false, pesan: "Data rumah ibadah tidak ditemukan atau sudah dihapus sebelumnya." };
    }
    return { sukses: true, pesan: `Data rumah ibadah "${deleted[0]?.nama || ""}" berhasil dihapus.` };
  } catch (err) {
    return { sukses: false, pesan: "Gagal menghapus data rumah ibadah: " + (err instanceof Error ? err.message : String(err)) };
  }
}
