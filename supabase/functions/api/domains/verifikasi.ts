import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";
import { formatTanggalWaktuWIB } from "../_shared/tanggal.ts";
import {
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";

// ---------------------------------------------------------------------------
// Pengganti LockService di seluruh domain ini: bukan advisory lock, tapi UPDATE ... WHERE
// status_verifikasi = <status diharapkan> RETURNING id — atomik secara native di Postgres, jadi
// optimistic-locking (deteksi "sudah diubah admin lain") tidak butuh mekanisme lock terpisah sama
// sekali. Ini persis pola yang sudah dicatat di rencana migrasi (§ Pengganti Mekanisme GAS).
// ---------------------------------------------------------------------------

// Port 1:1 dari verifikasiSatuData() (Kode.gs baris 2942-3007). `nomorBarisAsli` = penerima.id.
export async function verifikasiSatuData(
  token: string,
  nomorBarisAsli: number,
  statusBaru: string,
  keterangan: string,
  batasWaktu: string,
  statusSebelumnyaDiharapkan?: string,
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  const id = Number(nomorBarisAsli);
  if (!id) return { sukses: false, pesan: "Nomor baris tidak valid." };

  const statusValid = ["Tidak Memenuhi Syarat", "Berkas Tidak Lengkap"];
  if (!statusValid.includes(statusBaru)) return { sukses: false, pesan: "Status tidak valid." };

  const keteranganBersih = (keterangan || "").toString().trim();
  if (!keteranganBersih) return { sukses: false, pesan: "Keterangan hasil verifikasi wajib diisi." };

  let batasWaktuBersih = "";
  if (statusBaru === "Berkas Tidak Lengkap") {
    batasWaktuBersih = (batasWaktu || "").toString().trim();
    if (!batasWaktuBersih) {
      return { sukses: false, pesan: "Batas waktu perbaikan wajib diisi untuk status Berkas Tidak Lengkap." };
    }
  }

  try {
    // Dihitung sekali di JS (bukan now() di SQL) supaya nilai yang DISIMPAN dan yang DIKEMBALIKAN
    // ke frontend di respons dijamin identik — sama seperti Kode.gs yang menghitung tglSekarang
    // sekali lalu memakainya untuk penulisan sel & isi respons sekaligus.
    const waktuVerifikasi = new Date();
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();
    const statusDiharapkan = (statusSebelumnyaDiharapkan || "").toString().trim();

    // "$8 = '' OR status_verifikasi = $8": kalau statusDiharapkan kosong (tidak dikirim), tidak
    // ada pengecekan status sama sekali (perilaku asli: cek konflik cuma jalan kalau statusDiharapkan
    // diisi) — persis logika `if (statusDiharapkan && statusSaatIni !== statusDiharapkan)`.
    const rows = await sql`
      update penerima set
        status_verifikasi = ${statusBaru},
        keterangan_verifikasi = ${keteranganBersih},
        tanggal_verifikasi = ${waktuVerifikasi},
        diverifikasi_oleh = ${namaVerifikator},
        batas_waktu_perbaikan = ${batasWaktuBersih || null}
      where id = ${id} and tahun = ${TAHUN_AKTIF}
        and (${statusDiharapkan} = '' or status_verifikasi = ${statusDiharapkan})
      returning id
    `;

    if (rows.length === 0) {
      const cekAda = await sql`select status_verifikasi from penerima where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1`;
      if (cekAda.length === 0) return { sukses: false, pesan: "Baris tidak ditemukan." };
      const statusTerkini = cekAda[0].status_verifikasi;
      return {
        sukses: false,
        konflik: true,
        statusTerkini,
        pesan: 'Data ini sudah diverifikasi/diubah oleh admin lain (status terkini: "' + statusTerkini +
          '"). Muat ulang data sebelum menyimpan lagi.',
      };
    }

    return {
      sukses: true,
      pesan: "Status verifikasi berhasil disimpan.",
      status: statusBaru,
      keterangan: keteranganBersih,
      tanggal: formatTanggalWaktuWIB(waktuVerifikasi),
      verifikator: namaVerifikator,
      batasWaktu: batasWaktuBersih,
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port dari laporkanPerbaikanBerkas() (Kode.gs baris 3011-3067) — hanya penanda "sudah dilaporkan",
// TIDAK mengubah status. PENGERASAN DISENGAJA (konsisten dgn ambilDetailPenerimaPerBaris/
// ambilRiwayatEdit): fungsi asli tidak menerapkan kelurahan-lock/sub-filter GSM, di sini ditambahkan
// lewat helper akses yang sama.
export async function laporkanPerbaikanBerkas(token: string, nomorBarisAsli: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const id = Number(nomorBarisAsli);
  if (!id) return { sukses: false, pesan: "Nomor baris tidak valid." };

  try {
    const rowsCek = await sql`
      select layanan, kecamatan, kelurahan, tempat_tugas, status_verifikasi
      from penerima where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1
    `;
    if (rowsCek.length === 0) return { sukses: false, pesan: "Baris tidak ditemukan." };
    const rowCek = rowsCek[0];

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) return { sukses: false, pesan: "Anda tidak berhak melapor untuk data ini." };

    const bolehLapor = lolosAksesBarisLihatData({
      instansiPengguna,
      layananPengguna,
      namaKecamatanPengguna: sesi.kecamatan || "",
      kelurahanTerkunci: kelurahanTerkunciDari(sesi),
      subFilterGsm: subFilterGsmDari(sesi),
      listLayananKemenag,
      layananSheet: (rowCek.layanan || "").toUpperCase(),
      kecamatanSheet: (rowCek.kecamatan || "").toUpperCase(),
      kelurahanSheet: (rowCek.kelurahan || "").toUpperCase(),
      tempatTugasSheet: (rowCek.tempat_tugas || "").toUpperCase(),
    });
    if (!bolehLapor) return { sukses: false, pesan: "Anda tidak berhak melapor untuk data ini." };

    const namaPelapor = (sesi.username || "").toString().toUpperCase();
    const waktuLapor = new Date();

    const rows = await sql`
      update penerima set tanggal_lapor_perbaikan = ${waktuLapor}, dilapor_oleh = ${namaPelapor}
      where id = ${id} and tahun = ${TAHUN_AKTIF} and status_verifikasi = 'Berkas Tidak Lengkap'
      returning id
    `;
    if (rows.length === 0) {
      return { sukses: false, pesan: "Data ini bukan berstatus Berkas Tidak Lengkap." };
    }

    return { sukses: true, tanggalLapor: formatTanggalWaktuWIB(waktuLapor), dilaporOleh: namaPelapor };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari tandaiSudahDiperbaiki() (Kode.gs baris 3070-3120) — khusus UTAMA.
export async function tandaiSudahDiperbaiki(token: string, nomorBarisAsli: number) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  const id = Number(nomorBarisAsli);
  if (!id) return { sukses: false, pesan: "Nomor baris tidak valid." };

  try {
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();
    const waktuVerifikasi = new Date();

    const rows = await sql`
      update penerima set
        status_verifikasi = 'Memenuhi Syarat',
        keterangan_verifikasi = '',
        tanggal_verifikasi = ${waktuVerifikasi},
        diverifikasi_oleh = ${namaVerifikator},
        batas_waktu_perbaikan = null,
        tanggal_lapor_perbaikan = null,
        dilapor_oleh = null
      where id = ${id} and tahun = ${TAHUN_AKTIF} and status_verifikasi = 'Berkas Tidak Lengkap'
      returning id
    `;

    if (rows.length === 0) {
      const cekAda = await sql`select status_verifikasi from penerima where id = ${id} and tahun = ${TAHUN_AKTIF} limit 1`;
      if (cekAda.length === 0) return { sukses: false, pesan: "Baris tidak ditemukan." };
      const statusTerkini = cekAda[0].status_verifikasi;
      return {
        sukses: false,
        konflik: true,
        statusTerkini,
        pesan: 'Data ini sudah diubah oleh admin lain (status terkini: "' + statusTerkini +
          '"). Muat ulang data sebelum menyimpan lagi.',
      };
    }

    return { sukses: true, status: "Memenuhi Syarat", tanggal: formatTanggalWaktuWIB(waktuVerifikasi), verifikator: namaVerifikator };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari verifikasiMassalMemenuhiSyarat() (Kode.gs baris 3122-3169) — khusus UTAMA.
// Hanya menyentuh baris yang MASIH "" atau "Proses Verifikasi" (case-insensitive, sama seperti
// asli) — status lain (termasuk Berkas Tidak Lengkap) TIDAK disentuh.
export async function verifikasiMassalMemenuhiSyarat(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  try {
    const namaVerifikator = (sesi.username || "UTAMA").toString().toUpperCase();

    const rows = await sql`
      update penerima set
        status_verifikasi = 'Memenuhi Syarat',
        keterangan_verifikasi = '',
        tanggal_verifikasi = now(),
        diverifikasi_oleh = ${namaVerifikator},
        batas_waktu_perbaikan = null
      where tahun = ${TAHUN_AKTIF}
        and (status_verifikasi = '' or upper(trim(status_verifikasi)) = 'PROSES VERIFIKASI')
      returning id
    `;

    return { sukses: true, jumlah: rows.length };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari getDaftarBerkasTidakLengkapUntukWA() (Kode.gs baris 3171-3218) — khusus UTAMA.
export async function getDaftarBerkasTidakLengkapUntukWA(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Fitur ini khusus Admin Utama." };
  }

  interface BarisBerkasTidakLengkap {
    nama: string | null;
    nik: string | null;
    layanan: string | null;
    kecamatan: string | null;
    kelurahan: string | null;
    keterangan_verifikasi: string | null;
    batas_waktu_perbaikan: string | Date | null;
  }

  try {
    const rows = await sql<BarisBerkasTidakLengkap[]>`
      select nama, nik, layanan, kecamatan, kelurahan, keterangan_verifikasi, batas_waktu_perbaikan
      from penerima
      where tahun = ${TAHUN_AKTIF} and status_verifikasi = 'Berkas Tidak Lengkap'
    `;

    const data = rows.map((r: BarisBerkasTidakLengkap) => ({
      nama: (r.nama || "").toString().trim(),
      nik: (r.nik || "").toString().replace(/'/g, "").trim(),
      layanan: (r.layanan || "").toString().trim(),
      kecamatan: (r.kecamatan || "").toString().trim(),
      kelurahan: (r.kelurahan || "").toString().trim(),
      keterangan: (r.keterangan_verifikasi || "").toString().trim(),
      // Format "yyyy-MM-dd" (BUKAN dd-MM-yyyy seperti field tanggal lain) — dikonfirmasi dari
      // Kode.gs baris 3210: Utilities.formatDate(..., "yyyy-MM-dd"). Kolom `date` murni (tanpa
      // jam) jadi tidak perlu geser WIB seperti formatTanggalWaktuWIB.
      batasWaktu: r.batas_waktu_perbaikan
        ? new Date(r.batas_waktu_perbaikan).toISOString().slice(0, 10)
        : "",
    }));

    return { sukses: true, data };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Port dari cekBatasWaktuVerifikasi() — Kode.gs baris 3063-3100.
//
// Di Kode.gs fungsi ini dijalankan oleh trigger harian Apps Script (jam 01.00 WIB).
// Di Supabase, fungsi ini diekspos sebagai action API tanpa parameter token (dipanggil
// oleh Vercel Cron — lihat api/cron.js yang dibuat bersamaan dengan Fase 4 ini).
// Bisa juga dipanggil manual oleh admin via Postman/curl untuk trigger on-demand.
//
// Return: { sukses, jumlahBerubah, pesan } — bukan void seperti GAS.
// ---------------------------------------------------------------------------
export async function cekBatasWaktuVerifikasi() {
  try {
    const hariIniISO = new Date().toISOString().slice(0, 10); // yyyy-MM-dd UTC, cukup untuk perbandingan date

    // Atomic UPDATE: temukan + ubah dalam satu query (port Kode.gs baris 3075-3091)
    const rowsBerubah = await sql`
      update penerima set
        status_verifikasi    = 'Tidak Memenuhi Syarat',
        keterangan_verifikasi = 'Otomatis diubah sistem: batas waktu perbaikan berkas telah lewat tanpa perbaikan.',
        tanggal_verifikasi   = now() at time zone 'Asia/Jakarta',
        diverifikasi_oleh    = 'SISTEM (OTOMATIS)',
        batas_waktu_perbaikan = null,
        diperbarui_at        = now()
      where tahun             = ${TAHUN_AKTIF}
        and status_verifikasi = 'Berkas Tidak Lengkap'
        and batas_waktu_perbaikan is not null
        and batas_waktu_perbaikan < ${hariIniISO}::date
      returning id, nama
    `;

    const jumlahBerubah = rowsBerubah.length;
    const sekarang = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });

    return {
      sukses: true,
      jumlahBerubah,
      pesan: jumlahBerubah > 0
        ? `${jumlahBerubah} data diubah otomatis ke "Tidak Memenuhi Syarat" pada ${sekarang} WIB.`
        : `Tidak ada data yang perlu diubah (dijalankan ${sekarang} WIB).`,
    };
  } catch (error) {
    return { sukses: false, jumlahBerubah: 0, pesan: String(error) };
  }
}
