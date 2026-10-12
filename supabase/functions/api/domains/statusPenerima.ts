import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";
import { BULAN, buatPenyaringAkses } from "./retur.ts";
import { susunExcelBase64 } from "./returAdmin.ts";

// ---------------------------------------------------------------------------
// Modul Retur -- LAPORAN STATUS PENERIMA (pengganti "Usul Laporan Kematian & Tidak Aktif" di Retur lama)
// + AKTIVASI KEMBALI (baru, khusus Admin Utama).
//
// Satu-satunya sumber status penerima = data_detail.status / tgl_status (modul Pembayaran membaca
// `upper(status) like '%AKTIF%' and not like '%TIDAK%'`). Setiap laporan disimpan di
// status_penerima_laporan DAN mengubah data_detail dalam SATU transaksi; baris data_detail dikunci
// (for update) agar dua petugas tidak saling menimpa. Identitas penerima disalin ke tabel laporan
// (tanpa FK ke data_detail -- lihat catatan migrasi Retur).
// ---------------------------------------------------------------------------

const BATAS_DETAIL = 500;
const BATAS_NAMA = 100;
// Hanya tautan BERKAS Google Drive (yang dihasilkan unggahan GAS: file.getUrl()), bukan sembarang alamat.
const POLA_URL_DRIVE = /^https:\/\/drive\.google\.com\/(file\/d\/|open\?id=)[A-Za-z0-9_-]{10,200}([/?#][^\s]{0,200})?$/;

// Penanda status "aktif" yang sama dengan modul Pembayaran (hitungBarisAktif).
function statusAktif(status: unknown): boolean {
  const s = String(status ?? "").toUpperCase();
  return s.includes("AKTIF") && !s.includes("TIDAK");
}

function nikBersih(nik: unknown): string {
  return String(nik ?? "").replace(/[^0-9]/g, "");
}

function teksBersih(nilai: unknown, maks: number): string {
  return String(nilai ?? "").replace(/\s+/g, " ").trim().slice(0, maks);
}

// "yyyy-mm-dd" valid, tidak di masa depan (toleransi 1 hari untuk selisih zona waktu), tidak sebelum tahun 2000.
function tanggalValid(nilai: unknown): string | null {
  const s = String(nilai ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  if (d.getUTCFullYear() < 2000) return null;
  if (d.getTime() > Date.now() + 36 * 3600 * 1000) return null;
  return s;
}

function galat(e: unknown) {
  return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
}

/** Pilihan status untuk form: status khusus (Hasil Monev, dll.) hanya ditawarkan ke Admin Utama. */
export async function statusPilihan(token: string) {
  try {
    const sesi = await wajibSesi(token);
    const utama = (sesi.role || "").toString().trim().toUpperCase() === "UTAMA";
    const rows = await sql`select kode, khusus_utama from ref_status_laporan order by urutan`;
    return {
      sukses: true,
      statuses: rows
        .filter((r: Record<string, unknown>) => utama || !r.khusus_utama)
        .map((r: Record<string, unknown>) => ({ kode: r.kode, khususUtama: !!r.khusus_utama })),
    };
  } catch (e) {
    return galat(e);
  }
}

// Dua batch pembayaran BPJS TK terbaru (lintas tahun) -- sama dengan Retur lama yang memeriksa dua file bulanan terbaru.
async function cekPembayaranBpjs(nik: string): Promise<{ ditemukan: boolean; bulan: string | null; tahun: number | null }> {
  const batch = await sql`
    select id, tahun, bulan from pembayaran_batch
    where jenis = 'BPJS'
    order by tahun desc, array_position(${sql.array(BULAN as unknown as string[])}::text[], bulan::text) desc
    limit 2
  `;
  for (const b of batch) {
    const ada = await sql`select 1 from pembayaran_baris where batch_id = ${b.id} and nik = ${nik} limit 1`;
    if (ada.length > 0) return { ditemukan: true, bulan: String(b.bulan), tahun: Number(b.tahun) };
  }
  return { ditemukan: false, bulan: null, tahun: null };
}

/**
 * Cari penerima tahun aktif berdasarkan NIK untuk mengisi form otomatis. Hanya yang dalam hak akses pemanggil;
 * NIK di luar akses dijawab sama seperti "tidak ditemukan" (tidak membocorkan keberadaannya).
 */
export async function statusCariPenerima(token: string, nik: string) {
  try {
    const sesi = await wajibSesi(token);
    const n = nikBersih(nik);
    if (n.length !== 16) return { sukses: false, pesan: "NIK harus 16 digit angka." };
    const boleh = await buatPenyaringAkses(sesi);
    const rows = await sql`
      select id, nama, nik, layanan, kecamatan, kelurahan, tempat_tugas, status, tgl_status
      from data_detail where tahun = ${TAHUN_AKTIF} and nik = ${n} limit 1
    `;
    if (rows.length === 0 || !boleh(rows[0])) {
      return { sukses: true, ditemukan: false, pesan: "NIK tidak terdaftar sebagai penerima tahun " + TAHUN_AKTIF + " atau berada di luar akses Anda." };
    }
    const r = rows[0];
    const bpjs = await cekPembayaranBpjs(n);
    return {
      sukses: true,
      ditemukan: true,
      penerima: {
        nama: r.nama, nik: r.nik, layanan: r.layanan, kecamatan: r.kecamatan, kelurahan: r.kelurahan,
        tempatTugas: r.tempat_tugas, status: r.status, aktif: statusAktif(r.status), tglStatus: r.tgl_status,
      },
      bpjs,
    };
  } catch (e) {
    return galat(e);
  }
}

interface DataLaporan {
  nik?: string; status?: string; tanggal?: string; detail?: string;
  namaPelapor?: string; jabatan?: string; urlDokumen?: string;
}

/**
 * Simpan laporan meninggal / tidak aktif / dll. dan ubah status penerima. Satu transaksi; baris dikunci.
 */
export async function statusSimpanLaporan(token: string, d: DataLaporan) {
  try {
    const sesi = await wajibSesi(token);
    const utama = (sesi.role || "").toString().trim().toUpperCase() === "UTAMA";
    const data = d || {};

    const n = nikBersih(data.nik);
    if (n.length !== 16) return { sukses: false, pesan: "NIK harus 16 digit angka." };
    const status = teksBersih(data.status, 80).toUpperCase();
    if (!status) return { sukses: false, pesan: "Status laporan wajib dipilih." };
    const tanggal = tanggalValid(data.tanggal);
    if (!tanggal) return { sukses: false, pesan: "Tanggal tidak valid (tidak boleh di masa depan atau sebelum tahun 2000)." };
    const namaPelapor = teksBersih(data.namaPelapor, BATAS_NAMA).toUpperCase();
    const jabatan = teksBersih(data.jabatan, BATAS_NAMA).toUpperCase();
    if (namaPelapor.length < 2) return { sukses: false, pesan: "Nama pelapor wajib diisi." };
    if (jabatan.length < 2) return { sukses: false, pesan: "Jabatan pelapor wajib diisi." };
    const detail = teksBersih(data.detail, BATAS_DETAIL);
    const urlDokumen = String(data.urlDokumen ?? "").trim();
    if (!urlDokumen) return { sukses: false, pesan: "Dokumen pendukung (surat kematian/SK/dll.) wajib diunggah." };
    if (!POLA_URL_DRIVE.test(urlDokumen)) return { sukses: false, pesan: "Tautan dokumen tidak valid. Unggah ulang dokumennya." };

    const ref = await sql`select kode, khusus_utama from ref_status_laporan where kode = ${status}`;
    if (ref.length === 0) return { sukses: false, pesan: "Status laporan tidak dikenal." };
    if (ref[0].khusus_utama && !utama) return { sukses: false, pesan: "Status ini hanya dapat dipilih oleh Admin Utama." };

    const boleh = await buatPenyaringAkses(sesi);
    // deno-lint-ignore no-explicit-any
    let hasil: any = null;
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      const rows = await trx`
        select id, nama, nik, layanan, kecamatan, kelurahan, tempat_tugas, status
        from data_detail where tahun = ${TAHUN_AKTIF} and nik = ${n} for update
      `;
      if (rows.length === 0 || !boleh(rows[0])) {
        hasil = { sukses: false, pesan: "Penerima tidak ditemukan atau berada di luar hak akses Anda." };
        return;
      }
      const r = rows[0];
      if (String(r.status ?? "").trim().toUpperCase() === status) {
        hasil = { sukses: false, pesan: "Penerima ini sudah berstatus " + status + "." };
        return;
      }
      const lap = await trx`
        insert into status_penerima_laporan (tahun, data_detail_id, nik, nama, layanan, kecamatan, kelurahan, tempat_tugas,
          jenis, status_laporan, status_sebelum, tanggal, detail, url_dokumen, nama_pelapor, jabatan, dibuat_oleh_akun_id)
        values (${TAHUN_AKTIF}, ${r.id}, ${r.nik}, ${r.nama}, ${r.layanan}, ${r.kecamatan}, ${r.kelurahan}, ${r.tempat_tugas},
          'NONAKTIF', ${status}, ${r.status}, ${tanggal}::date, ${detail || null}, ${urlDokumen}, ${namaPelapor}, ${jabatan}, ${sesi.akunId})
        returning id
      `;
      // tgl_status = tanggal kejadian yang dilaporkan (sama dengan Retur lama), pukul 00.00 WIB.
      await trx`
        update data_detail set status = ${status},
          tgl_status = (${tanggal}::date)::timestamp at time zone 'Asia/Jakarta',
          diperbarui_at = now()
        where id = ${r.id} and tahun = ${TAHUN_AKTIF}
      `;
      hasil = { sukses: true, laporanId: Number(lap[0].id), statusSebelum: r.status, statusBaru: status, nama: r.nama, nik: r.nik };
    });
    return hasil;
  } catch (e) {
    return galat(e);
  }
}

interface DataAktivasi { nik?: string; alasan?: string; urlDokumen?: string }

/** Aktivasi kembali penerima yang berstatus tidak aktif. KHUSUS Admin Utama, alasan wajib. */
export async function statusAktivasiKembali(token: string, d: DataAktivasi) {
  try {
    const sesi = await wajibSesi(token);
    if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
      return { sukses: false, pesan: "Akses ditolak: aktivasi kembali hanya untuk Admin Utama." };
    }
    const data = d || {};
    const n = nikBersih(data.nik);
    if (n.length !== 16) return { sukses: false, pesan: "NIK harus 16 digit angka." };
    const alasan = teksBersih(data.alasan, BATAS_DETAIL);
    if (alasan.length < 10) return { sukses: false, pesan: "Alasan aktivasi kembali wajib diisi (minimal 10 karakter)." };
    const urlDokumen = String(data.urlDokumen ?? "").trim();
    if (urlDokumen && !POLA_URL_DRIVE.test(urlDokumen)) return { sukses: false, pesan: "Tautan dokumen tidak valid. Unggah ulang dokumennya." };

    // deno-lint-ignore no-explicit-any
    let hasil: any = null;
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      const rows = await trx`
        select id, nama, nik, layanan, kecamatan, kelurahan, tempat_tugas, status
        from data_detail where tahun = ${TAHUN_AKTIF} and nik = ${n} for update
      `;
      if (rows.length === 0) { hasil = { sukses: false, pesan: "NIK tidak terdaftar sebagai penerima tahun " + TAHUN_AKTIF + "." }; return; }
      const r = rows[0];
      if (statusAktif(r.status)) { hasil = { sukses: false, pesan: "Penerima ini sudah berstatus aktif." }; return; }
      const lap = await trx`
        insert into status_penerima_laporan (tahun, data_detail_id, nik, nama, layanan, kecamatan, kelurahan, tempat_tugas,
          jenis, status_laporan, status_sebelum, tanggal, detail, url_dokumen, nama_pelapor, jabatan, dibuat_oleh_akun_id)
        values (${TAHUN_AKTIF}, ${r.id}, ${r.nik}, ${r.nama}, ${r.layanan}, ${r.kecamatan}, ${r.kelurahan}, ${r.tempat_tugas},
          'AKTIVASI', 'AKTIF', ${r.status}, (now() at time zone 'Asia/Jakarta')::date, ${alasan}, ${urlDokumen || null},
          ${String(sesi.username || "").toUpperCase()}, 'ADMIN UTAMA', ${sesi.akunId})
        returning id
      `;
      await trx`
        update data_detail set status = 'AKTIF', tgl_status = now(), diperbarui_at = now()
        where id = ${r.id} and tahun = ${TAHUN_AKTIF}
      `;
      hasil = { sukses: true, laporanId: Number(lap[0].id), statusSebelum: r.status, statusBaru: "AKTIF", nama: r.nama, nik: r.nik };
    });
    return hasil;
  } catch (e) {
    return galat(e);
  }
}

