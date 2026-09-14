"use strict";

const fs = require("fs");
const { google } = require("googleapis");

/**
 * Buat klien Google Sheets API v4 terautentikasi via Service Account.
 * Spreadsheet tujuan (SS_ID_MASTER_DROPDOWN & SS_ID_PENYIMPANAN) harus sudah di-share
 * ke email Service Account ini sebagai Editor (atau minimal Viewer, karena skrip ini
 * hanya MEMBACA Sheets — tidak pernah menulis balik ke Sheets).
 */
async function buatKlienSheets(env) {
  const credentials = env.googleKeyJson
    ? JSON.parse(env.googleKeyJson)
    : JSON.parse(fs.readFileSync(env.googleKeyPath, "utf8"));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Baca satu range dari satu sheet, kembalikan array-of-array mentah (tanpa header)
 * persis seperti sheet.getRange(...).getValues() di Kode.gs.
 * @param {string} sheetName nama tab, mis. "db_admin"
 * @param {string} range mis. "A2:H" (mulai baris 2 supaya header dilewati)
 */
async function bacaSheet(sheetsClient, spreadsheetId, sheetName, range) {
  const res = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${range}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res.data.values || [];
}

/** Ambil daftar nama semua tab sheet dalam satu spreadsheet (dipakai untuk cari sheet db_<tahun> arsip). */
async function daftarNamaSheet(sheetsClient, spreadsheetId) {
  const res = await sheetsClient.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  return (res.data.sheets || []).map((s) => s.properties.title);
}

module.exports = { buatKlienSheets, bacaSheet, daftarNamaSheet };
