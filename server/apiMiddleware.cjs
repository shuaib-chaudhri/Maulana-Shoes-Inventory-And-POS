const db = require('./db.cjs');

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

function apiMiddleware(req, res, next) {
  const url = req.url || '';

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }

  if (!url.startsWith('/api/pos')) {
    return next ? next() : false;
  }

  // Route handling
  if (url === '/api/pos/bootstrap' && req.method === 'GET') {
    try {
      const data = db.getBootstrapData();
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url === '/api/pos/save-product' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.saveProduct(body);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url.startsWith('/api/pos/product/') && req.method === 'DELETE') {
    const parts = url.split('/');
    const productId = parts[parts.length - 1];
    try {
      const result = db.deleteProduct(productId);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url.startsWith('/api/pos/inventory-piece/') && req.method === 'DELETE') {
    const parts = url.split('/');
    const pieceId = parts[parts.length - 1];
    try {
      const result = db.deleteInventoryPiece(pieceId);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url.startsWith('/api/pos/sale/') && req.method === 'DELETE') {
    const parts = url.split('/');
    const saleId = parts[parts.length - 1];
    try {
      const result = db.cancelSale(saleId);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url === '/api/pos/complete-sale' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.completeSale(body);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/cancel-sale' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.cancelSale(body.saleId);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/create-box' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.createBox(body);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/settings' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.updateSettings(body);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/export-backup' && req.method === 'GET') {
    try {
      const result = db.getBootstrapData();
      res.setHeader('Content-Disposition', `attachment; filename="maulana_shoe_center_backup_${Date.now()}.json"`);
      return sendJson(res, 200, result.data);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url === '/api/pos/import-backup' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.syncFullState(body);
        return sendJson(res, 200, { success: true, message: 'Backup restored successfully', data: result.data });
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/sync-all' && req.method === 'POST') {
    return parseJsonBody(req)
      .then(body => {
        const result = db.syncFullState(body);
        return sendJson(res, 200, result);
      })
      .catch(err => sendJson(res, 400, { success: false, error: err.message }));
  }

  if (url === '/api/pos/system-storage-status' && req.method === 'GET') {
    try {
      const info = db.getSystemStorageInfo();
      return sendJson(res, 200, info);
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  if (url === '/api/pos/save-system-backup' && req.method === 'POST') {
    try {
      db.autoBackupToJsonDisk();
      const info = db.getSystemStorageInfo();
      return sendJson(res, 200, { success: true, message: 'Saved to local system storage', data: info });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // Not found
  return sendJson(res, 404, { success: false, error: 'Endpoint not found' });
}

module.exports = apiMiddleware;
