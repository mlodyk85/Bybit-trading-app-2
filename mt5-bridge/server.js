const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const TOKEN = String(process.env.MT5_BRIDGE_TOKEN || '').trim();
if (!TOKEN) {
  console.error('MT5_BRIDGE_TOKEN is required.');
  process.exit(1);
}

let latestStatus = null;
let queuedCommand = 'NONE';

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function text(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function authorized(req, mt5 = false) {
  if (mt5) return req.headers['x-bridge-token'] === TOKEN;
  const auth = String(req.headers.authorization || '');
  return auth === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 128 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'mt5-bridge' });
    }

    if (url.pathname.startsWith('/mt5/')) {
      if (!authorized(req, true)) return text(res, 401, 'UNAUTHORIZED');

      if (req.method === 'POST' && url.pathname === '/mt5/status') {
        const raw = await readBody(req);
        const incoming = JSON.parse(raw || '{}');
        latestStatus = {
          ...incoming,
          agentId: String(incoming.agentId || 'gold-ea'),
          updatedAt: new Date().toISOString(),
        };
        return text(res, 200, 'OK');
      }

      if (req.method === 'GET' && url.pathname === '/mt5/next-command') {
        const command = queuedCommand;
        queuedCommand = 'NONE';
        return text(res, 200, command);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req, false)) return json(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, { status: latestStatus });
      }

      if (req.method === 'POST' && url.pathname === '/api/command') {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || '{}');
        const command = String(payload.command || '').toUpperCase();
        const allowed = new Set(['START', 'STOP', 'CLOSE_ALL', 'RESET_DAY_LOCK']);
        if (!allowed.has(command)) return json(res, 400, { error: 'invalid command' });
        queuedCommand = command;
        return json(res, 202, { accepted: true, command });
      }
    }

    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MT5 Bridge listening on :${PORT}`);
});
