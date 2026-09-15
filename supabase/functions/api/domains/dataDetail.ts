import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { TAHUN_AKTIF } from "../_shared/config.ts";
import {
  kelurahanTerkunciDari,
  lolosAksesBarisLihatData,
  resolveInstansiPengguna,
  subFilterGsmDari,
} from "../_shared/akses.ts";
import { formatTanggalDDMMYYYY, formatTanggalWaktuWIB } from "../_shared/tanggal.ts";

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
// ---------------------------------------------------------------------------
export async function ambilDataDetail(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    // Sinkron dulu: baris `penerima` yang sudah "Memenuhi Syarat" tapi belum ada di
    // `data_detail` ditambahkan (idempoten lewat ON CONFLICT). Sengaja dilakukan di SATU
    // tempat ini (bukan ditempel di tiap fungsi verifikasi seperti verifikasiSatuData/
    // verifikasiMassalMemenuhiSyarat) supaya cuma ada satu jalur logika yang perlu dijaga.
    await sql`
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
      where p.tahun = ${TAHUN_AKTIF} and p.status_verifikasi = 'Memenuhi Syarat'
      on conflict (tahun, penerima_id) do nothing
    `;

    const namaKecamatanPengguna = sesi.kecamatan || "";
    const kelurahanTerkunci = kelurahanTerkunciDari(sesi);
    const subFilterGsm = subFilterGsmDari(sesi);

    const { instansiPengguna, layananPengguna, listLayananKemenag } = await resolveInstansiPengguna(sesi.role);
    if (!instansiPengguna) {
      return { sukses: false, pesan: "Peran tidak dikenali." };
    }

    // Sengaja TIDAK mendorong filter kecamatan/layanan ke WHERE SQL (beda dari optimasi yang
    // pernah dicoba di ambilDataLihatDataHakAkses dan menyebabkan insiden produksi) — tarik
    // semua baris tahun aktif, filter akses di kode, sampai ada cara uji lokal yang layak
    // sebelum optimasi semacam itu diulang.
    const rows = await sql`
      select nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat, layanan,
             tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening, nomor_rekening,
             kantor_cabang, no_kontak, status_bpjs_tk, umur, status, tgl_status
      from data_detail
      where tahun = ${TAHUN_AKTIF}
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
        tglStatus: formatTanggalWaktuWIB(row.tgl_status),
      });
    }

    return { sukses: true, rows: hasil };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
