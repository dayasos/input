"use strict";

const { bacaSheet } = require("../lib/sheets");
const { keWaktuJs } = require("../lib/waktu");
const log = require("../lib/log");

// db_riwayat_edit kolom: Waktu, Editor, Role, No.Baris, Nama Penerima, Kolom Diubah, Sebelum,
// Sesudah (header di catatRiwayatEdit_(), Kode.gs baris 3311). "No.Baris" mengacu ke baris fisik
// di sheet "Data Input <tahunAktif>" — SENGAJA dijalankan SETELAH step 07 (data-input-aktif) supaya
// penerima_id bisa ditautkan balik via sheet_row_number (kalau step 07 belum jalan, kolom
// penerima_id/tahun akan NULL dulu — tidak fatal, nomor_baris_sheet tetap tersimpan sebagai jejak).
async function jalankan({ sheetsClient, pool, env, mode, tahunAktif }) {
  log.judul("08. Riwayat Edit (db_riwayat_edit -> riwayat_edit)");

  const baris = await bacaSheet(sheetsClient, env.ssIdPenyimpanan, "db_riwayat_edit", "A2:H");
  let ditulis = 0;
  let dilewati = 0;
  let tertaut = 0;

  const client = mode === "write" ? await pool.connect() : null;
  try {
    for (const r of baris) {
      const waktu = keWaktuJs(r[0]);
      const nomorBarisSheet = Number(r[3]) || null;
      if (!waktu || !nomorBarisSheet) {
        dilewati++;
        continue;
      }

      const editorUsername = (r[1] || "").toString().trim();
      const editorRole = (r[2] || "").toString().trim();
      const namaPenerima = (r[4] || "").toString().trim();
      const kolomDiubah = (r[5] || "").toString().trim();
      const sebelum = (r[6] || "").toString();
      const sesudah = (r[7] || "").toString();

      if (mode === "write") {
        const cariPenerima = await client.query(
          `select id from penerima where tahun = $1 and sheet_row_number = $2 limit 1`,
          [tahunAktif, nomorBarisSheet],
        );
        const penerimaId = cariPenerima.rows[0] ? cariPenerima.rows[0].id : null;
        if (penerimaId) tertaut++;

        await client.query(
          `insert into riwayat_edit (
             waktu, editor_username, editor_role, penerima_id, tahun, nomor_baris_sheet,
             nama_penerima, kolom_diubah, sebelum, sesudah
           )
           select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           where not exists (
             select 1 from riwayat_edit
             where waktu = $1 and nomor_baris_sheet = $6 and kolom_diubah = $8
           )`,
          [waktu, editorUsername, editorRole, penerimaId, penerimaId ? tahunAktif : null, nomorBarisSheet, namaPenerima, kolomDiubah, sebelum, sesudah],
        );
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }

  log.info(`Berhasil ditautkan ke penerima_id: ${tertaut} dari ${ditulis} (sisanya NULL kalau step 07 belum/tidak dijalankan)`);
  log.ringkasan({ sheetDibaca: baris.length, ditulis, dilewati, mode });
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

module.exports = { nama: "riwayat-edit", jalankan };
