const http = require('http');
const fs = require('fs');
const path = require('path');
const apiMiddleware = require('./server/apiMiddleware.cjs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

let activeServer = null;

function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    if (activeServer) {
      return resolve(activeServer);
    }

    const PORT = process.env.PORT || port;
    const DIST_DIR = path.join(__dirname, 'dist');
    const BASE_DIR = fs.existsSync(DIST_DIR) ? DIST_DIR : __dirname;

    const server = http.createServer((req, res) => {
      // Try API middleware first
      apiMiddleware(req, res, () => {
        // Serve static files
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/' || reqPath === '') {
          reqPath = '/index.html';
        }

        let filePath = path.join(BASE_DIR, reqPath);

        // Fallback to root or public directory if not found in BASE_DIR
        if (!fs.existsSync(filePath)) {
          const rootPath = path.join(__dirname, reqPath);
          const pubPath = path.join(__dirname, 'public', reqPath);
          if (fs.existsSync(rootPath)) {
            filePath = rootPath;
          } else if (fs.existsSync(pubPath)) {
            filePath = pubPath;
          }
        }

        // Security check - prevent path traversal
        if (!filePath.startsWith(BASE_DIR) && !filePath.startsWith(__dirname)) {
          res.statusCode = 403;
          return res.end('Forbidden');
        }

        fs.stat(filePath, (err, stats) => {
          if (err || !stats.isFile()) {
            // Fallback to index.html for SPA routing
            filePath = path.join(BASE_DIR, 'index.html');
          }

          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';

          fs.readFile(filePath, (readErr, content) => {
            if (readErr) {
              res.statusCode = 500;
              return res.end(`Server Error: ${readErr.code}`);
            }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
          });
        });
      });
    });

    // The port the POS is reachable on is exposed as server.posPort. Port 3000 is preferred because
    // the renderer's origin (and its localStorage/IndexedDB) is tied to it.
    let tryPort = Number(PORT);
    const lastPort = tryPort + MAX_PORT_FALLBACKS;

    server.on('error', async (err) => {
      if (err.code !== 'EADDRINUSE') return reject(err);

      // Reuse the port only when another POS instance owns it; any other program on it
      // (e.g. an editor's preview server) would be loaded in place of the POS
      if (await isPosServer(tryPort)) {
        console.log(`Port ${tryPort} in use by a running POS instance, reusing it.`);
        server.posPort = tryPort;
        activeServer = server;
        return resolve(server);
      }
      if (tryPort >= lastPort) {
        return reject(new Error(`Ports ${PORT}-${lastPort} are all in use by other programs`));
      }
      console.log(`Port ${tryPort} in use by another program, trying ${tryPort + 1}.`);
      tryPort++;
      server.listen(tryPort, '127.0.0.1');
    });

    server.on('listening', () => {
      console.log(`====================================================`);
      console.log(`  MAULANA SHOES POS & INVENTORY`);
      console.log(`  Begumpeth, Solapur, Maharashtra`);
      console.log(`  Running on http://127.0.0.1:${tryPort}`);
      console.log(`====================================================`);
      server.posPort = tryPort;
      activeServer = server;
      resolve(server);
    });

    server.listen(tryPort, '127.0.0.1');
  });
}

const MAX_PORT_FALLBACKS = 10;

// True when the server on this port answers the POS thermal-spec endpoint
function isPosServer(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/pos/thermal-spec', timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(res.statusCode === 200 && data.success === true && typeof data.widthMm === 'number');
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
