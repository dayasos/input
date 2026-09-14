"use strict";

const { Pool } = require("pg");

function buatPool(env) {
  return new Pool({ connectionString: env.dbUrl });
}

/**
 * Upsert generik: INSERT ... ON CONFLICT (kolomKonflik) DO UPDATE SET <kolom lain>.
 * Dipakai berulang di semua step supaya backfill IDEMPOTEN — aman dijalankan ulang
 * (mis. re-run setelah gagal di tengah jalan, atau "pass delta" sebelum cutover)
 * tanpa membuat duplikat baris.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} table nama tabel tujuan
 * @param {string[]} kolomKonflik kolom yang jadi kunci unik (dipakai di ON CONFLICT)
 * @param {Record<string, unknown>} data seluruh kolom yang mau ditulis (termasuk kolomKonflik)
 */
async function upsert(client, table, kolomKonflik, data) {
  const kolom = Object.keys(data);
  const nilai = Object.values(data);
  const placeholder = kolom.map((_, i) => `$${i + 1}`).join(", ");
  const kolomUpdate = kolom.filter((k) => !kolomKonflik.includes(k));
  const setClause = kolomUpdate.map((k) => `${k} = excluded.${k}`).join(", ");

  const sql = `
    insert into ${table} (${kolom.join(", ")})
    values (${placeholder})
    on conflict (${kolomKonflik.join(", ")})
    ${setClause ? `do update set ${setClause}` : "do nothing"}
  `;
  await client.query(sql, nilai);
}

async function hitungBaris(client, table, whereSql = "", params = []) {
  const res = await client.query(`select count(*)::int as jumlah from ${table} ${whereSql}`, params);
  return res.rows[0].jumlah;
}

module.exports = { buatPool, upsert, hitungBaris };
