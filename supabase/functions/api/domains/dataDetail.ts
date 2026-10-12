import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { SS_ID_PENYIMPANAN, TAHUN_AKTIF } from "../_shared/config.ts";
import {
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";
import { ambilAccessTokenGoogleSheets } from "../../_shared/googleAuth.ts";
import { formatTanggalDDMMYYYY, formatTanggalWaktuWIB, tentukanTglStatusDataDetail } from "../_shared/tanggal.ts";

// ---------------------------------------------------------------------------
// Fitur "Data Detail" — dibangun ulang 2026-09-15 sebagai fitur murni Supabase (pengganti
// sheet eksternal "Data Detail" + formula QUERY() yang lama, yang sudah dihapus total). Beda
// dari fitur lama (per-baris, dicocokkan by NIK): ini SATU tombol di header tab Lihat Data
// yang menampilkan REKAP seluruh penerima berstatus "Memenuhi Syarat" yang bisa diakses user,
// dipakai sebagai sumber proses Pembayaran di luar aplikasi ini.
//
// `status`/`tgl_status` pada tabel `data_detail` SENGAJA tidak pernah ditulis di sini setelah
// baris dibuat (selalu default 'AKTIF') — itu wewenang Aplikasi Retur begitu nanti tersambung
// ke database yang sama.
//
// Kolom "Tgl Status" yang TAMPIL mengikuti Tanggal SK Wali Kota (Tools > Tanggal SK) untuk baris
// berstatus AKTIF tahun aktif -- dihitung saat membaca (lihat tentukanTglStatusDataDetail di
// _shared/tanggal.ts), bukan ditulis ke database, jadi begitu Tanggal SK disimpan tampilan langsung
// ikut (simpanReferensiSkWalikota membuang cache domain data_detail, lihat api-bridge.js).
//
// Parameter `tahun` (2026-09-22): awalnya fungsi ini SELALU terkunci ke TAHUN_AKTIF, tidak
// peduli tahun yang sedang dipilih user di dropdown "Lihat Data" — akibatnya tombol "Data Detail"
// diam-diam menampilkan rekap tahun aktif (dan waktu itu masih kosong) walau user sedang melihat
// tahun historis (mis. 2026), tanpa pesan error apa pun ("Belum ada data Memenuhi Syarat" padahal
// tahun yang dilihat sebenarnya punya data). Sekarang menerima tahun eksplisit dari frontend,
// fallback ke TAHUN_AKTIF kalau tidak dikirim (kompatibel dengan pemanggil lama). Butuh partisi
// data_detail_<tahun> sudah ada (lihat migrasi 20260922090000_partisi_data_detail_2026.sql) —
// kalau belum, insert sinkronisasi di bawah akan gagal dengan error partisi dari Postgres.
//
// Status kelayakan `IN ('Memenuhi Syarat', 'AKTIF')` (2026-09-22): tahun arsip yang di-backfill
// dari sheet db_<tahun> lama (mis. 2026, lihat scripts/backfill/steps/06_arsip_tahun_lalu.js)
// TIDAK PERNAH punya status_verifikasi = 'Memenuhi Syarat' — kosakata arsip pakai 'AKTIF' sebagai
// status "lolos"-nya, digabung jadi satu (beda dari alur verifikasi tahun berjalan yang punya
// tahap terpisah Proses Verifikasi/Memenuhi Syarat/dst). SENGAJA bukan cabang "kalau tahun aktif
// pakai X, kalau bukan pakai Y" — itu akan rusak begitu TAHUN_AKTIF sekarang (mis. 2027) nanti
// pensiun jadi arsip: baris-barisnya TETAP berlabel 'Memenuhi Syarat' apa adanya (tidak ada proses
// yang menulis ulang label saat pergantian tahun), jadi tetap harus dicek juga. Daftar IN() ini
// aman untuk semua tahun tanpa perlu direvisi lagi tiap pergantian TAHUN_AKTIF — tidak berisiko ke
// proses Pembayaran karena buatBatchPembayaran() (pembayaran.ts) selalu hardcode ke TAHUN_AKTIF,
// tidak pernah baca tahun yang sedang dilihat di sini.
const STATUS_LOLOS_DATA_DETAIL = ["Memenuhi Syarat", "AKTIF"];

const NAMA_SHEET_ARSIP = "Arsip Data Detail";

const HEADER_ARSIP_DATA_DETAIL = [
  "ID", "TAHUN", "NAMA", "NIK", "JENIS KELAMIN", "TEMPAT LAHIR", "TANGGAL LAHIR",
  "ALAMAT", "LAYANAN", "TEMPAT TUGAS", "ALAMAT TUGAS", "KECAMATAN", "KELURAHAN",
  "NAMA REKENING", "NOMOR REKENING", "KANTOR CABANG", "NO KONTAK", "STATUS BPJS", "UMUR",
  "STATUS (DATA DETAIL)", "WAKTU_ARSIP", "ALASAN", "DIARSIP_OLEH",
];

// ---------------------------------------------------------------------------
// arsipkanDataDetail: backup baris ke sheet "Arsip Data Detail" di Google
// Sheets lalu hapus dari tabel data_detail. Bersifat best-effort — kegagalan
// backup ke Sheets TIDAK mencegah DELETE di DB (konsisten dengan pola
// backup-spreadsheet yang juga non-blocking untuk log). Bisa dipanggil
// dengan 1 ID atau banyak sekaligus.
// ---------------------------------------------------------------------------
export async function arsipkanDataDetail(
  penerimaIds: number[],
  alasan: string,
  tahun: number,
  diarsipOleh = "SISTEM",
): Promise<{ sukses: boolean; jumlahDihapus: number; pesan?: string }> {
  if (!penerimaIds || penerimaIds.length === 0) return { sukses: true, jumlahDihapus: 0 };

  try {
    // 1. Baca baris data_detail yang akan diarsipkan
    const rows = await sql`
      select id, penerima_id, tahun, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir,
             alamat, layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan,
             nama_rekening, nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk,
             umur, status
      from data_detail
      where tahun = ${tahun} and penerima_id = any(${penerimaIds}::bigint[])
    `;

    if (rows.length === 0) {
      // Tidak ada di data_detail — tidak perlu arsip, tapi bukan error
      return { sukses: true, jumlahDihapus: 0 };
    }

    const waktuArsip = formatTanggalWaktuWIB(new Date().toISOString());

    // 2. Format baris untuk dikirim ke Google Sheets
    const barisArsip = rows.map((r: Record<string, unknown>) => [
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
      String(r.status || "AKTIF"),
      waktuArsip,
      alasan,
      diarsipOleh,
    ]);

    // 3. Kirim ke Google Sheets (best-effort — gagal tidak batalkan DELETE)
    try {
      const accessToken = await ambilAccessTokenGoogleSheets();
      const spreadsheetId = SS_ID_PENYIMPANAN;

      // Pastikan tab arsip tersedia (auto-create)
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title)`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const sheetsAda = new Set(
          ((meta?.sheets || []) as Array<{ properties?: { title?: string } }>)
            .map((s) => s.properties?.title),
        );
        if (!sheetsAda.has(NAMA_SHEET_ARSIP)) {
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ requests: [{ addSheet: { properties: { title: NAMA_SHEET_ARSIP } } }] }),
            },
          );
          // Tulis baris header di tab baru
          await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(NAMA_SHEET_ARSIP + "!A1")}?valueInputOption=USER_ENTERED`,
            {
              method: "PUT",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ values: [HEADER_ARSIP_DATA_DETAIL] }),
            },
          );
        }
      }

      // Append baris arsip ke sheet
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(NAMA_SHEET_ARSIP + "!A:W")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ values: barisArsip }),
        },
      );
    } catch (errSheet) {
      // Non-blocking: gagal kirim ke Sheets tidak batalkan penghapusan di DB
      console.error("dataDetail arsipkanDataDetail: gagal backup ke Google Sheets:", errSheet);
    }

    // 4. Catat ke tabel log_arsip_data_detail — satu batch INSERT, bukan loop per baris
    // (best-effort: gagal tidak batalkan DELETE, tapi tabel ini mungkin belum ada
    //  sebelum migrasi dijalankan — error akan muncul di console log saja).
    try {
      if (rows.length === 1) {
        const r = rows[0];
        await sql`
          insert into log_arsip_data_detail (penerima_id, tahun, nik, nama, alasan, diarsip_oleh)
          values (${r.penerima_id as number}, ${tahun}, ${r.nik as string}, ${r.nama as string}, ${alasan}, ${diarsipOleh})
        `;
      } else {
        // Batch: bangun VALUES list secara eksplisit karena sql tag tidak mendukung
        // array-of-tuples secara native — loop singkat masih lebih aman daripada string concat.
        for (const r of rows) {
          await sql`
            insert into log_arsip_data_detail (penerima_id, tahun, nik, nama, alasan, diarsip_oleh)
            values (${r.penerima_id as number}, ${tahun}, ${r.nik as string}, ${r.nama as string}, ${alasan}, ${diarsipOleh})
          `;
        }
      }
    } catch (errLog) {
      console.error("dataDetail arsipkanDataDetail: gagal insert log_arsip_data_detail:", errLog);
    }

    // 5. Hapus dari data_detail
    await sql`
      delete from data_detail
      where tahun = ${tahun} and penerima_id = any(${penerimaIds}::bigint[])
    `;

    return { sukses: true, jumlahDihapus: rows.length };
  } catch (err) {
    console.error("dataDetail arsipkanDataDetail: gagal:", err);
    return { sukses: false, jumlahDihapus: 0, pesan: String(err) };
  }
}
/**
 * Pastikan setiap penerima yang sudah lolos verifikasi punya baris di `data_detail` (idempoten: ON CONFLICT DO NOTHING).
 * Dulu logika ini hanya jalan saat seseorang membuka tombol "Data Detail", sehingga penerima yang baru diverifikasi tidak
 * ada di `data_detail` sampai saat itu -- dan fitur lain yang membaca data_detail (Retur: cari NIK, impor rekening bank)
 * tidak menemukannya. Sekarang dapat dipanggil dari mana saja; pengecekan awal (anti-join) murah (±22 ms).
 */
