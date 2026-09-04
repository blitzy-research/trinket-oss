/**
 * Pygame Manager - Local Mode
 *
 * Simplified manager for local/single-instance deployments.
 * Proxies browser connections directly to a single worker container.
 *
 * For production scaling, see scaler.js (AWS) or scaler.gcp.js (GCP).
 */

import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as Client } from 'socket.io-client';
import { fileTypeFromBuffer } from 'file-type';
import isSvg from 'is-svg';
import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import config from 'config';

const PORT = config.get('manager.port');
const HOST = config.get('manager.host');
const WORKER_URL = config.get('manager.workerUrl');
const GEN_DIR = config.get('manager.genDir');
const GEN_URL = config.get('manager.genUrl');
const VNC_PATH = config.get('manager.vncPath');

// The websockify token the pygame worker's entrypoint expects. It is read from
// the environment rather than from config/*.json on purpose: it is a shared
// secret, and committed configuration is the wrong place for one.
//
// It is required, and the requirement is enforced here rather than in
// serverside/docker-compose.yml. Compose interpolates an entire file before it
// applies profiles, so a `${PYGAME_VNC_TOKEN:?...}` guard there stops
// `--profile python3`, `--profile java` and `--profile r` too - measured - none
// of which starts a pygame service. Failing in this process keeps the
// requirement loud and confines it to the service that actually needs it.
const VNC_TOKEN = (process.env.PYGAME_VNC_TOKEN || '').trim();

if (VNC_TOKEN === '') {
  console.error('Pygame manager: refusing to start because PYGAME_VNC_TOKEN is not set.');
  console.error('Pygame manager: the worker proxies a VNC connection only when it carries this token, so without it every');
  console.error('Pygame manager: desktop connection is refused and the pygame view in the browser stays blank.');
  console.error('Pygame manager: generate one and give the same value to pygame-worker, for example');
  console.error('Pygame manager: export PYGAME_VNC_TOKEN=$(openssl rand -hex 32)');
  process.exit(1);
}

// Same character set the worker validates in pygame/worker/entrypoint.sh: its
// websockify token file is a line-oriented `<token>: <host>:<port>` format that
// cannot represent anything else. Checking it here turns a token the worker
// would reject into a startup failure naming the reason, instead of a desktop
// that silently never connects.
if (/[^A-Za-z0-9_-]/.test(VNC_TOKEN)) {
  console.error('Pygame manager: refusing to start because PYGAME_VNC_TOKEN contains characters the worker cannot use.');
  console.error('Pygame manager: allowed characters are A-Z a-z 0-9 _ - ; `openssl rand -hex 32` produces a valid value.');
  process.exit(1);
}

// Same 24-character floor the worker's entrypoint enforces, checked here too so
// a weak value fails at whichever end starts first. The token is a bearer
// credential in a URL and nothing in the chain rate-limits a guess - websockify
// drops an unknown token and waits for the next connection - so its length is
// the whole of its strength.
if (VNC_TOKEN.length < 24) {
  console.error(`Pygame manager: refusing to start because PYGAME_VNC_TOKEN is ${VNC_TOKEN.length} characters; it must be at least 24.`);
  console.error('Pygame manager: generate one with `openssl rand -hex 32` and give the same value to pygame-worker.');
  process.exit(1);
}

/**
 * Normalize the configured browser origins into an explicit allowlist.
 *
 * Three shapes reach this function in practice and all three are accepted:
 *   - an array, as config/default.json declares it;
 *   - a JSON array inside a string, the form documented for the CORS_ORIGINS
 *     override - node-config passes that variable through verbatim because
 *     config/custom-environment-variables.json declares no `__format` for it,
 *     so without this branch the documented override is inert;
 *   - a comma-separated string, the natural form for an environment variable.
 *
 * A wildcard is rejected rather than quietly narrowed. `corsOrigins: true` in
 * config/production.json used to be handed straight to Socket.IO, so with
 * NODE_ENV=production any web origin could drive this execution manager.
 *
 * @param {*} configured raw value of `manager.corsOrigins`
 * @returns {{origins: string[]}|{error: string}} the allowlist, or why there is none
 */
function normalizeAllowedOrigins(configured) {
  let values;

  if (Array.isArray(configured)) {
    values = configured;
  } else if (typeof configured === 'string') {
    const trimmed = configured.trim();

    if (trimmed.startsWith('[')) {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        return { error: `the value looks like a JSON array but does not parse (${e.message})` };
      }
      if (!Array.isArray(parsed)) {
        return { error: 'the value parses as JSON but is not an array' };
      }
      values = parsed;
    } else {
      values = trimmed.split(',');
    }
  } else {
    return { error: `the value must be a list of origins, not ${JSON.stringify(configured)}` };
  }

  const origins = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      return { error: `every entry must be an origin string, found ${JSON.stringify(value)}` };
    }

    const origin = value.trim();

    if (origin === '') {
      continue;
    }
    if (origin.includes('*')) {
      return { error: `the entry ${JSON.stringify(origin)} contains a wildcard, which would admit any web origin` };
    }
    // Every entry has to be a real serialized origin - scheme://host[:port],
    // no path, no whitespace. Measured need for this: `CORS_ORIGINS=true`
    // arrives as the string "true" (node-config forwards the variable
    // verbatim), and without this check it would be accepted as an origin
    // literally named "true" - a wildcard that had been asked for, silently
    // turned into an allowlist that matches nothing.
    if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+$/i.test(origin)) {
      return { error: `the entry ${JSON.stringify(origin)} is not a browser origin; each entry must look like scheme://host[:port], for example http://localhost:8080` };
    }
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }

  if (origins.length === 0) {
    return { error: 'the list contains no origin' };
  }

  return { origins };
}

