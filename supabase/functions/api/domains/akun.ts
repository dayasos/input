import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { hashString } from "../_shared/hash.ts";
import { formatTanggalWaktuWIB } from "../_shared/tanggal.ts";
import { KECAMATAN_MEDAN_URUT } from "../_shared/config.ts";
import { kelurahanDariUserId } from "../_shared/akses.ts";

const ROLE_PENGGUNA_VALID = new Set([
  "UTAMA",
  "KECAMATAN",
  "GURU SEKOLAH BUDDHA",
  "GURU SEKOLAH HINDU",
  "GURU SEKOLAH KONG HU CHU",
  "GURU SEKOLAH MINGGU",
  "PENATUA GEREJA",
  "GURU MAGHRIB MENGAJI",
]);
// Role yang BOLEH punya kecamatan. KECAMATAN wajib; GURU MAGHRIB MENGAJI opsional — GMM tanpa
// kecamatan berlaku se-Kota Medan (akun lama "BIMAS ISLAM").
const ROLE_DENGAN_KECAMATAN = new Set(["KECAMATAN", "GURU MAGHRIB MENGAJI"]);
const ROLE_WAJIB_KECAMATAN = new Set(["KECAMATAN"]);
const KECAMATAN_VALID = new Set(KECAMATAN_MEDAN_URUT);
const PREFIX_USER_ID_KELURAHAN = "KELURAHAN ";

function validasiRoleDanKecamatan(role: string, kecamatan: string) {
  if (!ROLE_PENGGUNA_VALID.has(role)) {
    return "Role tidak valid. Pilih salah satu role resmi Manajemen Pengguna.";
  }
  if (ROLE_WAJIB_KECAMATAN.has(role) && !kecamatan) {
    return `Kecamatan wajib dipilih untuk akun role ${role}.`;
  }
  if (kecamatan && !KECAMATAN_VALID.has(kecamatan)) {
    return "Kecamatan yang dipilih tidak valid.";
  }
  return null;
}

async function kelurahanAdaDiKecamatan(kecamatan: string, kelurahan: string): Promise<boolean> {
  const rows = await sql`
    select 1 from wilayah
    where upper(trim(kecamatan)) = ${kecamatan} and upper(trim(kelurahan)) = ${kelurahan}
    limit 1
  `;
  return rows.length > 0;
}

// Nama kelurahan kembar di >1 kecamatan (mis. SEI MATI di Medan Labuhan & Medan Maimun) diberi
// sufiks kecamatan pada user_id, mengikuti data lama "KELURAHAN SEI MATI_MAIMUN" -- supaya kunci
// sakelar per-user tidak bentrok. Sufiks dibuang lagi oleh kelurahanDariUserId (akses.ts).
async function userIdKelurahan(kecamatan: string, kelurahan: string): Promise<string> {
  const rows = await sql`
    select count(distinct upper(trim(kecamatan)))::int as jumlah
    from wilayah where upper(trim(kelurahan)) = ${kelurahan}
  `;
  const kembar = Number(rows[0]?.jumlah || 0) > 1;
  return PREFIX_USER_ID_KELURAHAN + kelurahan + (kembar ? "_" + kecamatan.replace(/^MEDAN\s+/, "") : "");
}

// `akun.user_id` = kunci sakelar input per-user (setelan.ts) sekaligus penanda kelurahan-terkunci
// (akses.ts kelurahanTerkunciDari). Mengikuti konvensi data lama: "KECAMATAN <kec>",
// "KELURAHAN <kel>[_<kec>]", "GMM <kec>", GMM se-kota = "BIMAS ISLAM". Role lain -> null (tidak
// dikelola otomatis; mis. BIMAS KATOLIK/KRISTEN dipakai sebagai sub-filter GSM, jangan ditimpa).
async function userIdOtomatis(role: string, kecamatan: string, kelurahan: string): Promise<string | null> {
  if (role === "KECAMATAN") return kelurahan ? await userIdKelurahan(kecamatan, kelurahan) : "KECAMATAN " + kecamatan;
  if (role === "GURU MAGHRIB MENGAJI") return kecamatan ? "GMM " + kecamatan : "BIMAS ISLAM";
  return null;
}

