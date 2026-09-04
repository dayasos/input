export const config = {
  maxDuration: 60,
};

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbynxqlpYro4mIOLqTizr6JYbFVXvVcJc7axlvuaz44DvSOTr8aORzNgaHSWuOp52smPYQ/exec';

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

  try {
    // Teruskan payload POST ke Google Apps Script via text/plain (bebas CORS preflight di GAS)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    });

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
