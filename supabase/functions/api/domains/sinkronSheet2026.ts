import { sql } from "../_shared/db.ts";
import { SS_ID_MASTER_DROPDOWN } from "../_shared/config.ts";
import { ambilAccessTokenGoogle } from "../../_shared/googleAuth.ts";
import { wajibSesi } from "../_shared/sesi.ts";

const TAHUN = 2026;
const NAMA_SHEET = "db_2026";
const UKURAN_BATCH = 400;
const ADVISORY_LOCK_ID = 20260923; // ID unik pengunci proses sinkronisasi 2026

function keTanggalIso(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    // Excel/Sheets serial number: jumlah hari sejak 1899-12-30
    const ms = Math.round((val - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  // Format DD/MM/YYYY atau DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const hari = m[1].padStart(2, "0");
    const bulan = m[2].padStart(2, "0");
    const tahun = m[3];
    return `${tahun}-${bulan}-${hari}`;
  }
  // Format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function angkaAtauNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

export async function sinkronDataSheet2026(token?: string) {
  // 1. Verifikasi sesi & hak akses jika dipanggil dari browser (UI)
  if (token) {
    let sesi;
    try {
      sesi = await wajibSesi(token);
    } catch (e) {
      return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
    }

    const role = (sesi.role || "").toString().trim().toUpperCase();
    if (role !== "UTAMA") {
      return {
        sukses: false,
        pesan: "Akses Ditolak: Hanya Admin Utama (Dinas Sosial) yang diizinkan menjalankan sinkronisasi data dari Google Sheets.",
      };
    }
  }

  // 2. Proteksi Concurrency Mutex: Cegah duplikasi proses jika admin klik berkali-kali atau bentrok dengan cron
  const lockResult = await sql`select pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as terkunci;`;
  if (!lockResult[0]?.terkunci) {
    return {
      sukses: true,
      pesan: "Sinkronisasi data 2026 sedang berlangsung di latar belakang, silakan tunggu beberapa detik...",
    };
  }

  const mulai = Date.now();

  try {
    // 3. Ambil access token Google API v4
    const accessToken = await ambilAccessTokenGoogle("https://www.googleapis.com/auth/spreadsheets.readonly");

    // 4. Baca seluruh baris dari Google Sheets API v4
    const urlSheets = `https://sheets.googleapis.com/v4/spreadsheets/${SS_ID_MASTER_DROPDOWN}/values/'${NAMA_SHEET}'!A2:S?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
    const resSheets = await fetch(urlSheets, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resSheets.ok) {
      const errTeks = await resSheets.text();
      throw new Error(`Gagal membaca Google Sheets API (${resSheets.status}): ${errTeks}`);
    }

    const dataSheets = await resSheets.json();
    const rawRows = (dataSheets.values || []) as unknown[][];

    if (rawRows.length === 0) {
      return { sukses: false, pesan: "Sheet db_2026 kosong atau tidak ditemukan data." };
    }

    // 5. Parsing & pemetaan 19 kolom secara presisi
    // deno-lint-ignore no-explicit-any
    const daftarData: any[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const nik = (r[2] || "").toString().trim();
      if (!nik) continue;

      const nomorUrut = angkaAtauNull(r[0]) || (i + 1);
      const statusVerifikasi = (r[18] || "").toString().trim().toUpperCase() || "TIDAK DIKETAHUI";

      daftarData.push({
        tahun: TAHUN,
        nomor_urut: nomorUrut,
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

    // 6. Transaksi Atomik: Batch Upsert & Penyelarasan Data Detail
    const totalBatch = Math.ceil(daftarData.length / UKURAN_BATCH);
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      // A. Batch Upsert ke penerima_2026
      for (let b = 0; b < totalBatch; b++) {
        const chunk = daftarData.slice(b * UKURAN_BATCH, (b + 1) * UKURAN_BATCH);
        await trx`
          insert into penerima ${trx(chunk,
          "tahun", "nomor_urut", "nama", "nik", "jenis_kelamin", "tempat_lahir", "tanggal_lahir",
          "alamat", "layanan", "tempat_tugas", "alamat_tugas", "kecamatan", "kelurahan",
          "nama_rekening", "nomor_rekening", "kantor_cabang", "no_kontak", "status_bpjs_tk",
          "umur", "status_verifikasi"
        )}
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
            status_verifikasi = excluded.status_verifikasi
        `;
      }

      // B. Hapus baris dari data_detail_2026 jika status tidak lagi lolos (mis. retur / meninggal)
      await trx`
        delete from data_detail
        where tahun = 2026
          and penerima_id in (
            select id from penerima
            where tahun = 2026
              and status_verifikasi not in ('Memenuhi Syarat', 'AKTIF')
          )
      `;

      // C. Pastikan baris yang lolos (status AKTIF / Memenuhi Syarat) tersinkron lengkap di data_detail_2026
      await trx`
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
          umur = excluded.umur
      `;

      // D. Broadcast sinyal Realtime ke Event Bus CDC
      await trx`
        insert into public.realtime_event_bus (domain, aksi, entitas_id, created_at)
        values
          ('arsip_tahun', 'SYNC_2026', null, now()),
          ('penerima', 'SYNC_2026', null, now()),
          ('data_detail', 'SYNC_2026', null, now())
      `;
    });

    const durasiDetik = ((Date.now() - mulai) / 1000).toFixed(1);
    return {
      sukses: true,
      totalBaris: daftarData.length,
      durasi: durasiDetik,
      pesan: `Sinkronisasi berhasil! ${daftarData.length} data diselaraskan dari Google Sheets dalam ${durasiDetik} detik.`,
    };
  } catch (err) {
    const pesan = err instanceof Error ? err.message : String(err);
    return { sukses: false, pesan: `Gagal sinkronisasi data 2026: ${pesan}` };
  } finally {
    // 7. Lepaskan Mutex Lock
    await sql`select pg_advisory_unlock(${ADVISORY_LOCK_ID});`;
  }
}