function userIdBerpolaOtomatis(userId: string): boolean {
  const u = String(userId || "").trim().toUpperCase();
  return u.startsWith("KECAMATAN ") || u.startsWith(PREFIX_USER_ID_KELURAHAN) || u.startsWith("GMM ") || u === "BIMAS ISLAM";
}

// Sesi login menyimpan salinan role/kecamatan/user_id saat login (lihat _shared/sesi.ts), jadi
// setelah password atau penugasan diubah admin, sesi lama WAJIB dicabut agar hak akses lama tidak
// tetap berlaku sampai 6 jam. Dipanggil di dalam transaksi yang sama dengan perubahan akunnya.
// deno-lint-ignore no-explicit-any
async function cabutSemuaSesiAkun(trx: any, akunId: string) {
  await trx`delete from sesi_login where akun_id = ${akunId}`;
}

// Port 1:1 dari ubahAkunSendiri() (Kode.gs baris 2246-2365) — user ganti username/password sendiri.
export async function ubahAkunSendiri(
  token: string,
  passwordVerifikasi: string,
  usernameBaru: string,
  passwordBaru: string,
  konfirmasiBaru: string,
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const verif = String(passwordVerifikasi || "").trim();
  const userBaru = String(usernameBaru || "").trim();
  const passBaru = String(passwordBaru || "").trim();
  const konfirm = String(konfirmasiBaru || "").trim();

  if (!verif) return { sukses: false, pesan: "Password (verifikasi) wajib diisi." };
  const mauGantiUser = userBaru.length > 0;
  const mauGantiPass = passBaru.length > 0 || konfirm.length > 0;
  if (!mauGantiUser && !mauGantiPass) {
    return { sukses: false, pesan: "Isi username baru dan/atau password baru." };
  }

  if (mauGantiUser) {
    if (userBaru.length < 4) return { sukses: false, pesan: "Username baru minimal 4 karakter." };
    if (!/^[A-Za-z0-9_]+$/.test(userBaru)) {
      return { sukses: false, pesan: "Username baru hanya boleh huruf, angka, dan garis bawah (_)." };
    }
  }

  if (mauGantiPass) {
    if (!passBaru || !konfirm) return { sukses: false, pesan: "Password baru dan konfirmasi wajib diisi." };
    if (passBaru !== konfirm) return { sukses: false, pesan: "Password baru dan konfirmasi tidak sama." };
    if (passBaru.length < 6) return { sukses: false, pesan: "Password baru minimal 6 karakter." };
    if (!/[A-Za-z]/.test(passBaru) || !/[0-9]/.test(passBaru)) {
      return { sukses: false, pesan: "Password baru harus mengandung huruf dan angka." };
    }
    if (passBaru === verif) return { sukses: false, pesan: "Password baru tidak boleh sama dengan password lama." };
  }

  const usernameSesi = String(sesi.username || "").trim();
  if (!usernameSesi) return { sukses: false, pesan: "Sesi tidak memuat username. Silakan login ulang." };

  try {
    const rowsSelf = await sql`select id, password_hash from akun where username = ${usernameSesi} limit 1`;
    if (rowsSelf.length === 0) return { sukses: false, pesan: "Akun tidak ditemukan." };
    const { id, password_hash: passwordSheet } = rowsSelf[0];

    const hashVerif = await hashString(verif);
    if (passwordSheet !== hashVerif) return { sukses: false, pesan: "Password salah." };

    if (mauGantiUser) {
      // `akun.username` bertipe citext (case-insensitive) — perbandingan ini otomatis
      // case-insensitive sama seperti .toLowerCase() di Kode.gs, dan `id <>` mengecualikan baris
      // sendiri dari pengecekan bentrok.
      const bentrok = await sql`select 1 from akun where username = ${userBaru} and id <> ${id} limit 1`;
      if (bentrok.length > 0) {
        return { sukses: false, pesan: `Username "${userBaru}" sudah dipakai akun lain.` };
      }
    }

    const usernameBerubah = mauGantiUser && userBaru.toLowerCase() !== usernameSesi.toLowerCase();

    if (usernameBerubah && mauGantiPass) {
      const hashBaru = await hashString(passBaru);
      await sql`update akun set username = ${userBaru}, password_hash = ${hashBaru}, diperbarui_at = now() where id = ${id}`;
    } else if (usernameBerubah) {
      await sql`update akun set username = ${userBaru}, diperbarui_at = now() where id = ${id}`;
    } else if (mauGantiPass) {
      const hashBaru = await hashString(passBaru);
      await sql`update akun set password_hash = ${hashBaru}, diperbarui_at = now() where id = ${id}`;
    }

    let pesan = "Perubahan berhasil disimpan.";
    if (usernameBerubah) pesan += " Username diubah — silakan login ulang dengan username baru.";
    return { sukses: true, pesan, usernameBaru: usernameBerubah ? userBaru : "" };
  } catch (error) {
    return { sukses: false, pesan: "Gagal menyimpan perubahan: " + String(error) };
  }
}

