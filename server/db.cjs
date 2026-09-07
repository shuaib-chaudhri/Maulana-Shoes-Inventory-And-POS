const path = require('path');
const fs = require('fs');
const supabaseSync = require('./supabaseSync.cjs');

const isElectron = Boolean(process.versions.electron);
let Database = null;
let sqliteAvailable = false;

if (!isElectron) {
  try {
    Database = require('better-sqlite3');
    // Test if Database can be instantiated without crashing
    const testDb = new Database(':memory:');
    testDb.close();
    sqliteAvailable = true;
  } catch (e) {
    sqliteAvailable = false;
    console.warn('SQLite not available or incompatible ABI, falling back to JSON engine:', e.message);
  }
}

function getResolvedDataDir() {
  if (process.env.USER_DATA_PATH) {
    try {
      if (!fs.existsSync(process.env.USER_DATA_PATH)) {
        fs.mkdirSync(process.env.USER_DATA_PATH, { recursive: true });
      }
      return process.env.USER_DATA_PATH;
    } catch (e) {}
  }
  if (process.env.APPDATA) {
    const p = path.join(process.env.APPDATA, 'maulana-shoes-inventory-pos');
    try {
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
      return p;
    } catch (e) {}
  }
  return path.join(__dirname, '..');
}

const userDataDir = getResolvedDataDir();
if (!fs.existsSync(userDataDir)) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch (e) {}
}

const DB_PATH = path.join(userDataDir, 'maulana_pos.sqlite');
const JSON_BACKUP_PATH = path.join(userDataDir, 'maulana_pos_data.json');

// Bundled master template fallback (for INITIAL SEED ONLY when user data does not exist)
function getBundledDataPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'maulana_pos_data.json'),
    path.join(__dirname, '..', 'maulana_pos_data.json'),
    path.join(__dirname, 'maulana_pos_data.json'),
    path.join(process.cwd(), 'maulana_pos_data.json')
  ];
  for (const c of candidates) {
    try {
      if (c && c !== JSON_BACKUP_PATH && fs.existsSync(c)) return c;
    } catch (e) {}
  }
  return null;
}

// -------------------------------------------------------------
// Pure JSON Persistence Engine (100% stable in Electron & Node)
// -------------------------------------------------------------
let jsonStore = null;

