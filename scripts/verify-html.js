const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

const requiredIds = [
  'modal-kelola-user', 'modal-tambah-user', 'modal-edit-user', 'modal-kelola-akses-user',
  'modal-bulk-kecamatan', 'modal-ganti-password', 'modal-profil-awal', 'modal-konfirmasi-logout',
  'modal-konfirmasi-universal', 'modal-detail-penerima', 'modal-data-detail', 'modal-update-sistem',
  'modal-konfirmasi-simpan', 'modal-nama-beda', 'modal-usia-alert', 'modal-login',
  'modal-temuan-duplikat', 'modal-kuota-habis', 'modal-dashboard-progres', 'modal-progres-kuota',
  'modal-kelola-kuota', 'modal-tolak-2026', 'modal-tolak-capil', 'modal-notif-tutup',
  'btn-kelola-user', 'cari-kelola-user', 'filter-role-kelola-user', 'tbody-kelola-user',
  'form-tambah-user', 'tu-username', 'tu-password', 'tu-role', 'tu-kecamatan', 'btn-simpan-tambah-user',
  'form-edit-user', 'eu-username-target', 'eu-role', 'eu-kecamatan', 'btn-simpan-edit-user'
];

let missing = [];
requiredIds.forEach(id => {
  if (!content.includes(`id="${id}"`)) missing.push(id);
});

console.log('Total required IDs checked:', requiredIds.length);
console.log('Missing IDs:', missing.length === 0 ? 'NONE - 100% COMPLETE & INTACT' : missing);
