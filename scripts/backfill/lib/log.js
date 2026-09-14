"use strict";

function info(pesan) {
  console.log("  " + pesan);
}

function judul(nama) {
  console.log("\n=== " + nama + " ===");
}

/** Cetak ringkasan hasil satu step: berapa baris dibaca dari Sheets vs berapa ditulis/dilewati. */
function ringkasan({ sheetDibaca, ditulis, dilewati = 0, mode }) {
  console.log(
    `  Sheets dibaca: ${sheetDibaca} baris | ${mode === "write" ? "Ditulis ke Postgres" : "AKAN ditulis (dry-run)"}: ${ditulis} | Dilewati (kosong/invalid): ${dilewati}`,
  );
}

module.exports = { info, judul, ringkasan };
