import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true,
  },
  plugins: [
    {
      name: 'copy-static-assets',
      closeBundle() {
        // Salin folder js/ dan aset statis ke dist/ agar tersedia di deployment produksi
        if (fs.existsSync('js')) {
          fs.cpSync('js', 'dist/js', { recursive: true });
        }
        if (fs.existsSync('logo-medan.png')) {
          fs.copyFileSync('logo-medan.png', 'dist/logo-medan.png');
        }
      },
    },
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
