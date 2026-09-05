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

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} in use, using running instance.`);
        activeServer = server;
        resolve(server);
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`====================================================`);
      console.log(`  MAULANA SHOES POS & INVENTORY`);
      console.log(`  Begumpeth, Solapur, Maharashtra`);
      console.log(`  Running on http://127.0.0.1:${PORT}`);
      console.log(`====================================================`);
      activeServer = server;
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