function loadJsonStore(forceReload = false) {
  if (jsonStore && !forceReload) return jsonStore;
  if (fs.existsSync(JSON_BACKUP_PATH)) {
    try {
      jsonStore = JSON.parse(fs.readFileSync(JSON_BACKUP_PATH, 'utf8'));
      if (jsonStore && typeof jsonStore === 'object') return jsonStore;
    } catch (e) {
      console.warn('Error reading user JSON file:', e.message);
    }
  }
  // Initial seed happens ONLY when the user-data JSON file does not exist.
  // Never re-seed or restore bundled default data over existing user data.
  if (!jsonStore && !fs.existsSync(JSON_BACKUP_PATH)) {
    const bundled = getBundledDataPath();
    if (bundled && bundled !== JSON_BACKUP_PATH && fs.existsSync(bundled)) {
      try {
        jsonStore = JSON.parse(fs.readFileSync(bundled, 'utf8'));
        const dir = path.dirname(JSON_BACKUP_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(JSON_BACKUP_PATH, JSON.stringify(jsonStore, null, 2), 'utf8');
      } catch (e) {}
    }
  }
  if (!jsonStore) {
    jsonStore = {
      settings: {},
      products: [],
      variants: [],
      boxes: [],
      box_items: [],
      inventory_items: [],
      sales: [],
      activities: []
    };
  }
  return jsonStore;
}

function saveJsonStore() {
  if (!jsonStore) return;
  try {
    const dir = path.dirname(JSON_BACKUP_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JSON_BACKUP_PATH, JSON.stringify(jsonStore, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write JSON backup to disk:', err.message);
  }
}

let dbInstance = null;

function getDb() {
  if (!sqliteAvailable) {
    return null;
  }
  if (!dbInstance) {
    try {
      dbInstance = new Database(DB_PATH);
      dbInstance.pragma('journal_mode = WAL');
      initSchema(dbInstance);
      setTimeout(() => {
        try {
          const fullData = getBootstrapData().data;
          supabaseSync.syncFullState(fullData);
        } catch (e) {
          console.warn('Initial Supabase sync error:', e.message);
        }
      }, 2000);
    } catch (e) {
      console.warn('Failed to open SQLite database, falling back to JSON engine:', e.message);
      sqliteAvailable = false;
      dbInstance = null;
    }
  }
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      brand TEXT NOT NULL,
      category TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      mrp REAL NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      size TEXT NOT NULL,
      color TEXT NOT NULL,
      variant_code TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS boxes (
      id TEXT PRIMARY KEY,
      box_number TEXT NOT NULL,
      barcode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS box_items (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (box_id) REFERENCES boxes(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_pieces (
      id TEXT PRIMARY KEY,
      variant_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      piece_code TEXT NOT NULL,
      barcode TEXT NOT NULL,
      box_id TEXT,
      status TEXT NOT NULL DEFAULT 'In Stock',
      created_at TEXT NOT NULL,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      bill_number TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      item_discount REAL NOT NULL DEFAULT 0,
      overall_discount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL,
      amount_received REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      cashier_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      variant_id TEXT,
      piece_id TEXT,
      piece_code TEXT,
      product_name_snapshot TEXT NOT NULL,
      size_snapshot TEXT,
      colour_snapshot TEXT,
      box_number_snapshot TEXT,
      mrp_snapshot REAL NOT NULL DEFAULT 0,
      price_at_sale REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      discount REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      size TEXT,
      qty_change TEXT,
      time TEXT NOT NULL,
      details TEXT
    );
  `);

  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_pieces_code ON inventory_pieces(piece_code);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_pieces_barcode ON inventory_pieces(barcode);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_boxes_barcode ON boxes(barcode);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_code ON product_variants(variant_code);
    `);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE sale_items ADD COLUMN is_return INTEGER DEFAULT 0`);
  } catch (e) {}

  seedInitialData(db);
}

function seedInitialData(db) {
  // Check settings
  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('store_settings');
  if (!checkSetting) {
    const defaultSettings = {
      storeName: 'Maulana Shoes',
      storeAddress: 'Begumpeth, Solapur, Maharashtra, India',
      phone: '+91 98903 24362',
      whatsapp: '+91 7588888578',
      receiptFooter: 'Thank you for shopping with us! Visit again.',
      warrantyTerms: '1. Exchange within 7 days only.\n2. No exchange without bill and Tag with barcode.\n3. No guarantee of color and quality.',
      enableTax: false,
      taxPercent: 5,
      defaultLowStock: 5,
      receiptWidth: '80mm',
      gstNumber: ''
    };
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('store_settings', JSON.stringify(defaultSettings));
  }

  // Check products - ONLY seed demo products in dev mode when SEED_DEMO=true is set
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === 'true') {
    const countProd = db.prepare('SELECT count(*) as count FROM products').get();
    if (countProd.count === 0) {
    const now = new Date().toISOString();

    const insertProd = db.prepare(`
      INSERT INTO products (id, name, sku, brand, category, cost, price, mrp, low_stock_threshold, created_at)
      VALUES (@id, @name, @sku, @brand, @category, @cost, @price, @mrp, @low_stock_threshold, @created_at)
    `);

    const insertVar = db.prepare(`
      INSERT INTO product_variants (id, product_id, size, color, variant_code)
      VALUES (@id, @product_id, @size, @color, @variant_code)
    `);

    const insertBox = db.prepare(`
      INSERT INTO boxes (id, box_number, barcode, created_at)
      VALUES (@id, @box_number, @barcode, @created_at)
    `);

    const insertBoxItem = db.prepare(`
      INSERT INTO box_items (id, box_id, variant_id, quantity)
      VALUES (@id, @box_id, @variant_id, @quantity)
    `);

    const insertPiece = db.prepare(`
      INSERT INTO inventory_pieces (id, variant_id, product_id, piece_code, barcode, box_id, status, created_at)
      VALUES (@id, @variant_id, @product_id, @piece_code, @barcode, @box_id, @status, @created_at)
    `);

    const insertAct = db.prepare(`
      INSERT INTO activities (id, type, title, size, qty_change, time, details)
      VALUES (@id, @type, @title, @size, @qty_change, @time, @details)
    `);

    const seedTx = db.transaction(() => {
      // Product 1
      insertProd.run({
        id: 'PROD-001',
        name: 'Nike Air Max 270',
        sku: 'NK-270-001',
        brand: 'Nike',
        category: 'Sports',
        cost: 1200,
        price: 2499,
        mrp: 2999,
        low_stock_threshold: 5,
        created_at: now
      });

      // Product 2
      insertProd.run({
        id: 'PROD-002',
        name: 'Campus Classic Runner',
        sku: 'CAMP-CLS-02',
        brand: 'Campus',
        category: 'Sneakers',
        cost: 700,
        price: 1399,
        mrp: 1699,
        low_stock_threshold: 5,
        created_at: now
      });

      // Variants
      const v1 = { id: 'VAR-101', product_id: 'PROD-001', size: '9', color: 'Black', variant_code: 'NIASBLK9' };
      const v2 = { id: 'VAR-102', product_id: 'PROD-001', size: '9', color: 'White', variant_code: 'NIASWT9' };
      const v3 = { id: 'VAR-103', product_id: 'PROD-001', size: '9', color: 'Blue', variant_code: 'NIASBLU9' };
      const v4 = { id: 'VAR-104', product_id: 'PROD-001', size: '9', color: 'Red', variant_code: 'NIASRED9' };
      const v5 = { id: 'VAR-201', product_id: 'PROD-002', size: '8', color: 'Grey', variant_code: 'CAMSGRY8' };
      const v6 = { id: 'VAR-202', product_id: 'PROD-002', size: '9', color: 'Grey', variant_code: 'CAMSGRY9' };

      [v1, v2, v3, v4, v5, v6].forEach(v => insertVar.run(v));

      // Boxes
      const b1 = { id: 'BOX-001', box_number: 'BOX-001', barcode: 'BOX-8901001', created_at: now };
      const b2 = { id: 'BOX-002', box_number: 'BOX-002', barcode: 'BOX-8901002', created_at: now };
      [b1, b2].forEach(b => insertBox.run(b));

      // Box items & Pieces
      const biList = [
        { id: 'BI-1', box_id: 'BOX-001', variant: v1, quantity: 4 },
        { id: 'BI-2', box_id: 'BOX-001', variant: v2, quantity: 4 },
        { id: 'BI-3', box_id: 'BOX-001', variant: v3, quantity: 4 },
        { id: 'BI-4', box_id: 'BOX-001', variant: v4, quantity: 4 },
        { id: 'BI-5', box_id: 'BOX-002', variant: v5, quantity: 5 },
        { id: 'BI-6', box_id: 'BOX-002', variant: v6, quantity: 6 }
      ];

      biList.forEach(bi => {
        insertBoxItem.run({
          id: bi.id,
          box_id: bi.box_id,
          variant_id: bi.variant.id,
          quantity: bi.quantity
        });

        for (let i = 1; i <= bi.quantity; i++) {
          const seqStr = String(i).padStart(3, '0');
          const pCode = `${bi.variant.variant_code}-${seqStr}`;
          insertPiece.run({
            id: `PIECE-${bi.variant.id}-${bi.box_id}-${i}`,
            variant_id: bi.variant.id,
            product_id: bi.variant.product_id,
            piece_code: pCode,
            barcode: pCode,
            box_id: bi.box_id,
            status: 'In Stock',
            created_at: now
          });
        }
      });

      insertAct.run({
        id: 'ACT-1',
        type: 'add',
        title: 'Nike Air Max 270',
        size: '-',
        qty_change: '+16 pairs',
        time: now,
        details: 'Initial inventory loaded for Begumpeth Solapur counter'
      });
    });

    seedTx();
  }
  }
}

function getBootstrapData() {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore(true);
    if (!store.settings) store.settings = {};
    return {
      success: true,
      data: {
        settings: store.settings || {},
        products: store.products || [],
        variants: store.variants || [],
        boxes: store.boxes || [],
        box_items: store.box_items || [],
        inventory_items: store.inventory_items || [],
        sales: store.sales || [],
        activities: store.activities || []
      }
    };
  }

  const settingsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('store_settings');
  let settings = settingsRow ? JSON.parse(settingsRow.value) : {};
  if (!settings || Object.keys(settings).length === 0) {
    try {
      const diskStore = loadJsonStore(true);
      if (diskStore && diskStore.settings && Object.keys(diskStore.settings).length > 0) {
        settings = diskStore.settings;
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('store_settings', JSON.stringify(settings));
      }
    } catch (e) {}
  }

  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  const variants = db.prepare('SELECT * FROM product_variants').all();
  const boxes = db.prepare('SELECT * FROM boxes ORDER BY box_number ASC').all();
  const box_items = db.prepare('SELECT * FROM box_items').all();
  const inventory_items = db.prepare('SELECT * FROM inventory_pieces ORDER BY created_at ASC').all();
  const activities = db.prepare('SELECT * FROM activities ORDER BY time DESC LIMIT 200').all();
  
  // Sales with items
  const sales = db.prepare('SELECT * FROM sales ORDER BY date DESC').all();
  const saleItems = db.prepare('SELECT * FROM sale_items').all();
  
  const salesWithItems = sales.map(s => ({
    ...s,
    items: saleItems.filter(si => si.sale_id === s.id)
  }));

  return {
    success: true,
    data: {
      settings,
      products,
      variants,
      boxes,
      box_items,
      inventory_items,
      sales: salesWithItems,
      activities
    }
  };
}

function autoBackupToJsonDisk() {
  try {
    const res = getBootstrapData();
    if (res && res.data) {
      if (!res.data.settings || Object.keys(res.data.settings).length === 0) {
        if (fs.existsSync(JSON_BACKUP_PATH)) {
          try {
            const diskObj = JSON.parse(fs.readFileSync(JSON_BACKUP_PATH, 'utf8'));
            if (diskObj && diskObj.settings && Object.keys(diskObj.settings).length > 0) {
              res.data.settings = diskObj.settings;
            }
          } catch (e) {}
        }
      }
      const dir = path.dirname(JSON_BACKUP_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(JSON_BACKUP_PATH, JSON.stringify(res.data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not auto-write JSON system backup:', err.message);
  }
}

function getSystemStorageInfo() {
  const sqliteExists = fs.existsSync(DB_PATH);
  const jsonExists = fs.existsSync(JSON_BACKUP_PATH);
  return {
    success: true,
    sqlitePath: DB_PATH,
    sqliteSize: sqliteExists ? fs.statSync(DB_PATH).size : 0,
    jsonPath: JSON_BACKUP_PATH,
    jsonSize: jsonExists ? fs.statSync(JSON_BACKUP_PATH).size : 0,
    lastUpdated: new Date().toISOString()
  };
}

function saveProduct(data) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    const { product, variants = [], boxes = [], box_items = [], inventory_pieces = [], is_non_footwear = false } = data;
    if (product && product.id) {
      const pIdx = store.products.findIndex(p => p.id === product.id);
      if (pIdx >= 0) store.products[pIdx] = { ...store.products[pIdx], ...product };
      else store.products.unshift(product);
    }
    variants.forEach(v => {
      const vIdx = store.variants.findIndex(x => x.id === v.id);
      if (vIdx >= 0) store.variants[vIdx] = { ...store.variants[vIdx], ...v };
      else store.variants.push(v);
    });
    boxes.forEach(b => {
      const bIdx = store.boxes.findIndex(x => x.id === b.id);
      if (bIdx >= 0) store.boxes[bIdx] = { ...store.boxes[bIdx], ...b };
      else store.boxes.push(b);
    });
    box_items.forEach(bi => {
      const biIdx = store.box_items.findIndex(x => x.id === bi.id);
      if (biIdx >= 0) store.box_items[biIdx] = { ...store.box_items[biIdx], ...bi };
      else store.box_items.push(bi);
    });

    if (is_non_footwear && product && product.id) {
      const keepIds = new Set(inventory_pieces.map(p => p.id));
      store.inventory_items = store.inventory_items.filter(pi => pi.product_id !== product.id || pi.status !== 'In Stock' || keepIds.has(pi.id));
    }

    inventory_pieces.forEach(pi => {
      const piIdx = store.inventory_items.findIndex(x => x.id === pi.id);
      if (piIdx >= 0) store.inventory_items[piIdx] = { ...store.inventory_items[piIdx], ...pi };
      else store.inventory_items.push(pi);
    });
    saveJsonStore();
    supabaseSync.syncProductSave(data);
    return getBootstrapData();
  }

  const { product, variants = [], boxes = [], box_items = [], inventory_pieces = [], is_non_footwear = false } = data;

  const tx = db.transaction(() => {
    // Upsert product
    db.prepare(`
      INSERT INTO products (id, name, sku, brand, category, cost, price, mrp, low_stock_threshold, created_at)
      VALUES (@id, @name, @sku, @brand, @category, @cost, @price, @mrp, @low_stock_threshold, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        sku = excluded.sku,
        brand = excluded.brand,
        category = excluded.category,
        cost = excluded.cost,
        price = excluded.price,
        mrp = excluded.mrp,
        low_stock_threshold = excluded.low_stock_threshold
    `).run(product);

    // Sync variants for this product
    for (const v of variants) {
      db.prepare(`
        INSERT INTO product_variants (id, product_id, size, color, variant_code)
        VALUES (@id, @product_id, @size, @color, @variant_code)
        ON CONFLICT(id) DO UPDATE SET
          size = excluded.size,
          color = excluded.color,
          variant_code = excluded.variant_code
      `).run(v);
    }

    // Sync boxes
    for (const b of boxes) {
      db.prepare(`
        INSERT INTO boxes (id, box_number, barcode, created_at)
        VALUES (@id, @box_number, @barcode, @created_at)
        ON CONFLICT(id) DO UPDATE SET
          box_number = excluded.box_number,
          barcode = excluded.barcode
      `).run(b);
    }

    // Replace box items for these boxes/variants
    for (const bi of box_items) {
      db.prepare(`
        INSERT OR REPLACE INTO box_items (id, box_id, variant_id, quantity)
        VALUES (@id, @box_id, @variant_id, @quantity)
      `).run(bi);
    }

    // Clean up excess in-stock pieces for non-footwear products when stock is directly updated
    if (is_non_footwear && product && product.id) {
      const pieceIds = inventory_pieces.map(pi => pi.id);
      if (pieceIds.length > 0) {
        const placeholders = pieceIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM inventory_pieces WHERE product_id = ? AND status = 'In Stock' AND id NOT IN (${placeholders})`).run(product.id, ...pieceIds);
      } else {
        db.prepare(`DELETE FROM inventory_pieces WHERE product_id = ? AND status = 'In Stock'`).run(product.id);
      }
    }

    // Upsert inventory pieces
    for (const pi of inventory_pieces) {
      db.prepare(`
        INSERT OR REPLACE INTO inventory_pieces (id, variant_id, product_id, piece_code, barcode, box_id, status, created_at)
        VALUES (@id, @variant_id, @product_id, @piece_code, @barcode, @box_id, @status, @created_at)
      `).run({
        ...pi,
        box_id: pi.box_id || null
      });
    }
  });

  tx();
  autoBackupToJsonDisk();
  supabaseSync.syncProductSave(data);
  return getBootstrapData();
}

function deleteProduct(productId) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    store.products = store.products.filter(p => p.id !== productId);
    store.variants = store.variants.filter(v => v.product_id !== productId);
    store.inventory_items = store.inventory_items.filter(pi => pi.product_id !== productId);
    store.box_items = store.box_items.filter(bi => {
      const v = store.variants.find(x => x.id === bi.variant_id);
      return v && v.product_id !== productId;
    });
    saveJsonStore();
    supabaseSync.syncProductDelete(productId);
    return getBootstrapData();
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM inventory_pieces WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM box_items WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)').run(productId);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  });
  tx();
  autoBackupToJsonDisk();
  supabaseSync.syncProductDelete(productId);
  return getBootstrapData();
}

