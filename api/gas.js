export const config = {
  maxDuration: 60,
};

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbynxqlpYro4mIOLqTizr6JYbFVXvVcJc7axlvuaz44DvSOTr8aORzNgaHSWuOp52smPYQ/exec';

// Fungsi helper untuk fetch dengan retry
async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      // Jika status 502, 503, 504 dari Google, kita retry. Selain itu langsung kembalikan.
      if (!res.ok && (res.status === 502 || res.status === 503 || res.status === 504)) {
        if (i === maxRetries) return res;
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff (1s, 2s)
        continue;
      }
      return res;
    } catch (err) {
      if (i === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

export default async function handler(req, res) {
  // Hanya izinkan HTTP POST (menyamai proxy google.script.run)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Ambil URL dari environment variable Vercel, dengan fallback ke DEFAULT_GAS_URL
  const url = process.env.GAS_API_URL || DEFAULT_GAS_URL;
  if (!url) {
    return res.status(500).json({ error: 'Missing GAS_API_URL in environment' });
  }

  // Siapkan payload dengan menginjeksi Secret Token
  // Jika req.body sudah berupa string, parse dulu agar bisa ditambah token.
  let payloadObj;
  try {
    payloadObj = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Injeksi token rahasia ke dalam payload
  // Variabel ini harus disetel di Vercel Dashboard -> Environment Variables
  const secretToken = process.env.GAS_SECRET_TOKEN || 'DJPM2027_DEFAULT_SECRET';
  payloadObj._secret = secretToken;

  try {
    // Teruskan payload POST ke Google Apps Script via text/plain (bebas CORS preflight di GAS)
    // Gunakan fungsi retry buatan kita
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payloadObj)
    }, 2); // 2 kali percobaan tambahan jika gagal (total 3 kali)

    // fetch otomatis mengikuti 302 redirect dari Google Apps Script
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return res.status(200).json(data);
    } catch (parseErr) {
      console.error("GAS returned non-JSON response:", text);
      return res.status(502).json({
        error: "Google Apps Script tidak mengembalikan respon JSON valid. Pastikan Web App di-deploy dengan akses 'Anyone' (Siapa saja).",
        details: text.slice(0, 500)
      });
    }
  } catch (err) {
    console.error("Vercel Proxy Error:", err);
    return res.status(500).json({ error: 'Internal Proxy Error', details: err.toString() });
  }
}
