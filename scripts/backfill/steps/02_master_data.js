"use strict";

const { bacaSheet } = require("../lib/sheets");
const { upsert } = require("../lib/db");
const log = require("../lib/log");

const SHEET_KE_JENIS_RUMAH_IBADAH = {
  db_masjid: "MASJID",
  db_musholla: "MUSHOLLA",
  db_gereja: "GEREJA",
  db_pgk: "GEREJA_KATOLIK",
  db_vihara: "VIHARA",
  db_klenteng: "KLENTENG",
  db_kuil: "KUIL",
};

// Sheet gabungan lama tidak dapat dipisah otomatis menjadi Vihara, Klenteng, atau Kuil.
// Sengaja tidak diimpor agar backfill baru tidak lagi menciptakan data berjenis gabungan.
const SHEET_RUMAH_IBADAH_PERLU_KLASIFIKASI = ["db_vihara_klenteng_kuil"];

// db_layanan kolom A=daftar layanan Kecamatan, B=daftar layanan Kemenag (DUA LIST INDEPENDEN,
// bukan baris berpasangan — dikonfirmasi dari getMasterLayanan() Kode.gs baris 374-379).
async function backfillLayanan(ctx) {
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, "db_layanan", "A2:B");
  let ditulis = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (let i = 0; i < baris.length; i++) {
      const kec = (baris[i][0] || "").toString().trim();
      if (kec) {
        if (ctx.mode === "write") {
          await upsert(client, "layanan_master", ["kategori", "nama_layanan"], {
            kategori: "KECAMATAN",
            nama_layanan: kec,
            urutan: i,
          });
        }
        ditulis++;
      }
      const kem = (baris[i][1] || "").toString().trim();
      if (kem) {
        if (ctx.mode === "write") {
          await upsert(client, "layanan_master", ["kategori", "nama_layanan"], {
            kategori: "KEMENAG",
            nama_layanan: kem,
            urutan: i,
          });
        }
        ditulis++;
      }
    }
  } finally {
    if (client) client.release();
  }
  log.info(`db_layanan -> layanan_master: ${baris.length} baris sheet, ${ditulis} entri layanan ditulis`);
  return { sheetDibaca: baris.length, ditulis };
}

// db_wilayah kolom A=Kecamatan, B=Kelurahan (dikonfirmasi getKelurahanByKecamatan() Kode.gs baris 407-415).
async function backfillWilayah(ctx) {
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, "db_wilayah", "A2:B");
  let ditulis = 0;
  let dilewati = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (const r of baris) {
      const kecamatan = (r[0] || "").toString().trim().toUpperCase();
      const kelurahan = (r[1] || "").toString().trim();
      if (!kecamatan || !kelurahan) {
        dilewati++;
        continue;
      }
      if (ctx.mode === "write") {
        await upsert(client, "wilayah", ["kecamatan", "kelurahan"], { kecamatan, kelurahan });
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }
  log.info(`db_wilayah -> wilayah: ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati`);
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

// db_kuota & db_kuotakatolik kolom A=Kecamatan B=Layanan C=Kuota (Kode.gs baris 1570-1575, 1814-1822).
async function backfillKuota(ctx, sheetName, table) {
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, sheetName, "A2:C");
  let ditulis = 0;
  let dilewati = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (const r of baris) {
      const kecamatan = (r[0] || "").toString().trim().toUpperCase();
      const layanan = (r[1] || "").toString().trim().toUpperCase();
      if (!kecamatan || !layanan) {
        dilewati++;
        continue;
      }
      const kuotaMaks = Number(r[2]) || 0;
      if (ctx.mode === "write") {
        await upsert(client, table, ["kecamatan", "layanan"], { kecamatan, layanan, kuota_maks: kuotaMaks });
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }
  log.info(`${sheetName} -> ${table}: ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati`);
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

// Sheet rumah ibadah resmi, kolom A=Kecamatan B=Kelurahan C=Nama D=Alamat (dikonfirmasi dari
// renderTable() di index.html baris 6587-6593: r[0]=kecamatan, r[1]=kelurahan, r[2]=nama, r[3]=alamat).
async function backfillRumahIbadah(ctx, sheetName) {
  const jenis = SHEET_KE_JENIS_RUMAH_IBADAH[sheetName];
  const baris = await bacaSheet(ctx.sheetsClient, ctx.env.ssIdMasterDropdown, sheetName, "A2:D");
  let ditulis = 0;
  let dilewati = 0;
  const client = ctx.mode === "write" ? await ctx.pool.connect() : null;
  try {
    for (const r of baris) {
      const kecamatan = (r[0] || "").toString().trim().toUpperCase();
      const kelurahan = (r[1] || "").toString().trim();
      const nama = (r[2] || "").toString().trim();
      const alamat = (r[3] || "").toString().trim();
      if (!kecamatan || !nama) {
        dilewati++;
        continue;
      }
      if (ctx.mode === "write") {
        // Tidak ada kunci alami unik yang pasti (nama rumah ibadah bisa mirip di kelurahan
        // berbeda) — kita INSERT langsung (bukan upsert) tapi cegah duplikat exact-match
        // lewat NOT EXISTS, supaya backfill tetap idempoten kalau dijalankan ulang.
        await client.query(
          `insert into rumah_ibadah (jenis, kecamatan, kelurahan, nama, alamat)
           select $1, $2, $3, $4, $5
           where not exists (
             select 1 from rumah_ibadah
             where jenis = $1 and kecamatan = $2 and kelurahan = $3 and nama = $4 and alamat = $5
           )`,
          [jenis, kecamatan, kelurahan, nama, alamat],
        );
      }
      ditulis++;
    }
  } finally {
    if (client) client.release();
  }
  log.info(`${sheetName} -> rumah_ibadah(${jenis}): ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati`);
  return { sheetDibaca: baris.length, ditulis, dilewati };
}

async function jalankan({ sheetsClient, pool, env, mode }) {
  log.judul("02. Master Data (layanan, wilayah, kuota, rumah ibadah)");
  const ctx = { sheetsClient, pool, env, mode };

  const hasil = [];
  hasil.push(await backfillLayanan(ctx));
  hasil.push(await backfillWilayah(ctx));
  hasil.push(await backfillKuota(ctx, "db_kuota", "kuota"));
  hasil.push(await backfillKuota(ctx, "db_kuotakatolik", "kuota_katolik"));
  for (const sheetName of Object.keys(SHEET_KE_JENIS_RUMAH_IBADAH)) {
    hasil.push(await backfillRumahIbadah(ctx, sheetName));
  }
  for (const sheetName of SHEET_RUMAH_IBADAH_PERLU_KLASIFIKASI) {
    log.info(`${sheetName} dilewati: data harus diklasifikasikan sebagai Vihara, Klenteng, atau Kuil sebelum diimpor.`);
  }

  const total = hasil.reduce(
    (acc, h) => ({ sheetDibaca: acc.sheetDibaca + h.sheetDibaca, ditulis: acc.ditulis + h.ditulis }),
    { sheetDibaca: 0, ditulis: 0 },
  );
  log.ringkasan({ sheetDibaca: total.sheetDibaca, ditulis: total.ditulis, mode });
  return total;
}

module.exports = { nama: "master-data", jalankan };