function deleteInventoryPiece(pieceId) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    const piece = store.inventory_items.find(x => x.id === pieceId);
    if (piece) {
      if (piece.box_id && piece.variant_id) {
        const bi = store.box_items.find(x => x.box_id === piece.box_id && x.variant_id === piece.variant_id);
        if (bi) bi.quantity = Math.max(0, (bi.quantity || 1) - 1);
      }
      store.inventory_items = store.inventory_items.filter(x => x.id !== pieceId);
      saveJsonStore();
    }
    return getBootstrapData();
  }

  const tx = db.transaction(() => {
    const piece = db.prepare('SELECT * FROM inventory_pieces WHERE id = ?').get(pieceId);
    if (piece) {
      if (piece.box_id && piece.variant_id) {
        db.prepare('UPDATE box_items SET quantity = MAX(0, quantity - 1) WHERE box_id = ? AND variant_id = ?').run(piece.box_id, piece.variant_id);
      }
      db.prepare('DELETE FROM inventory_pieces WHERE id = ?').run(pieceId);
    }
  });
  tx();
  autoBackupToJsonDisk();
  return getBootstrapData();
}

function completeSale(saleData) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    const { sale, items = [], soldPieceIds = [], returnedPieceIds = [] } = saleData;
    const saleWithItems = { ...sale, items };
    store.sales = store.sales || [];
    store.sales.unshift(saleWithItems);

    soldPieceIds.forEach(pId => {
      const piece = store.inventory_items.find(x => x.id === pId);
      if (piece) piece.status = 'Sold';
    });
    returnedPieceIds.forEach(rId => {
      const piece = store.inventory_items.find(x => x.id === rId);
      if (piece) piece.status = 'In Stock';
    });

    const hasExchange = items.some(it => it.is_return);
    store.activities = store.activities || [];
    store.activities.unshift({
      id: 'ACT-' + Date.now(),
      type: hasExchange ? 'exchange' : 'sale',
      title: `Bill #${sale.bill_number}${hasExchange ? ' (Exchange)' : ''}`,
      size: `${items.length} items`,
      qty_change: `₹${sale.grand_total}`,
      time: new Date().toISOString(),
      details: hasExchange ? `Product exchange processed via ${sale.payment_method}` : `Paid via ${sale.payment_method}`
    });

    saveJsonStore();
    supabaseSync.syncSaleComplete(saleData);
    return getBootstrapData();
  }

  const { sale, items, soldPieceIds = [], returnedPieceIds = [] } = saleData;

  const tx = db.transaction(() => {
    // Insert sale
    db.prepare(`
      INSERT INTO sales (
        id, bill_number, date, subtotal, item_discount, overall_discount,
        tax_amount, grand_total, payment_method, amount_received, change_amount, cashier_notes
      ) VALUES (
        @id, @bill_number, @date, @subtotal, @item_discount, @overall_discount,
        @tax_amount, @grand_total, @payment_method, @amount_received, @change_amount, @cashier_notes
      )
    `).run(sale);

    // Insert sale items (supporting is_return for exchange items)
    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, variant_id, piece_id, piece_code, product_name_snapshot,
        size_snapshot, colour_snapshot, box_number_snapshot, mrp_snapshot,
        price_at_sale, quantity, discount, amount, is_return
      ) VALUES (
        @id, @sale_id, @variant_id, @piece_id, @piece_code, @product_name_snapshot,
        @size_snapshot, @colour_snapshot, @box_number_snapshot, @mrp_snapshot,
        @price_at_sale, @quantity, @discount, @amount, @is_return
      )
    `);

    for (const item of items) {
      insertItem.run({
        ...item,
        box_number_snapshot: item.box_number_snapshot || '',
        is_return: item.is_return ? 1 : 0
      });
    }

    // Mark sold outgoing pieces as 'Sold'
    const updatePieceSold = db.prepare(`
      UPDATE inventory_pieces SET status = 'Sold' WHERE id = ?
    `);

    for (const pId of soldPieceIds) {
      if (pId) updatePieceSold.run(pId);
    }

    // Restock returned incoming exchange pieces back to 'In Stock'
    const updatePieceReturn = db.prepare(`
      UPDATE inventory_pieces SET status = 'In Stock' WHERE id = ?
    `);

    for (const rId of returnedPieceIds) {
      if (rId) updatePieceReturn.run(rId);
    }

    // Log Activity
    const hasExchange = items.some(it => it.is_return);
    db.prepare(`
      INSERT INTO activities (id, type, title, size, qty_change, time, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'ACT-' + Date.now(),
      hasExchange ? 'exchange' : 'sale',
      `Bill #${sale.bill_number}${hasExchange ? ' (Exchange)' : ''}`,
      `${items.length} items`,
      `₹${sale.grand_total}`,
      new Date().toISOString(),
      hasExchange ? `Product exchange processed via ${sale.payment_method}` : `Paid via ${sale.payment_method}`
    );
  });

  tx();
  autoBackupToJsonDisk();
  supabaseSync.syncSaleComplete(saleData);
  return getBootstrapData();
}