// Port 1:1 dari ambilDaftarAkun() (Kode.gs baris 2373-2400) — khusus UTAMA.
export async function ambilDaftarAkun(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengakses daftar akun." };
  }

  interface BarisDaftarAkun {
    username: string;
    role: string | null;
    kecamatan: string | null;
  }

  try {
    const rows = await sql<BarisDaftarAkun[]>`
      select username, role, kecamatan from akun order by username
    `;
    const daftar = rows.map((r: BarisDaftarAkun) => ({
      username: r.username,
      role: (r.role || "").toString().trim().toUpperCase(),
      kecamatan: (r.kecamatan || "").toString().trim().toUpperCase(),
    }));
    return { sukses: true, daftar };
  } catch (error) {
    return { sukses: false, pesan: String(error) };
  }
}

// Port 1:1 dari resetPasswordUser() (Kode.gs baris 2404-2446) — khusus UTAMA.
export async function resetPasswordUser(token: string, usernameTarget: string, passwordSementara: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mereset password." };
  }

  const target = String(usernameTarget || "").trim();
  const passBaru = String(passwordSementara || "").trim();
  if (!target) return { sukses: false, pesan: "Pilih user yang akan direset." };
  if (target.toLowerCase() === String(sesi.username || "").trim().toLowerCase()) {
    return { sukses: false, pesan: "Tidak bisa mereset password akun Anda sendiri dari sini. Gunakan menu Akun Saya." };
  }
  if (passBaru.length < 6) return { sukses: false, pesan: "Password sementara minimal 6 karakter." };
  if (!/[A-Za-z]/.test(passBaru) || !/[0-9]/.test(passBaru)) {
    return { sukses: false, pesan: "Password sementara harus mengandung huruf dan angka." };
  }

  try {
    const hash = await hashString(passBaru);
    // deno-lint-ignore no-explicit-any
    const ditemukan = await sql.begin(async (trx: any) => {
      const rows = await trx`
        update akun set password_hash = ${hash}, diperbarui_at = now() where username = ${target} returning id
      `;
      if (rows.length === 0) return false;
      await cabutSemuaSesiAkun(trx, rows[0].id);
      return true;
    });
    if (!ditemukan) return { sukses: false, pesan: "User tidak ditemukan." };
    return {
      sukses: true,
      pesan: `Password untuk "${target}" berhasil direset. Sampaikan password sementara ini ke user, lalu minta mereka menggantinya lewat menu Akun Saya.`,
    };
  } catch (error) {
    return { sukses: false, pesan: "Gagal reset: " + String(error) };
  }
}

