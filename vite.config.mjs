import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const secretToken = env.GAS_SECRET_TOKEN || process.env.GAS_SECRET_TOKEN || '';
  const supabaseUrl = env.SUPABASE_EDGE_FUNCTION_URL || env.GAS_API_URL || 'https://wwqxbscumaakvziwzwjx.supabase.co/functions/v1/api';
  const driveUrl = env.GAS_DRIVE_UPLOAD_URL || 'https://script.google.com/macros/s/AKfycbzrAA20sJ_U0RtzoCEElKUusHJJQm8K-I83R0Ckyxru9F1H-UW9r31Cc9YATp66tKGSRQ/exec';
  const anonKey = env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXhic2N1bWFha3Z6aXd6d2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MjQ2MTMsImV4cCI6MjEwNDEwMDYxM30.W0hJsUzcnYaOWfF-NHKR1F3RnJR8j-vJsDDqBF636hQ';

  return {
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
            if (req.method === 'GET') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                status: 'API Dev Proxy Online',
                envConfigured: true,
                secretConfigured: Boolean(secretToken),
                activeBackendUrl: supabaseUrl,
                driveUploadUrl: driveUrl,
                pingTest: { status: 200, ok: true },
              }));
              return;
            }

            if (req.method === 'POST') {
              let rawBody = '';
              req.on('data', chunk => {
                rawBody += chunk;
              });
              req.on('end', async () => {
                try {
                  let payload = {};
                  try {
                    payload = JSON.parse(rawBody);
                  } catch (e) {
                    payload = {};
                  }

                  payload._secret = secretToken;

                  const isDriveUpload = payload.action === 'uploadSemuaBerkasKeDrive' || payload.action === 'uploadSatuBerkasKeDrive';
                  const targetUrl = isDriveUpload ? driveUrl : supabaseUrl;

                  const headers = {
                    'Content-Type': 'application/json',
                    'Connection': 'close',
                  };

                  if (targetUrl.includes('supabase.co')) {
                    headers['apikey'] = anonKey;
                    headers['Authorization'] = `Bearer ${anonKey}`;
                  }

                  const resp = await fetch(targetUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                    redirect: 'follow',
                  });

                  const data = await resp.text();
                  res.statusCode = resp.status;
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
  };
});

