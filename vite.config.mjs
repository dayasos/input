import { defineConfig } from 'vite';

// js/ dan logo-medan.png dipindah ke public/ (konvensi bawaan Vite: semua isi public/ disalin
// apa adanya ke dist/ tanpa perlu plugin custom) -- sebelumnya pakai plugin closeBundle() manual
// yang PERNAH GAGAL SENYAP di build Vercel (js/api-bridge.js tidak tersalin, 404 di Production,
// seluruh aplikasi tidak bisa dipakai karena `google` shim tidak termuat). public/ jauh lebih
// andal karena ditangani langsung oleh Vite, bukan kode custom yang bisa salah asumsi soal
// working directory / urutan hook saat build di lingkungan Vercel.
export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true,
  },
  plugins: [
    {
      name: 'gas-api-dev-proxy',
      configureServer(server) {
        server.middlewares.use('/api/gas', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk;
            });
            req.on('end', async () => {
              try {
                const gasUrl = process.env.GAS_API_URL || 'https://script.google.com/macros/s/AKfycbx2DAtU6e3ZWH0sZbi2JAKjpp_cLWV0LfVoAmsWLuUGzEp_KGOjv1xZ9QL6yHCrb8ypCw/exec';
                const resp = await fetch(gasUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: body,
                });
                const data = await resp.text();
                res.setHeader('Content-Type', 'application/json');
                res.end(data);
              } catch (err) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else {
            next();
          }
        });
      },
    },
  ],
});
