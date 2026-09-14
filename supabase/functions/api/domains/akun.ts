import { sql } from "../_shared/db.ts";
import { wajibSesi } from "../_shared/sesi.ts";
import { hashString } from "../_shared/hash.ts";

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
  if (passBaru.length < 6) return { sukses: false, pesan: "Password sementara minimal 6 karakter." };
  if (!/[A-Za-z]/.test(passBaru) || !/[0-9]/.test(passBaru)) {
    return { sukses: false, pesan: "Password sementara harus mengandung huruf dan angka." };
  }

  try {
    const hash = await hashString(passBaru);
    const rows = await sql`
      update akun set password_hash = ${hash}, diperbarui_at = now() where username = ${target} returning id
    `;
    if (rows.length === 0) return { sukses: false, pesan: "User tidak ditemukan." };
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
