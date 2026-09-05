const fs = require('fs');
const path = require('path');

const files = [
  path.resolve(__dirname, '..', 'maulana_pos_data.json'),
  path.join(process.env.APPDATA, 'maulana-shoes-inventory-pos', 'maulana_pos_data.json')
];

const newProduct = {
  id: 'PROD-NIK-232',
  name: 'Nike Air Zoom Pegasus 232',
  brand: 'Nike',
  category: 'Running Shoes',
  sku: 'NIK-232',
  hsnCode: '640411',
  basePrice: 3299,
  created_at: '2026-09-01T10:00:00.000Z'
};

const newVariant = {
  id: 'VAR-NIK-232-BLK9',
  product_id: 'PROD-NIK-232',
  productId: 'PROD-NIK-232',
  size: '9',
  color: 'Black',
  skuVariant: 'NIK-232BLK',
  mrp: 4999,
  sellingPrice: 3299,
  stock: 6
};

const newPieces = [
  {
    id: 'ITEM-NIK-232BLK-001',
    product_id: 'PROD-NIK-232',
    productId: 'PROD-NIK-232',
    variant_id: 'VAR-NIK-232-BLK9',
    variantId: 'VAR-NIK-232-BLK9',
    pieceCode: 'NIK-232BLK-001',
    barcode: 'NIK-232BLK',
    status: 'in_stock',
    size: '9',
    color: 'Black',
    costPrice: 2200,
    mrp: 4999,
    sellingPrice: 3299
  },
  {
    id: 'ITEM-NIK-232BLK-002',
    product_id: 'PROD-NIK-232',
    productId: 'PROD-NIK-232',
    variant_id: 'VAR-NIK-232-BLK9',
    variantId: 'VAR-NIK-232-BLK9',
    pieceCode: 'NIK-232BLK-002',
    barcode: 'NIK-232BLK-02',
    status: 'in_stock',
    size: '9',
    color: 'Black',
    costPrice: 2200,
    mrp: 4999,
    sellingPrice: 3299
  }
];

const newSale = {
  id: 'SALE-232',
  billNumber: 'BILL-2026-232',
  date: '2026-09-04T15:30:00.000Z',
  customerName: 'Ramesh Patil',
  customerPhone: '+91 9822012345',
  paymentMethod: 'UPI',
  subtotal: 3299,
  tax: 0,
  discount: 0,
  total: 3299,
  status: 'completed',
  items: [
    {
      productId: 'PROD-NIK-232',
      productName: 'Nike Air Zoom Pegasus 232',
      variantId: 'VAR-NIK-232-BLK9',
      sku: 'NIK-232',
      skuVariant: 'NIK-232BLK',
      barcode: 'NIK-232BLK',
      size: '9',
      color: 'Black',
      price: 3299,
      quantity: 1
    }
  ]
};

for (const fp of files) {
  if (fs.existsSync(fp)) {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    data.products = data.products || [];
    if (!data.products.some(p => p.id === newProduct.id || p.sku === 'NIK-232')) {
      data.products.push(newProduct);
    }
    data.variants = data.variants || [];
    if (!data.variants.some(v => v.id === newVariant.id || v.skuVariant === 'NIK-232BLK')) {
      data.variants.push(newVariant);
    }
    data.inventory_items = data.inventory_items || [];
    for (const piece of newPieces) {
      if (!data.inventory_items.some(pi => pi.id === piece.id || pi.pieceCode === piece.pieceCode)) {
        data.inventory_items.push(piece);
      }
    }
    data.sales = data.sales || [];
    if (!data.sales.some(s => s.id === newSale.id || s.billNumber === newSale.billNumber)) {
      data.sales.unshift(newSale);
    }
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
    console.log('Updated:', fp);
  }
}
