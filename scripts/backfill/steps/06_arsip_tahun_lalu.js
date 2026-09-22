"use strict";

const { bacaSheet, daftarNamaSheet } = require("../lib/sheets");
const { keTanggalIso, angkaAtauNull, angkaAtauFallback } = require("../lib/tanggal");
const log = require("../lib/log");

// Kolom sheet arsip db_<tahun> (1-based, dikonfirmasi dari cekStatusTahunLalu_() Kode.gs baris
// 3611-3614 & komentar "Ambil HANYA Kolom C" di baris 3592-3597) — HANYA 19 kolom (ringkasan),
// BUKAN skema penuh 40-kolom "Data Input <tahun>" yang masih berjalan (itu ditangani step 08):
// A=NO B=NAMA C=NIK D=JENIS KELAMIN E=TEMPAT LAHIR F=TANGGAL LAHIR G=ALAMAT H=LAYANAN
// I=TEMPAT TUGAS J=ALAMAT TUGAS K=KECAMATAN L=KELURAHAN M=NAMA REKENING N=NOMOR REKENING
// O=KANTOR CABANG P=NO KONTAK Q=STATUS BPJS TK R=UMUR S=STATUS (AKTIF/TIDAK AKTIF)
//
// Kolom-kolom yang tidak ada di arsip (link berkas, status verifikasi detail, dst.) sengaja
// dibiarkan NULL di tabel `penerima` untuk tahun arsip — kolom itu memang tidak pernah terisi
// untuk data lampau, dan tidak dipakai oleh cekStatusTahunLalu_/cekNikRealtime yang hanya baca
// nik/nama/layanan/status_verifikasi (lihat supabase/functions/api/domains/validasi.ts).
const POLA_NAMA_SHEET_ARSIP = /^db_(\d{4})$/;

const SQL_INSERT_PENERIMA = `insert into penerima (
    tahun, nomor_urut, nama, nik, jenis_kelamin, tempat_lahir, tanggal_lahir, alamat,
    layanan, tempat_tugas, alamat_tugas, kecamatan, kelurahan, nama_rekening,
    nomor_rekening, kantor_cabang, no_kontak, status_bpjs_tk, umur, status_verifikasi
  ) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
  )
  on conflict (tahun, nik) do update set
    nomor_urut = excluded.nomor_urut, nama = excluded.nama,
    jenis_kelamin = excluded.jenis_kelamin, tempat_lahir = excluded.tempat_lahir,
    tanggal_lahir = excluded.tanggal_lahir, alamat = excluded.alamat,
    layanan = excluded.layanan, tempat_tugas = excluded.tempat_tugas,
    alamat_tugas = excluded.alamat_tugas, kecamatan = excluded.kecamatan,
    kelurahan = excluded.kelurahan, nama_rekening = excluded.nama_rekening,
    nomor_rekening = excluded.nomor_rekening, kantor_cabang = excluded.kantor_cabang,
    no_kontak = excluded.no_kontak, status_bpjs_tk = excluded.status_bpjs_tk,
    umur = excluded.umur, status_verifikasi = excluded.status_verifikasi`;

async function pastikanPartisiAda(pool, tahun) {
  const res = await pool.query(
    `select 1 from pg_inherits
     join pg_class parent on pg_inherits.inhparent = parent.oid
     join pg_class child on pg_inherits.inhrelid = child.oid
     where parent.relname = 'penerima' and child.relname = $1`,
    [`penerima_${tahun}`],
  );
  if (res.rowCount === 0) {
    throw new Error(
      `Partisi penerima_${tahun} belum ada. Buat dulu lewat migrasi SQL sebelum backfill tahun ini:\n` +
        `  create table penerima_${tahun} partition of penerima for values in (${tahun});\n` +
        `(index & constraint unik otomatis mengikuti dari tabel induk, lihat migrasi 20260907090200_penerima_partitioned.sql)`,
    );
  }
}