function updateSettings(settings) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore(true);
    store.settings = { ...(store.settings || {}), ...settings };
    saveJsonStore();
    supabaseSync.syncSettings(store.settings);
    return getBootstrapData();
  }

  const existingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('store_settings');
  const existing = existingRow ? JSON.parse(existingRow.value) : {};
  const merged = { ...existing, ...settings };
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('store_settings', JSON.stringify(merged));
  
  try {
    const store = loadJsonStore(true);
    store.settings = merged;
    saveJsonStore();
  } catch (e) {
    console.warn('Could not write settings to JSON store:', e.message);
  }

  autoBackupToJsonDisk();
  supabaseSync.syncSettings(merged);
  return getBootstrapData();
}

function cancelSale(saleId) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    const sale = (store.sales || []).find(s => s.id === saleId);
    const items = sale ? (sale.items || []) : [];
    items.forEach(it => {
      if (it.piece_id) {
        const piece = store.inventory_items.find(x => x.id === it.piece_id);
        if (piece) {
          piece.status = it.is_return ? 'Sold' : 'In Stock';
        }
      }
    });
    store.sales = (store.sales || []).filter(s => s.id !== saleId);
    store.activities = store.activities || [];
    store.activities.unshift({
      id: 'ACT-' + Date.now(),
      type: 'adjust',
      title: `Cancelled Sale ${saleId}`,
      size: `${items.length} items`,
      qty_change: `+${items.length} pairs`,
      time: new Date().toISOString(),
      details: 'Bill cancelled and inventory adjusted'
    });
    saveJsonStore();
    supabaseSync.syncSaleCancel(saleId, items);
    return getBootstrapData();
  }

  let items = [];
  const tx = db.transaction(() => {
    // Find sale items to restore piece status
    items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);
    const updatePieceStock = db.prepare("UPDATE inventory_pieces SET status = 'In Stock' WHERE id = ?");
    const updatePieceSold = db.prepare("UPDATE inventory_pieces SET status = 'Sold' WHERE id = ?");

    for (const it of items) {
      if (it.piece_id) {
        if (it.is_return) {
          // If this bill was an exchange return, cancelling reverts it back to Sold
          updatePieceSold.run(it.piece_id);
        } else {
          // Normal sold item reverts to In Stock
          updatePieceStock.run(it.piece_id);
        }
      }
    }
    // Delete sale items and sale
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
    db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);

    // Log Activity
    db.prepare(`
      INSERT INTO activities (id, type, title, size, qty_change, time, details)
      VALUES (?, 'adjust', ?, ?, ?, ?, ?)
    `).run(
      'ACT-' + Date.now(),
      `Cancelled Sale ${saleId}`,
      `${items.length} items`,
      `+${items.length} pairs`,
      new Date().toISOString(),
      'Bill cancelled and inventory adjusted'
    );
  });
  tx();
  autoBackupToJsonDisk();
  supabaseSync.syncSaleCancel(saleId, items);
  return getBootstrapData();
}

