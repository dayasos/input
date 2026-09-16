import { wajibSesi } from "../_shared/sesi.ts";
import {
  muatExcelJS,
  terapkanBorderData,
  terapkanGayaHeaderKolom,
} from "../_shared/excelGaya.ts";

// ---------------------------------------------------------------------------
// Port dari eksporDataKeSpreadsheet() — Kode.gs baris 1519-1606.
//
// PERUBAHAN ARSITEKTUR: Kode.gs membuat Google Sheet sementara, mengkonversi ke XLSX via
// Drive API, lalu menghapus sheet. Di Supabase, kita langsung membuat XLSX di memory
// menggunakan `exceljs` (Deno-compatible) — jauh lebih cepat dan tidak memerlukan
// akses Google Drive/Sheets sama sekali.
//
// 2026-09-16: diganti dari `xlsx` (SheetJS Community Edition, tidak menyimpan gaya sel) ke
// `exceljs`, memakai helper styling yang sama dengan halaman Tools (domains/pembayaran.ts) --
// supaya semua dokumen Excel yang dihasilkan aplikasi ini konsisten tampilannya (header tebal +
// border + latar, border pada data, baris header dibekukan), bukan cuma yang untuk pembayaran.
//
// Kontrak respons IDENTIK: { sukses: true, base64: string, namaFile: string }
// Frontend index.html membuat link download dari base64 ini.
// ---------------------------------------------------------------------------

// Header kolom sesuai Kode.gs baris 1530-1534
const HEADER_EKSPOR = [
  "NO", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR", "ALAMAT",
  "JENIS LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
  "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO. KONTAK", "STATUS BPJS TK", "UMUR",
];

export async function eksporDataKeSpreadsheet(
  token: string,
  dataRows: unknown[][],
  namaFile: string,
) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    // Bersihkan & normalkan setiap baris (port Kode.gs baris 1545-1559)
    const rowsToExport: unknown[][] = [];
    for (const r of dataRows) {
      const row = Array.isArray(r) ? [...r] : [];

      // Pastikan panjang sama dengan header
      while (row.length < HEADER_EKSPOR.length) row.push("");
      const rowTrimmed = row.slice(0, HEADER_EKSPOR.length);

      // Bersihkan leading-quote untuk NIK (idx 2), rekening (idx 13), kontak (idx 15)
      rowTrimmed[2] = rowTrimmed[2] != null ? String(rowTrimmed[2]).replace(/^'+/, "").trim() : "";
      rowTrimmed[5] = rowTrimmed[5] != null ? String(rowTrimmed[5]).trim() : "";
      rowTrimmed[13] = rowTrimmed[13] != null ? String(rowTrimmed[13]).replace(/^'+/, "").trim() : "";
      rowTrimmed[15] = rowTrimmed[15] != null ? String(rowTrimmed[15]).replace(/^'+/, "").trim() : "";

      // TIDAK di-prefix "'" seperti Kode.gs baris 1553-1555. Trik itu khusus Google Sheets API
      // (setValues() menafsirkan awalan kutip sebagai "paksa format teks" dan MEMBUANG kutipnya).
      // exceljs (sama seperti xlsx sebelumnya) TIDAK mengenal konvensi itu -- nilai string JS
      // biasa sudah otomatis tersimpan sebagai sel bertipe teks berdasarkan typeof, tanpa perlu
      // trik apa pun, jadi tidak ada risiko notasi ilmiah.
      rowsToExport.push(rowTrimmed);
    }

    const ExcelJS = await muatExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Rekap Penerima");

    const jumlahKolom = HEADER_EKSPOR.length;
    ws.addRows([HEADER_EKSPOR, ...rowsToExport]);
    ws.columns = HEADER_EKSPOR.map((h) => ({ width: Math.max(h.length + 2, 15) }));

    const barisHeader = 1;
    terapkanGayaHeaderKolom(ws, barisHeader, jumlahKolom);
    if (rowsToExport.length > 0) {
      terapkanBorderData(ws, barisHeader + 1, barisHeader + rowsToExport.length, jumlahKolom);
    }
    ws.views = [{ state: "frozen", ySplit: barisHeader }];

    const xlsxBufferMentah = await wb.xlsx.writeBuffer();
    const xlsxBuffer: Uint8Array = xlsxBufferMentah instanceof Uint8Array
      ? xlsxBufferMentah
      : new Uint8Array(xlsxBufferMentah);

    // Encode ke base64 secara chunked agar aman untuk data ribuan baris (hindari RangeError call stack limit)
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < xlsxBuffer.length; i += chunk) {
      binary += String.fromCharCode(...xlsxBuffer.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return { sukses: true, base64, namaFile: namaFile + ".xlsx" };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}