async function jalankan({ sheetsClient, pool, env, mode, tahunAktif }) {
  log.judul("06. Arsip Tahun Lalu (db_<tahun> -> partisi penerima_<tahun>)");

  const semuaSheet = await daftarNamaSheet(sheetsClient, env.ssIdMasterDropdown);
  const sheetArsip = semuaSheet
    .map((nama) => ({ nama, match: nama.match(POLA_NAMA_SHEET_ARSIP) }))
    .filter((s) => s.match && Number(s.match[1]) !== tahunAktif)
    .map((s) => ({ nama: s.nama, tahun: Number(s.match[1]) }));

  log.info(`Ditemukan ${sheetArsip.length} sheet arsip: ${sheetArsip.map((s) => s.nama).join(", ") || "(tidak ada)"}`);

  let totalDibaca = 0;
  let totalDitulis = 0;
  let totalDilewati = 0;
  let totalKonflikRekening = 0;

  for (const { nama: namaSheet, tahun } of sheetArsip) {
    if (mode === "write") await pastikanPartisiAda(pool, tahun);

    const baris = await bacaSheet(sheetsClient, env.ssIdMasterDropdown, namaSheet, "A2:S");
    let ditulis = 0;
    let dilewati = 0;
    let konflikRekening = 0;

    const client = mode === "write" ? await pool.connect() : null;
    try {
      for (let i = 0; i < baris.length; i++) {
        const r = baris[i];
        const nomorBarisSheet = i + 2;
        const nik = (r[2] || "").toString().trim();
        if (!nik) {
          dilewati++;
          continue;
        }
        const nomorUrut = angkaAtauFallback(r[0], i + 1);

        const data = {
          tahun,
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
          status_verifikasi: (r[18] || "").toString().trim().toUpperCase() || "TIDAK DIKETAHUI",
        };

        if (mode === "write") {
          // Setiap baris di-INSERT satu per satu TANPA transaksi pembungkus (sengaja, supaya baris
          // yang berhasil sebelum satu baris bermasalah tetap tersimpan) -- tapi itu berarti error
          // yang tidak ditangkap akan MENGHENTIKAN seluruh proses di tengah jalan, meninggalkan
          // backfill setengah-selesai tanpa peringatan jelas. Ditemukan saat code review: 2 baris
          // db_2026 berbagi nomor_rekening yang sama (constraint uq_penerima_rekening, BEDA dari
          // target ON CONFLICT di atas yang cuma (tahun, nik)) -- tanpa try/catch ini, --write akan
          // crash persis di baris itu dan menyisakan ribuan baris berikutnya tidak pernah masuk.
          try {
            await client.query(SQL_INSERT_PENERIMA, Object.values(data));
          } catch (err) {
            if (err.code === "23505" && (err.constraint || "").includes("rekening")) {
              // Konflik HANYA di nomor rekening: simpan tetap baris ini tapi rekening dikosongkan
              // (bukan didrop total) -- konsisten dengan desain uq_penerima_rekening sendiri yang
              // sengaja tidak mengindeks rekening kosong (lihat komentar di migrasi
              // 20260907090200_penerima_partitioned.sql), jadi ini bukan hack, memang jalur yang
              // sudah disediakan skema untuk data belum lengkap/perlu dicek ulang manual.
              const dataTanpaRekening = { ...data, nomor_rekening: "" };
              try {
                await client.query(SQL_INSERT_PENERIMA, Object.values(dataTanpaRekening));
                log.info(
                  `  [KONFLIK REKENING] baris sheet ${nomorBarisSheet} (NIK ${nik}): nomor rekening ` +
                    `"${data.nomor_rekening}" sudah dipakai baris lain -> disimpan TANPA rekening, ` +
                    `perlu dicek & diisi ulang manual.`,
                );
                konflikRekening++;
                ditulis++;
              } catch (err2) {
                log.info(`  [GAGAL] baris sheet ${nomorBarisSheet} (NIK ${nik}) tetap gagal setelah rekening dikosongkan: ${err2.message}`);
                dilewati++;
              }
            } else if (err.code === "23505") {
              log.info(`  [GAGAL - KONFLIK] baris sheet ${nomorBarisSheet} (NIK ${nik}): ${err.constraint || err.message} -- dilewati, cek manual.`);
              dilewati++;
            } else {
              // Error di luar pelanggaran constraint unik (mis. koneksi putus) TETAP menghentikan
              // proses -- itu bukan masalah kualitas data yang aman ditangani otomatis.
              throw err;
            }
            continue;
          }
        }
        ditulis++;
      }
    } finally {
      if (client) client.release();
    }

    log.info(
      `${namaSheet} -> penerima_${tahun}: ${baris.length} baris sheet, ${ditulis} ditulis, ${dilewati} dilewati` +
        (konflikRekening > 0 ? `, ${konflikRekening} konflik rekening (disimpan tanpa rekening)` : ""),
    );
    totalDibaca += baris.length;
    totalDitulis += ditulis;
    totalDilewati += dilewati;
    totalKonflikRekening += konflikRekening;
  }

  log.ringkasan({ sheetDibaca: totalDibaca, ditulis: totalDitulis, dilewati: totalDilewati, mode });
  if (totalKonflikRekening > 0) {
    log.info(
      `${totalKonflikRekening} baris tersimpan TANPA nomor rekening karena bentrok dengan baris lain -- cek log [KONFLIK REKENING] di atas, lalu perbaiki manual (isi ulang rekening yang benar) setelah backfill selesai.`,
    );
  }
  return { sheetDibaca: totalDibaca, ditulis: totalDitulis, dilewati: totalDilewati, konflikRekening: totalKonflikRekening };
}

module.exports = { nama: "arsip-tahun-lalu", jalankan };
