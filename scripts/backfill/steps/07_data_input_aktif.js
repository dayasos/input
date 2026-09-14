"use strict";

const { bacaSheet } = require("../lib/sheets");
const { keTanggalIso, angkaAtauNull, angkaAtauFallback } = require("../lib/tanggal");
const { keWaktuJs } = require("../lib/waktu");
const log = require("../lib/log");

// Header 40 kolom "Data Input <tahun>" (dikonfirmasi dari appendRow header di simpanDataKeSheet(),
// Kode.gs baris 946-956) — lihat juga migrasi 20260907090200_penerima_partitioned.sql.
// PERHATIAN: format TANGGAL VERIFIKASI & TANGGAL LAPOR PERBAIKAN belum sempat diverifikasi
// persis terhadap kode penulisnya (verifikasiSatuData/laporkanPerbaikanBerkas) — SELALU jalankan
// dry-run dulu dan periksa beberapa baris sampel sebelum --write, terutama 2 kolom ini.
async function jalankan({ sheetsClient, pool, env, mode, tahunAktif }) {
  log.judul(`07. Data Input Aktif ("Data Input ${tahunAktif}" -> penerima_${tahunAktif})`);

  const namaSheet = `Data Input ${tahunAktif}`;
  const baris = await bacaSheet(sheetsClient, env.ssIdPenyimpanan, namaSheet, "A2:AN");

  let ditulis = 0;
  let dilewati = 0;
  let contohSampel = null;

  const client = mode === "write" ? await pool.connect() : null;
  try {
    for (let i = 0; i < baris.length; i++) {
      const r = baris[i];
      const nik = (r[2] || "").toString().trim();
      if (!nik) {
        dilewati++;
        continue;
      }

      const bersihkanKontak = (v) => (v || "").toString().replace(/^'+/, "").trim();

      const data = {
        tahun: tahunAktif,
        nomor_urut: angkaAtauFallback(r[0], i + 1),
        nama: (r[1] || "").toString().trim(),
        nik,
        jenis_kelamin: (r[3] || "").toString().trim(),
        tempat_lahir: (r[4] || "").toString().trim(),
        tanggal_lahir: keTanggalIso(r[5]),
        alamat: (r[6] || "").toString().trim(),
        layanan: (r[7] || "").toString().trim().toUpperCase(),
        tempat_tugas: (r[8] || "").toString().trim(),
        alamat_tugas: (r[9] || "").toString().trim(),
        kecamatan: (r[10] || "").toString().trim().toUpperCase(),
        kelurahan: (r[11] || "").toString().trim(),
        nama_rekening: (r[12] || "").toString().trim(),
        nomor_rekening: (r[13] || "").toString().trim(),
        kantor_cabang: (r[14] || "").toString().trim(),
        no_kontak: bersihkanKontak(r[15]),
        status_bpjs_tk: (r[16] || "").toString().trim(),
        umur: angkaAtauNull(r[17]),
        link_ktp: (r[18] || "").toString().trim() || null,
        link_buku_rekening: (r[19] || "").toString().trim() || null,
        link_surat_permohonan: (r[20] || "").toString().trim() || null,
        link_pernyataan_satu_bantuan: (r[21] || "").toString().trim() || null,
        link_domisili_kelurahan: (r[22] || "").toString().trim() || null,
        link_formulir_pendataan: (r[23] || "").toString().trim() || null,
        link_berkas_pendukung: (r[24] || "").toString().trim() || null,
        link_foto_plank_rumah_ibadah: (r[25] || "").toString().trim() || null,
        link_foto_lokasi_ibadah: (r[26] || "").toString().trim() || null,
        link_foto_kegiatan_belajar: (r[27] || "").toString().trim() || null,
        link_rekomendasi_bkm: (r[28] || "").toString().trim() || null,
        link_rekomendasi_rumah_ibadah: (r[29] || "").toString().trim() || null,
        id_folder_berkas: (r[30] || "").toString().trim() || null,
        link_koordinat_lokasi: (r[31] || "").toString().trim() || null,
        status_verifikasi: (r[32] || "").toString().trim() || "Proses Verifikasi",
        keterangan_verifikasi: (r[33] || "").toString().trim() || null,
        tanggal_verifikasi: keWaktuJs(r[34]),
        diverifikasi_oleh: (r[35] || "").toString().trim() || null,
        batas_waktu_perbaikan: keTanggalIso(r[36]),
        catatan_perbedaan_nama: (r[37] || "").toString().trim() || null,
        tanggal_lapor_perbaikan: keWaktuJs(r[38]),
        dilapor_oleh: (r[39] || "").toString().trim() || null,
        sheet_row_number: i + 2,
        sync_status: "SUKSES",
      };

      if (!contohSampel) contohSampel = data; // dicetak di ringkasan supaya bisa diperiksa manual sebelum --write

      if (mode === "write") {
        const kolom = Object.keys(data);
        const placeholder = kolom.map((_, idx) => `$${idx + 1}`).join(", ");
        const kolomUpdate = kolom.filter((k) => k !== "tahun" && k !== "nik");
        const setClause = kolomUpdate.map((k) => `${k} = excluded.${k}`).join(", ");
        await client.query(
          `insert into penerima (${kolom.join(", ")}) values (${placeholder})
           on conflict (tahun, nik) do update set ${setClause}`,
          Object.values(data),
        );
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }

  if (contohSampel) {
    log.info("Contoh 1 baris pertama yang diproses (periksa manual sebelum --write, terutama field tanggal):");
    log.info(JSON.stringify(contohSampel, null, 2));
  }
  log.ringkasan({ sheetDibaca: baris.length, ditulis, dilewati, mode });
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

module.exports = { nama: "data-input-aktif", jalankan };
