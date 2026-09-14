// Auth Service Account Google (JWT RS256 -> access token OAuth2) tanpa library `googleapis` —
// konsisten dengan pola yang sudah dipakai domains/sso.ts (HMAC via Web Crypto, bukan library
// eksternal). Dipakai sync-worker untuk menulis ke Google Sheets API v4 langsung lewat fetch().
//
// Alur standar "Service Account JWT Bearer Flow" Google:
//   1. Bangun JWT { iss: client_email, scope, aud: token_uri, iat, exp }, sign RS256 pakai
//      private_key dari kredensial Service Account.
//   2. POST ke token_uri (https://oauth2.googleapis.com/token) dengan
//      grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>
//   3. Dapat access_token (Bearer), berlaku ~1 jam — di-cache di memory isolate, jangan minta
//      token baru tiap request (rate limit Google & lambat).

interface KredensialServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

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
 * Ambil access token OAuth2 untuk Google Sheets API (scope spreadsheets, baca+tulis).
 * Di-cache di memory isolate Edge Function, hanya minta token baru kalau sudah/hampir kedaluwarsa.
 */
export async function ambilAccessTokenGoogleSheets(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const kredensialJson = Deno.env.get("GOOGLE_SHEETS_SA_KEY_JSON");
  if (!kredensialJson) {
    throw new Error(
      "Env var GOOGLE_SHEETS_SA_KEY_JSON belum diset (kredensial Service Account Google untuk tulis Sheets API).",
    );
  }
  const kredensial: KredensialServiceAccount = JSON.parse(kredensialJson);

  const jwt = await buatJwtDitandatangani(kredensial, "https://www.googleapis.com/auth/spreadsheets");

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
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}
