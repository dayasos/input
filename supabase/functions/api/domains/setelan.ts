import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { formatTanggalWaktuWIB } from "../_shared/tanggal.ts";

// Port dari konstanta Kode.gs (KEY_INPUT_KECKEM baris 1997, PREFIX_SAKELAR_USER baris 3507).
const KEY_INPUT_KECKEM = "INPUT_KECAMATAN_KEMENAG";
const PREFIX_SAKELAR_USER = "INPUT_USER_";

// CATATAN: setHeaderUserId() (Kode.gs baris 3512) SENGAJA TIDAK diporting — dikonfirmasi lewat
// pencarian menyeluruh TIDAK dipanggil dari index.html sama sekali; murni utilitas sekali-jalan
// yang dulu dijalankan manual dari editor Apps Script untuk memastikan judul kolom H sheet
// db_admin = "USER_ID". Kolom `akun.user_id` di Postgres sudah otomatis bernama benar sejak awal.

interface BarisSetelan {
  key?: string;
  value?: string | null;
}

interface BarisRiwayatSetelan {
  waktu: Date | string;
  username?: string | null;
  nilai_baru?: string | null;
}

interface AkunPenggunaBaris {
  username?: string | null;
  role?: string | null;
  kecamatan?: string | null;
  user_id?: string | null;
  nama_lengkap?: string | null;
  nomor_hp?: string | null;
  jabatan?: string | null;
}

interface ItemDaftarUserStatus {
  username: string;
  userId: string;
  role: string;
  kecamatan: string;
  nama: string;
  hp: string;
  jabatan: string;
  status: string;
  sumber: string;
}

async function ambilSetelan(key: string): Promise<string> {
  const rows = await sql<BarisSetelan[]>`select value from setelan where key = ${key}`;
  return rows.length > 0 ? (rows[0].value || "").toString().trim().toUpperCase() : "";
}

// Port dari catatRiwayatSetelan_() — SENGAJA menelan error (tidak throw), sama seperti asli:
// gagal mencatat riwayat TIDAK BOLEH menggagalkan aksi utama yang sedang berjalan.
async function catatRiwayatSetelan(
  username: string,
  key: string,
  nilaiLama: string,
  nilaiBaru: string,
  keterangan = "",
): Promise<void> {
  try {
    await sql`
      insert into riwayat_setelan (waktu, username, key, nilai_lama, nilai_baru, keterangan)
      values (now(), ${username}, ${key}, ${nilaiLama}, ${nilaiBaru}, ${keterangan})
    `;
  } catch (_e) {
    // diam-diam diabaikan, sama seperti Logger.log() di Kode.gs
  }
}

async function inputKecKemDitutup(): Promise<boolean> {
  return (await ambilSetelan(KEY_INPUT_KECKEM)) === "TUTUP";
}

interface AksesInput {
  ditutup: boolean;
  sumber: "KHUSUS" | "MASTER";
  nilai: string;
}

// Port 1:1 dari cekAksesInputUser_() — dipakai statusInputKecKem sekarang, dan dipakai ulang
// oleh simpanDataKeSheet & editDataPenerima (Fase 4).
export async function cekAksesInputUser(userId: string): Promise<AksesInput> {
  const [nilaiKhusus, ditutup] = await Promise.all([
    userId ? ambilSetelan(PREFIX_SAKELAR_USER + userId) : Promise.resolve(null),
    inputKecKemDitutup(),
  ]);
  
  if (nilaiKhusus === "BUKA") return { ditutup: false, sumber: "KHUSUS", nilai: "BUKA" };
  if (nilaiKhusus === "TUTUP") return { ditutup: true, sumber: "KHUSUS", nilai: "TUTUP" };
  
  return { ditutup, sumber: "MASTER", nilai: ditutup ? "TUTUP" : "BUKA" };
}

