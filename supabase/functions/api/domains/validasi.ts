import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { ikonRumahIbadah, LAYANAN_BATASI_TEMPAT_TUGAS, rapikanTeks, TAHUN_AKTIF } from "../_shared/config.ts";

// ---------------------------------------------------------------------------
// Catatan desain (beda dari Kode.gs, disengaja — lihat rencana migrasi):
// Kode.gs membangun "indeks" NIK/rekening/tempat-tugas/kuota di CacheService (getIndeksTerdaftar_,
// TTL 3 jam) supaya tidak perlu scan penuh sheet transaksi tiap kali validasi realtime dipanggil.
// Di Postgres, kolom-kolom itu sudah punya index (uq_penerima_nik, uq_penerima_rekening,
// uq_penerima_tempat_tugas, idx_penerima_kec_lay — lihat migrasi 20260907090200), sehingga query
// langsung ke tabel `penerima` sama cepatnya dan SELALU akurat real-time (tidak basi 3 jam seperti
// cache lama). Jadi getIndeksTerdaftar_/invalidateIndeksTerdaftar_ SENGAJA tidak diporting.
// ---------------------------------------------------------------------------

// Port dari cekDomisiliCapil_() — tanpa parameter token (pemanggil di sini sudah memvalidasi sesi
// di level luar; pengecekan sesi kedua di Kode.gs bersifat redundan/tidak mengubah perilaku).
async function cekDomisiliCapil(nik: string) {
  try {
    const nikTarget = String(nik || "").trim();
    if (!nikTarget) return { ditemukan: false as const };

    const rows = await sql`
      select nama, nik, status, alamat_domisili, kab_kota_domisili
      from capil
      where nik = ${nikTarget}
      limit 1
    `;
    if (rows.length === 0) return { ditemukan: false as const };

    const r = rows[0];
    return {
      ditemukan: true as const,
      nama: (r.nama || "").toString().trim(),
      nik: nikTarget,
      status: (r.status || "").toString().trim(),
      alamatDomisili: (r.alamat_domisili || "").toString().trim(),
      kabKotaDomisili: (r.kab_kota_domisili || "").toString().trim(),
    };
  } catch (_e) {
    // Jika error, JANGAN blokir input — sama seperti Kode.gs.
    return { ditemukan: false as const };
  }
}

// Port dari cekStatusTahunLalu_() — cek ke SEMUA tahun selain TAHUN_AKTIF sekaligus (satu query
// yang di-prune otomatis ke partisi relevan oleh Postgres), bukan loop per-sheet seperti GAS.
// Kalau NIK muncul di lebih dari satu tahun lampau, ambil yang tahunnya paling baru (order by tahun desc).
async function cekStatusTahunLalu(nik: string) {
  try {
    const nikTarget = String(nik || "").trim();
    if (!nikTarget) return { ditemukan: false as const };

    const rows = await sql`
      select tahun, nama, layanan, status_verifikasi
      from penerima
      where nik = ${nikTarget} and tahun <> ${TAHUN_AKTIF}
      order by tahun desc
      limit 1
    `;
    if (rows.length === 0) return { ditemukan: false as const };

    const r = rows[0];
    const status = (r.status_verifikasi || "").toString().trim().toUpperCase();
    return {
      ditemukan: true as const,
      status,
      aktif: status === "AKTIF",
      nama: (r.nama || "").toString().trim(),
      layanan: (r.layanan || "").toString().trim().toUpperCase(),
      tahun: String(r.tahun),
    };
  } catch (_e) {
    return { ditemukan: false as const };
  }
}