const BATAS_REKAP = 2000; // baris yang ditampilkan
// Penyaringan hak akses dilakukan di kode SETELAH query (bukan di SQL); batas tarik dibuat besar agar baris milik pemanggil
// tidak tergeser keluar oleh baris pihak lain (bug yang sama pernah ditemukan di pencarian retur).
const BATAS_FETCH_REKAP = 20000;

// deno-lint-ignore no-explicit-any
async function ambilRekap(token: string, tahun: number | undefined, kata?: string): Promise<{ sesi: Awaited<ReturnType<typeof wajibSesi>>; rows: Record<string, any>[]; terpotong: boolean; tahun: number }> {
  const sesi = await wajibSesi(token);
  const t = Number(tahun) || TAHUN_AKTIF;
  if (!Number.isInteger(t) || t < 2000 || t > 2100) throw new Error("Tahun tidak valid.");
  const boleh = await buatPenyaringAkses(sesi);
  const q = String(kata ?? "").trim();
  const pola = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = await sql`
    select l.*, a.username as akun_username
    from status_penerima_laporan l left join akun a on a.id = l.dibuat_oleh_akun_id
    where l.tahun = ${t}
      ${q.length >= 3 ? sql`and (l.nik = ${q} or l.nama ilike ${pola})` : sql``}
    order by l.dibuat_at desc, l.id desc
    limit ${BATAS_FETCH_REKAP}
  `;
  const diizinkan = rows.filter((r: Record<string, unknown>) => boleh(r));
  return { sesi, rows: diizinkan.slice(0, BATAS_REKAP), terpotong: diizinkan.length > BATAS_REKAP, tahun: t };
}