// Port 1:1 dari statusInputKecKem() (Kode.gs baris 2033-2055).
export async function statusInputKecKem(token: string) {
  try {
    const sesi = await wajibSesi(token);
    const peranSesi = (sesi.role || "").toString().trim().toUpperCase();

    if (peranSesi === "UTAMA") {
      return { sukses: true, ditutup: false, sumber: "UTAMA_BEBAS" };
    }

    const akses = await cekAksesInputUser(sesi.userId);
    return { sukses: true, ditutup: akses.ditutup, sumber: akses.sumber, nilai: akses.nilai };
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
}

// Port 1:1 dari setInputKecKem() (Kode.gs baris 2060-2140), termasuk auto-cleanup sakelar khusus
// yang jadi redundan dengan master baru.
export async function setInputKecKem(token: string, buka: boolean) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah setelan ini." };
  }

  try {
    const nilaiBaru = buka ? "BUKA" : "TUTUP";
    const nilaiLama = (await ambilSetelan(KEY_INPUT_KECKEM)) || "BUKA"; // default "BUKA", sama seperti asli

    await sql`
      insert into setelan (key, value) values (${KEY_INPUT_KECKEM}, ${nilaiBaru})
      on conflict (key) do update set value = excluded.value
    `;

    let jumlahDihapus = 0;
    if (nilaiLama !== nilaiBaru) {
      await catatRiwayatSetelan(sesi.username, KEY_INPUT_KECKEM, nilaiLama, nilaiBaru);

      // AUTO-CLEANUP: sakelar khusus INPUT_USER_* yang nilainya sama dgn master baru jadi
      // redundan (mereka pasti bukan exception kalau nilainya sama dgn master) — dihapus.
      const dihapus = await sql`
        delete from setelan
        where key like ${PREFIX_SAKELAR_USER + "%"} and value = ${nilaiBaru}
        returning key
      `;
      jumlahDihapus = dihapus.length;
      if (jumlahDihapus > 0) {
        await catatRiwayatSetelan(
          sesi.username,
          "AUTO_CLEANUP_" + nilaiBaru,
          jumlahDihapus + " sakelar khusus " + nilaiBaru,
          "(dihapus, jadi redundant dgn master)",
        );
      }
    }

    return { sukses: true, ditutup: !buka, cleanup: jumlahDihapus };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari ambilStatusDetailSetelan() (Kode.gs baris 2163-2199).
export async function ambilStatusDetailSetelan(token: string) {
  try {
    await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  try {
    const ditutup = await inputKecKemDitutup();
    let terakhirUbah = { waktu: "", username: "", nilaiBaru: "" };

    const rows = await sql<BarisRiwayatSetelan[]>`
      select waktu, username, nilai_baru from riwayat_setelan
      where key = ${KEY_INPUT_KECKEM}
      order by waktu desc
      limit 1
    `;
    if (rows.length > 0) {
      terakhirUbah = {
        waktu: formatTanggalWaktuWIB(rows[0].waktu),
        username: (rows[0].username || "").toString(),
        nilaiBaru: (rows[0].nilai_baru || "").toString(),
      };
    }

    return { sukses: true, ditutup, terakhirUbah };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

interface HasilSakelar {
  action: "DIHAPUS" | "TIDAK_BERUBAH" | "DIUBAH" | "DITAMBAH" | "TIDAK_ADA_USER_ID" | "TIDAK_KETEMU";
  nilaiLama?: string;
  nilaiBaru?: string;
  alasan?: string;
}

// Port 1:1 dari setSakelarUser_() (Kode.gs baris 3587-3629) — versi private, TANPA parameter
// token/pengecekan sesi (pemanggil di modul ini sudah memvalidasi UTAMA lebih dulu; Kode.gs
// memvalidasi lagi di sini karena fungsi aslinya bisa dipanggil lepas, tapi di sini SELALU
// dipanggil dari fungsi yang sudah mengecek, jadi pengecekan ganda dihilangkan tanpa mengubah
// perilaku yang terlihat).
async function setSakelarUser(userId: string, nilaiBaru: string): Promise<HasilSakelar> {
  if (!userId) throw new Error("User ID kosong.");
  const nilaiUpper = nilaiBaru.toString().trim().toUpperCase();
  if (nilaiUpper !== "BUKA" && nilaiUpper !== "TUTUP") throw new Error("Nilai harus BUKA atau TUTUP.");

  const masterKetutup = await inputKecKemDitutup();
  const masterNilai = masterKetutup ? "TUTUP" : "BUKA";
  const keyUser = PREFIX_SAKELAR_USER + userId;
  const nilaiLama = await ambilSetelan(keyUser);

  if (nilaiUpper === masterNilai) {
    if (nilaiLama) {
      await hapusSakelarUser(userId);
      return { action: "DIHAPUS", nilaiLama, alasan: "Sama dengan master" };
    }
    return { action: "TIDAK_BERUBAH", nilaiLama: "", alasan: "Sudah default (ikut master)" };
  }

  await sql`
    insert into setelan (key, value) values (${keyUser}, ${nilaiUpper})
    on conflict (key) do update set value = excluded.value
  `;
  return nilaiLama
    ? { action: "DIUBAH", nilaiLama, nilaiBaru: nilaiUpper }
    : { action: "DITAMBAH", nilaiLama: "", nilaiBaru: nilaiUpper };
}

// Port 1:1 dari hapusSakelarUser_() (Kode.gs baris 3632-3654) — versi private, lihat catatan di atas.
async function hapusSakelarUser(userId: string): Promise<HasilSakelar> {
  if (!userId) return { action: "TIDAK_ADA_USER_ID" };
  const keyUser = PREFIX_SAKELAR_USER + userId;
  const rows = await sql`delete from setelan where key = ${keyUser} returning key`;
  return rows.length > 0 ? { action: "DIHAPUS" } : { action: "TIDAK_KETEMU" };
}

// Port 1:1 dari setSakelarUserByAdmin() (Kode.gs baris 3658-3693).
export async function setSakelarUserByAdmin(token: string, userId: string, buka: boolean) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah sakelar user." };
  }
  if (!userId) return { sukses: false, pesan: "User ID kosong." };

  try {
    const nilaiBaru = buka ? "BUKA" : "TUTUP";
    const hasil = await setSakelarUser(userId, nilaiBaru);

    if (hasil.action === "DITAMBAH" || hasil.action === "DIUBAH" || hasil.action === "DIHAPUS") {
      const nilaiLamaLog = hasil.nilaiLama || "(default)";
      const nilaiBaruLog = hasil.action === "DIHAPUS" ? "(default)" : nilaiBaru;
      await catatRiwayatSetelan(sesi.username, PREFIX_SAKELAR_USER + userId, nilaiLamaLog, nilaiBaruLog);
    }

    return {
      sukses: true,
      action: hasil.action,
      pesan: hasil.action === "TIDAK_BERUBAH"
        ? "Sakelar tidak berubah: " + hasil.alasan
        : "Sakelar user berhasil diubah.",
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari resetSakelarUserByAdmin() (Kode.gs baris 3696-3727).
export async function resetSakelarUserByAdmin(token: string, userId: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah sakelar user." };
  }
  if (!userId) return { sukses: false, pesan: "User ID kosong." };

  try {
    const nilaiLama = await ambilSetelan(PREFIX_SAKELAR_USER + userId);
    const hasil = await hapusSakelarUser(userId);

    if (hasil.action === "DIHAPUS") {
      await catatRiwayatSetelan(sesi.username, PREFIX_SAKELAR_USER + userId, nilaiLama, "(default)");
    }

    return {
      sukses: true,
      pesan: hasil.action === "DIHAPUS"
        ? "Sakelar khusus dihapus. User kembali mengikuti master."
        : "User tidak punya sakelar khusus. Sudah ikut master.",
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari ambilDaftarUserDenganStatus() (Kode.gs baris 3732-3818). Filter `role <> 'UTAMA'`
// dipindah ke SQL (dieksekusi Postgres, bukan loop JS) — hasil akhirnya sama.
export async function ambilDaftarUserDenganStatus(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengakses daftar ini." };
  }

  try {
    const rowsAkun = await sql<AkunPenggunaBaris[]>`
      select username, role, kecamatan, user_id, nama_lengkap, nomor_hp, jabatan
      from akun
      where role <> 'UTAMA'
    `;

    const rowsSetelanKhusus = await sql<BarisSetelan[]>`
      select key, value from setelan where key like ${PREFIX_SAKELAR_USER + "%"}
    `;
    const petaSakelarKhusus: Record<string, string> = {};
    for (const r of rowsSetelanKhusus) {
      const nilai = (r.value || "").toString().trim().toUpperCase();
      if (nilai === "BUKA" || nilai === "TUTUP") {
        const userId = (r.key || "").toString().toUpperCase().slice(PREFIX_SAKELAR_USER.length);
        petaSakelarKhusus[userId] = nilai;
      }
    }

    const masterKetutup = await inputKecKemDitutup();

    const daftar: ItemDaftarUserStatus[] = rowsAkun.map((r: AkunPenggunaBaris) => {
      const userId = (r.user_id || "").toString().trim().toUpperCase();
      let statusEfektif: string;
      let sumber: string;
      if (userId && petaSakelarKhusus[userId]) {
        statusEfektif = petaSakelarKhusus[userId];
        sumber = "KHUSUS";
      } else {
        statusEfektif = masterKetutup ? "TUTUP" : "BUKA";
        sumber = "MASTER";
      }
      return {
        username: String(r.username || ""),
        userId,
        role: (r.role || "").toString().trim().toUpperCase(),
        kecamatan: (r.kecamatan || "").toString().trim().toUpperCase(),
        nama: (r.nama_lengkap || "").toString().trim(),
        hp: (r.nomor_hp || "").toString().trim(),
        jabatan: (r.jabatan || "").toString().trim(),
        status: statusEfektif,
        sumber,
      };
    });

    daftar.sort((a: ItemDaftarUserStatus, b: ItemDaftarUserStatus) => {
      if (a.sumber !== b.sumber) return a.sumber === "KHUSUS" ? -1 : 1;
      if (a.kecamatan !== b.kecamatan) return a.kecamatan.localeCompare(b.kecamatan);
      return a.username.localeCompare(b.username);
    });

    return {
      sukses: true,
      daftar,
      masterKetutup,
      jumlahKhusus: Object.keys(petaSakelarKhusus).length,
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari bulkSakelarPerKecamatan() (Kode.gs baris 3823-3897).
export async function bulkSakelarPerKecamatan(token: string, namaKecamatan: string, action: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh melakukan aksi ini." };
  }

  const actionUpper = (action || "").toString().trim().toUpperCase();
  if (!["BUKA", "TUTUP", "RESET"].includes(actionUpper)) {
    return { sukses: false, pesan: "Action harus BUKA, TUTUP, atau RESET." };
  }

  try {
    const kecTarget = (namaKecamatan || "").toString().trim().toUpperCase();

    const rowsAkun = await sql<AkunPenggunaBaris[]>`
      select user_id from akun where role <> 'UTAMA' and kecamatan = ${kecTarget}
    `;
    const listUserId = rowsAkun
      .map((r: AkunPenggunaBaris) => (r.user_id || "").toString().trim().toUpperCase())
      .filter((id: string) => id.length > 0);

    if (listUserId.length === 0) {
      return { sukses: false, pesan: "Tidak ada user di kecamatan tsb." };
    }

    let berhasil = 0;
    for (const userId of listUserId) {
      try {
        if (actionUpper === "RESET") {
          await hapusSakelarUser(userId);
        } else {
          await setSakelarUser(userId, actionUpper);
        }
        berhasil++;
      } catch (_eInner) {
        // Sama seperti Kode.gs: satu user gagal tidak menghentikan proses bulk untuk user lain.
      }
    }

    const labelKec = kecTarget || "(TANPA KECAMATAN)";
    await catatRiwayatSetelan(sesi.username, "BULK_" + actionUpper + "_" + labelKec, "-", berhasil + " user");

    return {
      sukses: true,
      jumlah: berhasil,
      pesan: "Bulk " + actionUpper + " berhasil untuk " + berhasil + " user di " + labelKec + ".",
    };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}