export async function pastikanDataDetailTersinkron(tahun: number): Promise<void> {
  const tahunDiminta = Number(tahun) || TAHUN_AKTIF;

  // === Sweep: hapus baris data_detail yang statusnya sudah tidak lolos ===
  // Jaring pengaman untuk inkonsistensi lama (sebelum arsipkanDataDetail diterapkan)
  // maupun kasus edge (mis. perubahan status di luar verifikasiSatuData).
  // Hanya berjalan untuk tahun aktif — arsip (2026 dst.) statusnya memang 'AKTIF',
  // tidak ada alur yang mengubahnya ke non-lolos, jadi aman di-skip.
  if (tahunDiminta === TAHUN_AKTIF) {
    const yangTidakLolos = await sql`
      select d.penerima_id
      from data_detail d
      join penerima p on p.id = d.penerima_id and p.tahun = d.tahun
      where d.tahun = ${tahunDiminta}
        and p.status_verifikasi not in ${sql(STATUS_LOLOS_DATA_DETAIL)}
    `;
    if (yangTidakLolos.length > 0) {
      const ids = yangTidakLolos.map((r: Record<string, unknown>) => Number(r.penerima_id));
      await arsipkanDataDetail(
        ids,
        "Sinkronisasi otomatis — status tidak lagi Memenuhi Syarat",
        tahunDiminta,
        "SISTEM",
      );
    }
  }

  // === Insert: tambah baris yang belum ada di data_detail ===
  const adaYangKurang = await sql`
    select exists (
      select 1 from penerima p
      where p.tahun = ${tahunDiminta} and p.status_verifikasi in ${sql(STATUS_LOLOS_DATA_DETAIL)}
        and not exists (select 1 from data_detail d where d.tahun = p.tahun and d.penerima_id = p.id)
    ) as ada
  `;
  if (adaYangKurang[0]?.ada) {
    await sql`
      insert into data_detail (
        tahun, penerima_id, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir,
        alamat, layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening,
        nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk, umur,
        kecamatan_domisili, kelurahan_domisili
      )
      select
        p.tahun, p.id, p.nama, p.nik, p.jenis_kelamin, p.tempat_lahir, p.tanggal_lahir,
        p.alamat, p.layanan, p.tempat_tugas, p.alamat_tugas, p.kecamatan, p.kelurahan,
        p.nama_rekening, p.nomor_rekening, p.kantor_cabang, p.no_kontak, p.status_bpjs_tk, p.umur,
        p.kecamatan_domisili, p.kelurahan_domisili
      from penerima p
      where p.tahun = ${tahunDiminta} and p.status_verifikasi in ${sql(STATUS_LOLOS_DATA_DETAIL)}
      on conflict (tahun, penerima_id) do nothing
    `;
  }
}

