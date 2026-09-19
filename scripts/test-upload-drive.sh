#!/usr/bin/env bash
# Skrip uji cepat alur upload Drive API v3 (mintaUrlUploadBerkasDrive -> PUT byte langsung ke
# Google -> konfirmasiUploadBerkasDrive) TANPA lewat browser -- dipakai memverifikasi langkah 1-2
# dari rencana rollout sebelum dicoba dari browser sungguhan (lihat catatan CORS di percakapan).
#
# Cara pakai (Git Bash):
#   export DJPM_USERNAME="username_anda"
#   export DJPM_PASSWORD="password_anda"
#   export GAS_SECRET_TOKEN="nilai_sama_dgn_env_var_GAS_SECRET_TOKEN_di_Supabase"
#   export TEST_FILE="/c/path/ke/file/test.jpg"
#   bash scripts/test-upload-drive.sh
#
# Skrip ini membuat folder/file SUNGGUHAN di Drive (di bawah folder
# "TES SKRIP/TES UPLOAD/TES NAMA (0000000000000001)") -- hapus manual setelah selesai tes.

set -euo pipefail

EDGE_URL="${EDGE_URL:-https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api}"
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXhic2N1bWFha3Z6aXd6d2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjQ2MTMsImV4cCI6MjEwNDEwMDYxM30.W0hJsUzcnYaOWfF-NHKR1F3RnJR8j-vJsDDqBF636hQ}"
GAS_SECRET_TOKEN="${GAS_SECRET_TOKEN:?Set GAS_SECRET_TOKEN dulu (sama persis dgn secret GAS_SECRET_TOKEN di Supabase edge function)}"
DJPM_USERNAME="${DJPM_USERNAME:?Set DJPM_USERNAME (akun login aplikasi yang valid)}"
DJPM_PASSWORD="${DJPM_PASSWORD:?Set DJPM_PASSWORD}"
TEST_FILE="${TEST_FILE:?Set TEST_FILE ke path file gambar/PDF kecil utk tes}"
TEST_MIME="${TEST_MIME:-image/jpeg}"

ambil_json() {
  # $1 = JSON string, $2 = path node (mis. "result.token")
  node -e "
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      const j = JSON.parse(d);
      const path = '$2'.split('.');
      let v = j;
      for (const p of path) v = v && v[p];
      if (v === undefined || v === null) { process.stderr.write('Path $2 tidak ditemukan di respons.\n'); process.exit(1); }
      process.stdout.write(String(v));
    });
  " <<< "$1"
}

echo "== 1. Login (dapatkan session token) =="
LOGIN_RES=$(curl -sS -X POST "$EDGE_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d "{\"action\":\"loginPengguna\",\"args\":[\"$DJPM_USERNAME\",\"$DJPM_PASSWORD\"],\"_secret\":\"$GAS_SECRET_TOKEN\"}")
echo "$LOGIN_RES"
TOKEN=$(ambil_json "$LOGIN_RES" "result.token")
echo "-> Token didapat."

echo
echo "== 2. Minta sesi upload Drive (mintaUrlUploadBerkasDrive) =="
NAMA_FILE=$(basename "$TEST_FILE")
SESI_PAYLOAD=$(cat <<EOF
{"action":"mintaUrlUploadBerkasDrive","args":["$TOKEN",{"kecamatan":"TES SKRIP","layanan":"TES UPLOAD","nama":"TES NAMA","nik":"0000000000000001"},{"tes":{"namaFile":"$NAMA_FILE","mimeType":"$TEST_MIME","label":"Tes Skrip"}}]}
EOF
)
SESI_RES=$(curl -sS -X POST "$EDGE_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-session-token: $TOKEN" \
  -d "$SESI_PAYLOAD")
echo "$SESI_RES"
FOLDER_ID=$(ambil_json "$SESI_RES" "result.folderId")
UPLOAD_URI=$(ambil_json "$SESI_RES" "result.daftarSesi.tes.uploadSessionUri")
echo "-> Folder ID: $FOLDER_ID"
echo "-> Upload session URI didapat."

echo
echo "== 3. PUT byte file lewat proxy Edge Function (driveProxy.ts) ke Google =="
# CATATAN (2026-09-19): sejak fix CORS 2026-09-18, UPLOAD_URI di atas SUDAH berupa URL proxy
# Edge Function kita (endpoint /drive-proxy-upload), BUKAN lagi URL googleapis.com langsung --
# proxy ini WAJIB header x-session-token (lihat driveProxy.ts tanganiProxyUploadDrive). Tanpa
# header ini permintaan akan ditolak 401, bukan menguji upload sungguhan.
PUT_RES=$(curl -sS -X PUT "$UPLOAD_URI" -H "Content-Type: $TEST_MIME" -H "x-session-token: $TOKEN" --data-binary "@$TEST_FILE")
echo "$PUT_RES"
FILE_ID=$(ambil_json "$PUT_RES" "id")
echo "-> File ID: $FILE_ID"

echo
echo "== 4. Konfirmasi (set izin akses publik + bentuk link) =="
KONFIRM_RES=$(curl -sS -X POST "$EDGE_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "x-session-token: $TOKEN" \
  -d "{\"action\":\"konfirmasiUploadBerkasDrive\",\"args\":[\"$TOKEN\",\"$FOLDER_ID\",{\"tes\":\"$FILE_ID\"}]}")
echo "$KONFIRM_RES"

echo
echo "== SELESAI =="
echo "Cek folder \"TES SKRIP/TES UPLOAD/TES NAMA (0000000000000001)\" di Drive, buka link di atas,"
echo "pastikan file bisa dibuka tanpa perlu login. Hapus folder tes ini manual setelah selesai."