// Port 1:1 dari cekKuotaTersedia() — tetap diekspos sebagai action tersendiri untuk paritas
// dengan daftar ALLOWED lama, meski index.html saat ini hanya memakainya lewat cekKuotaRealtime.
export async function cekKuotaTersedia(kecamatan: string, layanan: string, jumlahTerpakaiOverride?: number) {
  try {
    const kecUpper = String(kecamatan || "").trim().toUpperCase();
    const layUpper = String(layanan || "").trim().toUpperCase();

    const rowsKuota = await sql`
      select kuota_maks from kuota where kecamatan = ${kecUpper} and layanan = ${layUpper} limit 1
    `;
    if (rowsKuota.length === 0) {
      return {
        tersedia: false,
        pesan: "Kuota layanan " + layanan + " untuk " + kecamatan +
          " belum diset. Silahkan hubungi Admin Dinas Sosial Kota Medan.",
      };
    }
    const kuotaMaks = Number(rowsKuota[0].kuota_maks) || 0;

    let jumlahTerpakai: number;
    if (typeof jumlahTerpakaiOverride === "number") {
      jumlahTerpakai = jumlahTerpakaiOverride;
    } else {
      const rowsPakai = await sql`
        select count(*)::int as jumlah from penerima
        where tahun = ${TAHUN_AKTIF} and kecamatan = ${kecUpper} and layanan = ${layUpper}
      `;
      jumlahTerpakai = rowsPakai[0]?.jumlah ?? 0;
    }

    if (jumlahTerpakai >= kuotaMaks) {
      return {
        tersedia: false,
        terpakai: jumlahTerpakai,
        maks: kuotaMaks,
        sisa: 0,
        pesan: "Kuota Layanan " + layanan + " untuk Kecamatan " + kecamatan +
          " sudah terpenuhi (" + jumlahTerpakai + "/" + kuotaMaks +
          "). Silahkan hubungi Admin Dinas Sosial Kota Medan.",
      };
    }

    return {
      tersedia: true,
      terpakai: jumlahTerpakai,
      maks: kuotaMaks,
      sisa: Math.max(0, kuotaMaks - jumlahTerpakai),
    };
  } catch (error) {
    return { tersedia: false, pesan: "Error cek kuota: " + String(error) };
  }
}

// Port 1:1 dari cekNikRealtime() — gagal cek TIDAK PERNAH memblokir (fail-open), validasi final
// saat submit (validasiDataBaru) tetap jadi jaring pengaman terakhir, sama seperti Kode.gs.
export async function cekNikRealtime(token: string, nik: string) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return { blokir: false };
  }

  try {
    const nikTarget = String(nik || "").trim();
    if (nikTarget.length !== 16) return { blokir: false };

    const cekCapil = await cekDomisiliCapil(nikTarget);
    if (cekCapil.ditemukan) {
      return {
        blokir: true,
        jenis: "CAPIL",
        pesan: "NIK ini terdaftar sebagai domisili di luar Kota Medan: " + cekCapil.kabKotaDomisili,
        nama: cekCapil.nama,
      };
    }

    const cekTahunLalu = await cekStatusTahunLalu(nikTarget);
    if (cekTahunLalu.ditemukan && !cekTahunLalu.aktif) {
      return {
        blokir: true,
        jenis: "STATUS_LAMA",
        pesan: "NIK ini terdaftar di data " + (cekTahunLalu.tahun || "sebelumnya") +
          " dengan status: " + cekTahunLalu.status,
        nama: cekTahunLalu.nama,
      };
    }

    const rowsNik = await sql`
      select nama from penerima where tahun = ${TAHUN_AKTIF} and nik = ${nikTarget} limit 1
    `;
    if (rowsNik.length > 0) {
      const nama = (rowsNik[0].nama || "").toString();
      return { blokir: true, jenis: "NIK_GANDA", pesan: "NIK ini sudah terdaftar atas nama " + nama + ".", nama };
    }

    return { blokir: false };
  } catch (_e) {
    return { blokir: false };
  }
}

