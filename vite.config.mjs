import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true,
  },
  plugins: [
    {
      name: 'api-dev-proxy',
      configureServer(server) {
        server.middlewares.use('/api/gas', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk;
            });
            req.on('end', async () => {
              try {
                const targetUrl = process.env.SUPABASE_EDGE_FUNCTION_URL || process.env.GAS_API_URL || 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api';
                const resp = await fetch(targetUrl, {
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