// Port dari simpanProfilKeSheet_() (Kode.gs baris 2526-2564) — helper internal, dipakai
// simpanProfilUser (profil sendiri) & ubahProfilUser (admin ubah profil user lain).
// Otorisasi: pemilik akun sendiri ATAU UTAMA.
async function simpanProfilKeAkun(sesi: { username: string; role: string }, usernameTarget: string, nama: string, hp: string, jabatan: string) {
  const peran = (sesi.role || "").toString().trim().toUpperCase();
  const milikSendiri = (sesi.username || "").toString().trim() === String(usernameTarget || "").trim();
  if (!milikSendiri && peran !== "UTAMA") {
    return { sukses: false, pesan: "Anda tidak berhak mengubah profil akun ini." };
  }

  try {
    const rows = await sql`
      update akun set nama_lengkap = ${nama}, nomor_hp = ${hp}, jabatan = ${jabatan}, diperbarui_at = now()
      where username = ${usernameTarget}
      returning id
    `;
    if (rows.length === 0) return { sukses: false, pesan: "Akun tidak ditemukan." };
    return { sukses: true, pesan: "Profil berhasil disimpan." };
  } catch (error) {
    return { sukses: false, pesan: "Gagal menyimpan profil: " + String(error) };
  }
}

// Bersihkan nomor HP jaga leading zero — port dari pola berulang di Kode.gs
// (simpanProfilUser baris 2462-2463, ubahProfilUser baris 2511-2512).
function bersihkanNomorHp(nomorHp: string): string {
  let hp = String(nomorHp || "").trim().replace(/[^0-9]/g, "");
  if (hp && hp[0] !== "0") hp = "0" + hp;
  return hp;
}

// Port 1:1 dari simpanProfilUser() (Kode.gs baris 2455-2497) — dipanggil user sendiri saat
// pertama login (sekaligus wajib ganti password).
export async function simpanProfilUser(token: string, namaLengkap: string, nomorHp: string, jabatan: string, passwordBaru: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }

  const nama = String(namaLengkap || "").trim().toUpperCase();
  const hp = bersihkanNomorHp(nomorHp);
  const jbt = String(jabatan || "").trim().toUpperCase();
  const pb = String(passwordBaru || "").trim();

  if (!nama) return { sukses: false, pesan: "Nama lengkap wajib diisi." };
  if (!hp || !hp.startsWith("08") || hp.length < 10) {
    return { sukses: false, pesan: "Nomor HP tidak valid. Harus diawali 08 dan minimal 10 digit angka." };
  }
  if (!jbt) return { sukses: false, pesan: "Jabatan wajib diisi." };
  if (!pb) return { sukses: false, pesan: "Password baru wajib diisi." };
  if (pb.length < 6) return { sukses: false, pesan: "Password baru minimal 6 karakter." };
  if (!/[A-Za-z]/.test(pb) || !/[0-9]/.test(pb)) {
    return { sukses: false, pesan: "Password baru harus mengandung huruf dan angka." };
  }

  try {
    const hash = await hashString(pb);
    const rowsPw = await sql`
      update akun set password_hash = ${hash}, diperbarui_at = now() where username = ${sesi.username} returning id
    `;
    if (rowsPw.length === 0) return { sukses: false, pesan: "Akun tidak ditemukan." };
  } catch (error) {
    return { sukses: false, pesan: "Gagal menyimpan password: " + String(error) };
  }

  return await simpanProfilKeAkun(sesi, sesi.username, nama, hp, jbt);
}