export async function ambilDataDetail(token: string, tahun?: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const tahunDiminta = Number(tahun) || TAHUN_AKTIF;

  try {
    // Sinkron dulu (lihat pastikanDataDetailTersinkron di atas): penerima "Memenuhi Syarat" yang belum punya baris data_detail.
    await pastikanDataDetailTersinkron(tahunDiminta);

    const namaKecamatanPengguna = sesi.kecamatan || "";
    const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
    const subFilterGsm = subFilterGsmDari(sesi);

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return { sukses: false, pesan: "Peran tidak dikenali." };
    }

    // Tanggal SK Wali Kota (satu baris referensi, bukan per tahun) -- sumber nilai "Tgl Status".
    const refSk = await sql`select tanggal_sk from referensi_sk_walikota where id = 1`;
    const tanggalSk = refSk[0]?.tanggal_sk ?? null;

    // Sengaja TIDAK mendorong filter kecamatan/layanan ke WHERE SQL (beda dari optimasi yang
    // pernah dicoba di ambilDataLihatDataHakAkses dan menyebabkan insiden produksi) — tarik
    // semua baris tahun aktif, filter akses di kode, sampai ada cara uji lokal yang layak
    // sebelum optimasi semacam itu diulang.
    const rows = await sql`
      select nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat, layanan,
             tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening, nomor_rekening,
             kantor_cabang, no_kontak, status_bpjs_tk, umur, status, tgl_status
      from data_detail
      where tahun = ${tahunDiminta}
      order by id
    `;

    // deno-lint-ignore no-explicit-any
    const hasil: any[] = [];
    for (const row of rows) {
      const layananSheet = (row.layanan || "").toUpperCase();
      const kecamatanSheet = (row.kecamatan || "").toUpperCase();
      const kelurahanSheet = (row.kelurahan || "").toUpperCase();
      const tempatTugasSheet = (row.tempat_tugas || "").toUpperCase();

      const lolos = lolosAksesBarisLihatData({
        instansiPengguna,
        layananPengguna,
        namaKecamatanPengguna,
        kelurahanTerkunci,
        subFilterGsm,
        listLayananKemenag,
        layananSheet,
        kecamatanSheet,
        kelurahanSheet,
        tempatTugasSheet,
      });
      if (!lolos) continue;

      hasil.push({
        nama: row.nama,
        nik: row.nik,
        jenisKelamin: row.jenis_kelamin,
        tempatLahir: row.tempat_lahir,
        tanggalLahir: formatTanggalDDMMYYYY(row.tanggal_lahir),
        alamat: row.alamat,
        layanan: row.layanan,
        tempatTugas: row.tempat_tugas,
        alamatTugas: row.alamat_tugas,
        kecamatan: row.kecamatan,
        kelurahan: row.kelurahan,
        namaRekening: row.nama_rekening,
        nomorRekening: row.nomor_rekening,
        kantorCabang: row.kantor_cabang,
        noKontak: (row.no_kontak || "").toString().replace(/^'+/, "").trim(),
        statusBpjsTk: row.status_bpjs_tk,
        umur: row.umur ?? "",
        status: row.status,
        tglStatus: tentukanTglStatusDataDetail({
          tahunBaris: tahunDiminta,
          tahunAktif: TAHUN_AKTIF,
          status: row.status,
          tglStatus: row.tgl_status,
          tanggalSk,
        }),
      });
    }

    return { sukses: true, rows: hasil, tahun: tahunDiminta };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
