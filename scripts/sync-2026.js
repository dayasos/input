"use strict";

const fs = require("fs");
const path = require("path");

// Muat .env.local dengan aman (mendukung multiline JSON Service Account & comment Vercel)
function muatEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");

  // Ekstrak GOOGLE_SERVICE_ACCOUNT_KEY_JSON
  const keyIdx = content.indexOf("GOOGLE_SERVICE_ACCOUNT_KEY_JSON=");
  if (keyIdx !== -1) {
    const start = keyIdx + "GOOGLE_SERVICE_ACCOUNT_KEY_JSON=".length;
    const firstBrace = content.indexOf("{", start);
    if (firstBrace !== -1) {
      let depth = 0;
      let end = -1;
      for (let i = firstBrace; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      if (end !== -1) {
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON = content.slice(firstBrace, end);
      }
    }
  }

  // Ekstrak SUPABASE_DB_URL
  const dbMatch = content.match(/SUPABASE_DB_URL=(.+)/);
  if (dbMatch && !process.env.SUPABASE_DB_URL) {
    process.env.SUPABASE_DB_URL = dbMatch[1].trim();
  }

  // Ekstrak SS_ID_MASTER_DROPDOWN
  const ssMatch = content.match(/SS_ID_MASTER_DROPDOWN=(.+)/);
  if (ssMatch && !process.env.SS_ID_MASTER_DROPDOWN) {
    process.env.SS_ID_MASTER_DROPDOWN = ssMatch[1].trim();
  }
}

muatEnvLocal();

const { muatEnv } = require("./backfill/lib/env");
const { buatKlienSheets, bacaSheet } = require("./backfill/lib/sheets");
const { buatPool } = require("./backfill/lib/db");
const { keTanggalIso, angkaAtauNull, angkaAtauFallback } = require("./backfill/lib/tanggal");

const TAHUN = 2026;
const NAMA_SHEET = "db_2026";
const UKURAN_BATCH = 400; // 400 baris * 20 parameter = 8.000 param (jauh di bawah batas Postgres 65.535)