function createBox(boxData) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    const idx = store.boxes.findIndex(b => b.id === boxData.id);
    if (idx >= 0) store.boxes[idx] = { ...store.boxes[idx], ...boxData };
    else store.boxes.push(boxData);
    saveJsonStore();
    supabaseSync.syncBoxCreate(boxData);
    return getBootstrapData();
  }

  db.prepare(`
    INSERT INTO boxes (id, box_number, barcode, created_at)
    VALUES (@id, @box_number, @barcode, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      box_number = excluded.box_number,
      barcode = excluded.barcode
  `).run(boxData);
  autoBackupToJsonDisk();
  supabaseSync.syncBoxCreate(boxData);
  return getBootstrapData();
}

function syncFullState(payload) {
  const db = getDb();
  if (!db) {
    const store = loadJsonStore();
    if (payload.settings) store.settings = { ...(store.settings || {}), ...payload.settings };
    if (Array.isArray(payload.products)) store.products = payload.products;
    if (Array.isArray(payload.variants)) store.variants = payload.variants;
    if (Array.isArray(payload.boxes)) store.boxes = payload.boxes;
    if (Array.isArray(payload.box_items)) store.box_items = payload.box_items;
    if (Array.isArray(payload.inventory_items)) store.inventory_items = payload.inventory_items;
    if (Array.isArray(payload.sales)) store.sales = payload.sales;
    if (Array.isArray(payload.activities)) store.activities = payload.activities;
    saveJsonStore();
    supabaseSync.syncFullState(payload);
    return getBootstrapData();
  }

  const { products, variants, boxes, box_items, inventory_items, sales, activities, settings } = payload;

  const tx = db.transaction(() => {
    if (settings) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('store_settings', JSON.stringify(settings));
    }

    if (Array.isArray(products)) {
      db.prepare('DELETE FROM products').run();
      const insert = db.prepare(`
        INSERT INTO products (id, name, sku, brand, category, cost, price, mrp, low_stock_threshold, created_at)
        VALUES (@id, @name, @sku, @brand, @category, @cost, @price, @mrp, @low_stock_threshold, @created_at)
      `);
      for (const p of products) {
        insert.run({
          id: p.id,
          name: p.name,
          sku: p.sku || '',
          brand: p.brand || 'Generic',
          category: p.category || 'Casual',
          cost: Number(p.cost || 0),
          price: Number(p.price || 0),
          mrp: Number(p.mrp || p.price || 0),
          low_stock_threshold: Number(p.low_stock_threshold || 5),
          created_at: p.created_at || new Date().toISOString()
        });
      }
    }

    if (Array.isArray(variants)) {
      db.prepare('DELETE FROM product_variants').run();
      const insert = db.prepare(`
        INSERT INTO product_variants (id, product_id, size, color, variant_code)
        VALUES (@id, @product_id, @size, @color, @variant_code)
      `);
      for (const v of variants) {
        insert.run(v);
      }
    }

    if (Array.isArray(boxes)) {
      db.prepare('DELETE FROM boxes').run();
      const insert = db.prepare(`
        INSERT INTO boxes (id, box_number, barcode, created_at)
        VALUES (@id, @box_number, @barcode, @created_at)
      `);
      for (const b of boxes) {
        insert.run({
          id: b.id,
          box_number: b.box_number,
          barcode: b.barcode || b.box_number,
          created_at: b.created_at || new Date().toISOString()
        });
      }
    }

    if (Array.isArray(box_items)) {
      db.prepare('DELETE FROM box_items').run();
      const insert = db.prepare(`
        INSERT INTO box_items (id, box_id, variant_id, quantity)
        VALUES (@id, @box_id, @variant_id, @quantity)
      `);
      for (const bi of box_items) {
        insert.run(bi);
      }
    }

    if (Array.isArray(inventory_items)) {
      db.prepare('DELETE FROM inventory_pieces').run();
      const insert = db.prepare(`
        INSERT INTO inventory_pieces (id, variant_id, product_id, piece_code, barcode, box_id, status, created_at)
        VALUES (@id, @variant_id, @product_id, @piece_code, @barcode, @box_id, @status, @created_at)
      `);
      for (const pi of inventory_items) {
        insert.run(pi);
      }
    }

    if (Array.isArray(sales)) {
      db.prepare('DELETE FROM sale_items').run();
      db.prepare('DELETE FROM sales').run();
      const insertSale = db.prepare(`
        INSERT INTO sales (
          id, bill_number, date, subtotal, item_discount, overall_discount,
          tax_amount, grand_total, payment_method, amount_received, change_amount, cashier_notes
        ) VALUES (
          @id, @bill_number, @date, @subtotal, @item_discount, @overall_discount,
          @tax_amount, @grand_total, @payment_method, @amount_received, @change_amount, @cashier_notes
        )
      `);
      const insertItem = db.prepare(`
        INSERT INTO sale_items (
          id, sale_id, variant_id, piece_id, piece_code, product_name_snapshot,
          size_snapshot, colour_snapshot, box_number_snapshot, mrp_snapshot,
          price_at_sale, quantity, discount, amount
        ) VALUES (
          @id, @sale_id, @variant_id, @piece_id, @piece_code, @product_name_snapshot,
          @size_snapshot, @colour_snapshot, @box_number_snapshot, @mrp_snapshot,
          @price_at_sale, @quantity, @discount, @amount
        )
      `);

      for (const s of sales) {
        insertSale.run({
          id: s.id || ('SALE-' + Math.random().toString(36).substring(2, 9)),
          bill_number: s.bill_number || ('BILL-' + Date.now()),
          date: s.date || new Date().toISOString(),
          subtotal: Number(s.subtotal || s.total || 0),
          item_discount: Number(s.item_discount || 0),
          overall_discount: Number(s.overall_discount || s.discount || 0),
          tax_amount: Number(s.tax_amount || 0),
          grand_total: Number(s.grand_total || s.total || 0),
          payment_method: s.payment_method || s.payment || 'Cash',
          amount_received: Number(s.amount_received || s.total || 0),
          change_amount: Number(s.change_amount || 0),
          cashier_notes: s.cashier_notes || ''
        });

        if (Array.isArray(s.items)) {
          for (const it of s.items) {
            insertItem.run({
              id: it.id || ('SI-' + Math.random().toString(36).substring(2, 9)),
              sale_id: s.id,
              variant_id: it.variant_id || null,
              piece_id: it.piece_id || null,
              piece_code: it.piece_code || '',
              product_name_snapshot: it.product_name_snapshot || it.name || 'Shoe',
              size_snapshot: it.size_snapshot || it.size || '',
              colour_snapshot: it.colour_snapshot || it.color || '',
              box_number_snapshot: it.box_number_snapshot || it.box_number || '',
              mrp_snapshot: Number(it.mrp_snapshot || it.mrp || it.price || 0),
              price_at_sale: Number(it.price_at_sale || it.price || 0),
              quantity: Number(it.quantity || 1),
              discount: Number(it.discount || 0),
              amount: Number(it.amount || it.price || 0)
            });
          }
        }
      }
    }
  });

  tx();
  autoBackupToJsonDisk();
  supabaseSync.syncFullState(payload);
  return getBootstrapData();
}

module.exports = {
  getDb,
  getBootstrapData,
  saveProduct,
  deleteProduct,
  deleteInventoryPiece,
  completeSale,
  cancelSale,
  createBox,
  updateSettings,
  syncFullState,
  autoBackupToJsonDisk,
  getSystemStorageInfo
};
