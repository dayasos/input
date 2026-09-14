"use strict";

const { bacaSheet } = require("../lib/sheets");
const { upsert } = require("../lib/db");
const { keTanggalIso } = require("../lib/tanggal");
const log = require("../lib/log");

// Kolom db_capil (1-based), dikonfirmasi dari komentar cekDomisiliCapil_() di Kode.gs baris 3486-3489:
// A=NAMA B=NIK C=JK D=TMPT LAHIR E=TGL LAHIR F=ALAMAT G=KECAMATAN H=KELURAHAN I=STATUS
// J=ALAMAT DOMISILI K=KAB/KOTA DOMISILI
async function jalankan({ sheetsClient, pool, env, mode }) {
  log.judul("03. Capil (db_capil -> capil)");

  const baris = await bacaSheet(sheetsClient, env.ssIdMasterDropdown, "db_capil", "A2:K");
  let ditulis = 0;
  let dilewati = 0;

  const client = mode === "write" ? await pool.connect() : null;
  try {
    for (const r of baris) {
      const nik = (r[1] || "").toString().trim();
      if (!nik) {
        dilewati++;
        continue;
      }

      const data = {
        nik,
        nama: (r[0] || "").toString().trim(),
        jenis_kelamin: (r[2] || "").toString().trim(),
        tempat_lahir: (r[3] || "").toString().trim(),
        tanggal_lahir: keTanggalIso(r[4]),
        alamat: (r[5] || "").toString().trim(),
        kecamatan: (r[6] || "").toString().trim().toUpperCase(),
        kelurahan: (r[7] || "").toString().trim().toUpperCase(),
        status: (r[8] || "").toString().trim(),
        alamat_domisili: (r[9] || "").toString().trim(),
        kab_kota_domisili: (r[10] || "").toString().trim(),
      };

      if (mode === "write") {
        await upsert(client, "capil", ["nik"], data);
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }

  log.ringkasan({ sheetDibaca: baris.length, ditulis, dilewati, mode });
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

module.exports = { nama: "capil", jalankan };
