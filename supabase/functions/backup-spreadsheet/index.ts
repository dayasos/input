// ============================================================================
// Edge Function: backup-spreadsheet
// Snapshot Generator & Disaster Recovery Auto-Backup ke Google Spreadsheet 3x Sehari
// Jadwal: 08.00 WIB, 16.00 WIB, 00.00 WIB (via PostgreSQL pg_cron + pg_net)
// Menggunakan 1 panggilan batchUpdate tunggal (hemat kuota Google Sheets API v4)
// ============================================================================

import { sql } from "../_shared/db.ts";
import { SS_ID_PENYIMPANAN, TAHUN_AKTIF } from "../_shared/config.ts";
import { formatTanggalDDMMYYYY, formatTanggalWaktuWIB } from "../_shared/tanggal.ts";
import { ambilAccessTokenGoogleSheets } from "../_shared/googleAuth.ts";

const HEADER_PENERIMA_40_KOLOM = [
  "NO", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR", "ALAMAT DOMISILI",
  "JENIS LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
  "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO. KONTAK", "STATUS BPJS", "UMUR",
  "KTP", "BUKU REKENING", "SURAT PERMOHONAN", "SURAT PERNYATAAN", "DOMISILI KELURAHAN",
  "FORMULIR PENDATAAN", "BERKAS PENDUKUNG", "FOTO PLANK", "FOTO LOKASI", "FOTO KEGIATAN",
  "REKOMENDASI BKM", "REKOMENDASI RUMAH IBADAH", "ID FOLDER BERKAS", "KOORDINAT LOKASI",
  "STATUS VERIFIKASI", "KETERANGAN VERIFIKASI", "TANGGAL VERIFIKASI", "DIVERIFIKASI OLEH",
  "BATAS WAKTU PERBAIKAN", "CATATAN PERBEDAAN NAMA", "TANGGAL LAPOR PERBAIKAN", "DILAPOR OLEH"
];

const HEADER_DATA_DETAIL = [
  "ID", "TAHUN", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR",
  "ALAMAT", "LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
  "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO KONTAK", "STATUS BPJS", "UMUR",
  "STATUS", "TANGGAL VERIFIKASI"
];

const HEADER_KUOTA = [
  "KECAMATAN", "LAYANAN", "KUOTA MAKS"
];

const HEADER_LOG = [
  "WAKTU (WIB)", "JUMLAH BARIS PENERIMA", "DURASI (MS)", "STATUS", "KETERANGAN"
];

function barisKeArraySheet(r: Record<string, unknown>): unknown[] {
  const teks = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const kutip = (v: unknown) => {
    const s = teks(v);
    return s ? "'" + s : "";
  };

  return [
    r.nomor_urut ?? "",
    teks(r.nama),
    kutip(r.nik),
    teks(r.jenis_kelamin),
    teks(r.tempat_lahir),
    formatTanggalDDMMYYYY(r.tanggal_lahir as string),
    teks(r.alamat),
    teks(r.layanan),
    teks(r.tempat_tugas),
    teks(r.alamat_tugas),
    teks(r.kecamatan),
    teks(r.kelurahan),
    teks(r.nama_rekening),
    kutip(r.nomor_rekening),
    teks(r.kantor_cabang),
    kutip(r.no_kontak),
    teks(r.status_bpjs_tk),
    r.umur ?? "",
    teks(r.link_ktp),
    teks(r.link_buku_rekening),
    teks(r.link_surat_permohonan),
    teks(r.link_pernyataan_satu_bantuan),
    teks(r.link_domisili_kelurahan),
    teks(r.link_formulir_pendataan),
    teks(r.link_berkas_pendukung),
    teks(r.link_foto_plank_rumah_ibadah),
    teks(r.link_foto_lokasi_ibadah),
    teks(r.link_foto_kegiatan_belajar),
    teks(r.link_rekomendasi_bkm),
    teks(r.link_rekomendasi_rumah_ibadah),
    teks(r.id_folder_berkas),
    teks(r.link_koordinat_lokasi),
    teks(r.status_verifikasi),
    teks(r.keterangan_verifikasi),
    formatTanggalWaktuWIB(r.tanggal_verifikasi as string),
    teks(r.diverifikasi_oleh),
    formatTanggalDDMMYYYY(r.batas_waktu_perbaikan as string),
    teks(r.catatan_perbedaan_nama),
    formatTanggalWaktuWIB(r.tanggal_lapor_perbaikan as string),
    teks(r.dilapor_oleh),
  ];
}

