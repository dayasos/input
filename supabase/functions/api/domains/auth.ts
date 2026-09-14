import { sql } from "../_shared/db.ts";
import { hashString } from "../_shared/hash.ts";
import { ambilSesi, buatSesi, hapusSesi } from "../_shared/sesi.ts";
import { catatGagal, cekTerkunci, resetPercobaan } from "../_shared/bruteforce.ts";

// Port 1:1 dari loginPengguna() di Kode.gs — kontrak respons (field & pesan) dipertahankan
// identik supaya index.html/js/api-bridge.js tidak perlu diubah sama sekali.
export async function loginPengguna(username: string, password: string) {
  try {
    const usernameInput = String(username || "").trim();
    const usernameUpper = usernameInput.toUpperCase();

    if (await cekTerkunci(usernameUpper)) {
      return {
        sukses: false,
        pesan: "Terlalu banyak percobaan login gagal untuk akun ini. Coba lagi dalam beberapa menit.",
      };
    }

    const passwordHashInput = await hashString(String(password || "").trim());

    const rows = await sql`
      select id, username, password_hash, role, kecamatan, user_id, nama_lengkap, nomor_hp, jabatan
      from akun
      where upper(username) = ${usernameUpper} and aktif = true
      limit 1
    `;

    if (rows.length > 0 && rows[0].password_hash === passwordHashInput) {
      await resetPercobaan(usernameUpper);
      const akun = rows[0];
      const token = await buatSesi({
        akunId: akun.id,
        username: akun.username,
        role: akun.role,
        kecamatan: akun.kecamatan,
        userId: akun.user_id,
      });
      const profileBelumDiisi = !akun.nama_lengkap;
      return {
        sukses: true,
        token,
        username: akun.username,
        role: akun.role,
        kecamatan: akun.kecamatan,
        userId: akun.user_id,
        profileBelumDiisi,
        profil: {
          namaLengkap: akun.nama_lengkap || "",
          nomorHp: akun.nomor_hp || "",
          jabatan: akun.jabatan || "",
        },
        pesan: "Login berhasil.",
      };
    }

    await catatGagal(usernameUpper);
    return { sukses: false, pesan: "Username atau password salah." };
  } catch (e) {
    return { sukses: false, pesan: "Error sistem: " + String(e) };
  }
}

// Port 1:1 dari logoutPengguna()
export async function logoutPengguna(token: string) {
  try {
    if (!token) return { sukses: true };
    await hapusSesi(token);
    return { sukses: true, pesan: "Sesi berhasil dihapus." };
  } catch (e) {
    return { sukses: false, error: String(e) };
  }
}

// Port 1:1 dari pulihkanSesi()
export async function pulihkanSesi(token: string) {
  const sesi = await ambilSesi(token);
  if (!sesi || !sesi.role) {
    return { sukses: false, pesan: "Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang." };
  }

  let namaLengkap = "";
  let nomorHp = "";
  let jabatan = "";
  try {
    const rows = await sql`
      select nama_lengkap, nomor_hp, jabatan from akun where id = ${sesi.akunId} limit 1
    `;
    if (rows.length > 0) {
      namaLengkap = rows[0].nama_lengkap || "";
      nomorHp = rows[0].nomor_hp || "";
      jabatan = rows[0].jabatan || "";
    }
  } catch (_e) {
    // abaikan — sesi dasar tetap dipulihkan meski gagal ambil profil terbaru
  }

  return {
    sukses: true,
    token,
    username: sesi.username,
    role: sesi.role,
    kecamatan: sesi.kecamatan,
    userId: sesi.userId || "",
    profileBelumDiisi: !namaLengkap,
    profil: { namaLengkap, nomorHp, jabatan },
  };
}
