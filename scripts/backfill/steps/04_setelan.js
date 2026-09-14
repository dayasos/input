"use strict";

const { bacaSheet } = require("../lib/sheets");
const { upsert } = require("../lib/db");
const { keWaktuJs } = require("../lib/waktu");
const log = require("../lib/log");

// db_setelan kolom A=Key B=Value (komentar Kode.gs baris 2162: "Format db_setelan: Kolom A = Key, Kolom B = Value").
async function backfillSetelan(ctx) {
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, "db_setelan", "A2:B");
  let ditulis = 0;
  let dilewati = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (const r of baris) {
      const key = (r[0] || "").toString().trim();
      if (!key) {
        dilewati++;
        continue;
      }
      const value = (r[1] || "").toString().trim();
      if (ctx.mode === "write") {
        await upsert(client, "setelan", ["key"], { key, value });
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }
  log.info(`db_setelan -> setelan: ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati`);
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

// db_riwayat_setelan kolom: Waktu, Username, Key, Nilai Lama, Nilai Baru, Keterangan
// (appendRow header di catatRiwayatSetelan_(), Kode.gs baris 2319).
// Log audit tanpa kunci alami -> pakai NOT EXISTS (waktu+username+key+nilai_baru) supaya
// idempoten kalau skrip dijalankan ulang.
async function backfillRiwayatSetelan(ctx) {
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, "db_riwayat_setelan", "A2:F");
  let ditulis = 0;
  let dilewati = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (const r of baris) {
      const waktu = keWaktuJs(r[0]);
      const key = (r[2] || "").toString().trim();
      if (!waktu || !key) {
        dilewati++;
        continue;
      }
      const username = (r[1] || "").toString().trim();
      const nilaiLama = (r[3] || "").toString();
      const nilaiBaru = (r[4] || "").toString();
      const keterangan = (r[5] || "").toString();

      if (ctx.mode === "write") {
        await client.query(
          `insert into riwayat_setelan (waktu, username, key, nilai_lama, nilai_baru, keterangan)
           select $1, $2, $3, $4, $5, $6
           where not exists (
             select 1 from riwayat_setelan
             where waktu = $1 and username = $2 and key = $3 and nilai_baru = $5
           )`,
          [waktu, username, key, nilaiLama, nilaiBaru, keterangan],
        );
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }
  log.info(`db_riwayat_setelan -> riwayat_setelan: ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati`);
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

async function jalankan({ sheetsClient, pool, env, mode }) {
  log.judul("04. Setelan & Riwayat Setelan");
  const ctx = { sheetsClient, pool, env, mode };

  const a = await backfillSetelan(ctx);
  const b = await backfillRiwayatSetelan(ctx);

  const total = { sheetDibaca: a.sheetDibaca + b.sheetDibaca, ditulis: a.ditulis + b.ditulis };
  log.ringkasan({ sheetDibaca: total.sheetDibaca, ditulis: total.ditulis, mode });
  return total;
}

module.exports = { nama: "setelan", jalankan };