async function sinkronkan2026() {
  const mulaiWaktu = Date.now();
  console.log("==================================================================");
  console.log("   SINKRONISASI DATA GOOGLE SHEETS db_2026 -> SUPABASE POSTGRES   ");
  console.log("==================================================================");

  const env = muatEnv();
  const spreadsheetId = env.ssIdMasterDropdown;
  console.log(`[1/4] Menghubungkan ke Google Sheets API...`);
  console.log(`      Spreadsheet ID : ${spreadsheetId}`);
  console.log(`      Sheet Tab      : ${NAMA_SHEET}`);

  const sheetsClient = await buatKlienSheets(env);
  const rawRows = await bacaSheet(sheetsClient, spreadsheetId, NAMA_SHEET, "A2:S");
  console.log(`      Total baris dibaca dari Sheet: ${rawRows.length} baris.`);

  if (rawRows.length === 0) {
    console.log("Peringatan: Tidak ada data di sheet db_2026. Sinkronisasi dibatalkan.");
    return;
  }

  console.log(`\n[2/4] Melakukan parsing & validasi ${rawRows.length} baris data...`);
  const daftarData = [];
  const statusCounter = {};

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    const nik = (r[2] || "").toString().trim();
    if (!nik) continue;

    const statusVerifikasi = (r[18] || "").toString().trim().toUpperCase() || "TIDAK DIKETAHUI";
    statusCounter[statusVerifikasi] = (statusCounter[statusVerifikasi] || 0) + 1;

    daftarData.push({
      tahun: TAHUN,
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
      no_kontak: (r[15] || "").toString().trim(),
      status_bpjs_tk: (r[16] || "").toString().trim(),
      umur: angkaAtauNull(r[17]),
      status_verifikasi: statusVerifikasi,
    });
  }

  console.log(`      Baris valid dengan NIK: ${daftarData.length} baris.`);
  console.log("      Rincian status di Sheet:");
  for (const [st, jml] of Object.entries(statusCounter)) {
    console.log(`        - ${st.padEnd(52)}: ${jml}`);
  }

  console.log(`\n[3/4] Menghubungkan ke Postgres & Upsert Batch ke penerima_2026...`);
  const pool = buatPool(env);
  const client = await pool.connect();

  const ADVISORY_LOCK_ID = 20260923;
  const lockRes = await client.query(`select pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as terkunci;`);
  if (!lockRes.rows[0]?.terkunci) {
    console.log("Peringatan: Sinkronisasi data 2026 sedang berlangsung di latar belakang (cron/proses lain). Dibatalkan demi keamanan.");
    return;
  }

  try {
    await client.query("begin;");

    // 1. Eksekusi batch upsert ke tabel penerima
    let totalBerhasil = 0;
    const totalBatch = Math.ceil(daftarData.length / UKURAN_BATCH);

    for (let b = 0; b < totalBatch; b++) {
      const chunk = daftarData.slice(b * UKURAN_BATCH, (b + 1) * UKURAN_BATCH);
      const params = [];
      const valuesSql = [];

      for (let j = 0; j < chunk.length; j++) {
        const item = chunk[j];
        const offset = j * 20;
        valuesSql.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, ` +
          `$${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, ` +
          `$${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, ` +
          `$${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20})`
        );
        params.push(
          item.tahun, item.nomor_urut, item.nama, item.nik, item.jenis_kelamin,
          item.tempat_lahir, item.tanggal_lahir, item.alamat, item.layanan,
          item.tempat_tugas, item.alamat_tugas, item.kecamatan, item.kelurahan,
          item.nama_rekening, item.nomor_rekening, item.kantor_cabang,
          item.no_kontak, item.status_bpjs_tk, item.umur, item.status_verifikasi
        );
      }

      const queryUpsert = `
        insert into penerima (
          tahun, nomor_urut, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat,
          layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening,
          nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk, umur, status_verifikasi
        ) values ${valuesSql.join(",\n")}
        on conflict (tahun, nik) do update set
          nomor_urut = excluded.nomor_urut,
          nama = excluded.nama,
          jenis_kelamin = excluded.jenis_kelamin,
          tempat_lahir = excluded.tempat_lahir,
          tanggal_lahir = excluded.tanggal_lahir,
          alamat = excluded.alamat,
          layanan = excluded.layanan,
          tempat_tugas = excluded.tempat_tugas,
          alamat_tugas = excluded.alamat_tugas,
          kecamatan = excluded.kecamatan,
          kelurahan = excluded.kelurahan,
          nama_rekening = excluded.nama_rekening,
          nomor_rekening = excluded.nomor_rekening,
          kantor_cabang = excluded.kantor_cabang,
          no_kontak = excluded.no_kontak,
          status_bpjs_tk = excluded.status_bpjs_tk,
          umur = excluded.umur,
          status_verifikasi = excluded.status_verifikasi;
      `;

      await client.query(queryUpsert, params);
      totalBerhasil += chunk.length;
      process.stdout.write(`      Progress: Batch ${b + 1}/${totalBatch} (${totalBerhasil}/${daftarData.length} baris)\r`);
    }
    console.log(`\n      Sukses upsert ${totalBerhasil} baris ke penerima_2026.`);

    // 2. Penyelarasan ke tabel data_detail_2026
    console.log(`\n[4/4] Menyelaraskan tabel data_detail_2026...`);

    // A. Hapus data yang tidak lagi berstatus AKTIF atau Memenuhi Syarat
    const deleteRes = await client.query(`
      delete from data_detail
      where tahun = 2026
        and penerima_id in (
          select id from penerima
          where tahun = 2026
            and status_verifikasi not in ('Memenuhi Syarat', 'AKTIF')
        );
    `);
    console.log(`      Dibersihkan dari data_detail_2026 (status non-aktif/retur/meninggal): ${deleteRes.rowCount} baris.`);

    // B. Tambahkan data yang lolos tapi belum masuk ke data_detail_2026
    const insertDetailRes = await client.query(`
      insert into data_detail (
        tahun, penerima_id, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir,
        alamat, layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening,
        nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk, umur
      )
      select
        p.tahun, p.id, p.nama, p.nik, p.jenis_kelamin, p.tempat_lahir, p.tanggal_lahir,
        p.alamat, p.layanan, p.tempat_tugas, p.alamat_tugas, p.kecamatan, p.kelurahan,
        p.nama_rekening, p.nomor_rekening, p.kantor_cabang, p.no_kontak, p.status_bpjs_tk, p.umur
      from penerima p
      where p.tahun = 2026 and p.status_verifikasi in ('Memenuhi Syarat', 'AKTIF')
      on conflict (tahun, penerima_id) do update set
        nama = excluded.nama,
        jenis_kelamin = excluded.jenis_kelamin,
        tempat_lahir = excluded.tempat_lahir,
        tanggal_lahir = excluded.tanggal_lahir,
        alamat = excluded.alamat,
        layanan = excluded.layanan,
        tempat_tugas = excluded.tempat_tugas,
        alamat_tugas = excluded.alamat_tugas,
        kecamatan = excluded.kecamatan,
        kelurahan = excluded.kelurahan,
        nama_rekening = excluded.nama_rekening,
        nomor_rekening = excluded.nomor_rekening,
        kantor_cabang = excluded.kantor_cabang,
        no_kontak = excluded.no_kontak,
        status_bpjs_tk = excluded.status_bpjs_tk,
        umur = excluded.umur;
    `);
    console.log(`      Tersinkron ke data_detail_2026: ${insertDetailRes.rowCount} baris.`);

    // D. Penyiaran sinyal Realtime CDC ke browser klien
    await client.query(`
      insert into public.realtime_event_bus (domain, aksi, entitas_id, created_at)
      values
        ('arsip_tahun', 'SYNC_2026', null, now()),
        ('penerima', 'SYNC_2026', null, now()),
        ('data_detail', 'SYNC_2026', null, now());
    `);
    console.log("      Sinyal Realtime CDC dipancarkan ke realtime_event_bus (arsip_tahun, penerima, data_detail).");

    // E. Komit Transaksi Atomik
    await client.query("commit;");

    // F. Cek hitungan akhir
    const finalPenerima = await client.query("select count(*) from penerima where tahun = 2026;");
    const finalDetail = await client.query("select count(*) from data_detail where tahun = 2026;");
    console.log(`\n==================================================================`);
    console.log(`   SINKRONISASI SELESAI DENGAN SUKSES (${((Date.now() - mulaiWaktu) / 1000).toFixed(2)} detik)   `);
    console.log(`==================================================================`);
    console.log(`  Total penerima_2026   : ${finalPenerima.rows[0].count} baris`);
    console.log(`  Total data_detail_2026: ${finalDetail.rows[0].count} baris (persis sesuai jumlah AKTIF)`);
    console.log(`==================================================================\n`);

  } catch (err) {
    try {
      await client.query("rollback;");
    } catch (_rbErr) { }
    throw err;
  } finally {
    try {
      await client.query(`select pg_advisory_unlock(${ADVISORY_LOCK_ID});`);
    } catch (_unlErr) { }
    client.release();
    await pool.end();
  }
}

sinkronkan2026().catch((err) => {
  console.error("\n[GAGAL SINKRONISASI]:", err);
  process.exit(1);
});