// Port 1:1 dari ubahProfilUser() (Kode.gs baris 2500-2523) — dipanggil admin utama untuk
// mengubah profil user lain (TANPA mengubah password).
export async function ubahProfilUser(token: string, usernameTarget: string, namaLengkap: string, nomorHp: string, jabatan: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang boleh mengubah profil user lain." };
  }

  const target = String(usernameTarget || "").trim();
  const nama = String(namaLengkap || "").trim().toUpperCase();
  const hp = bersihkanNomorHp(nomorHp);
  const jbt = String(jabatan || "").trim().toUpperCase();

  if (!target) return { sukses: false, pesan: "Pilih user yang profilnya akan diubah." };
  if (!nama) return { sukses: false, pesan: "Nama lengkap wajib diisi." };
  if (!hp || !hp.startsWith("08") || hp.length < 10) {
    return { sukses: false, pesan: "Nomor HP tidak valid." };
  }
  if (!jbt) return { sukses: false, pesan: "Jabatan wajib diisi." };

  return await simpanProfilKeAkun(sesi, target, nama, hp, jbt);
}

// ============================================================================
// CRUD PENGGUNA PENUH (USER MANAGEMENT BY ROLE) - KHUSUS ROLE UTAMA
// Memungkinkan penambahan, pengubahan, dan penghapusan pengguna langsung dari UI
// ============================================================================

interface UserBaruInput {
  username: string;
  password: string;
  role: string;
  kecamatan?: string;
  kelurahan?: string;
  namaLengkap?: string;
  nomorHp?: string;
  jabatan?: string;
}

export async function tambahUserBaru(token: string, userObj: UserBaruInput) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang berhak menambah pengguna baru." };
  }

  const uName = String(userObj?.username || "").trim();
  const pass = String(userObj?.password || "").trim();
  const role = String(userObj?.role || "").trim().toUpperCase();
  const kec = String(userObj?.kecamatan || "").trim().toUpperCase();
  const nama = String(userObj?.namaLengkap || "").trim().toUpperCase();
  const hp = bersihkanNomorHp(userObj?.nomorHp || "");
  const jbt = String(userObj?.jabatan || "").trim().toUpperCase();

  if (!uName || uName.length < 4) {
    return { sukses: false, pesan: "Username minimal 4 karakter." };
  }
  if (!/^[A-Za-z0-9_]+$/.test(uName)) {
    return { sukses: false, pesan: "Username hanya boleh huruf, angka, dan underscore (_)." };
  }
  if (!pass || pass.length < 6) {
    return { sukses: false, pesan: "Password minimal 6 karakter." };
  }
  if (!/[A-Za-z]/.test(pass) || !/[0-9]/.test(pass)) {
    return { sukses: false, pesan: "Password harus memuat kombinasi huruf dan angka." };
  }
  if (!role) {
    return { sukses: false, pesan: "Role pengguna wajib dipilih." };
  }
  const pesanValidasiRole = validasiRoleDanKecamatan(role, kec);
  if (pesanValidasiRole) return { sukses: false, pesan: pesanValidasiRole };
  const kecamatanSimpan = ROLE_DENGAN_KECAMATAN.has(role) ? kec : "";
  // Kelurahan hanya berlaku untuk role KECAMATAN; kosong = seluruh kelurahan di kecamatan itu.
  const kelurahanSimpan = role === "KECAMATAN" ? String(userObj?.kelurahan || "").trim().toUpperCase() : "";

  try {
    if (kelurahanSimpan && !(await kelurahanAdaDiKecamatan(kecamatanSimpan, kelurahanSimpan))) {
      return { sukses: false, pesan: `Kelurahan "${kelurahanSimpan}" tidak terdaftar di Kecamatan ${kecamatanSimpan}.` };
    }

    const existing = await sql`select id from akun where lower(username) = lower(${uName}) limit 1`;
    if (existing.length > 0) {
      return { sukses: false, pesan: `Username "${uName}" sudah digunakan oleh akun lain.` };
    }

    const hash = await hashString(pass);
    const userIdSimpan = (await userIdOtomatis(role, kecamatanSimpan, kelurahanSimpan)) ?? "";
    // Kolom kecamatan/nama_lengkap/nomor_hp/jabatan/user_id bertipe NOT NULL default '' — kirim '' bukan null.
    await sql`
      insert into akun (username, password_hash, role, kecamatan, user_id, nama_lengkap, nomor_hp, jabatan, aktif, dibuat_at, diperbarui_at)
      values (${uName}, ${hash}, ${role}, ${kecamatanSimpan}, ${userIdSimpan}, ${nama}, ${hp}, ${jbt}, true, now(), now())
    `;

    return { sukses: true, pesan: `Pengguna "${uName}" (${role}) berhasil ditambahkan.` };
  } catch (err) {
    return { sukses: false, pesan: "Gagal menambah user: " + String(err) };
  }
}

