export default async function handler(req, res) {
  // Only allow POST requests (matching how google.script.run proxies data)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const url = process.env.GAS_API_URL;
  if (!url) {
    return res.status(500).json({ error: 'Missing GAS_API_URL in environment' });
  }

  try {
    // Forward the POST body to Google Apps Script. 
    // We send it as text/plain so GAS doesn't require complex CORS preflight
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    });

    // fetch automatically follows the 302 redirect that GAS uses to serve JSON
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
