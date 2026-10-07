import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import type { DataSesi } from "../_shared/sesi.ts";
import { KECAMATAN_MEDAN_URUT, LAYANAN_BATASI_TEMPAT_TUGAS, rapikanTeks, TAHUN_AKTIF } from "../_shared/config.ts";
import { formatTanggalDDMMYYYY } from "../_shared/tanggal.ts";
import { panggilGasAdmin } from "../_shared/gasDrive.ts";
import { hapusObjekStorage, pathStorageDariUrl } from "../_shared/storage.ts";
import { getMasterLayanan } from "./master.ts";
import { hitungUmur, labelKolom, MAP_IDX_KE_KOLOM_BERKAS, tglDDMMYYYYkeISO } from "./penerima.ts";

// ---------------------------------------------------------------------------
// KELOLA DATA & BERKAS -- CRUD penuh khusus Admin Utama (role "UTAMA") atas seluruh data
// penerima (kiriman kecamatan maupun Kemenag; keduanya di tabel `penerima` yang sama) dan berkas
// Google Drive-nya.
//
// Aturan yang sengaja dijaga:
//  * Semua aksi diawali wajibUtama() -- role dinormalisasi (trim + uppercase).
//  * Mutasi HANYA untuk TAHUN_AKTIF. Baris tahun arsip (mis. 2026) ditimpa otomatis dari Google
//    Sheet db_2026 tiap 10 menit (sinkronSheet2026.ts), jadi mengubah/menghapusnya di DB percuma
//    dan menyesatkan; tahun arsip hanya boleh dilihat.
//  * Pool DB kecil (_shared/db.ts, max: 2): DI DALAM sql.begin() cuma boleh memakai `trx`, jangan
//    memanggil `sql`/fungsi lain yang memakai `sql` -- bisa menunggu selamanya bila pool habis.
//  * Urutan hapus: database dulu (transaksi), baru Drive. Drive hanya memindahkan ke Sampah
//    (bisa dipulihkan ~30 hari). Kegagalan Drive TIDAK membatalkan penghapusan data; hasilnya
//    melaporkan `drive.status = "gagal"` supaya admin bisa membereskan manual.
// ---------------------------------------------------------------------------