export async function ambilDaftarAkunLengkap(token: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang berwenang melihat daftar akun lengkap." };
  }

  try {
    const rows = await sql`
      select id, username, role, kecamatan, user_id, nama_lengkap, nomor_hp, jabatan, aktif, dibuat_at
      from akun
      order by role asc, kecamatan asc, username asc
    `;

    const daftar = rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      username: String(r.username || ""),
      role: (r.role || "").toString().trim().toUpperCase(),
      kecamatan: (r.kecamatan || "").toString().trim().toUpperCase(),
      kelurahan: kelurahanDariUserId(String(r.user_id || "")),
      namaLengkap: String(r.nama_lengkap || ""),
      nomorHp: String(r.nomor_hp || ""),
      jabatan: String(r.jabatan || ""),
      aktif: r.aktif !== false,
      dibuatAt: r.dibuat_at ? formatTanggalWaktuWIB(r.dibuat_at as string) : "-",
    }));

    return { sukses: true, daftar };
  } catch (error) {
    return { sukses: false, pesan: "Gagal memuat daftar akun: " + String(error) };
  }
}

export async function ubahDataUserOlehAdmin(
  token: string,
  usernameTarget: string,
  dataEdit: {
    role?: string;
    kecamatan?: string;
    kelurahan?: string;
    namaLengkap?: string;
    nomorHp?: string;
    jabatan?: string;
  }
) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang berwenang mengubah akun." };
  }

  const target = String(usernameTarget || "").trim();
  if (!target) return { sukses: false, pesan: "Target username tidak valid." };

  const role = dataEdit.role !== undefined ? String(dataEdit.role).trim().toUpperCase() : null;
  const kec = dataEdit.kecamatan !== undefined ? String(dataEdit.kecamatan).trim().toUpperCase() : null;
  const kel = dataEdit.kelurahan !== undefined ? String(dataEdit.kelurahan).trim().toUpperCase() : null;
  const nama = dataEdit.namaLengkap ? String(dataEdit.namaLengkap).trim().toUpperCase() : null;
  const hp = dataEdit.nomorHp ? bersihkanNomorHp(dataEdit.nomorHp) : null;
  const jbt = dataEdit.jabatan ? String(dataEdit.jabatan).trim().toUpperCase() : null;

  try {
    const existing = await sql`select id, role, kecamatan, user_id from akun where username = ${target} limit 1`;
    if (existing.length === 0) return { sukses: false, pesan: `Akun "${target}" tidak ditemukan.` };
    const lama = existing[0];
    const roleLama = String(lama.role || "").trim().toUpperCase();
    const kecamatanLama = String(lama.kecamatan || "").trim().toUpperCase();
    const userIdLama = String(lama.user_id || "");
    const kelurahanLama = kelurahanDariUserId(userIdLama);

    const roleAkhir = role === null ? roleLama : role;
    const akunSendiri = target.toLowerCase() === String(sesi.username || "").trim().toLowerCase();
    if (akunSendiri && roleAkhir !== "UTAMA") {
      return { sukses: false, pesan: "Anda tidak dapat mengubah role akun Anda sendiri yang sedang aktif." };
    }
    const kecamatanAkhir = kec === null ? kecamatanLama : kec;
    const pesanValidasiRole = validasiRoleDanKecamatan(roleAkhir, kecamatanAkhir);
    if (pesanValidasiRole) return { sukses: false, pesan: pesanValidasiRole };
    const kecamatanSimpan = ROLE_DENGAN_KECAMATAN.has(roleAkhir) ? kecamatanAkhir : "";
    const kelurahanAkhir = roleAkhir === "KECAMATAN" ? (kel === null ? kelurahanLama : kel) : "";

    // Penugasan (role/kecamatan/kelurahan) tidak berubah -> user_id lama dipertahankan apa adanya,
    // supaya menyimpan profil saja tidak mengganti kunci sakelar per-user akun tersebut.
    const penugasanBerubah = roleAkhir !== roleLama || kecamatanSimpan !== kecamatanLama || kelurahanAkhir !== kelurahanLama;
    let userIdAkhir = userIdLama;
    if (penugasanBerubah) {
      if (kelurahanAkhir && !(await kelurahanAdaDiKecamatan(kecamatanSimpan, kelurahanAkhir))) {
        return { sukses: false, pesan: `Kelurahan "${kelurahanAkhir}" tidak terdaftar di Kecamatan ${kecamatanSimpan}.` };
      }
      const otomatis = await userIdOtomatis(roleAkhir, kecamatanSimpan, kelurahanAkhir);
      // Role tanpa pola otomatis: buang user_id wilayah lama (supaya kunci kelurahan/sakelar
      // kecamatan tidak terbawa ke role baru), tapi pertahankan user_id khusus lain (mis. BIMAS KATOLIK).
      userIdAkhir = otomatis ?? (userIdBerpolaOtomatis(userIdLama) ? "" : userIdLama);
    }

    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      await trx`
        update akun set
          role = ${roleAkhir},
          kecamatan = ${kecamatanSimpan},
          user_id = ${userIdAkhir},
          nama_lengkap = coalesce(${nama}, nama_lengkap),
          nomor_hp = coalesce(${hp}, nomor_hp),
          jabatan = coalesce(${jbt}, jabatan),
          diperbarui_at = now()
        where id = ${lama.id}
      `;
      if (penugasanBerubah) await cabutSemuaSesiAkun(trx, lama.id);
    });

    let pesan = `Data pengguna "${target}" berhasil diperbarui.`;
    if (penugasanBerubah) pesan += " Hak akses berubah — user tersebut perlu login ulang.";
    return { sukses: true, pesan };
  } catch (err) {
    return { sukses: false, pesan: "Gagal memperbarui data user: " + String(err) };
  }
}

