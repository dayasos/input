import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";

// ---------------------------------------------------------------------------
// Halaman "Tools" (khusus role UTAMA) — pengganti alur manual "Kode.gs Data Bayar"
// (Google Sheets: sheet per layanan + REKAP + mirroring ke Drive). Port LOGIKA KALKULASI
// 1:1 dari kode itu (formula kompensasi, potongan JKM/JKK, mapping layanan) — TIDAK ada
// nilai yang diubah. Bedanya cuma sumber data (data_detail Postgres, bukan sheet "DATA
// DETAIL") dan hasilnya disimpan sebagai SNAPSHOT BEKU (pembayaran_batch/pembayaran_baris),
// bukan ditulis ulang ke sheet fisik tiap kali — lihat catatan desain di migration
// 20260915130000_pembayaran.sql.
// ---------------------------------------------------------------------------

const BULAN_VALID = [
  "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
  "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
];

const JENIS_VALID = ["DJPM", "BPJS"];

// Sama persis `map` di distribusiDataLayanan() Kode.gs -- kalau layanan tidak ada di daftar
// ini, kodenya dipakai apa adanya (fallback `|| layanan`), sama seperti aslinya.
const MAP_LAYANAN_KODE: Record<string, string> = {
  "BILAL JENAZAH": "BILAL",
  "GURU MAGHRIB MENGAJI": "GMM",
  "PENGGALI KUBUR": "P. KUBUR",
  "IMAM MASJID": "IMAM",
  "KHATIB JUMAT": "KHATIB",
  "NAZIR MASJID": "N. MASJID",
  "NAZIR MUSHOLLA": "N. MUSHOLLA",
  "GURU SEKOLAH MINGGU": "GSM",
  "GURU SEKOLAH BUDDHA": "GSB",
  "GURU SEKOLAH HINDU": "GSH",
  "PENATUA GEREJA": "PENATUA",
  "PENGURUS GEREJA": "P. GEREJA",
  "PENGURUS VIHARA/KLENTENG/KUIL": "P. KUIL",
  "PETUGAS GEREJA KATOLIK": "PGK",
  "USTADZ": "USTADZ",
  "USTADZAH": "USTADZAH",
};

interface BarisHitung {
  dataDetailId: number;
  tahun: number;
  nama: string;
  nik: string;
  layanan: string;
  layananKode: string;
  nomorRekening: string;
  kecamatan: string;
  kelurahan: string;
  umur: number;
  jumlahKotor: number;
  jkm: number;
  jkk: number;
  jumlahPotongan: number;
  jumlahDiterima: number;
}

// Port 1:1 formula kompensasi & potongan JKM/JKK dari distribusiDataLayanan() Kode.gs.
function hitungKompensasi(layananUpper: string, umur: number): { kotor: number; jkm: number; jkk: number; diterima: number } {
  let kotor: number;
  if (layananUpper === "BILAL JENAZAH") kotor = umur < 65 ? 416800 : 400000;
  else if (layananUpper === "GURU MAGHRIB MENGAJI") kotor = umur < 65 ? 616800 : 600000;
  else if (layananUpper === "PENGGALI KUBUR") kotor = umur < 65 ? 366800 : 350000;
  else kotor = umur < 65 ? 316800 : 300000;

  const jkm = umur < 65 ? 10000 : 0;
  const jkk = umur < 65 ? 6800 : 0;
  return { kotor, jkm, jkk, diterima: kotor - (jkm + jkk) };
}

async function wajibUtama(token: string) {
  const sesi = await wajibSesi(token);
  if (sesi.role !== "UTAMA") {
    throw new Error("Akses ditolak: halaman Tools Pembayaran hanya untuk Admin Utama.");
  }
  return sesi;
}

