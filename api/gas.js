export const config = {
  maxDuration: 60,
};

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzz_K4XfFkOgOe5Q1evz3nml6x7_4Jv_vV1iN35AfFTYjo4ZY8t0v29poh1No2_oaoc_Q/exec';

// Fungsi helper untuk fetch dengan retry dan timeout
async function fetchWithRetry(url, options, maxRetries = 2) {
  let lastError = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      // Jika status 502, 503, 504 dari Google, kita retry. Selain itu langsung kembalikan.
      if (!res.ok && (res.status === 502 || res.status === 503 || res.status === 504)) {
        if (i === maxRetries) return res;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (i === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

function sanitizeUrl(raw) {
  if (!raw) return DEFAULT_GAS_URL;
  let u = raw.trim().replace(/^["']|["']$/g, '');
  if (u.startsWith('ttps://')) u = 'h' + u; // Otomatis perbaiki jika huruf 'h' tertinggal saat copy-paste
  if (u.startsWith('http://')) u = 'https://' + u.slice(7);
  if (!u.startsWith('https://script.google.com/macros/s/')) return DEFAULT_GAS_URL;
  return u;
}

export default async function handler(req, res) {
  const rawEnv = process.env.GAS_API_URL || '';
  const sanitizedTargetUrl = sanitizeUrl(rawEnv);

  // 1. Endpoint Health-Check jika diakses via GET
  if (req.method === 'GET') {
    let pingStatus = 'untested';

    try {
      const testRes = await fetch(sanitizedTargetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        },
        body: JSON.stringify({
          action: 'ping',
          _secret: process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET'
        })
      });
      pingStatus = { status: testRes.status, ok: testRes.ok };
    } catch (pingErr) {
      pingStatus = {
        error: pingErr.message,
        cause: pingErr.cause ? (pingErr.cause.message || pingErr.cause.code || String(pingErr.cause)) : null
      };
    }

    return res.status(200).json({
      status: 'API Proxy Online',
      envConfigured: Boolean(rawEnv),
      activeBackendUrl: sanitizedTargetUrl,
      isUsingFallback: sanitizedTargetUrl === DEFAULT_GAS_URL && rawEnv !== DEFAULT_GAS_URL,
      pingTest: pingStatus
    });
  }

  // 2. Hanya izinkan POST untuk pemanggilan fungsi backend
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 3. Gunakan URL yang telah disanitasi
  let targetUrl = sanitizedTargetUrl;

  // 4. Siapkan payload dan injeksi Secret Token
  let payloadObj = {};
  try {
    if (req.body) {
      payloadObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Format JSON payload tidak valid', details: e.message });
  }

  const secretToken = process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET';
  payloadObj._secret = secretToken;

  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    },
    body: JSON.stringify(payloadObj),
    redirect: 'follow'
  };

  // 5. Eksekusi fetch dengan otomatis fallback ke DEFAULT_GAS_URL jika target awal gagal (baik network error maupun HTML error)
  let response = null;
  let usedUrl = targetUrl;
  let fallbackAttempted = false;

  const executeFetch = async (endpoint) => {
    return await fetchWithRetry(endpoint, fetchOptions, 2);
  };

  try {
    let text = '';
    try {
      response = await executeFetch(targetUrl);
      text = await response.text();
      // Verifikasi apakah respon berupa JSON
      JSON.parse(text);
    } catch (initialErr) {
      // Jika URL dari ENV gagal (network error atau respon bukan JSON), dan beda dari DEFAULT_GAS_URL
      if (targetUrl !== DEFAULT_GAS_URL) {
        console.warn(`Fetch ke targetUrl gagal (${initialErr.message}). Otomatis fallback ke DEFAULT_GAS_URL...`);
        fallbackAttempted = true;
        usedUrl = DEFAULT_GAS_URL;
        response = await executeFetch(DEFAULT_GAS_URL);
        text = await response.text();
      } else {
        throw initialErr;
      }
    }

    try {
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (parseErr) {
      console.error("GAS returned non-JSON response:", text);
      return res.status(502).json({
        error: "Google Apps Script tidak mengembalikan respon JSON valid. Pastikan Web App di-deploy dengan akses 'Anyone' (Siapa saja).",
        details: text.slice(0, 500),
        usedUrl,
        fallbackAttempted
      });
    }
  } catch (err) {
    console.error("Vercel Proxy Error:", err);
    return res.status(500).json({
      error: 'Terjadi kesalahan koneksi antara server Vercel dan Google Apps Script.',
      details: err.toString(),
      cause: err.cause ? (err.cause.message || err.cause.code || String(err.cause)) : null,
      usedUrl,
      fallbackAttempted
    });
  }
}