async function wajibUtama(token: string): Promise<DataSesi> {
  const sesi = await wajibSesi(token);
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    throw new Error("Akses ditolak: hanya Admin Utama yang dapat mengelola data dan berkas penerima.");
  }
  return sesi;
}

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseTahun(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

function parseId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function wajibTahunAktif(tahun: number): string | null {
  return tahun === TAHUN_AKTIF ? null : `Data tahun ${tahun} bersifat arsip dan hanya bisa dilihat (sumbernya Google Sheet, disinkron otomatis).`;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

const LINK_DRIVE = /^https?:\/\/(drive|docs)\.google\.com\//i;
const ID_FOLDER_DRIVE = /^[A-Za-z0-9_-]{15,}$/; // ID Drive tidak memuat "/"; path Storage legacy memuat "/"

// ---------------------------------------------------------------------------
// BACA
// ---------------------------------------------------------------------------

// Daftar tahun yang punya data hanya berubah saat tahun baru mulai dipakai. Tanpa memo, setiap
// pemuatan daftar (tiap ketikan pencarian & ganti halaman) memindai seluruh partisi `penerima`
// hanya untuk mengisi pilihan tahun. Memo per-instance, kedaluwarsa 5 menit.
let memoTahun: { waktu: number; daftar: number[] } | null = null;
async function daftarTahunDiDb(): Promise<number[]> {
  if (memoTahun && Date.now() - memoTahun.waktu < 5 * 60_000) return memoTahun.daftar;
  const rows = await sql`select distinct tahun from penerima order by tahun desc`;
  memoTahun = { waktu: Date.now(), daftar: rows.map((r) => Number(r.tahun)) };
  return memoTahun.daftar;
}

// Master layanan hanya untuk label/kategori di tampilan daftar & detail; jarang berubah, jadi memo 60 dtk
// menghemat satu query DB per pemuatan (pool cuma 1 koneksi, semua query antre). Validasi ubah data
// (adminUbahData) sengaja tetap membaca langsung agar aturan layanan selalu terbaru.
let memoMaster: { waktu: number; nilai: Awaited<ReturnType<typeof getMasterLayanan>> } | null = null;
async function masterLayananTampilan() {
  if (memoMaster && Date.now() - memoMaster.waktu < 60_000) return memoMaster.nilai;
  const nilai = await getMasterLayanan();
  memoMaster = { waktu: Date.now(), nilai };
  return nilai;
}

export async function adminDaftarData(token: string, filter: Record<string, unknown> = {}) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  try {
    const f = filter || {};
    const tahun = parseTahun(f.tahun ?? TAHUN_AKTIF);
    if (!tahun) return { sukses: false, pesan: "Tahun tidak valid." };

    const page = Math.max(1, Math.floor(Number(f.page)) || 1);
    const limit = Math.min(50, Math.max(5, Math.floor(Number(f.limit)) || 20));
    const offset = (page - 1) * limit;

    const cari = str(f.cari).slice(0, 80);
    const pola = "%" + cari.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    const layanan = str(f.layanan).toUpperCase();
    const kecamatan = str(f.kecamatan).toUpperCase();
    const kategori = str(f.kategori).toUpperCase();
    const kelengkapan = str(f.kelengkapan).toUpperCase();

    const master = await masterLayananTampilan();
    const layananKemenag = master.kemenag.map((v) => v.toUpperCase());
    const setKemenag = new Set(layananKemenag);

    // deno-lint-ignore no-explicit-any
    const kondisi: any[] = [sql`tahun = ${tahun}`];
    if (cari) kondisi.push(sql`(nama ilike ${pola} or nik like ${pola})`);
    if (layanan) kondisi.push(sql`upper(layanan) = ${layanan}`);
    if (kecamatan) kondisi.push(sql`upper(kecamatan) = ${kecamatan}`);
    if (kategori === "KEMENAG") {
      kondisi.push(layananKemenag.length ? sql`upper(layanan) in ${sql(layananKemenag)}` : sql`false`);
    } else if (kategori === "KECAMATAN" && layananKemenag.length) {
      kondisi.push(sql`upper(layanan) not in ${sql(layananKemenag)}`);
    }
    // deno-lint-ignore no-explicit-any
    const where = kondisi.reduce((a: any, b: any) => sql`${a} and ${b}`);

    const dasar = sql`
      select id, tahun, nomor_urut, nama, nik, layanan, kecamatan, kelurahan, tempat_tugas,
             status_verifikasi, diperbarui_at,
             ( (nullif(btrim(link_ktp), '') is not null)::int
             + (nullif(btrim(link_buku_rekening), '') is not null)::int
             + (nullif(btrim(link_surat_permohonan), '') is not null)::int
             + (nullif(btrim(link_pernyataan_satu_bantuan), '') is not null)::int
             + (nullif(btrim(link_domisili_kelurahan), '') is not null)::int
             + (nullif(btrim(link_formulir_pendataan), '') is not null)::int
             + (nullif(btrim(link_berkas_pendukung), '') is not null)::int
             + (nullif(btrim(link_foto_plank_rumah_ibadah), '') is not null)::int
             + (nullif(btrim(link_foto_lokasi_ibadah), '') is not null)::int
             + (nullif(btrim(link_foto_kegiatan_belajar), '') is not null)::int
             + (nullif(btrim(link_rekomendasi_bkm), '') is not null)::int
             + (nullif(btrim(link_rekomendasi_rumah_ibadah), '') is not null)::int
             + (nullif(btrim(link_domisili_rumah_ibadah), '') is not null)::int ) as jumlah_berkas
      from penerima
      where ${where}
    `;
    const saringKelengkapan = kelengkapan === "ADA"
      ? sql`where jumlah_berkas > 0`
      : kelengkapan === "KOSONG"
      ? sql`where jumlah_berkas = 0`
      : sql``;

    const [hitung, baris, tahunRows] = [
      kelengkapan === "ADA" || kelengkapan === "KOSONG"
        ? await sql`select count(*)::int as n from (${dasar}) t ${saringKelengkapan}`
        : await sql`select count(*)::int as n from penerima where ${where}`,
      await sql`select * from (${dasar}) t ${saringKelengkapan} order by nama, id limit ${limit} offset ${offset}`,
      await daftarTahunDiDb(),
    ];
    const total = Number(hitung[0]?.n) || 0;

    return {
      sukses: true,
      daftar: baris.map((r) => ({
        id: Number(r.id),
        tahun: Number(r.tahun),
        nomorUrut: r.nomor_urut,
        nama: str(r.nama),
        nik: str(r.nik),
        layanan: str(r.layanan),
        kecamatan: str(r.kecamatan),
        kelurahan: str(r.kelurahan),
        tempatTugas: str(r.tempat_tugas),
        status: str(r.status_verifikasi),
        jumlahBerkas: Number(r.jumlah_berkas) || 0,
        kategori: setKemenag.has(str(r.layanan).toUpperCase()) ? "KEMENAG" : "KECAMATAN",
      })),
      total,
      totalHalaman: Math.max(1, Math.ceil(total / limit)),
      page,
      limit,
      tahun,
      tahunAktif: TAHUN_AKTIF,
      tahunTersedia: Array.from(new Set([TAHUN_AKTIF, ...tahunRows])).sort((a, b) => b - a),
      bolehUbah: tahun === TAHUN_AKTIF,
      opsi: { layananKecamatan: master.kecamatan, layananKemenag: master.kemenag, kecamatan: KECAMATAN_MEDAN_URUT },
    };
  } catch (e) {
    return { sukses: false, pesan: "Gagal memuat daftar data: " + pesanError(e) };
  }
}

export async function adminDetailData(token: string, id: number, tahun: number) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  try {
    const idNum = parseId(id);
    const th = parseTahun(tahun ?? TAHUN_AKTIF);
    if (!idNum || !th) return { sukses: false, pesan: "Parameter tidak valid." };

    const rows = await sql`select * from penerima where id = ${idNum} and tahun = ${th} limit 1`;
    if (rows.length === 0) return { sukses: false, pesan: "Data tidak ditemukan (mungkin sudah dihapus)." };
    const r = rows[0];

    let jumlahBatchPembayaran = 0;
    try {
      const b = await sql`select count(distinct batch_id)::int as n from pembayaran_baris where nik = ${str(r.nik)}`;
      jumlahBatchPembayaran = Number(b[0]?.n) || 0;
    } catch (_e) { /* peringatan saja; jangan gagalkan detail */ }

    const master = await masterLayananTampilan();
    const kemenag = new Set(master.kemenag.map((v) => v.toUpperCase()));

    const berkas = Object.keys(MAP_IDX_KE_KOLOM_BERKAS).map((k) => {
      const idx = Number(k);
      const kolom = MAP_IDX_KE_KOLOM_BERKAS[idx];
      return { idx, kolom, label: labelKolom(idx), link: str(r[kolom]) };
    });

    return {
      sukses: true,
      bolehUbah: th === TAHUN_AKTIF,
      versi: r.diperbarui_at instanceof Date ? r.diperbarui_at.toISOString() : str(r.diperbarui_at),
      jumlahBatchPembayaran,
      data: {
        id: Number(r.id),
        tahun: Number(r.tahun),
        nomorUrut: r.nomor_urut,
        nama: str(r.nama),
        nik: str(r.nik),
        jenisKelamin: str(r.jenis_kelamin),
        tempatLahir: str(r.tempat_lahir),
        tanggalLahir: formatTanggalDDMMYYYY(r.tanggal_lahir),
        umur: r.umur,
        alamat: str(r.alamat),
        layanan: str(r.layanan),
        tempatTugas: str(r.tempat_tugas),
        alamatTugas: str(r.alamat_tugas),
        kecamatan: str(r.kecamatan),
        kelurahan: str(r.kelurahan),
        namaRekening: str(r.nama_rekening),
        nomorRekening: str(r.nomor_rekening),
        kantorCabang: str(r.kantor_cabang),
        noKontak: str(r.no_kontak).replace(/^'+/, ""),
        statusBpjs: str(r.status_bpjs_tk),
        statusVerifikasi: str(r.status_verifikasi),
        keteranganVerifikasi: str(r.keterangan_verifikasi),
        idFolderBerkas: str(r.id_folder_berkas),
        linkKoordinat: str(r.link_koordinat_lokasi),
        kategori: kemenag.has(str(r.layanan).toUpperCase()) ? "KEMENAG" : "KECAMATAN",
      },
      berkas,
    };
  } catch (e) {
    return { sukses: false, pesan: "Gagal memuat detail: " + pesanError(e) };
  }
}

// ---------------------------------------------------------------------------
// UBAH
// ---------------------------------------------------------------------------
const KOLOM_EDIT: Record<string, { label: string; huruf: boolean; maks: number }> = {
  nama: { label: "Nama Lengkap", huruf: true, maks: 150 },
  nik: { label: "NIK", huruf: false, maks: 16 },
  jenis_kelamin: { label: "Jenis Kelamin", huruf: true, maks: 20 },
  tempat_lahir: { label: "Tempat Lahir", huruf: true, maks: 100 },
  tanggal_lahir: { label: "Tanggal Lahir", huruf: false, maks: 10 },
  alamat: { label: "Alamat Domisili", huruf: true, maks: 500 },
  layanan: { label: "Layanan", huruf: true, maks: 100 },
  tempat_tugas: { label: "Tempat Tugas", huruf: true, maks: 200 },
  alamat_tugas: { label: "Alamat Tugas", huruf: true, maks: 500 },
  kecamatan: { label: "Kecamatan", huruf: true, maks: 60 },
  kelurahan: { label: "Kelurahan", huruf: true, maks: 60 },
  nama_rekening: { label: "Nama Rekening", huruf: true, maks: 150 },
  nomor_rekening: { label: "Nomor Rekening", huruf: false, maks: 14 },
  kantor_cabang: { label: "Kantor Cabang", huruf: true, maks: 150 },
  no_kontak: { label: "No. Kontak", huruf: false, maks: 20 },
  status_bpjs_tk: { label: "Status BPJS", huruf: true, maks: 10 },
};

function isoDariRow(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return str(v).slice(0, 10);
}

function tanggalIsoValid(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

export async function adminUbahData(
  token: string,
  id: number,
  tahun: number,
  perubahan: Record<string, unknown>,
  versiDiharapkan?: string,
) {
  let sesi: DataSesi;
  try {
    sesi = await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  const idNum = parseId(id);
  const th = parseTahun(tahun);
  if (!idNum || !th) return { sukses: false, pesan: "Parameter tidak valid." };
  const tolakArsip = wajibTahunAktif(th);
  if (tolakArsip) return { sukses: false, pesan: tolakArsip };

  const masuk = perubahan && typeof perubahan === "object" ? perubahan : {};
  const kunci = Object.keys(masuk);
  if (kunci.length === 0) return { sukses: true, pesan: "Tidak ada perubahan.", jumlahBerubah: 0 };
  const tidakDikenal = kunci.filter((k) => !KOLOM_EDIT[k]);
  if (tidakDikenal.length > 0) return { sukses: false, pesan: "Kolom tidak dikenal: " + tidakDikenal.join(", ") };

  try {
    // Referensi dibaca SEBELUM transaksi (pool 1 koneksi -- lihat catatan di atas berkas).
    const master = kunci.includes("layanan") ? await getMasterLayanan() : null;
    const layananSah = master ? new Set([...master.kecamatan, ...master.kemenag].map((v) => v.toUpperCase())) : null;

    // deno-lint-ignore no-explicit-any
    const hasil = await sql.begin(async (trx: any) => {
      const rows = await trx`select * from penerima where id = ${idNum} and tahun = ${th} for update`;
      if (rows.length === 0) return { sukses: false, pesan: "Data tidak ditemukan (mungkin sudah dihapus)." };
      const lama = rows[0];

      if (versiDiharapkan) {
        const versiSekarang = lama.diperbarui_at instanceof Date ? lama.diperbarui_at.toISOString() : str(lama.diperbarui_at);
        if (versiSekarang !== str(versiDiharapkan)) {
          return {
            sukses: false,
            konflik: true,
            pesan: "Data ini baru saja diubah oleh pengguna lain. Muat ulang data lalu ulangi perubahan Anda.",
          };
        }
      }

      const lamaStr = (kolom: string): string => kolom === "tanggal_lahir" ? isoDariRow(lama.tanggal_lahir) : str(lama[kolom]);
      const baru: Record<string, string> = {};
      // deno-lint-ignore no-explicit-any
      const setValues: Record<string, any> = {};
      const riwayat: Array<{ label: string; sebelum: string; sesudah: string }> = [];

      for (const k of kunci) {
        const def = KOLOM_EDIT[k];
        let nilai = str(masuk[k]);
        if (k === "tanggal_lahir") nilai = nilai ? (tglDDMMYYYYkeISO(nilai) || "") : "";
        else if (def.huruf) nilai = nilai.toUpperCase();
        if (nilai.length > def.maks) return { sukses: false, pesan: `GAGAL: ${def.label} terlalu panjang (maks ${def.maks} karakter).` };
        if (nilai === lamaStr(k)) continue;
        baru[k] = nilai;
      }
      const berubah = Object.keys(baru);
      if (berubah.length === 0) return { sukses: true, pesan: "Tidak ada perubahan.", jumlahBerubah: 0 };

      const eff = (k: string): string => (k in baru ? baru[k] : lamaStr(k));

      // ── Validasi ──
      if ("nama" in baru && !baru.nama) return { sukses: false, pesan: "GAGAL: Nama tidak boleh kosong." };
      if ("nik" in baru && !/^\d{16}$/.test(baru.nik)) return { sukses: false, pesan: "GAGAL: NIK harus 16 digit angka." };
      if ("nomor_rekening" in baru && baru.nomor_rekening && baru.nomor_rekening.length !== 14) {
        return { sukses: false, pesan: "GAGAL: Nomor rekening harus 14 karakter." };
      }
      if ("status_bpjs_tk" in baru && baru.status_bpjs_tk && !["YA", "TIDAK"].includes(baru.status_bpjs_tk)) {
        return { sukses: false, pesan: "GAGAL: Status BPJS harus YA atau TIDAK." };
      }
      if ("layanan" in baru && (!baru.layanan || !layananSah?.has(baru.layanan))) {
        return { sukses: false, pesan: "GAGAL: Layanan tidak dikenal." };
      }
      if ("kecamatan" in baru && !KECAMATAN_MEDAN_URUT.includes(baru.kecamatan)) {
        return { sukses: false, pesan: "GAGAL: Kecamatan tidak dikenal." };
      }
      if (("kecamatan" in baru || "kelurahan" in baru) && eff("kelurahan")) {
        const w = await trx`
          select 1 from wilayah
          where upper(kecamatan) = ${eff("kecamatan").toUpperCase()} and upper(kelurahan) = ${eff("kelurahan").toUpperCase()}
          limit 1
        `;
        if (w.length === 0) return { sukses: false, pesan: "GAGAL: Kelurahan tidak sesuai dengan kecamatan yang dipilih." };
      }
      if ("tanggal_lahir" in baru) {
        if (!tanggalIsoValid(baru.tanggal_lahir)) return { sukses: false, pesan: "GAGAL: Tanggal lahir tidak valid." };
        const umur = hitungUmur(baru.tanggal_lahir);
        if (umur === null || umur < 18) return { sukses: false, pesan: "GAGAL: Usia di bawah 18 tahun tidak memenuhi syarat." };
        setValues["umur"] = umur;
      }

      // ── Duplikat (semua memakai trx) ──
      if ("nik" in baru) {
        const d = await trx`select id from penerima where tahun = ${th} and nik = ${baru.nik} and id <> ${idNum} limit 1`;
        if (d.length > 0) return { sukses: false, pesan: "GAGAL: NIK " + baru.nik + " sudah terdaftar." };
      }
      if ("nomor_rekening" in baru && baru.nomor_rekening) {
        const d = await trx`select id from penerima where tahun = ${th} and nomor_rekening = ${baru.nomor_rekening} and id <> ${idNum} limit 1`;
        if (d.length > 0) return { sukses: false, pesan: "GAGAL: Nomor rekening " + baru.nomor_rekening + " sudah digunakan." };
      }
      const layananEff = eff("layanan").toUpperCase();
      if (
        ("tempat_tugas" in baru || "alamat_tugas" in baru || "layanan" in baru) &&
        LAYANAN_BATASI_TEMPAT_TUGAS.includes(layananEff)
      ) {
        const d = await trx`
          select nama from penerima
          where tahun = ${th} and layanan = ${layananEff}
            and tempat_tugas = ${rapikanTeks(eff("tempat_tugas"))} and alamat_tugas = ${rapikanTeks(eff("alamat_tugas"))}
            and id <> ${idNum}
          limit 1
        `;
        if (d.length > 0) {
          return { sukses: false, pesan: `GAGAL: ${eff("tempat_tugas")} sudah memiliki penerima untuk layanan ${layananEff} atas nama ${d[0].nama}.` };
        }
      }

      // ── Kuota bila baris pindah kecamatan/layanan ──
      if ("layanan" in baru || "kecamatan" in baru) {
        const kec = eff("kecamatan").toUpperCase();
        const kq = await trx`select kuota_maks from kuota where kecamatan = ${kec} and layanan = ${layananEff} limit 1`;
        if (kq.length === 0) {
          return { sukses: false, kuotaHabis: true, pesan: `GAGAL: Kuota layanan ${layananEff} untuk ${kec} belum diset. Atur dulu di menu Kuota.` };
        }
        const pakai = await trx`
          select count(*)::int as n from penerima
          where tahun = ${th} and upper(kecamatan) = ${kec} and upper(layanan) = ${layananEff} and id <> ${idNum}
        `;
        if ((Number(pakai[0]?.n) || 0) >= (Number(kq[0].kuota_maks) || 0)) {
          return { sukses: false, kuotaHabis: true, pesan: `GAGAL: Kuota ${layananEff} di ${kec} sudah penuh. Naikkan kuota di menu Kuota bila memang perlu.` };
        }
      }

      // ── Tulis ──
      for (const k of berubah) {
        setValues[k] = baru[k] === "" && k === "tanggal_lahir" ? null : baru[k];
        riwayat.push({
          label: KOLOM_EDIT[k].label,
          sebelum: k === "tanggal_lahir" ? formatTanggalDDMMYYYY(lama.tanggal_lahir) : lamaStr(k),
          sesudah: k === "tanggal_lahir" ? formatTanggalDDMMYYYY(baru[k]) : baru[k],
        });
      }
      const cols = Object.keys(setValues);
      const vals = cols.map((c) => setValues[c]);
      const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
      // Nama kolom datang dari daftar tetap KOLOM_EDIT/umur -- bukan dari input pengguna.
      await trx.unsafe(
        `update penerima set ${setSql}, diperbarui_at = now() where id = $${cols.length + 1} and tahun = $${cols.length + 2}`,
        [...vals, idNum, th],
      );
      // Snapshot data_detail (kalau sudah terbentuk) ikut disamakan supaya tidak basi.
      await trx.unsafe(
        `update data_detail set ${setSql}, diperbarui_at = now() where penerima_id = $${cols.length + 1} and tahun = $${cols.length + 2}`,
        [...vals, idNum, th],
      );

      const namaPenerima = eff("nama");
      for (const r of riwayat) {
        await trx`
          insert into riwayat_edit
            (waktu, editor_username, editor_role, penerima_id, tahun, nama_penerima, kolom_diubah, sebelum, sesudah)
          values (now(), ${sesi.username}, ${sesi.role}, ${idNum}, ${th}, ${namaPenerima}, ${r.label}, ${r.sebelum}, ${r.sesudah})
        `;
      }
      return { sukses: true, pesan: `Data berhasil diperbarui (${riwayat.length} kolom diubah).`, jumlahBerubah: riwayat.length };
    });
    return hasil;
  } catch (e) {
    return { sukses: false, pesan: "Gagal mengubah data: " + pesanError(e) };
  }
}

// ---------------------------------------------------------------------------
// HAPUS -- helper Drive/Storage
// ---------------------------------------------------------------------------
type StatusDrive = "dipindah" | "sudahTiada" | "gagal" | "dilewati";
interface HasilDrive {
  status: StatusDrive;
  pesan?: string;
  folderUrl?: string;
}

// Jalankan `fn` untuk tiap item dengan paling banyak `batas` yang berjalan bersamaan (hasil tetap urut).
// GAS punya batas eksekusi bersamaan untuk SELURUH pengguna, jadi jangan menembak semuanya sekaligus.
async function paralelTerbatas<T, R>(items: T[], batas: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const hasil: R[] = new Array(items.length);
  let berikut = 0;
  async function pekerja() {
    for (;;) {
      const i = berikut++;
      if (i >= items.length) return;
      hasil[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(batas, items.length) }, pekerja));
  return hasil;
}

const PARALEL_DRIVE = 4;
const MAKS_BERKAS_MASSAL = 12; // jumlah jenis berkas per penerima
const MAKS_DATA_MASSAL = 10; // per permintaan; klien memecah pilihan lebih besar (batas waktu klien 58 dtk)

async function bersihkanSatuLink(link: string): Promise<HasilDrive> {
  const l = link.trim();
  if (!l) return { status: "dilewati" };
  try {
    if (LINK_DRIVE.test(l)) {
      const h = await panggilGasAdmin("hapusBerkasDrive", { fileUrl: l });
      if (!h.sukses) return { status: "gagal", pesan: h.pesan };
      return { status: h.sudahTiada ? "sudahTiada" : "dipindah" };
    }
    const path = pathStorageDariUrl(l);
    if (path) {
      const h = await hapusObjekStorage(path);
      return h.sukses ? { status: "dipindah" } : { status: "gagal", pesan: h.pesan };
    }
    return { status: "dilewati", pesan: "Tautan bukan Drive/Storage; tidak ada berkas untuk dihapus." };
  } catch (e) {
    return { status: "gagal", pesan: pesanError(e) };
  }
}

// ---------------------------------------------------------------------------
// HAPUS BERKAS (satu atau banyak jenis berkas milik SATU penerima)
// Semua tautan dilepas dalam SATU transaksi; pemindahan ke Sampah Drive dilakukan paralel terbatas
// setelah commit, jadi hapus 12 berkas kira-kira secepat hapus 1-3 berkas.
// ---------------------------------------------------------------------------
export async function adminHapusBerkasMassal(
  token: string,
  id: number,
  tahun: number,
  daftar: Array<{ idx: number; link: string }>,
) {
  let sesi: DataSesi;
  try {
    sesi = await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  const idNum = parseId(id);
  const th = parseTahun(tahun);
  if (!idNum || !th) return { sukses: false, pesan: "Parameter tidak valid." };
  const tolakArsip = wajibTahunAktif(th);
  if (tolakArsip) return { sukses: false, pesan: tolakArsip };

  const diminta = new Map<number, string>();
  for (const x of Array.isArray(daftar) ? daftar : []) {
    const idx = Number(x && x.idx);
    if (!MAP_IDX_KE_KOLOM_BERKAS[idx]) return { sukses: false, pesan: "Jenis berkas tidak valid." };
    diminta.set(idx, str(x.link));
  }
  if (diminta.size === 0) return { sukses: false, pesan: "Tidak ada berkas yang dipilih." };
  if (diminta.size > MAKS_BERKAS_MASSAL) return { sukses: false, pesan: "Terlalu banyak berkas dalam satu permintaan." };

  try {
    // Nama kolom berasal dari MAP_IDX_KE_KOLOM_BERKAS (daftar tetap), aman disisipkan sebagai teks.
    const kolomDiminta = Array.from(diminta.keys()).map((i) => MAP_IDX_KE_KOLOM_BERKAS[i]);
    // deno-lint-ignore no-explicit-any
    const tx: any = await sql.begin(async (trx: any) => {
      const rows = await trx.unsafe(
        `select nama, ${kolomDiminta.join(", ")} from penerima where id = $1 and tahun = $2 for update`,
        [idNum, th],
      );
      if (rows.length === 0) return { ok: false, pesan: "Data tidak ditemukan (mungkin sudah dihapus)." };
      const r = rows[0];

      const hapus: Array<{ idx: number; kolom: string; label: string; link: string }> = [];
      const konflik: Array<{ idx: number; label: string }> = [];
      const sudahKosong: number[] = [];
      for (const [idx, diharapkan] of diminta) {
        const kolom = MAP_IDX_KE_KOLOM_BERKAS[idx];
        const sekarang = str(r[kolom]);
        if (!sekarang) sudahKosong.push(idx);
        else if (sekarang !== diharapkan) konflik.push({ idx, label: labelKolom(idx) });
        else hapus.push({ idx, kolom, label: labelKolom(idx), link: sekarang });
      }

      if (hapus.length > 0) {
        const setNull = hapus.map((h) => `${h.kolom} = null`).join(", ");
        await trx.unsafe(`update penerima set ${setNull}, diperbarui_at = now() where id = $1 and tahun = $2`, [idNum, th]);
        for (const h of hapus) {
          await trx`
            insert into riwayat_edit
              (waktu, editor_username, editor_role, penerima_id, tahun, nama_penerima, kolom_diubah, sebelum, sesudah)
            values (now(), ${sesi.username}, ${sesi.role}, ${idNum}, ${th}, ${str(r.nama)},
                    ${"Hapus berkas: " + h.label}, ${"[link lama]"}, ${"-"})
          `;
        }
      }
      return { ok: true, hapus, konflik, sudahKosong };
    });

    if (!tx.ok) return { sukses: false, pesan: tx.pesan };
    if (tx.hapus.length === 0) {
      return tx.konflik.length > 0
        ? { sukses: false, konflik: true, konflikBerkas: tx.konflik, pesan: "Berkas baru saja diganti/dihapus pengguna lain. Muat ulang data." }
        : { sukses: true, jumlahDihapus: 0, konflikBerkas: [], drive: [], pesan: "Berkas yang dipilih sudah kosong." };
    }

    // Setelah commit: pindahkan ke Sampah. Gagal di sini tidak membatalkan pelepasan tautan.
    // deno-lint-ignore no-explicit-any
    const drive = await paralelTerbatas(tx.hapus as any[], PARALEL_DRIVE, async (h) => ({
      idx: h.idx, label: h.label, ...(await bersihkanSatuLink(h.link)),
    }));
    const gagalDrive = drive.filter((d) => d.status === "gagal");
    let pesan = tx.hapus.length === 1 ? "Berkas berhasil dihapus." : `${tx.hapus.length} berkas berhasil dihapus.`;
    if (tx.konflik.length > 0) pesan += ` ${tx.konflik.length} berkas dilewati karena baru diubah pengguna lain.`;
    if (gagalDrive.length > 0) {
      pesan = `${tx.hapus.length} berkas dilepas dari data, tetapi ${gagalDrive.length} file di Google Drive belum berhasil dipindah ke Sampah ` +
        `(${gagalDrive.map((d) => d.label).join(", ")}). Buka Drive dan hapus manual bila perlu.`;
    }
    return {
      sukses: true,
      pesan,
      jumlahDihapus: tx.hapus.length,
      konflikBerkas: tx.konflik,
      drive,
      perluTindakLanjut: gagalDrive.length > 0,
    };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menghapus berkas: " + pesanError(e) };
  }
}

// ---------------------------------------------------------------------------
// HAPUS DATA PENERIMA (permanen; berkas Drive dipindah ke Sampah)
// Dipecah dua tahap agar bisa dipakai satu-satu maupun massal:
//   hapusDataDiDb()               -- transaksi database (cepat), mengembalikan info untuk pembersihan
//   bersihkanBerkasSetelahHapus() -- pemindahan ke Sampah Drive/Storage (lambat, bisa diparalelkan)
// ---------------------------------------------------------------------------
interface HasilDbHapus {
  sukses: boolean;
  pesan?: string;
  sudahTiada?: boolean;
  nama?: string;
  folder?: string;
  folderDipakaiLain?: boolean;
  links?: string[];
}

async function hapusDataDiDb(sesi: DataSesi, idNum: number, th: number, konfirmasiNik: string): Promise<HasilDbHapus> {
  // deno-lint-ignore no-explicit-any
  return await sql.begin(async (trx: any) => {
    const rows = await trx`select * from penerima where id = ${idNum} and tahun = ${th} for update`;
    if (rows.length === 0) {
      return { sukses: true, sudahTiada: true, pesan: "Data sudah tidak ada (kemungkinan sudah dihapus)." };
    }
    const r = rows[0];
    // Perlindungan salah-ID / salah-klik: NIK yang dikirim harus sama dengan NIK baris ini.
    if (str(konfirmasiNik) !== str(r.nik)) {
      return { sukses: false, nama: str(r.nama), pesan: "Konfirmasi NIK tidak cocok. Penghapusan dibatalkan." };
    }

    // data_detail punya FK ke penerima tanpa cascade -> hapus lebih dulu.
    await trx`delete from data_detail where tahun = ${th} and penerima_id = ${idNum}`;
    await trx`delete from penerima where id = ${idNum} and tahun = ${th}`;

    // Jejak minimal siapa menghapus apa (tanpa salinan isi data, sesuai keputusan "tanpa arsip").
    await trx`
      insert into riwayat_edit
        (waktu, editor_username, editor_role, penerima_id, tahun, nama_penerima, kolom_diubah, sebelum, sesudah)
      values (now(), ${sesi.username}, ${sesi.role}, ${idNum}, ${th}, ${str(r.nama)},
              ${"HAPUS DATA"}, ${str(r.layanan) + " / " + str(r.kecamatan)}, ${"-"})
    `;

    // Folder dipakai baris lain (tahun mana pun)? Dicek lewat trx SETELAH baris ini terhapus.
    const folder = str(r.id_folder_berkas);
    let folderDipakaiLain = false;
    if (folder) {
      const lain = await trx`select 1 from penerima where id_folder_berkas = ${folder} limit 1`;
      folderDipakaiLain = lain.length > 0;
    }
    const links: string[] = Object.values(MAP_IDX_KE_KOLOM_BERKAS).map((k) => str(r[k])).filter(Boolean);
    return { sukses: true, nama: str(r.nama), folder, folderDipakaiLain, links };
  });
}

async function bersihkanBerkasSetelahHapus(h: HasilDbHapus): Promise<HasilDrive> {
  try {
    if (h.folder && ID_FOLDER_DRIVE.test(h.folder)) {
      if (h.folderDipakaiLain) {
        return { status: "dilewati", pesan: "Folder Drive masih dipakai data lain sehingga tidak dihapus." };
      }
      const g = await panggilGasAdmin("hapusFolderDrive", { folderId: h.folder });
      return g.sukses
        ? { status: g.sudahTiada ? "sudahTiada" : "dipindah" }
        : { status: "gagal", pesan: g.pesan, folderUrl: "https://drive.google.com/drive/folders/" + h.folder };
    }
    // Tanpa ID folder Drive yang valid (baris legacy Storage / folder tak tercatat): hapus per tautan.
    const semua: HasilDrive[] = [];
    for (const l of h.links || []) semua.push(await bersihkanSatuLink(l));
    const gagal = semua.find((s) => s.status === "gagal");
    if (gagal) return { status: "gagal", pesan: gagal.pesan };
    return semua.some((s) => s.status === "dipindah") ? { status: "dipindah" } : { status: "dilewati" };
  } catch (e) {
    return { status: "gagal", pesan: pesanError(e) };
  }
}

function pesanHasilHapus(nama: string, drive: HasilDrive): string {
  return drive.status === "gagal"
    ? `Data "${nama}" berhasil dihapus, tetapi berkasnya di Google Drive belum berhasil dipindah ke Sampah: ${drive.pesan || ""}` +
      (drive.folderUrl ? ` Hapus manual di ${drive.folderUrl}` : "")
    : `Data "${nama}" berhasil dihapus.`;
}

export async function adminHapusData(token: string, id: number, tahun: number, konfirmasiNik: string) {
  let sesi: DataSesi;
  try {
    sesi = await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  const idNum = parseId(id);
  const th = parseTahun(tahun);
  if (!idNum || !th) return { sukses: false, pesan: "Parameter tidak valid." };
  const tolakArsip = wajibTahunAktif(th);
  if (tolakArsip) return { sukses: false, pesan: tolakArsip };

  try {
    const h = await hapusDataDiDb(sesi, idNum, th, konfirmasiNik);
    if (!h.sukses || h.sudahTiada) return h;
    const drive = await bersihkanBerkasSetelahHapus(h);
    return { sukses: true, pesan: pesanHasilHapus(h.nama || "", drive), drive, perluTindakLanjut: drive.status === "gagal" };
  } catch (e) {
    return { sukses: false, pesan: "Gagal menghapus data: " + pesanError(e) };
  }
}

// Hapus beberapa penerima sekaligus (maks MAKS_DATA_MASSAL per permintaan). Tiap baris punya transaksi
// sendiri, jadi kegagalan satu baris tidak membatalkan yang lain; hasil dilaporkan per baris.
export async function adminHapusDataMassal(
  token: string,
  tahun: number,
  daftar: Array<{ id: number; nik: string }>,
) {
  let sesi: DataSesi;
  try {
    sesi = await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: pesanError(e) };
  }

  const th = parseTahun(tahun);
  if (!th) return { sukses: false, pesan: "Parameter tidak valid." };
  const tolakArsip = wajibTahunAktif(th);
  if (tolakArsip) return { sukses: false, pesan: tolakArsip };

  const unik = new Map<number, string>();
  for (const x of Array.isArray(daftar) ? daftar : []) {
    const idNum = parseId(x && x.id);
    if (!idNum) return { sukses: false, pesan: "Parameter tidak valid." };
    unik.set(idNum, str(x.nik));
  }
  if (unik.size === 0) return { sukses: false, pesan: "Tidak ada data yang dipilih." };
  if (unik.size > MAKS_DATA_MASSAL) return { sukses: false, pesan: `Maksimal ${MAKS_DATA_MASSAL} data per permintaan.` };

  type Baris = {
    id: number;
    nama: string;
    status: "dihapus" | "sudahTiada" | "gagal";
    pesan?: string;
    drive?: HasilDrive;
    db?: HasilDbHapus;
  };
  const hasil: Baris[] = [];

  // Tahap 1: transaksi database, berurutan (pool koneksi cuma 1 dan tiap baris cepat).
  for (const [idNum, nik] of unik) {
    try {
      const h = await hapusDataDiDb(sesi, idNum, th, nik);
      if (!h.sukses) hasil.push({ id: idNum, nama: h.nama || "", status: "gagal", pesan: h.pesan });
      else if (h.sudahTiada) hasil.push({ id: idNum, nama: "", status: "sudahTiada", pesan: h.pesan });
      else hasil.push({ id: idNum, nama: h.nama || "", status: "dihapus", db: h });
    } catch (e) {
      hasil.push({ id: idNum, nama: "", status: "gagal", pesan: pesanError(e) });
    }
  }

  // Tahap 2: pembersihan Drive paralel terbatas (bagian yang lambat).
  const dihapus = hasil.filter((b) => b.status === "dihapus");
  await paralelTerbatas(dihapus, PARALEL_DRIVE, async (b) => {
    b.drive = await bersihkanBerkasSetelahHapus(b.db as HasilDbHapus);
    return null;
  });

  const jumlahDihapus = dihapus.length;
  const jumlahGagal = hasil.filter((b) => b.status === "gagal").length;
  const perluTindakLanjut = dihapus.filter((b) => b.drive && b.drive.status === "gagal").length;
  return {
    sukses: true,
    jumlahDihapus,
    jumlahGagal,
    perluTindakLanjut,
    hasil: hasil.map((b) => ({
      id: b.id,
      nama: b.nama,
      status: b.status,
      drive: b.drive,
      pesan: b.status === "dihapus" ? pesanHasilHapus(b.nama, b.drive as HasilDrive) : b.pesan,
    })),
    pesan: `${jumlahDihapus} data dihapus` + (jumlahGagal ? `, ${jumlahGagal} gagal` : "") +
      (perluTindakLanjut ? `, ${perluTindakLanjut} berkasnya perlu dibereskan manual di Drive` : "") + ".",
  };
}