// Port 1:1 dari cekRekeningRealtime().
export async function cekRekeningRealtime(token: string, noRekening: string) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return { blokir: false };
  }

  try {
    const rekTarget = String(noRekening || "").trim();
    if (rekTarget.length !== 14) return { blokir: false };

    const rows = await sql`
      select nama from penerima where tahun = ${TAHUN_AKTIF} and nomor_rekening = ${rekTarget} limit 1
    `;
    if (rows.length > 0) {
      const nama = (rows[0].nama || "").toString();
      return { blokir: true, pesan: "Nomor rekening ini sudah digunakan oleh " + nama + ".", nama };
    }
    return { blokir: false };
  } catch (_e) {
    return { blokir: false };
  }
}

// Port 1:1 dari cekTempatTugasGandaRealtime().
export async function cekTempatTugasGandaRealtime(
  token: string,
  layanan: string,
  tempatTugas: string,
  alamatTugas: string,
) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return { blokir: false, relevan: false };
  }

  try {
    const layananTarget = String(layanan || "").trim().toUpperCase();
    if (!LAYANAN_BATASI_TEMPAT_TUGAS.includes(layananTarget)) return { blokir: false, relevan: false };

    const tempatTarget = rapikanTeks(tempatTugas);
    const alamatTarget = rapikanTeks(alamatTugas);
    if (!tempatTarget || !alamatTarget) return { blokir: false, relevan: true };

    const rows = await sql`
      select nama, kecamatan from penerima
      where tahun = ${TAHUN_AKTIF} and layanan = ${layananTarget}
        and tempat_tugas = ${tempatTarget} and alamat_tugas = ${alamatTarget}
      limit 1
    `;
    if (rows.length > 0) {
      return { blokir: true, relevan: true, nama: rows[0].nama, kecamatan: rows[0].kecamatan };
    }
    return { blokir: false, relevan: true };
  } catch (_e) {
    return { blokir: false, relevan: false };
  }
}

// Port 1:1 dari cekKuotaRealtime() — pemanggilan cekKuotaTersedia() SENGAJA tidak dibungkus
// try/catch tambahan di sini, sama seperti Kode.gs (cekKuotaTersedia sudah punya try/catch sendiri
// dan tidak pernah throw).
export async function cekKuotaRealtime(token: string, kecamatan: string, layanan: string) {
  try {
    await wajibSesi(token);
  } catch (_e) {
    return { blokir: false };
  }
  const hasil = await cekKuotaTersedia(kecamatan, layanan);
  if (!hasil.tersedia) {
    return {
      blokir: true,
      pesan: hasil.pesan,
      terpakai: hasil.terpakai,
      maks: hasil.maks,
      sisa: hasil.sisa ?? 0,
    };
  }
  return {
    blokir: false,
    terpakai: hasil.terpakai,
    maks: hasil.maks,
    sisa: hasil.sisa ?? Math.max(0, (hasil.maks || 0) - (hasil.terpakai || 0)),
  };
}