const corsConfig = normalizeAllowedOrigins(config.get('manager.corsOrigins'));

if (corsConfig.error) {
  // Fail fast rather than start: a manager that runs while rejecting every
  // browser looks like a network fault, and one that runs with a wildcard is
  // the vulnerability this check exists to close.
  console.error(`Pygame manager: refusing to start because manager.corsOrigins is unusable - ${corsConfig.error}.`);
  console.error('Pygame manager: set the CORS_ORIGINS environment variable to an explicit list of trusted browser origins,');
  console.error('Pygame manager: for example CORS_ORIGINS=http://localhost:8080,http://localhost:3000');
  process.exit(1);
}

/** Explicit, wildcard-free list of browser origins allowed to use this manager. */
const ALLOWED_ORIGINS = corsConfig.origins;

/**
 * @param {string|undefined} origin value of the request's Origin header
 * @returns {boolean} true when the origin is on the allowlist
 */
function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin);
}

// Keep track of connections and stats
const connections = {};
const stats = {
  totalConnections: 0,
  totalRuns: 0
};

/**
 * HTTP request handler for stats endpoint
 */
function handleHttpRequest(req, res) {
  // CORS headers. Only an allowlisted Origin is reflected: the previous
  // `req.headers.origin || '*'` echoed whatever asked, so any page could read
  // /stats.json. A request from anywhere else still gets its response, it just
  // gets no Access-Control-Allow-Origin and the browser withholds the body.
  // Vary: Origin stops a shared cache handing one origin's response to another.
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/stats.json') {
    const activeCount = Object.keys(connections).length;
    const response = {
      available: 1,  // Local mode: always 1 worker available
      active: activeCount,
      mode: 'local',
      totalConnections: stats.totalConnections,
      totalRuns: stats.totalRuns,
      averages: {
        active: [],
        available: []
      }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Let Socket.io handle other requests
}

// HTTP server for Socket.io and stats
const server = createServer(handleHttpRequest);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS
  },

  // `cors` only decides the response headers of the polling handshake; it does
  // not gate a raw WebSocket upgrade, which a browser sends with no preflight.
  // allowRequest is called by engine.io for every handshake, polling and
  // websocket alike, so this is the one place that can refuse a connection from
  // a hostile page instead of merely declining to expose the response to it.
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;

    if (origin === undefined) {
      // Same-origin browser polling carries no Origin header at all, and the
      // committed topology (serverside/nginx/nginx.conf proxies /pygame/ to
      // this manager) serves the page and the manager from one origin, so
      // refusing it here would refuse the normal case. Every cross-origin XHR
      // and every browser WebSocket handshake does carry an Origin, which is
      // the case this gate is for; a non-browser client can forge the header
      // anyway, so no Origin check can be the control there.
      return callback(null, true);
    }

    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    console.warn(`Pygame manager: refused handshake from origin ${origin}`);
    return callback(null, false);
  }
});

console.log(`Pygame manager starting on ${HOST}:${PORT}`);
console.log(`Worker URL: ${WORKER_URL}`);
console.log(`VNC Path: ${VNC_PATH}`);
console.log(`Allowed browser origins: ${ALLOWED_ORIGINS.join(', ')}`);

// Ensure generated files directory exists
try {
  await mkdir(GEN_DIR, { recursive: true });
} catch (e) {
  // Ignore if exists
}

/**
 * Write generated file (image, HTML) to web-accessible location
 */
async function writeGeneratedFile(data, opts) {
  const dirname = Math.random().toString(36).slice(-8);
  const filedir = join(GEN_DIR, dirname);
  const filepath = join(filedir, data.name);

  await mkdir(filedir, { recursive: true });
  await fsWriteFile(filepath, data.buffer);

  data.url = `${GEN_URL}/${dirname}/${data.name}`;
  data[opts.type] = true;
}

/**
 * Connect to worker and set up event proxying
 */
