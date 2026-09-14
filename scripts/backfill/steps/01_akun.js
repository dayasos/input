"use strict";

const { bacaSheet } = require("../lib/sheets");
const { upsert } = require("../lib/db");
const log = require("../lib/log");

// Kolom db_admin (1-based, dikonfirmasi dari loginPengguna() di Kode.gs baris 244-258):
// A=Username B=Password(hash SHA-256) C=Role D=Kecamatan E=Nama Lengkap F=Nomor HP G=Jabatan H=USER_ID
async function jalankan({ sheetsClient, pool, env, mode }) {
  log.judul("01. Akun (db_admin -> akun)");

  const baris = await bacaSheet(sheetsClient, env.ssIdMasterDropdown, "db_admin", "A2:H");
  let ditulis = 0;
  let dilewati = 0;

  const client = mode === "write" ? await pool.connect() : null;
  try {
    for (const r of baris) {
      const username = (r[0] || "").toString().trim();
      const passwordHash = (r[1] || "").toString().trim();
      if (!username || !passwordHash) {
        dilewati++;
        continue;
      }

      const data = {
        username,
        password_hash: passwordHash,
        role: (r[2] || "").toString().trim().toUpperCase(),
        kecamatan: (r[3] || "").toString().trim().toUpperCase(),
        nama_lengkap: (r[4] || "").toString().trim(),
        nomor_hp: (r[5] || "").toString().trim(),
        jabatan: (r[6] || "").toString().trim(),
        user_id: (r[7] || "").toString().trim().toUpperCase(),
      };

      if (mode === "write") {
        // Password_hash TIDAK di-hash ulang — disalin apa adanya dari sheet supaya login
        // pengguna existing tetap valid tanpa reset password (lihat rencana migrasi § Backfill).
        await upsert(client, "akun", ["username"], data);
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }

  log.ringkasan({ sheetDibaca: baris.length, ditulis, dilewati, mode });
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

module.exports = { nama: "akun", jalankan };
