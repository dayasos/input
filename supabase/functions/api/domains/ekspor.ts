import { wajibSesi } from "../_shared/sesi.ts";

// ---------------------------------------------------------------------------
// Port dari eksporDataKeSpreadsheet() — Kode.gs baris 1519-1606.
//
// PERUBAHAN ARSITEKTUR: Kode.gs membuat Google Sheet sementara, mengkonversi ke XLSX via
// Drive API, lalu menghapus sheet. Di Supabase, kita langsung membuat XLSX di memory
// menggunakan library `xlsx` (Deno-compatible) — jauh lebih cepat dan tidak memerlukan
// akses Google Drive/Sheets sama sekali.
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
    // Dinamis import npm:xlsx supaya tidak load saat startup
    // deno-lint-ignore no-explicit-any
    const XLSX: any = await import("npm:xlsx@0.18.5");

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
      // SheetJS (aoa_to_sheet) TIDAK mengenal konvensi itu — nilai string JS biasa sudah otomatis
      // tersimpan sebagai sel bertipe teks (t:'s') berdasarkan typeof, tanpa perlu trik apa pun,
      // jadi tidak ada risiko notasi ilmiah. Kalau kutipnya tetap ditambahkan di sini, ada bug
      // SheetJS yang terdokumentasi (isu #3025) untuk pola string-angka+kutip-depan persis ini —
      // berisiko NIK/rekening/kontak di file Excel hasil ekspor malah kepentok kutip yang salah.
      rowsToExport.push(rowTrimmed);
    }

    // Buat worksheet: header + data
    const wsData = [HEADER_EKSPOR, ...rowsToExport];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set lebar kolom
    ws["!cols"] = HEADER_EKSPOR.map((h: string) => ({ wch: Math.max(h.length + 2, 15) }));

    // Buat workbook & tambah sheet
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Penerima");

    // Tulis ke buffer binary (format xlsx)
    const xlsxBuffer: Uint8Array = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

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