/** Rekap laporan status penerima (menu "Data Tidak Aktif / Meninggal Dunia"), disaring hak akses. */
export async function statusRekap(token: string, tahun?: number, kata?: string) {
  try {
    const { rows, terpotong, tahun: t } = await ambilRekap(token, tahun, kata);
    return {
      sukses: true, tahun: t, terpotong,
      rows: rows.map((r) => ({
        id: Number(r.id), nama: r.nama, nik: r.nik, layanan: r.layanan, kecamatan: r.kecamatan, kelurahan: r.kelurahan,
        jenis: r.jenis, status: r.status_laporan, statusSebelum: r.status_sebelum,
        tanggal: r.tanggal ? new Date(r.tanggal).toISOString().slice(0, 10) : "",
        detail: r.detail ?? "", urlDokumen: r.url_dokumen ?? "", pelapor: r.nama_pelapor ?? "", jabatan: r.jabatan ?? "",
        dicatatAt: r.dibuat_at, petugas: r.akun_username ?? "",
      })),
    };
  } catch (e) {
    return galat(e);
  }
}

/** Rekap sebagai Excel (kolom mengikuti sheet "Data Laporan Kematian" lama + jenis dan status sebelumnya). */
export async function statusUnduhExcelRekap(token: string, tahun?: number) {
  try {
    const { rows, tahun: t } = await ambilRekap(token, tahun);
    if (rows.length === 0) return { sukses: false, pesan: "Belum ada laporan status penerima pada akses Anda." };
    const header = ["NO", "TANGGAL", "NAMA", "NIK", "LAYANAN", "KECAMATAN", "KELURAHAN", "JENIS", "STATUS", "STATUS SEBELUMNYA", "KETERANGAN", "PELAPOR", "JABATAN", "DOKUMEN"];
    const baris = rows.map((r, i) => [
      i + 1, r.tanggal ? new Date(r.tanggal).toISOString().slice(0, 10) : "", r.nama, r.nik, r.layanan, r.kecamatan, r.kelurahan,
      r.jenis === "AKTIVASI" ? "AKTIVASI KEMBALI" : "NONAKTIF", r.status_laporan, r.status_sebelum ?? "", r.detail ?? "",
      r.nama_pelapor ?? "", r.jabatan ?? "", r.url_dokumen ?? "",
    ]);
    const base64 = await susunExcelBase64("DATA TIDAK AKTIF", header, baris,
      [6, 12, 30, 20, 26, 20, 22, 18, 24, 22, 40, 24, 22, 40], "FF7F7F7F", [4]);
    return { sukses: true, base64, namaFile: `Data Tidak Aktif dan Meninggal Dunia ${t}.xlsx` };
  } catch (e) {
    return galat(e);
  }
}
