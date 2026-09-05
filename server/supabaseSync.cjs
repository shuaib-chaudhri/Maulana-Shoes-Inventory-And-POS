const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env if present
let supabaseUrl = process.env.VITE_SUPABASE_URL;
let supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (key === 'VITE_SUPABASE_URL') supabaseUrl = value;
          if (key === 'VITE_SUPABASE_ANON_KEY') supabaseAnonKey = value;
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ [SupabaseSync]: Could not read .env file:', err.message);
  }
}

let supabase = null;
const SUPABASE_ENABLED = false;

if (SUPABASE_ENABLED && supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
  console.log('✅ [SupabaseSync]: Initialized Supabase client for backend auto-syncing.');
} else {
  console.log('ℹ️ [SupabaseSync]: Supabase integration is DISCONNECTED. Running in 100% Local SQLite Mode.');
}

/**
 * Convert any string ID into a deterministic UUID v4 string
 */
function toUuid(str) {
  if (!str) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(str)) return str;
  const hash = crypto.createHash('md5').update(String(str)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Helper to execute async Supabase calls safely in background without blocking local SQLite
 */
function safeSync(actionName, syncFn) {
  if (!SUPABASE_ENABLED || !supabase) return;
  Promise.resolve()
    .then(() => syncFn())
    .then(() => {
      console.log(`⚡ [SupabaseSync Completed]: ${actionName}`);
    })
    .catch(err => {
      console.error(`❌ [SupabaseSync Exception] (${actionName}):`, err.message || err);
    });
}

/**
 * Helper to execute table operation and log errors cleanly
 */
async function execOp(table, opPromise) {
  try {
    const res = await opPromise;
    if (res && res.error) {
      console.warn(`⚠️ [SupabaseSync Warning] (${table}):`, res.error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`⚠️ [SupabaseSync Error] (${table}):`, err.message || err);
    return false;
  }
}

/**
 * Sync product save (Product, Variants, Boxes, Box Items, Inventory Items)
 */
function syncProductSave(data) {
  safeSync('saveProduct', async () => {
    const { product, variants = [], boxes = [], box_items = [], inventory_pieces = [] } = data;

    if (product) {
      const prodRecord = {
        id: toUuid(product.id),
        name: product.name,
        sku: product.sku || '',
        brand: product.brand || 'Generic',
        category: product.category || 'Casual',
        cost: Number(product.cost || 0),
        price: Number(product.price || 0),
        mrp: Number(product.mrp || product.price || 0),
        low_stock_threshold: Number(product.low_stock_threshold || 5),
        created_at: product.created_at || new Date().toISOString()
      };
      await execOp('products', supabase.from('products').upsert([prodRecord]));
    }

    if (variants.length > 0) {
      const mappedVars = variants.map(v => ({
        id: toUuid(v.id),
        product_id: toUuid(v.product_id),
        sku: v.variant_code || v.sku || '',
        size: String(v.size || ''),
        color: String(v.color || '')
      }));
      await execOp('product_variants', supabase.from('product_variants').upsert(mappedVars));
    }

    if (boxes.length > 0) {
      const mappedBoxes = boxes.map(b => ({
        id: toUuid(b.id),
        box_number: b.box_number,
        barcode: b.barcode || b.box_number,
        created_at: b.created_at || new Date().toISOString()
      }));
      await execOp('boxes', supabase.from('boxes').upsert(mappedBoxes));
    }

    if (box_items.length > 0) {
      const mappedBoxItems = box_items.map(bi => ({
        id: toUuid(bi.id),
        box_id: toUuid(bi.box_id),
        variant_id: toUuid(bi.variant_id),
        quantity: Number(bi.quantity || 0)
      }));
      await execOp('box_items', supabase.from('box_items').upsert(mappedBoxItems));
    }

    if (inventory_pieces.length > 0) {
      const mappedPieces = inventory_pieces.map(pi => ({
        id: toUuid(pi.id),
        variant_id: toUuid(pi.variant_id),
        product_id: toUuid(pi.product_id),
        piece_code: pi.piece_code,
        barcode: pi.barcode || pi.piece_code,
        box_id: pi.box_id ? toUuid(pi.box_id) : null,
        status: pi.status || 'In Stock',
        created_at: pi.created_at || new Date().toISOString()
      }));
      await execOp('inventory_items', supabase.from('inventory_items').upsert(mappedPieces));
    }
  });
}

/**
 * Sync product deletion
 */
function syncProductDelete(productId) {
  safeSync('deleteProduct', async () => {
    const pUuid = toUuid(productId);
    await execOp('inventory_items', supabase.from('inventory_items').delete().eq('product_id', pUuid));
    await execOp('product_variants', supabase.from('product_variants').delete().eq('product_id', pUuid));
    await execOp('products', supabase.from('products').delete().eq('id', pUuid));
  });
}

/**
 * Sync completed sale (Invoice creation & item status update)
 */
function syncSaleComplete(saleData) {
  safeSync('completeSale', async () => {
    const { sale, items = [], soldPieceIds = [], returnedPieceIds = [] } = saleData;
    if (!sale) return;

    const saleUuid = toUuid(sale.id);
    const saleRecord = {
      id: saleUuid,
      invoice_number: sale.bill_number || ('BILL-' + Date.now()),
      created_at: sale.date || new Date().toISOString(),
      subtotal: Number(sale.subtotal || 0),
      discount: Number((sale.item_discount || 0) + (sale.overall_discount || 0)),
      tax: Number(sale.tax_amount || 0),
      total: Number(sale.grand_total || sale.subtotal || 0),
      status: 'completed',
      notes: `${sale.payment_method || 'Cash'}${sale.cashier_notes ? ' - ' + sale.cashier_notes : ''}`
    };

    await execOp('sales', supabase.from('sales').upsert([saleRecord]));

    if (items.length > 0) {
      const saleItemsMapped = items.map(it => ({
        id: toUuid(it.id),
        sale_id: saleUuid,
        variant_id: it.variant_id ? toUuid(it.variant_id) : null,
        unit_price: Number(it.price_at_sale || it.price || 0),
        quantity: Number(it.quantity || 1),
        discount: Number(it.discount || 0),
        total: Number(it.amount || it.price_at_sale || 0)
      }));
      await execOp('sale_items', supabase.from('sale_items').upsert(saleItemsMapped));
    }

    // Update status of sold inventory pieces in Supabase
    for (const pId of soldPieceIds) {
      if (pId) {
        await execOp('inventory_items', supabase.from('inventory_items').update({ status: 'Sold' }).eq('id', toUuid(pId)));
      }
    }

    // Restock returned inventory pieces in Supabase
    for (const rId of returnedPieceIds) {
      if (rId) {
        await execOp('inventory_items', supabase.from('inventory_items').update({ status: 'In Stock' }).eq('id', toUuid(rId)));
      }
    }

    // Log Activity
    const actRecord = {
      id: toUuid('ACT-SALE-' + sale.id),
      type: 'sale',
      title: `Invoice #${sale.bill_number}`,
      size: `${items.length} items`,
      qty_change: `₹${sale.grand_total}`,
      time: sale.date || new Date().toISOString(),
      details: `Paid via ${sale.payment_method}`
    };
    await execOp('activities', supabase.from('activities').upsert([actRecord]));
  });
}

/**
 * Sync sale cancellation
 */
function syncSaleCancel(saleId, items = []) {
  safeSync('cancelSale', async () => {
    const saleUuid = toUuid(saleId);
    await execOp('sale_items', supabase.from('sale_items').delete().eq('sale_id', saleUuid));
    await execOp('sales', supabase.from('sales').delete().eq('id', saleUuid));

    // Revert piece status
    for (const it of items) {
      if (it.piece_id) {
        const pieceUuid = toUuid(it.piece_id);
        const newStatus = it.is_return ? 'Sold' : 'In Stock';
        await execOp('inventory_items', supabase.from('inventory_items').update({ status: newStatus }).eq('id', pieceUuid));
      }
    }

    // Log Activity
    const actRecord = {
      id: toUuid('ACT-CANCEL-' + saleId + '-' + Date.now()),
      type: 'adjust',
      title: `Cancelled Sale ${saleId}`,
      size: `${items.length} items`,
      qty_change: `+${items.length} pairs`,
      time: new Date().toISOString(),
      details: 'Invoice cancelled'
    };
    await execOp('activities', supabase.from('activities').upsert([actRecord]));
  });
}

/**
 * Sync box creation
 */
function syncBoxCreate(boxData) {
  safeSync('createBox', async () => {
    if (!boxData) return;
    const boxRecord = {
      id: toUuid(boxData.id),
      box_number: boxData.box_number,
      barcode: boxData.barcode || boxData.box_number,
      created_at: boxData.created_at || new Date().toISOString()
    };
    await execOp('boxes', supabase.from('boxes').upsert([boxRecord]));
  });
}

/**
 * Sync settings
 */
function syncSettings(settings) {
  safeSync('updateSettings', async () => {
    if (!settings) return;
    const settingRecord = {
      id: toUuid('store_settings'),
      category: 'store',
      value: JSON.stringify(settings),
      updated_at: new Date().toISOString()
    };
    await execOp('settings', supabase.from('settings').upsert([settingRecord]));
  });
}

/**
 * Full state sync (Bootstrap/Restore payload)
 */
function syncFullState(payload) {
  safeSync('syncFullState', async () => {
    if (!payload) return;
    const { products, variants, boxes, box_items, inventory_items, sales, activities, settings } = payload;

    if (settings) {
      await execOp('settings', supabase.from('settings').upsert([{
        id: toUuid('store_settings'),
        category: 'store',
        value: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      }]));
    }

    if (Array.isArray(products) && products.length > 0) {
      const prodMapped = products.map(p => ({
        id: toUuid(p.id),
        name: p.name,
        sku: p.sku || '',
        brand: p.brand || 'Generic',
        category: p.category || 'Casual',
        cost: Number(p.cost || 0),
        price: Number(p.price || 0),
        mrp: Number(p.mrp || p.price || 0),
        low_stock_threshold: Number(p.low_stock_threshold || 5),
        created_at: p.created_at || new Date().toISOString()
      }));
      await execOp('products', supabase.from('products').upsert(prodMapped));
    }

    if (Array.isArray(variants) && variants.length > 0) {
      const varMapped = variants.map(v => ({
        id: toUuid(v.id),
        product_id: toUuid(v.product_id),
        sku: v.variant_code || v.sku || '',
        size: String(v.size || ''),
        color: String(v.color || '')
      }));
      await execOp('product_variants', supabase.from('product_variants').upsert(varMapped));
    }

    if (Array.isArray(boxes) && boxes.length > 0) {
      const boxMapped = boxes.map(b => ({
        id: toUuid(b.id),
        box_number: b.box_number,
        barcode: b.barcode || b.box_number,
        created_at: b.created_at || new Date().toISOString()
      }));
      await execOp('boxes', supabase.from('boxes').upsert(boxMapped));
    }

    if (Array.isArray(box_items) && box_items.length > 0) {
      const biMapped = box_items.map(bi => ({
        id: toUuid(bi.id),
        box_id: toUuid(bi.box_id),
        variant_id: toUuid(bi.variant_id),
        quantity: Number(bi.quantity || 0)
      }));
      await execOp('box_items', supabase.from('box_items').upsert(biMapped));
    }

    if (Array.isArray(inventory_items) && inventory_items.length > 0) {
      const pieceMapped = inventory_items.map(pi => ({
        id: toUuid(pi.id),
        variant_id: toUuid(pi.variant_id),
        product_id: toUuid(pi.product_id),
        piece_code: pi.piece_code,
        barcode: pi.barcode || pi.piece_code,
        box_id: pi.box_id ? toUuid(pi.box_id) : null,
        status: pi.status || 'In Stock',
        created_at: pi.created_at || new Date().toISOString()
      }));
      await execOp('inventory_items', supabase.from('inventory_items').upsert(pieceMapped));
    }

    if (Array.isArray(sales) && sales.length > 0) {
      for (const s of sales) {
        const sUuid = toUuid(s.id);
        await execOp('sales', supabase.from('sales').upsert([{
          id: sUuid,
          invoice_number: s.bill_number || ('BILL-' + Date.now()),
          created_at: s.date || new Date().toISOString(),
          subtotal: Number(s.subtotal || 0),
          discount: Number((s.item_discount || 0) + (s.overall_discount || 0)),
          tax: Number(s.tax_amount || 0),
          total: Number(s.grand_total || s.subtotal || 0),
          status: 'completed',
          notes: s.payment_method || 'Cash'
        }]));

        if (Array.isArray(s.items) && s.items.length > 0) {
          const sItemsMapped = s.items.map(it => ({
            id: toUuid(it.id),
            sale_id: sUuid,
            variant_id: it.variant_id ? toUuid(it.variant_id) : null,
            unit_price: Number(it.price_at_sale || it.price || 0),
            quantity: Number(it.quantity || 1),
            discount: Number(it.discount || 0),
            total: Number(it.amount || it.price_at_sale || 0)
          }));
          await execOp('sale_items', supabase.from('sale_items').upsert(sItemsMapped));
        }
      }
    }

    if (Array.isArray(activities) && activities.length > 0) {
      const actMapped = activities.map(a => ({
        id: toUuid(a.id),
        type: a.type || 'add',
        title: a.title || 'Activity',
        size: a.size || '',
        qty_change: a.qty_change || '',
        time: a.time || new Date().toISOString(),
        details: a.details || ''
      }));
      await execOp('activities', supabase.from('activities').upsert(actMapped));
    }
  });
}

module.exports = {
  toUuid,
  syncProductSave,
  syncProductDelete,
  syncSaleComplete,
  syncSaleCancel,
  syncBoxCreate,
  syncSettings,
  syncFullState
};