// ============================================================================
// Smart Non-Destructive Merge: Penerima (40 Kolom)
// Pertahankan seluruh baris lama di spreadsheet; upsert berbasis NIK.
// Data lama di sheet yang tidak ada di DB tidak akan pernah tertimpa/dihapus.
// ============================================================================
function smartMergePenerima(
  existingSheetData: unknown[][],
  freshRows: unknown[][],
  headerDefault: string[],
): { values: unknown[][]; stats: { updated: number; appended: number; preserved: number } } {
  const result: unknown[][] = [];

  if (!existingSheetData || existingSheetData.length === 0) {
    result.push(headerDefault, ...freshRows);
    return {
      values: result,
      stats: { updated: 0, appended: freshRows.length, preserved: 0 },
    };
  }

  // Salin data lama sheet apa adanya
  for (const r of existingSheetData) {
    result.push(Array.isArray(r) ? [...r] : [r]);
  }

  // Baris 0 adalah header
  if (result.length === 0 || !Array.isArray(result[0]) || result[0].length === 0) {
    result[0] = headerDefault;
  }

  // Peta NIK ke nomor baris di sheet (Kolom C / indeks 2)
  const nikMap = new Map<string, number>();
  for (let i = 1; i < result.length; i++) {
    const row = result[i];
    if (Array.isArray(row) && row.length > 2) {
      const rawNik = String(row[2] || "").replace(/^'/, "").trim();
      if (rawNik) nikMap.set(rawNik, i);
    }
  }

  let updated = 0;
  let appended = 0;
  const processedNiks = new Set<string>();

  for (const newRow of freshRows) {
    const rawNik = String((newRow as unknown[])[2] || "").replace(/^'/, "").trim();
    if (rawNik && nikMap.has(rawNik)) {
      const existingIdx = nikMap.get(rawNik)!;
      result[existingIdx] = newRow;
      updated++;
      processedNiks.add(rawNik);
    } else {
      result.push(newRow);
      appended++;
      if (rawNik) processedNiks.add(rawNik);
    }
  }

  const totalDataRows = Math.max(0, result.length - 1);
  const preserved = Math.max(0, totalDataRows - updated - appended);

  return { values: result, stats: { updated, appended, preserved } };
}

// ============================================================================
// Smart Non-Destructive Merge: Data Detail (21 Kolom)
// ============================================================================
function smartMergeDetail(
  existingSheetData: unknown[][],
  freshRows: unknown[][],
  headerDefault: string[],
): { values: unknown[][]; stats: { updated: number; appended: number; preserved: number } } {
  const result: unknown[][] = [];
  if (!existingSheetData || existingSheetData.length === 0) {
    result.push(headerDefault, ...freshRows);
    return {
      values: result,
      stats: { updated: 0, appended: freshRows.length, preserved: 0 },
    };
  }

  for (const r of existingSheetData) {
    result.push(Array.isArray(r) ? [...r] : [r]);
  }

  if (result.length === 0 || !Array.isArray(result[0]) || result[0].length === 0) {
    result[0] = headerDefault;
  }

  // Peta NIK (indeks 3) atau ID (indeks 0)
  const keyMap = new Map<string, number>();
  for (let i = 1; i < result.length; i++) {
    const row = result[i];
    if (Array.isArray(row)) {
      const nik = String(row[3] || "").replace(/^'/, "").trim();
      const id = String(row[0] || "").trim();
      const k = nik || id;
      if (k) keyMap.set(k, i);
    }
  }

  let updated = 0;
  let appended = 0;

  for (const newRow of freshRows) {
    const nik = String((newRow as unknown[])[3] || "").replace(/^'/, "").trim();
    const id = String((newRow as unknown[])[0] || "").trim();
    const k = nik || id;

    if (k && keyMap.has(k)) {
      result[keyMap.get(k)!] = newRow;
      updated++;
    } else {
      result.push(newRow);
      appended++;
    }
  }

  const preserved = Math.max(0, (result.length - 1) - updated - appended);
  return { values: result, stats: { updated, appended, preserved } };
}

// ============================================================================
// Smart Non-Destructive Merge: Kuota (3 Kolom)
// ============================================================================
function smartMergeKuota(
  existingSheetData: unknown[][],
  freshRows: unknown[][],
  headerDefault: string[],
): { values: unknown[][]; stats: { updated: number; appended: number; preserved: number } } {
  const result: unknown[][] = [];
  if (!existingSheetData || existingSheetData.length === 0) {
    result.push(headerDefault, ...freshRows);
    return {
      values: result,
      stats: { updated: 0, appended: freshRows.length, preserved: 0 },
    };
  }

  for (const r of existingSheetData) {
    result.push(Array.isArray(r) ? [...r] : [r]);
  }

  if (result.length === 0 || !Array.isArray(result[0]) || result[0].length === 0) {
    result[0] = headerDefault;
  }

  const keyMap = new Map<string, number>();
  for (let i = 1; i < result.length; i++) {
    const row = result[i];
    if (Array.isArray(row) && row.length >= 2) {
      const key = `${String(row[0] || "").trim().toUpperCase()}|${String(row[1] || "").trim().toUpperCase()}`;
      keyMap.set(key, i);
    }
  }

  let updated = 0;
  let appended = 0;

  for (const newRow of freshRows) {
    const key = `${String((newRow as unknown[])[0] || "").trim().toUpperCase()}|${String((newRow as unknown[])[1] || "").trim().toUpperCase()}`;
    if (keyMap.has(key)) {
      result[keyMap.get(key)!] = newRow;
      updated++;
    } else {
      result.push(newRow);
      appended++;
    }
  }

  const preserved = Math.max(0, (result.length - 1) - updated - appended);
  return { values: result, stats: { updated, appended, preserved } };
}

async function pastikanSheetTersedia(spreadsheetId: string, accessToken: string, daftarJudul: string[]) {
  try {
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    const sheetsAda = new Set(
      ((meta && meta.sheets) || []).map((s: { properties?: { title?: string } }) => s.properties?.title),
    );

    const requests = [];
    for (const judul of daftarJudul) {
      if (!sheetsAda.has(judul)) {
        requests.push({
          addSheet: {
            properties: { title: judul },
          },
        });
      }
    }

    if (requests.length > 0) {
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      });
    }
  } catch (_e) {
    // Non-blocking fallback
  }
}

Deno.serve(async (req: Request) => {
  const mulai = Date.now();
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-sync-secret",
      },
    });
  }

  // Verifikasi Secret
  const secretHeader = req.headers.get("x-sync-secret") || "";
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const expectedSecret = Deno.env.get("SYNC_WORKER_SECRET") || Deno.env.get("GAS_SECRET_TOKEN") || "DJPM2027_BACKUP_SECRET";

  if (secretHeader !== expectedSecret && token !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized: Kredensial tidak sah" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let mode = "SCHEDULED";
  try {
    const body = await req.json().catch(() => ({}));
    if (body && body.mode) mode = String(body.mode).toUpperCase();
  } catch (_e) {
    // default SCHEDULED
  }

  try {
    // 1. Ambil data snapshot penerima aktif dari PostgreSQL
    const rowsPenerima = await sql`
      select * from penerima
      where tahun = ${TAHUN_AKTIF}
      order by nomor_urut asc, id asc
    `;

    // 2. Ambil data snapshot data_detail (Memenuhi Syarat) dari PostgreSQL
    const rowsDetail = await sql`
      select * from data_detail
      where tahun = ${TAHUN_AKTIF}
      order by id asc
    `;

    // 3. Ambil data snapshot kuota dari PostgreSQL
    const rowsKuota = await sql`
      select kecamatan, layanan, kuota_maks
      from kuota
      order by kecamatan asc, layanan asc
    `;

    // 4. Format baris baru ke struktur array
    const freshPenerimaRows = rowsPenerima.map(barisKeArraySheet);

    const freshDetailRows = rowsDetail.map((r: Record<string, unknown>) => [
      r.id ?? "",
      r.tahun ?? "",
      String(r.nama || ""),
      r.nik ? "'" + String(r.nik) : "",
      String(r.jenis_kelamin || ""),
      String(r.tempat_lahir || ""),
      formatTanggalDDMMYYYY(r.tanggal_lahir as string),
      String(r.alamat || ""),
      String(r.layanan || ""),
      String(r.tempat_tugas || ""),
      String(r.alamat_tugas || ""),
      String(r.kecamatan || ""),
      String(r.kelurahan || ""),
      String(r.nama_rekening || ""),
      r.nomor_rekening ? "'" + String(r.nomor_rekening) : "",
      String(r.kantor_cabang || ""),
      r.no_kontak ? "'" + String(r.no_kontak) : "",
      String(r.status_bpjs_tk || ""),
      r.umur ?? "",
      String(r.status || ""),
      formatTanggalWaktuWIB((r.tgl_status || r.tanggal_verifikasi) as string),
    ]);

    const freshKuotaRows = rowsKuota.map((r: Record<string, unknown>) => [
      String(r.kecamatan || ""),
      String(r.layanan || ""),
      Number(r.kuota_maks) || 0,
    ]);

    // 5. Autentikasi Google Sheets API v4
    const accessToken = await ambilAccessTokenGoogleSheets();
    const spreadsheetId = SS_ID_PENYIMPANAN;

    const sheetPenerima = `Data Input ${TAHUN_AKTIF}`;
    const sheetDataDetail = "Data Detail";
    const sheetKuota = "Kuota";
    const sheetLog = "Log_Backup";

    // Pastikan seluruh tab tujuan tersedia di spreadsheet, auto-create jika belum ada
    await pastikanSheetTersedia(spreadsheetId, accessToken, [
      sheetPenerima,
      sheetDataDetail,
      sheetKuota,
      sheetLog,
    ]);

    // 6. Baca data eksisting dari Google Sheets (1x batchGet tunggal)
    const rangesToRead = [
      `${sheetPenerima}!A:AN`,
      `${sheetDataDetail}!A:U`,
      `${sheetKuota}!A:C`,
    ];
    const resGet = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?` +
      rangesToRead.map((r) => `ranges=${encodeURIComponent(r)}`).join("&"),
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    const readData = resGet.ok ? await resGet.json() : { valueRanges: [] };
    const existingPenerima: unknown[][] = readData.valueRanges?.[0]?.values || [];
    const existingDetail: unknown[][] = readData.valueRanges?.[1]?.values || [];
    const existingKuota: unknown[][] = readData.valueRanges?.[2]?.values || [];

    // 7. Lakukan Smart Non-Destructive Merge (Tanpa Tertimpa)
    const mergedPenerima = smartMergePenerima(existingPenerima, freshPenerimaRows, HEADER_PENERIMA_40_KOLOM);
    const mergedDetail = smartMergeDetail(existingDetail, freshDetailRows, HEADER_DATA_DETAIL);
    const mergedKuota = smartMergeKuota(existingKuota, freshKuotaRows, HEADER_KUOTA);

    // 8. Tulis kembali ke Google Sheets menggunakan 1x batchUpdate tunggal
    const batchPayload = {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${sheetPenerima}!A1:AN${mergedPenerima.values.length}`,
          values: mergedPenerima.values,
        },
        {
          range: `${sheetDataDetail}!A1:U${mergedDetail.values.length}`,
          values: mergedDetail.values,
        },
        {
          range: `${sheetKuota}!A1:C${mergedKuota.values.length}`,
          values: mergedKuota.values,
        },
      ],
    };

    const resBatch = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batchPayload),
      },
    );

    if (!resBatch.ok) {
      const errText = await resBatch.text();
      throw new Error(`Google Sheets API Error (${resBatch.status}): ${errText}`);
    }

    const durasiMs = Date.now() - mulai;
    const waktuWIB = formatTanggalWaktuWIB(new Date().toISOString());

    const keteranganLog = `Smart Backup: ${mergedPenerima.stats.updated} diperbarui, ${mergedPenerima.stats.appended} baru, ${mergedPenerima.stats.preserved} lama dipertahankan. Total: ${mergedPenerima.values.length - 1} data.`;

    const logRow = [
      waktuWIB,
      mergedPenerima.values.length - 1,
      durasiMs,
      "SUKSES",
      keteranganLog,
    ];

    // 9. Append log ke tab Log_Backup
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetLog}!A:E:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [logRow] }),
      },
    ).catch(() => { /* non-blocking */ });

    // 10. Catat log ke tabel log_backup_sistem di PostgreSQL
    await sql`
      insert into log_backup_sistem (waktu, status, jumlah_baris, durasi_ms, mode, pesan_error)
      values (now(), 'SUKSES', ${mergedPenerima.values.length - 1}, ${durasiMs}, ${mode}, ${keteranganLog})
    `.catch(() => { /* non-blocking */ });

    return new Response(
      JSON.stringify({
        sukses: true,
        pesan: "Smart Backup Non-Destructive ke Google Spreadsheet berhasil.",
        statistikPenerima: mergedPenerima.stats,
        totalBarisPenerima: mergedPenerima.values.length - 1,
        durasiMs,
        waktuWIB,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const pesan = error instanceof Error ? error.message : String(error);
    const durasiMs = Date.now() - mulai;

    await sql`
      insert into log_backup_sistem (waktu, status, jumlah_baris, durasi_ms, mode, pesan_error)
      values (now(), 'GAGAL', 0, ${durasiMs}, ${mode}, ${pesan})
    `.catch(() => { /* non-blocking */ });

    return new Response(
      JSON.stringify({
        sukses: false,
        error: pesan,
        durasiMs,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});