function connectToWorker(browserId) {
  const conn = connections[browserId];
  if (!conn) return;

  console.log(`Connecting to worker for ${browserId}`);

  const workerSocket = Client(WORKER_URL, {
    forceNew: true,
    reconnection: false
  });

  conn.workerSocket = workerSocket;

  workerSocket.on('connect', () => {
    console.log(`Worker connected for ${browserId}`);

    // Construct VNC URL from browser's host header
    const host = conn.browserSocket.handshake.headers.host || 'localhost:8080';
    const protocol = conn.browserSocket.handshake.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    // The worker's websockify proxy requires ?token=<value> before it will
    // connect a browser to the VNC desktop, so the token has to reach the
    // client through this URL. Building it here is what lets the desktop be
    // authenticated without touching the browser client: this URL is the only
    // thing the client is given, and nginx's /pygame-vnc/ rewrite preserves the
    // query string. The token is present unconditionally because this process
    // refuses to start without one.
    const rfbUrl = `${protocol}://${host}${VNC_PATH}?token=${encodeURIComponent(VNC_TOKEN)}`;

    // Tell browser the instance is ready with VNC URL
    conn.browserSocket.emit('instance ready', {
      rfbUrl: rfbUrl,
      audioUrl: null  // Audio not implemented in local mode
    });

    conn.ready = true;
  });

  workerSocket.on('connect_error', (err) => {
    console.error(`Worker connect error for ${browserId}:`, err.message);
    conn.browserSocket.emit('shell connect error');
    conn.browserSocket.emit('exit');
  });

  // Proxy events from worker to browser
  workerSocket.on('child ready', () => {
    conn.browserSocket.emit('child ready');
  });

  workerSocket.on('stdout', (data) => {
    conn.browserSocket.emit('stdout', data);
  });

  workerSocket.on('clear', () => {
    conn.browserSocket.emit('clear');
  });

  workerSocket.on('script error', (data) => {
    conn.browserSocket.emit('script error', { error: data.error });
  });

  workerSocket.on('file added', async (data) => {
    try {
      // Determine file type
      const type = await fileTypeFromBuffer(data.buffer);

      if ((type && /^image/.test(type.mime)) || isSvg(data.buffer)) {
        await writeGeneratedFile(data, { type: 'image' });
      } else if (type) {
        // Binary file
        data.binary = true;
      } else if (/\.html$/.test(data.name)) {
        await writeGeneratedFile(data, { type: 'html' });
      } else {
        // Text file
        data.content = data.buffer.toString('utf8');
      }
    } catch (e) {
      console.error('File type detection error:', e);
      data.typeError = e.message;
    }

    delete data.buffer;
    conn.browserSocket.emit('file added', data);
  });

  workerSocket.on('done', (result) => {
    conn.browserSocket.emit('done', result);
  });

  workerSocket.on('exit', () => {
    conn.browserSocket.emit('exit');
  });

  workerSocket.on('disconnect', () => {
    console.log(`Worker disconnected for ${browserId}`);
  });

  return workerSocket;
}

// Handle browser connections
io.on('connection', (browser) => {
  if (!browser || !browser.id) {
    console.error('Invalid browser connection');
    return;
  }

  const browserId = browser.id;
  console.log(`Browser connected: ${browserId}`);

  connections[browserId] = {
    browserSocket: browser,
    workerSocket: null,
    ready: false
  };

  // Connect to worker immediately (local mode - always available)
  connectToWorker(browserId);

  // Handle run request from browser
  browser.on('run', (data) => {
    const conn = connections[browserId];
    if (!conn || !conn.workerSocket) {
      browser.emit('shell connect error');
      browser.emit('exit');
      return;
    }

    // Basic security check (prevent crypto miners)
    if (data.code && (/verushash/.test(data.code) || /xmrig/.test(data.code))) {
      console.log('Blocked suspicious code');
      browser.emit('shell connect error');
      browser.emit('exit');
      browser.disconnect();
      return;
    }

    conn.workerSocket.emit('eval', {
      interactive: false,
      init: true,
      code: data.code
    });
  });

  // Handle stdin input from browser
  browser.on('write', (data) => {
    const conn = connections[browserId];
    if (conn && conn.workerSocket) {
      conn.workerSocket.emit('write', {
        input: data.input,
        from: 'user'
      });
    }
  });

  // Handle stop request
  browser.on('stop', () => {
    const conn = connections[browserId];
    if (conn && conn.workerSocket) {
      conn.workerSocket.emit('stop');
    }
  });

  // Handle browser disconnect
  browser.on('disconnect', () => {
    console.log(`Browser disconnected: ${browserId}`);
    const conn = connections[browserId];
    if (conn && conn.workerSocket) {
      conn.workerSocket.disconnect();
    }
    delete connections[browserId];
  });

  // Timeout - disconnect after 10 minutes of inactivity
  const releaseTimer = setTimeout(() => {
    const conn = connections[browserId];
    if (conn && conn.browserSocket) {
      console.log(`Releasing connection after timeout: ${browserId}`);
      conn.browserSocket.emit('exit');
      conn.browserSocket.disconnect();
    }
  }, 600000);

  browser.on('disconnect', () => {
    clearTimeout(releaseTimer);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Pygame manager listening on ${HOST}:${PORT}`);
});
