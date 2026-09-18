// Auth Google API tanpa library `googleapis` — konsisten dengan pola yang sudah dipakai
// domains/sso.ts (HMAC via Web Crypto, bukan library eksternal). DUA metode auth dipakai di sini
// utk DUA tujuan yang beda karakteristik kuota:
//
// 1. Service Account JWT Bearer Flow (Sheets API) -- dipakai backup-spreadsheet MENGEDIT
//    spreadsheet yang SUDAH ADA (values.update/batchUpdate). Ini aman lewat Service Account biasa
//    karena tidak membuat file/byte baru -- tidak pernah menyentuh kuota penyimpanan.
//
// 2. OAuth 2.0 refresh-token Flow, atas nama AKUN GOOGLE ASLI (Drive API, upload berkas) --
//    ditambahkan 2026-09-18 setelah terbukti langsung dari tes produksi: Service Account TIDAK
//    BISA membuat file (byte sungguhan) di folder Drive personal walau folder itu sudah di-share
//    Editor ke client_email-nya -- Google menolak dgn 403 storageQuotaExceeded ("Service Accounts
//    do not have storage quota. Leverage shared drives, or use OAuth delegation instead.").
//    Shared Drive butuh Google Workspace (tidak tersedia di kasus ini -- folder Drive tujuan
//    dimiliki akun Gmail personal biasa), jadi jalan yang dipakai: refresh_token OAuth atas nama
//    akun Gmail pemilik folder itu sendiri (didapat SEKALI via proses manual, lihat catatan di
//    percakapan implementasi) -- akun asli itu punya kuota penuh, tidak ada batasan sama sekali.

interface KredensialServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";

// Cache per-scope (bukan 1 variabel tunggal) -- token utk scope Sheets & Drive punya masa
// berlaku sendiri-sendiri dan diminta lewat request JWT yang berbeda.
const cachedTokenPerScope = new Map<string, { token: string; expiresAt: number }>();

let cachedDriveOAuthToken: { token: string; expiresAt: number } | null = null;

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

// Private key dari JSON Service Account dalam format PEM (-----BEGIN PRIVATE KEY-----...) —
// perlu di-decode ke DER binary sebelum diimpor Web Crypto (yang butuh format "pkcs8" mentah).
function pemKeSpkiDer(pem: string): ArrayBuffer {
  const bersih = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(bersih);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function buatJwtDitandatangani(kredensial: KredensialServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: kredensial.client_email,
    scope,
    aud: kredensial.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = base64UrlEncodeString(JSON.stringify(header));
  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const dataUntukDitandatangani = `${headerB64}.${payloadB64}`;

  const keyDer = pemKeSpkiDer(kredensial.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(dataUntukDitandatangani),
  );
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuffer));

  return `${dataUntukDitandatangani}.${sigB64}`;
}

/**
 * Ambil access token OAuth2 Service Account untuk scope Google API tertentu. Di-cache per-scope
 * di memory isolate Edge Function, hanya minta token baru kalau sudah/hampir kedaluwarsa.
 * Kredensial Service Account dibaca dari env var GOOGLE_SHEETS_SA_KEY_JSON (nama env var
 * dipertahankan apa adanya walau sekarang dipakai lintas-scope, supaya secret yang sudah
 * di-set di Supabase tidak perlu diganti/di-set ulang).
 */
export async function ambilAccessTokenGoogle(scope: string): Promise<string> {
  const now = Date.now();
  const cached = cachedTokenPerScope.get(scope);
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.token;
  }

  const kredensialJson = Deno.env.get("GOOGLE_SHEETS_SA_KEY_JSON");
  if (!kredensialJson) {
    throw new Error(
      "Env var GOOGLE_SHEETS_SA_KEY_JSON belum diset (kredensial Service Account Google, dipakai lintas Sheets API & Drive API).",
    );
  }
  const kredensial: KredensialServiceAccount = JSON.parse(kredensialJson);

  const jwt = await buatJwtDitandatangani(kredensial, scope);

  const res = await fetch(kredensial.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!res.ok) {
    const teksError = await res.text();
    throw new Error(`Gagal ambil access token Google (${res.status}): ${teksError}`);
  }

  const data = await res.json();
  const entry = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 };
  cachedTokenPerScope.set(scope, entry);
  return entry.token;
}

/** Ambil access token OAuth2 untuk Google Sheets API (scope spreadsheets, baca+tulis). */
export async function ambilAccessTokenGoogleSheets(): Promise<string> {
  return ambilAccessTokenGoogle(SCOPE_SHEETS);
}

/**
 * Ambil access token OAuth2 utk Drive API, ATAS NAMA AKUN GOOGLE ASLI pemilik folder (bukan
 * Service Account) -- lewat OAuth 2.0 refresh-token flow. Lihat catatan panjang di atas kenapa
 * ini WAJIB dipakai (bukan JWT Service Account) khusus utk operasi yang membuat file baru di
 * Drive. refresh_token didapat SEKALI lewat proses otorisasi manual (mis. via OAuth Playground),
 * tidak pernah kedaluwarsa kecuali di-revoke manual dari myaccount.google.com/permissions.
 */
export async function ambilAccessTokenGoogleDrive(): Promise<string> {
  const now = Date.now();
  if (cachedDriveOAuthToken && cachedDriveOAuthToken.expiresAt > now + 60_000) {
    return cachedDriveOAuthToken.token;
  }

  const clientId = Deno.env.get("GOOGLE_DRIVE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Env var GOOGLE_DRIVE_OAUTH_CLIENT_ID/GOOGLE_DRIVE_OAUTH_CLIENT_SECRET/GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN " +
      "belum lengkap diset (kredensial OAuth akun Google asli pemilik folder Drive, dipakai khusus Drive API upload).",
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    const teksError = await res.text();
    throw new Error(`Gagal refresh access token Drive (OAuth akun asli): ${res.status} ${teksError}`);
  }

  const data = await res.json();
  cachedDriveOAuthToken = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 };
  return cachedDriveOAuthToken.token;
}
