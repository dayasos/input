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
// distribusiDataLayanan() Kode.gs) -- dipakai di sheet REKAP dan tiap sheet layanan (jenis DJPM
// saja; BPJS TK tidak punya blok TTD di kode asli).
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
    [], [], [], [], [],
    [kepala.nama, "", "", pptk.nama, "", "", "", bendahara.nama],
    [kepala.jabatan, "", "", pptk.jabatan, "", "", "", bendahara.jabatan],
    [kepala.nip, "", "", pptk.nip, "", "", "", bendahara.nip],
  ];
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
    const XLSX: any = await import("npm:xlsx@0.18.5");
    const wb = XLSX.utils.book_new();

    const teksHeader = `BULAN : ${batch.bulan} ${batch.tahun}`;
    const teksTtd = `Medan, ${batch.bulan} ${batch.tahun}`;

    if (batch.jenis === "BPJS") {
      // Satu sheet saja, TANPA blok TTD -- persis updateBPJS_Lokal() di Kode.gs.
      const aoa: unknown[][] = [
        [teksHeader],
        [],
        ["NO", "NAMA", "NIK", "LAYANAN", "KECAMATAN", "KELURAHAN", "USIA"],
        ...baris.map((b, i) => [i + 1, b.nama, b.nik, b.layanan, b.kecamatan, b.kelurahan, b.umur]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 5 }, { wch: 28 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 8 }];
      XLSX.utils.book_append_sheet(wb, ws, "BPJS TK");
    } else {
      // Jenis DJPM: 1 sheet REKAP + 1 sheet per layanan yang ada datanya -- persis
      // isiRekapOtomatis() + distribusiDataLayanan() di Kode.gs.
      const pejabatRows = await sql`select peran, nama, jabatan, nip from pejabat_ttd`;
      const pejabat: Record<string, { nama: string; jabatan: string; nip: string }> = {};
      for (const p of pejabatRows) pejabat[p.peran] = { nama: p.nama, jabatan: p.jabatan, nip: p.nip };

      const grup: Record<string, typeof baris> = {};
      for (const b of baris) {
        if (!grup[b.layanan_kode]) grup[b.layanan_kode] = [];
        grup[b.layanan_kode].push(b);
      }

      // ---- Sheet REKAP ----
      const rekapAoa: unknown[][] = [
        [teksHeader], [],
        ["LAYANAN", "TOTAL", "USIA < 65", "USIA >= 65", "TOTAL DITERIMA"],
      ];
      let totTotal = 0, totBwh = 0, totAts = 0, totUang = 0;
      for (const kode of Object.keys(grup).sort()) {
        const rows = grup[kode];
        const bwh65 = rows.filter((r) => r.umur < 65).length;
        const ats65 = rows.length - bwh65;
        const uang = rows.reduce((s, r) => s + r.jumlah_diterima, 0);
        rekapAoa.push([kode, rows.length, bwh65, ats65, uang]);
        totTotal += rows.length; totBwh += bwh65; totAts += ats65; totUang += uang;
      }
      rekapAoa.push(["TOTAL", totTotal, totBwh, totAts, totUang]);
      rekapAoa.push([]);
      rekapAoa.push(...bangunBlokTtd(teksTtd, batch.tahun, pejabat));
      const wsRekap = XLSX.utils.aoa_to_sheet(rekapAoa);
      wsRekap["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, wsRekap, "REKAP");

      // ---- Sheet per layanan ----
      const headerLayanan = ["NO", "NAMA", "NIK", "LAYANAN", "NO REK BANK SUMUT", "JLH KOTOR", "JKM", "JKK", "JLH JKK + JKM", "JUMLAH DITERIMA"];
      for (const kode of Object.keys(grup).sort()) {
        const rows = grup[kode];
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

        const aoa: unknown[][] = [
          [teksHeader], [],
          headerLayanan,
          ...dataRows,
          totalBaris,
          [],
          ...bangunBlokTtd(teksTtd, batch.tahun, pejabat),
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 5 }, { wch: 26 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
        // Nama sheet Excel maks 31 karakter & tidak boleh mengandung karakter tertentu
        // ([]:*?/\) -- kode layanan kita ("P. KUBUR" dkk.) sudah aman, tapi tetap dijaga.
        const namaSheet = kode.replace(/[\[\]:*?/\\]/g, "").slice(0, 31) || "LAYANAN";
        XLSX.utils.book_append_sheet(wb, ws, namaSheet);
      }
    }

    const xlsxBuffer: Uint8Array = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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