// Ambil baris data_detail berstatus AKTIF (fuzzy match -- persis logika filterDataKeMaster()
// Kode.gs: status mengandung "AKTIF" DAN tidak mengandung "TIDAK", supaya status apa pun yang
// ditulis nanti oleh Aplikasi Retur tetap tersaring benar tanpa perlu exact match), hitung
// kompensasinya. `jenis === 'BPJS'` mempersempit ke usia < 65 saja (sama seperti dataBPJS di
// Kode.gs -- JKM/JKK cuma berlaku utk usia itu, itulah alasan laporan BPJS TK cuma memuat
// mereka).
async function hitungBarisAktif(tahun: number, jenis: string): Promise<BarisHitung[]> {
  const rows = await sql`
    select id, nama, nik, layanan, nomor_rekening, kecamatan, kelurahan, umur
    from data_detail
    where tahun = ${tahun}
      and upper(status) like '%AKTIF%'
      and upper(status) not like '%TIDAK%'
  `;

  const hasil: BarisHitung[] = [];
  for (const r of rows) {
    const umur = Number(r.umur);
    if (!Number.isFinite(umur) || umur <= 0) continue; // sama seperti validasi usia di Kode.gs (baris dilewati)
    if (jenis === "BPJS" && umur >= 65) continue;

    const layananUpper = (r.layanan || "").toString().trim().toUpperCase();
    const layananKode = MAP_LAYANAN_KODE[layananUpper] || r.layanan;
    const k = hitungKompensasi(layananUpper, umur);

    hasil.push({
      dataDetailId: r.id,
      tahun,
      nama: r.nama,
      nik: (r.nik || "").toString().replace(/^'+/, "").trim(),
      layanan: r.layanan,
      layananKode,
      nomorRekening: (r.nomor_rekening || "").toString().replace(/^'+/, "").trim(),
      kecamatan: r.kecamatan,
      kelurahan: r.kelurahan,
      umur,
      jumlahKotor: k.kotor,
      jkm: k.jkm,
      jkk: k.jkk,
      jumlahPotongan: k.jkm + k.jkk,
      jumlahDiterima: k.diterima,
    });
  }
  return hasil;
}

function bangunRekap(baris: BarisHitung[]) {
  const rekap: Record<string, { layananKode: string; total: number; bwh65: number; ats65: number; uang: number }> = {};
  for (const b of baris) {
    if (!rekap[b.layananKode]) rekap[b.layananKode] = { layananKode: b.layananKode, total: 0, bwh65: 0, ats65: 0, uang: 0 };
    rekap[b.layananKode].total++;
    if (b.umur < 65) rekap[b.layananKode].bwh65++; else rekap[b.layananKode].ats65++;
    rekap[b.layananKode].uang += b.jumlahDiterima;
  }
  return Object.values(rekap);
}

// Buat (atau timpa, kalau kombinasi tahun+bulan+jenis yang sama sudah ada -- "Buat Ulang")
// snapshot beku dari data_detail SAAT INI. Satu transaksi: header batch di-upsert, baris lama
// (kalau ada) dihapus lalu diganti baris baru -- supaya tidak pernah ada baris "nyangkut" dari
// snapshot sebelumnya kalau jumlah barisnya berbeda dari sebelumnya.
export async function buatBatchPembayaran(token: string, bulan: string, jenis: string) {
  let sesi;
  try {
    sesi = await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const bulanUpper = (bulan || "").toString().trim().toUpperCase();
  const jenisUpper = (jenis || "").toString().trim().toUpperCase();
  if (BULAN_VALID.indexOf(bulanUpper) === -1) {
    return { sukses: false, pesan: "Bulan tidak valid." };
  }
  if (JENIS_VALID.indexOf(jenisUpper) === -1) {
    return { sukses: false, pesan: "Jenis pembayaran tidak valid (harus DJPM atau BPJS)." };
  }

  try {
    const baris = await hitungBarisAktif(TAHUN_AKTIF, jenisUpper);

    if (baris.length === 0) {
      return { sukses: false, pesan: "Tidak ada data berstatus AKTIF untuk diproses." };
    }

    let batchId = 0;
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      const hasil = await trx`
        insert into pembayaran_batch (tahun, bulan, jenis, dibuat_oleh_akun_id)
        values (${TAHUN_AKTIF}, ${bulanUpper}, ${jenisUpper}, ${sesi.akunId})
        on conflict (tahun, bulan, jenis) do update set
          diperbarui_at = now(),
          dibuat_oleh_akun_id = excluded.dibuat_oleh_akun_id
        returning id
      `;
      batchId = hasil[0].id;

      await trx`delete from pembayaran_baris where batch_id = ${batchId}`;

      for (const b of baris) {
        await trx`
          insert into pembayaran_baris (
            batch_id, tahun, data_detail_id, nama, nik, layanan, layanan_kode,
            nomor_rekening, kecamatan, kelurahan, umur,
            jumlah_kotor, jkm, jkk, jumlah_potongan, jumlah_diterima
          ) values (
            ${batchId}, ${b.tahun}, ${b.dataDetailId}, ${b.nama}, ${b.nik}, ${b.layanan}, ${b.layananKode},
            ${b.nomorRekening}, ${b.kecamatan}, ${b.kelurahan}, ${b.umur},
            ${b.jumlahKotor}, ${b.jkm}, ${b.jkk}, ${b.jumlahPotongan}, ${b.jumlahDiterima}
          )
          on conflict (batch_id, nik) do nothing
        `;
      }
    });

    return { sukses: true, batchId, jumlahBaris: baris.length, rekap: bangunRekap(baris) };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Daftar batch yang sudah pernah dibuat, untuk halaman review (poin 1 di rencana Tools).
export async function ambilDaftarBatchPembayaran(token: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const rows = await sql`
      select
        b.id, b.tahun, b.bulan, b.jenis, b.dibuat_at, b.diperbarui_at,
        count(r.id)::int as jumlah_baris,
        coalesce(sum(r.jumlah_diterima), 0)::bigint as total_nominal
      from pembayaran_batch b
      left join pembayaran_baris r on r.batch_id = b.id
      where b.tahun = ${TAHUN_AKTIF}
      group by b.id
    `;

    const daftar = rows.map((r) => ({
      id: r.id,
      tahun: r.tahun,
      bulan: r.bulan,
      jenis: r.jenis,
      dibuatAt: r.dibuat_at,
      diperbaruiAt: r.diperbarui_at,
      jumlahBaris: r.jumlah_baris,
      totalNominal: Number(r.total_nominal),
    }));

    // Urutkan Jan->Des lalu DJPM/BPJS -- diurut di JS (bukan SQL) supaya tidak perlu CASE WHEN
    // 12 baris hanya untuk urutan bulan.
    daftar.sort((a, b) => {
      const urutBulan = BULAN_VALID.indexOf(a.bulan) - BULAN_VALID.indexOf(b.bulan);
      if (urutBulan !== 0) return urutBulan;
      return a.jenis.localeCompare(b.jenis);
    });

    return { sukses: true, daftar };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Detail satu batch (header + seluruh baris) -- dipakai preview di layar sebelum/tanpa download.
export async function ambilDetailBatchPembayaran(token: string, batchId: number) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const batchRows = await sql`
      select id, tahun, bulan, jenis, dibuat_at, diperbarui_at
      from pembayaran_batch
      where id = ${batchId} and tahun = ${TAHUN_AKTIF}
      limit 1
    `;
    if (batchRows.length === 0) {
      return { sukses: false, pesan: "Batch pembayaran tidak ditemukan." };
    }
    const batch = batchRows[0];

    const baris = await sql`
      select nama, nik, layanan, layanan_kode, nomor_rekening, kecamatan, kelurahan, umur,
             jumlah_kotor, jkm, jkk, jumlah_potongan, jumlah_diterima
      from pembayaran_baris
      where batch_id = ${batchId}
      order by layanan_kode, nama
    `;

    const rekap: Record<string, { layananKode: string; total: number; bwh65: number; ats65: number; uang: number }> = {};
    for (const b of baris) {
      const kode = b.layanan_kode;
      if (!rekap[kode]) rekap[kode] = { layananKode: kode, total: 0, bwh65: 0, ats65: 0, uang: 0 };
      rekap[kode].total++;
      if (b.umur < 65) rekap[kode].bwh65++; else rekap[kode].ats65++;
      rekap[kode].uang += b.jumlah_diterima;
    }

    return {
      sukses: true,
      batch: {
        id: batch.id, tahun: batch.tahun, bulan: batch.bulan, jenis: batch.jenis,
        dibuatAt: batch.dibuat_at, diperbaruiAt: batch.diperbarui_at,
      },
      rekap: Object.values(rekap),
      baris: baris.map((b) => ({
        nama: b.nama, nik: b.nik, layanan: b.layanan, layananKode: b.layanan_kode,
        nomorRekening: b.nomor_rekening, kecamatan: b.kecamatan, kelurahan: b.kelurahan, umur: b.umur,
        jumlahKotor: b.jumlah_kotor, jkm: b.jkm, jkk: b.jkk,
        jumlahPotongan: b.jumlah_potongan, jumlahDiterima: b.jumlah_diterima,
      })),
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Blok tanda tangan 3 pejabat (kolom A/D/H, meniru posisi persis `ttd(...)` di
// distribusiDataLayanan() Kode.gs) -- dipakai di TIAP SHEET LAYANAN (jenis DJPM saja; BPJS TK
// tidak punya blok TTD di kode asli). Diverifikasi byte-per-byte terhadap contoh dokumen resmi
// 2026 (baris 2673-2686 sheet "BILAL") -- termasuk 4 baris kosong (BUKAN 5) antara baris
// "DINAS SOSIAL KOTA MEDAN" dan baris nama pejabat, yang sempat salah 1 baris lebih banyak
// sebelum verifikasi ini.
function bangunBlokTtd(
  teksTtd: string,
  tahun: number,
  pejabat: Record<string, { nama: string; jabatan: string; nip: string }>,
): unknown[][] {
  const kepala = pejabat["KEPALA_DINAS"] || { nama: "", jabatan: "", nip: "" };
  const pptk = pejabat["PPTK"] || { nama: "", jabatan: "", nip: "" };
  const bendahara = pejabat["BENDAHARA"] || { nama: "", jabatan: "", nip: "" };
  return [
    ["Setuju Dibayar", "", "", "", "", "", "", teksTtd],
    [],
    ["KEPALA DINAS SOSIAL KOTA MEDAN", "", "", "PEJABAT PELAKSANA TEKNIS KEGIATAN", "", "", "", "YANG MEMBAYARKAN"],
    ["SELAKU PENGGUNA ANGGARAN", "", "", "TAHUN ANGGARAN " + tahun, "", "", "", "BENDAHARA PENGELUARAN"],
    ["", "", "", "", "", "", "", "DINAS SOSIAL KOTA MEDAN"],
    [], [], [], [],
    [kepala.nama, "", "", pptk.nama, "", "", "", bendahara.nama],
    [kepala.jabatan, "", "", pptk.jabatan, "", "", "", bendahara.jabatan],
    [kepala.nip, "", "", pptk.nip, "", "", "", bendahara.nip],
  ];
}

// Blok tanda tangan REKAP -- BEDA dari bangunBlokTtd() di atas: REKAP HANYA ditandatangani PPTK
// sendiri (bukan 3 pejabat), semuanya di kolom H saja, TANPA baris "Setuju Dibayar". Ditemukan
// lewat verifikasi langsung ke contoh dokumen resmi (baris 22-32 sheet "REKAP") -- kalau dugaan
// awal (3 pejabat sama seperti sheet layanan) tidak diverifikasi ulang, dokumennya akan salah.
function bangunBlokTtdRekap(
  teksTtd: string,
  tahun: number,
  pptk: { nama: string; jabatan: string; nip: string },
): unknown[][] {
  return [
    ["", "", "", "", "", "", "", teksTtd],
    [],
    ["", "", "", "", "", "", "", "PEJABAT PELAKSANA TEKNIS KEGIATAN"],
    ["", "", "", "", "", "", "", "TAHUN ANGGARAN " + tahun],
    [], [], [],
    ["", "", "", "", "", "", "", pptk.nama],
    ["", "", "", "", "", "", "", pptk.jabatan],
    ["", "", "", "", "", "", "", pptk.nip],
  ];
}

// Urutan TETAP 16 layanan di sheet REKAP -- BUKAN alfabetis (ditemukan lewat perbandingan
// langsung dengan contoh dokumen resmi: urutannya PENATUA sebelum P. KUBUR/P. GEREJA/P. KUIL,
// yang tidak alfabetis). Sama persis urutan baris 5-20 REKAP di kode Kode.gs asli
// (mappingRekap: BILAL=5 ... USTADZAH=20).
const URUTAN_LAYANAN_REKAP = [
  "BILAL", "GMM", "GSB", "GSH", "GSM", "IMAM", "KHATIB", "N. MASJID", "N. MUSHOLLA",
  "PENATUA", "P. KUBUR", "P. GEREJA", "P. KUIL", "PGK", "USTADZ", "USTADZAH",
];

// Nama layanan LENGKAP per kode -- REKAP menampilkan nama lengkap (mis. "BILAL JENAZAH"), bukan
// kode singkat, di kolom LAYANAN. Kebalikan dari MAP_LAYANAN_KODE.
const NAMA_LAYANAN_DARI_KODE: Record<string, string> = Object.fromEntries(
  Object.entries(MAP_LAYANAN_KODE).map(([namaLengkap, kode]) => [kode, namaLengkap]),
);

function formatTanggalSkIndo(tanggal: string | Date | null | undefined): string {
  if (!tanggal) return "(BELUM DITETAPKAN)";
  const d = tanggal instanceof Date ? tanggal : new Date(tanggal);
  if (isNaN(d.getTime())) return "(BELUM DITETAPKAN)";
  const bulanIndo = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI",
    "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];
  return `${d.getUTCDate()} ${bulanIndo[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---- Helper styling (dipakai bersama oleh sheet REKAP, per-layanan, dan BPJS TK) -- migrasi
// dari `xlsx` (SheetJS Community Edition, TIDAK menyimpan info gaya sel saat menulis .xlsx) ke
// `exceljs` (mendukung penuh bold/border/fill/format angka), 2026-09-15. Diuji lokal dulu
// sebelum dipakai di sini: buat file -> tulis -> baca ulang -> pastikan gaya & nilainya benar
// tersimpan (bukan cuma "tidak error saat generate"). ----
const HURUF_KOLOM = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const WARNA_HEADER = "FFDDE6F0"; // biru muda lembut, dipakai konsisten di semua sheet
const BORDER_TIPIS = { style: "thin" as const };
const BORDER_SEL_PENUH = { top: BORDER_TIPIS, left: BORDER_TIPIS, bottom: BORDER_TIPIS, right: BORDER_TIPIS };

// deno-lint-ignore no-explicit-any
function terapkanGayaJudul(ws: any, jumlahKolom: number) {
  const rentang = `A1:${HURUF_KOLOM[jumlahKolom - 1]}1`;
  ws.mergeCells(rentang);
  const sel = ws.getCell("A1");
  sel.font = { bold: true, size: 12 };
  sel.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

// deno-lint-ignore no-explicit-any
function terapkanGayaHeaderKolom(ws: any, baris: number, jumlahKolom: number) {
  for (let kolom = 1; kolom <= jumlahKolom; kolom++) {
    const sel = ws.getCell(baris, kolom);
    sel.font = { bold: true };
    sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA_HEADER } };
    sel.border = BORDER_SEL_PENUH;
    sel.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

// deno-lint-ignore no-explicit-any
function terapkanBorderData(ws: any, barisAwal: number, barisAkhir: number, jumlahKolom: number) {
  for (let baris = barisAwal; baris <= barisAkhir; baris++) {
    for (let kolom = 1; kolom <= jumlahKolom; kolom++) {
      ws.getCell(baris, kolom).border = BORDER_SEL_PENUH;
    }
  }
}

// deno-lint-ignore no-explicit-any
function terapkanGayaBarisTotal(ws: any, baris: number, jumlahKolom: number) {
  for (let kolom = 1; kolom <= jumlahKolom; kolom++) {
    const sel = ws.getCell(baris, kolom);
    sel.font = { bold: true };
    sel.border = { top: { style: "medium" }, left: BORDER_TIPIS, bottom: BORDER_TIPIS, right: BORDER_TIPIS };
  }
}

// deno-lint-ignore no-explicit-any
function terapkanFormatUang(ws: any, barisAwal: number, barisAkhir: number, kolomList: number[]) {
  for (let baris = barisAwal; baris <= barisAkhir; baris++) {
    for (const kolom of kolomList) {
      ws.getCell(baris, kolom).numFmt = "#,##0";
    }
  }
}

// Generate .xlsx dari batch yang SUDAH TERSIMPAN (bukan hitung ulang dari data_detail) -- baca
// snapshot beku di pembayaran_baris, persis prinsip "dokumen yang sudah dibuat tidak berubah".
// Kontrak respons sama seperti eksporDataKeSpreadsheet(): { sukses, base64, namaFile }.
export async function unduhExcelBatch(token: string, batchId: number) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const batchRows = await sql`
      select id, tahun, bulan, jenis from pembayaran_batch
      where id = ${batchId} and tahun = ${TAHUN_AKTIF}
      limit 1
    `;
    if (batchRows.length === 0) {
      return { sukses: false, pesan: "Batch pembayaran tidak ditemukan." };
    }
    const batch = batchRows[0];

    const baris = await sql`
      select nama, nik, layanan, layanan_kode, nomor_rekening, kecamatan, kelurahan, umur,
             jumlah_kotor, jkm, jkk, jumlah_potongan, jumlah_diterima
      from pembayaran_baris
      where batch_id = ${batchId}
      order by layanan_kode, umur
    `;
    if (baris.length === 0) {
      return { sukses: false, pesan: "Batch ini belum punya data baris (kosong)." };
    }

    // deno-lint-ignore no-explicit-any
    const ExcelJSMod: any = await import("npm:exceljs@4.4.0");
    // Di Deno, import("npm:exceljs") TIDAK selalu meng-ekspos `Workbook` langsung di namespace
    // (beda dari Node `require()`) -- CJS export exceljs sebenarnya ada di properti `.default`
    // kalau Deno tidak berhasil mendeteksi named export secara statis. Diverifikasi lewat
    // pengujian nyata ke Edge Function (bukan tebakan): tanpa fallback ini muncul error
    // "ExcelJS.Workbook is not a constructor".
    const ExcelJS: any = ExcelJSMod.Workbook ? ExcelJSMod : (ExcelJSMod.default ?? ExcelJSMod);
    const wb = new ExcelJS.Workbook();

    const teksHeader = `BULAN : ${batch.bulan} ${batch.tahun}`;
    const teksTtd = `Medan, ${batch.bulan} ${batch.tahun}`;

    if (batch.jenis === "BPJS") {
      // Satu sheet saja, TANPA blok TTD -- persis updateBPJS_Lokal() di Kode.gs.
      const JUMLAH_KOLOM_BPJS = 7;
      const aoa: unknown[][] = [
        [teksHeader],
        [],
        ["NO", "NAMA", "NIK", "LAYANAN", "KECAMATAN", "KELURAHAN", "USIA"],
        ...baris.map((b, i) => [i + 1, b.nama, b.nik, b.layanan, b.kecamatan, b.kelurahan, b.umur]),
      ];
      const barisHeaderBpjs = 3;
      const ws = wb.addWorksheet("BPJS TK");
      ws.addRows(aoa);
      ws.columns = [{ width: 5 }, { width: 28 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 8 }];
      terapkanGayaHeaderKolom(ws, barisHeaderBpjs, JUMLAH_KOLOM_BPJS);
      terapkanBorderData(ws, barisHeaderBpjs + 1, aoa.length, JUMLAH_KOLOM_BPJS);
      ws.views = [{ state: "frozen", ySplit: barisHeaderBpjs }];
    } else {
      // Jenis DJPM: 1 sheet REKAP + 1 sheet per layanan yang ada datanya -- persis
      // isiRekapOtomatis() + distribusiDataLayanan() di Kode.gs, DIVERIFIKASI baris-per-baris
      // terhadap contoh dokumen resmi 2026 (bukan cuma tebakan dari kode lama).
      const pejabatRows = await sql`select peran, nama, jabatan, nip from pejabat_ttd`;
      const pejabat: Record<string, { nama: string; jabatan: string; nip: string }> = {};
      for (const p of pejabatRows) pejabat[p.peran] = { nama: p.nama, jabatan: p.jabatan, nip: p.nip };
      const pptk = pejabat["PPTK"] || { nama: "", jabatan: "", nip: "" };

      const skRows = await sql`select layanan_kode, jumlah_sk from sk_layanan`;
      const skMap: Record<string, number | null> = {};
      for (const s of skRows) skMap[s.layanan_kode] = s.jumlah_sk;

      const refRows = await sql`select nomor_sk, tanggal_sk from referensi_sk_walikota where id = 1`;
      const nomorSk = refRows[0]?.nomor_sk || null;
      const tanggalSk = refRows[0]?.tanggal_sk || null;
      const baraSkWalikota = `BERDASARKAN SK WALI KOTA MEDAN NOMOR : ${nomorSk || "(BELUM DITETAPKAN)"} TGL ${formatTanggalSkIndo(tanggalSk)}`;

      const grup: Record<string, typeof baris> = {};
      for (const b of baris) {
        if (!grup[b.layanan_kode]) grup[b.layanan_kode] = [];
        grup[b.layanan_kode].push(b);
      }

      // ---- Sheet REKAP -- SEMUA 16 layanan tetap muncul (bahkan yang 0 baris bulan ini),
      // urutan TETAP (bukan alfabetis), kolom SK dari sk_layanan (bukan dihitung ulang). ----
      const JUMLAH_KOLOM_REKAP = 9;
      const rekapAoaAwal: unknown[][] = [
        [`REKAP PEMBAYARAN PENERIMA DANA JASA PELAYANAN KEPADA WARGA PELAYAN MASYARAKAT KOTA MEDAN TAHUN ANGGARAN ${batch.tahun}`],
        [],
        [teksHeader],
        ["NO", "LAYANAN", "SK", "JLH DATA BAYAR", "< 65", ">= 65",
          "DIBAYARKAN KEPADA WARGA PELAYAN MASYARAKAT", "TOTAL DIBAYARKAN", "KETERANGAN"],
      ];
      const barisHeaderRekap = rekapAoaAwal.length; // baris 4
      const barisDataAwalRekap = barisHeaderRekap + 1; // baris 5
      const rekapAoa: unknown[][] = [...rekapAoaAwal];
      let totSk = 0, totBayar = 0, totBwh = 0, totAts = 0, totUang = 0;
      URUTAN_LAYANAN_REKAP.forEach((kode, idx) => {
        const rows = grup[kode] || [];
        const bwh65 = rows.filter((r) => r.umur < 65).length;
        const ats65 = rows.length - bwh65;
        const uang = rows.reduce((s, r) => s + r.jumlah_diterima, 0);
        const sk = skMap[kode] ?? null;
        rekapAoa.push([
          idx + 1, NAMA_LAYANAN_DARI_KODE[kode] || kode, sk === null ? "-" : sk,
          rows.length, bwh65, ats65, uang, uang, "",
        ]);
        totSk += sk ?? 0; totBayar += rows.length; totBwh += bwh65; totAts += ats65; totUang += uang;
      });
      const barisDataAkhirRekap = barisDataAwalRekap + URUTAN_LAYANAN_REKAP.length - 1;
      const barisJumlahRekap = barisDataAkhirRekap + 1;
      rekapAoa.push(["", "JUMLAH", totSk, totBayar, totBwh, totAts, totUang, totUang, ""]);
      rekapAoa.push([]);
      rekapAoa.push(...bangunBlokTtdRekap(teksTtd, batch.tahun, pptk));
      const wsRekap = wb.addWorksheet("REKAP");
      wsRekap.addRows(rekapAoa);
      wsRekap.columns = [{ width: 5 }, { width: 30 }, { width: 10 }, { width: 14 }, { width: 8 }, { width: 8 }, { width: 18 }, { width: 16 }, { width: 20 }];
      terapkanGayaJudul(wsRekap, JUMLAH_KOLOM_REKAP);
      terapkanGayaHeaderKolom(wsRekap, barisHeaderRekap, JUMLAH_KOLOM_REKAP);
      terapkanBorderData(wsRekap, barisDataAwalRekap, barisJumlahRekap, JUMLAH_KOLOM_REKAP);
      terapkanGayaBarisTotal(wsRekap, barisJumlahRekap, JUMLAH_KOLOM_REKAP);
      terapkanFormatUang(wsRekap, barisDataAwalRekap, barisJumlahRekap, [7, 8]);
      wsRekap.views = [{ state: "frozen", ySplit: barisHeaderRekap }];

      // ---- Sheet per layanan -- HANYA layanan yang ada datanya bulan ini, urutan TETAP ----
      const JUMLAH_KOLOM_LAYANAN = 10;
      const headerLayanan = ["NO", "NAMA", "NIK", "LAYANAN", "NO REK BANK SUMUT", "JLH KOTOR", "JKM", "JKK", "JLH JKK + JKM", "JUMLAH DITERIMA"];
      const judulSheetLayanan = `DAFTAR PEMBAYARAN DANA JASA PELAYANAN KEPADA WARGA PELAYAN MASYARAKAT KOTA MEDAN TAHUN ${batch.tahun}`;
      for (const kode of URUTAN_LAYANAN_REKAP) {
        const rows = grup[kode];
        if (!rows || rows.length === 0) continue;

        const dataRows = rows.map((b, i) => [
          i + 1, b.nama, b.nik, b.layanan, b.nomor_rekening,
          b.jumlah_kotor, b.jkm, b.jkk, b.jumlah_potongan, b.jumlah_diterima,
        ]);
        const totalBaris = ["JUMLAH TOTAL", "", "", "", "",
          rows.reduce((s, r) => s + r.jumlah_kotor, 0),
          rows.reduce((s, r) => s + r.jkm, 0),
          rows.reduce((s, r) => s + r.jkk, 0),
          rows.reduce((s, r) => s + r.jumlah_potongan, 0),
          rows.reduce((s, r) => s + r.jumlah_diterima, 0)];

        const aoaAwal: unknown[][] = [
          [judulSheetLayanan],
          [baraSkWalikota],
          [],
          [teksHeader],
          [NAMA_LAYANAN_DARI_KODE[kode] || kode],
          headerLayanan,
        ];
        const barisHeaderLayanan = aoaAwal.length; // baris 6
        const barisDataAwalLayanan = barisHeaderLayanan + 1; // baris 7
        const barisDataAkhirLayanan = barisDataAwalLayanan + dataRows.length - 1;
        const barisTotalLayanan = barisDataAkhirLayanan + 1;
        const aoa: unknown[][] = [
          ...aoaAwal,
          ...dataRows,
          totalBaris,
          [],
          ...bangunBlokTtd(teksTtd, batch.tahun, pejabat),
        ];
        // Nama sheet Excel maks 31 karakter & tidak boleh mengandung karakter tertentu
        // ([]:*?/\) -- kode layanan kita ("P. KUBUR" dkk.) sudah aman, tapi tetap dijaga.
        const namaSheet = kode.replace(/[\[\]:*?/\\]/g, "").slice(0, 31) || "LAYANAN";
        const ws = wb.addWorksheet(namaSheet);
        ws.addRows(aoa);
        ws.columns = [{ width: 5 }, { width: 26 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 16 }];
        terapkanGayaJudul(ws, JUMLAH_KOLOM_LAYANAN);
        terapkanGayaHeaderKolom(ws, barisHeaderLayanan, JUMLAH_KOLOM_LAYANAN);
        terapkanBorderData(ws, barisDataAwalLayanan, barisTotalLayanan, JUMLAH_KOLOM_LAYANAN);
        terapkanGayaBarisTotal(ws, barisTotalLayanan, JUMLAH_KOLOM_LAYANAN);
        terapkanFormatUang(ws, barisDataAwalLayanan, barisTotalLayanan, [6, 7, 8, 9, 10]);
        ws.views = [{ state: "frozen", ySplit: barisHeaderLayanan }];
      }
    }

    const xlsxBufferMentah = await wb.xlsx.writeBuffer();
    const xlsxBuffer: Uint8Array = xlsxBufferMentah instanceof Uint8Array
      ? xlsxBufferMentah
      : new Uint8Array(xlsxBufferMentah);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < xlsxBuffer.length; i += chunk) {
      binary += String.fromCharCode(...xlsxBuffer.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    const namaFile = `${batch.jenis === "DJPM" ? "Pembayaran Dana Jasa" : "Pembayaran BPJS Ketenagakerjaan"} Bulan ${batch.bulan} ${batch.tahun}`;
    return { sukses: true, base64, namaFile: namaFile + ".xlsx" };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// ---- Pejabat penandatangan TTD (poin 2 di rencana Tools) ----

export async function ambilPejabatTtd(token: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const rows = await sql`select peran, nama, jabatan, nip from pejabat_ttd order by peran`;
    return { sukses: true, pejabat: rows };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

const PERAN_TTD_VALID = ["KEPALA_DINAS", "PPTK", "BENDAHARA"];

export async function simpanPejabatTtd(token: string, peran: string, nama: string, jabatan: string, nip: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const peranUpper = (peran || "").toString().trim().toUpperCase();
  if (PERAN_TTD_VALID.indexOf(peranUpper) === -1) {
    return { sukses: false, pesan: "Peran pejabat tidak valid." };
  }
  const namaTrim = (nama || "").toString().trim();
  const jabatanTrim = (jabatan || "").toString().trim();
  const nipTrim = (nip || "").toString().trim();
  if (!namaTrim || !jabatanTrim || !nipTrim) {
    return { sukses: false, pesan: "Nama, jabatan, dan NIP wajib diisi." };
  }

  try {
    await sql`
      update pejabat_ttd
      set nama = ${namaTrim}, jabatan = ${jabatanTrim}, nip = ${nipTrim}, diperbarui_at = now()
      where peran = ${peranUpper}
    `;
    return { sukses: true, pesan: "Data pejabat berhasil disimpan." };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// ---- Jumlah SK per layanan -- angka PERMANEN diisi manual sekali saat SK terbit, TIDAK
// dihitung ulang otomatis (lihat catatan desain di migration 20260915140000). ----

export async function ambilSkLayanan(token: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const rows = await sql`select layanan_kode, jumlah_sk from sk_layanan order by layanan_kode`;
    // Urutkan sesuai URUTAN_LAYANAN_REKAP (bukan alfabetis) supaya form di frontend konsisten
    // dengan urutan yang dipakai di dokumen Excel.
    const urut = URUTAN_LAYANAN_REKAP
      .map((kode) => rows.find((r) => r.layanan_kode === kode))
      .filter(Boolean)
      .map((r) => ({ layananKode: r!.layanan_kode, namaLengkap: NAMA_LAYANAN_DARI_KODE[r!.layanan_kode] || r!.layanan_kode, jumlahSk: r!.jumlah_sk }));
    return { sukses: true, daftar: urut };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

export async function simpanSkLayanan(token: string, layananKode: string, jumlahSk: number | null) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const kode = (layananKode || "").toString().trim();
  if (URUTAN_LAYANAN_REKAP.indexOf(kode) === -1) {
    return { sukses: false, pesan: "Kode layanan tidak valid." };
  }
  let nilai: number | null = null;
  if (jumlahSk !== null && jumlahSk !== undefined && jumlahSk !== ("" as unknown)) {
    nilai = Number(jumlahSk);
    if (!Number.isFinite(nilai) || nilai < 0) {
      return { sukses: false, pesan: "Jumlah SK harus berupa angka 0 atau lebih." };
    }
  }

  try {
    await sql`
      update sk_layanan set jumlah_sk = ${nilai}, diperbarui_at = now()
      where layanan_kode = ${kode}
    `;
    return { sukses: true, pesan: "Jumlah SK berhasil disimpan." };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// ---- Referensi SK Wali Kota (nomor + tanggal) -- opsional, dipakai di judul dokumen Excel per
// layanan. Placeholder "(BELUM DITETAPKAN)" dipakai saat generate Excel kalau masih kosong. ----

export async function ambilReferensiSkWalikota(token: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const rows = await sql`select nomor_sk, tanggal_sk from referensi_sk_walikota where id = 1`;
    const r = rows[0] || { nomor_sk: null, tanggal_sk: null };
    // Driver `postgres` mengembalikan kolom `date` sebagai objek Date, yang kalau di-JSON.stringify
    // apa adanya jadi ISO datetime ("...T00:00:00.000Z") -- <input type="date"> di frontend butuh
    // persis "YYYY-MM-DD", jadi harus diformat manual di sini (ditemukan lewat pengujian langsung
    // terhadap driver, bukan tebakan).
    let tanggalSk = "";
    if (r.tanggal_sk) {
      const d = r.tanggal_sk instanceof Date ? r.tanggal_sk : new Date(r.tanggal_sk);
      if (!isNaN(d.getTime())) {
        tanggalSk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
    }
    return { sukses: true, nomorSk: r.nomor_sk || "", tanggalSk };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

export async function simpanReferensiSkWalikota(token: string, nomorSk: string, tanggalSk: string) {
  try {
    await wajibUtama(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const nomor = (nomorSk || "").toString().trim() || null;
  const tanggal = (tanggalSk || "").toString().trim() || null;

  try {
    await sql`
      update referensi_sk_walikota
      set nomor_sk = ${nomor}, tanggal_sk = ${tanggal}, diperbarui_at = now()
      where id = 1
    `;
    return { sukses: true, pesan: "Referensi SK Wali Kota berhasil disimpan." };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