export async function hapusUser(token: string, usernameTarget: string) {
  let sesi;
  try {
    sesi = await wajibSesi(token);
  } catch (e) {
    return { sukses: false, pesan: e instanceof Error ? e.message : String(e) };
  }
  if ((sesi.role || "").toString().trim().toUpperCase() !== "UTAMA") {
    return { sukses: false, pesan: "Hanya admin utama yang berwenang menghapus akun." };
  }

  const target = String(usernameTarget || "").trim();
  if (!target) return { sukses: false, pesan: "Target username tidak valid." };

  // Anti self-lockout: tidak boleh menghapus akun yang sedang dipakai
  if (sesi.username.toLowerCase() === target.toLowerCase()) {
    return { sukses: false, pesan: "Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif." };
  }

  try {
    const existing = await sql`select id from akun where username = ${target} limit 1`;
    if (existing.length === 0) return { sukses: false, pesan: `Akun "${target}" tidak ditemukan.` };

    const akunId = existing[0].id;

    // Sesi aktif (sesi_login) ikut terhapus lewat FK on delete cascade; dihapus eksplisit juga
    // dalam transaksi yang sama supaya tidak bergantung pada definisi FK saja.
    // deno-lint-ignore no-explicit-any
    await sql.begin(async (trx: any) => {
      await cabutSemuaSesiAkun(trx, akunId);
      await trx`delete from akun where id = ${akunId}`;
    });

    return { sukses: true, pesan: `Akun pengguna "${target}" berhasil dihapus.` };
  } catch (err) {
    return { sukses: false, pesan: "Gagal menghapus akun: " + String(err) };
  }
}