// Port dari validasiDataBaru() + validasiDataBaru_() digabung jadi satu fungsi (perilaku identik):
// Kode.gs punya 2 fungsi terpisah karena validasiDataBaru_() memvalidasi ulang sesi lagi di awal
// (redundan, sesi sudah pasti valid karena baru saja dicek oleh validasiDataBaru()) — digabung di
// sini supaya tidak ada round-trip validasi sesi dua kali tanpa mengubah hasil yang terlihat user.
export async function validasiDataBaru(
  token: string,
  nikBaru: string,
  layananBaru: string,
  tempatTugasBaru: string,
  _instansiBaru: string,
  noRekBaru: string,
  kecamatanBaru: string,
  alamatTugasBaru: string,
) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { valid: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    // 1. Cek domisili Capil (warga luar Kota Medan ditolak)
    const cekCapil = await cekDomisiliCapil(nikBaru);
    if (cekCapil.ditemukan) {
      return {
        valid: false,
        tolakCapil: true,
        namaCapil: cekCapil.nama,
        nikCapil: cekCapil.nik,
        alamatDomisiliCapil: cekCapil.alamatDomisili,
        kabKotaDomisiliCapil: cekCapil.kabKotaDomisili,
        statusCapil: cekCapil.status,
        pesan: "NIK INI TERDAFTAR SEBAGAI DOMISILI DI LUAR KOTA MEDAN: " + cekCapil.kabKotaDomisili,
      };
    }

    // 2. Cek status arsip tahun sebelumnya
    const cekTahunLalu = await cekStatusTahunLalu(nikBaru);
    if (cekTahunLalu.ditemukan && !cekTahunLalu.aktif) {
      return {
        valid: false,
        tolakStatus2026: true,
        status2026: cekTahunLalu.status,
        nama2026: cekTahunLalu.nama,
        layanan2026: cekTahunLalu.layanan,
        tahun2026: cekTahunLalu.tahun || "",
        pesan: "NIK INI TERDAFTAR DI DATA " + (cekTahunLalu.tahun || "SEBELUMNYA") +
          " DENGAN STATUS: " + cekTahunLalu.status,
      };
    }

    const nikTarget = String(nikBaru || "").trim();
    const layananTarget = String(layananBaru || "").trim().toUpperCase();
    const tempatTugasTarget = rapikanTeks(tempatTugasBaru);
    const alamatTugasTarget = rapikanTeks(alamatTugasBaru);
    const noRekTarget = String(noRekBaru || "").trim();
    const cekTempatTugasRelevan = LAYANAN_BATASI_TEMPAT_TUGAS.includes(layananTarget);

    // deno-lint-ignore no-explicit-any
    const temuan: any[] = [];

    // 3 pengecekan di bawah tidak saling bergantung -> jalankan paralel (Promise.all), bukan
    // berurutan, supaya latensi submit form tidak bertumpuk 3x round-trip database (ditemukan
    // saat code review; hasil akhir identik, hanya lebih cepat).
    const [rowsNik, rowsRek, rowsTempat] = await Promise.all([
      sql`select nama from penerima where tahun = ${TAHUN_AKTIF} and nik = ${nikTarget} limit 1`,
      sql`select nama from penerima where tahun = ${TAHUN_AKTIF} and nomor_rekening = ${noRekTarget} limit 1`,
      cekTempatTugasRelevan
        ? sql`
            select nama, kecamatan from penerima
            where tahun = ${TAHUN_AKTIF} and layanan = ${layananTarget}
              and tempat_tugas = ${tempatTugasTarget} and alamat_tugas = ${alamatTugasTarget}
            limit 1
          `
        : Promise.resolve([]),
    ]);

    if (rowsNik.length > 0) {
      temuan.push({
        jenis: "NIK",
        ikon: "🪪",
        detail: "NIK " + nikTarget + " sudah terdaftar atas nama " + rowsNik[0].nama + ".",
      });
    }

    if (rowsRek.length > 0) {
      temuan.push({
        jenis: "REKENING",
        ikon: "🏦",
        detail: "Nomor rekening " + noRekTarget + " sudah digunakan oleh " + rowsRek[0].nama + ".",
      });
    }

    if (rowsTempat.length > 0) {
      temuan.push({
        jenis: "TEMPAT TUGAS",
        ikon: ikonRumahIbadah(layananTarget),
        detail: tempatTugasBaru + " sudah memiliki penerima untuk layanan " + layananTarget +
          " atas nama " + rowsTempat[0].nama + " (Kec. " + rowsTempat[0].kecamatan + ").",
      });
    }

    if (temuan.length > 0) {
      return { valid: false, temuan, pesan: "Ditemukan " + temuan.length + " masalah duplikasi data." };
    }

    // Hitung pemakaian kuota - query langsung (lihat catatan desain di atas berkas ini soal indeks cache).
    const hasilKuota = await cekKuotaTersedia(kecamatanBaru, layananBaru);
    if (!hasilKuota.tersedia) {
      return { valid: false, pesan: hasilKuota.pesan, kuotaHabis: true };
    }
    return { valid: true, pesan: "DATA VALID" };
  } catch (error) {
    return { valid: false, pesan: "ERROR VALIDASI SERVER: " + String(error) };
  }
}
