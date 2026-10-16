"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function muatEnvLocal() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");

  const dbMatch = content.match(/SUPABASE_DB_URL=(.+)/);
  if (dbMatch && !process.env.SUPABASE_DB_URL) {
    process.env.SUPABASE_DB_URL = dbMatch[1].trim();
  }
}

async function main() {
  muatEnvLocal();
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("SUPABASE_DB_URL tidak ditemukan di .env.local!");
    process.exit(1);
  }

  const nils = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (nils.length === 0) {
    console.log("Penggunaan: node scripts/hapus-capil.js <NIK_1> [NIK_2 ...]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  try {
    for (const nik of nils) {
      console.log(`\n========================================`);
      console.log(`Memproses NIK: ${nik}`);
      const resFind = await client.query("SELECT * FROM capil WHERE nik = $1", [nik]);
      if (resFind.rows.length === 0) {
        console.log(`[INFO] NIK ${nik} tidak ditemukan di tabel capil.`);
      } else {
        const item = resFind.rows[0];
        console.log(`[DITEMUKAN] Nama: ${item.nama} | Domisili: ${item.kab_kota_domisili}`);
        const resDel = await client.query("DELETE FROM capil WHERE nik = $1 RETURNING *", [nik]);
        console.log(`[SUKSES] Berhasil menghapus NIK ${nik} (${resDel.rowCount} baris).`);
      }
    }
    console.log(`\nSelesai.`);
  } catch (err) {
    console.error("Error:", err.message || err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
