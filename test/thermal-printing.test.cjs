const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const thermalPrinter = require('../server/thermalPrinter.cjs');

test('Thermal Printer Specification & Dimensions', async (t) => {
  await t.test('Page dimensions are exactly 50.8 x 25.4 mm (2 x 1 inch)', () => {
    assert.strictEqual(thermalPrinter.THERMAL_WIDTH_MM, 50.8, 'Width must be 50.8mm');
    assert.strictEqual(thermalPrinter.THERMAL_HEIGHT_MM, 25.4, 'Height must be 25.4mm');
    assert.strictEqual(thermalPrinter.THERMAL_WIDTH_MICRONS, 50800, 'Width must be 50800 microns for Electron printer API');
    assert.strictEqual(thermalPrinter.THERMAL_HEIGHT_MICRONS, 25400, 'Height must be 25400 microns for Electron printer API');
    assert.strictEqual(thermalPrinter.THERMAL_WIDTH_PT, 144.0, 'Width must be 144 points in PDF units');
    assert.strictEqual(thermalPrinter.THERMAL_HEIGHT_PT, 72.0, 'Height must be 72 points in PDF units');
    assert.strictEqual(thermalPrinter.DEFAULT_PRINTER_NAME, 'TSC TL240', 'Default printer must be TSC TL240');
  });
});

test('Thermal Label HTML Generation & Page Units', async (t) => {
  await t.test('1 requested label produces exactly 1 separate label page unit', () => {
    const singleItem = [{
      productName: 'Leather Formal Shoe',
      sku: 'LFS-BLK-42',
      size: '42',
      price: 1899,
      barcode: 'MS-8901001',
      pieceCode: 'MS-8901001'
    }];

    const html = thermalPrinter.generateThermalLabelsHtml(singleItem, { storeName: 'Maulana Shoes' });

    // Verify 1 page unit
    const matches = html.match(/class="thermal-label-page"/g);
    assert.ok(matches, 'Should contain thermal-label-page elements');
    assert.strictEqual(matches.length, 1, '1 requested label must produce exactly 1 label unit');

    // Verify dimensions & page-break in CSS
    assert.ok(html.includes('size: 50.8mm 25.4mm;'), 'CSS must specify @page size 50.8mm 25.4mm');
    assert.ok(html.includes('width: 50.8mm;'), 'Label container must be 50.8mm wide');
    assert.ok(html.includes('height: 25.4mm;'), 'Label container must be 25.4mm high');
    assert.ok(html.includes('page-break-after: always;'), 'Label must have page-break-after');

    // Verify content
    assert.ok(html.includes('MAULANA SHOES'), 'Must contain store name');
    assert.ok(html.includes('Leather Formal Shoe'), 'Must contain product name');
    assert.strictEqual(html.includes('Leather Formal Shoe • SKU:'), false, 'Must not append duplicate SKU to product name');
    assert.ok(html.includes('Size: 42'), 'Must contain size');
    assert.ok(html.includes('₹1,899'), 'Must contain formatted price');
    assert.ok(html.includes('MS-8901001'), 'Must contain unique identifier');
  });

  await t.test('10 requested labels produce exactly 10 separate label page units', () => {
    const tenItems = Array.from({ length: 10 }, (_, i) => ({
      productName: `Shoe Model ${i + 1}`,
      sku: `SKU-${100 + i}`,
      size: String(7 + (i % 4)),
      price: 1200 + i * 50,
      barcode: `MS-890200${i}`,
      pieceCode: `MS-890200${i}`
    }));

    const html = thermalPrinter.generateThermalLabelsHtml(tenItems, { storeName: 'Maulana Shoes' });
    const matches = html.match(/class="thermal-label-page"/g);

    assert.ok(matches, 'Should contain thermal-label-page elements');
    assert.strictEqual(matches.length, 10, '10 requested labels must produce exactly 10 label page units');

    // Check page indices
    for (let i = 1; i <= 10; i++) {
      assert.ok(html.includes(`data-page-index="${i}"`), `Page index ${i} must exist`);
    }
  });

  await t.test('Multiple products and quantities produce correct label count and product data', () => {
    // 3 pairs of Oxford, 2 pairs of Sneaker, 1 pair of Sandal = 6 labels total
    const batch = [
      { productName: 'Oxford Wingtip', sku: 'OXF-BRN-8', size: '8', price: 2499, barcode: 'OXF-001', pieceCode: 'OXF-001' },
      { productName: 'Oxford Wingtip', sku: 'OXF-BRN-8', size: '8', price: 2499, barcode: 'OXF-002', pieceCode: 'OXF-002' },
      { productName: 'Oxford Wingtip', sku: 'OXF-BRN-8', size: '8', price: 2499, barcode: 'OXF-003', pieceCode: 'OXF-003' },
      { productName: 'Air Sport Sneaker', sku: 'SNK-WHT-9', size: '9', price: 3199, barcode: 'SNK-001', pieceCode: 'SNK-001' },
      { productName: 'Air Sport Sneaker', sku: 'SNK-WHT-9', size: '9', price: 3199, barcode: 'SNK-002', pieceCode: 'SNK-002' },
      { productName: 'Comfort Leather Sandal', sku: 'SAN-BLK-7', size: '7', price: 999, barcode: 'SAN-001', pieceCode: 'SAN-001' }
    ];

    const html = thermalPrinter.generateThermalLabelsHtml(batch, { storeName: 'Maulana Shoes' });
    const matches = html.match(/class="thermal-label-page"/g);
    assert.strictEqual(matches.length, 6, 'Must generate exactly 6 label pages');

    // Verify Oxford data count
    const oxfMatches = html.match(/<div class="product-title"[^>]*>Oxford Wingtip/g);
    assert.strictEqual(oxfMatches.length, 3, 'Must contain 3 Oxford labels');

    // Verify Sneaker data count
    const snkMatches = html.match(/<div class="product-title"[^>]*>Air Sport Sneaker/g);
    assert.strictEqual(snkMatches.length, 2, 'Must contain 2 Sneaker labels');

    // Verify Sandal data count
    const sanMatches = html.match(/<div class="product-title"[^>]*>Comfort Leather Sandal/g);
    assert.strictEqual(sanMatches.length, 1, 'Must contain 1 Sandal label');
  });

  await t.test('No A4 page dimensions or multi-column layout in thermal mode', () => {
    const items = [{
      productName: 'Casual Loafer',
      sku: 'LOAF-01',
      size: '8',
      price: 1599,
      barcode: 'MS-8903001',
      pieceCode: 'MS-8903001'
    }];

    const html = thermalPrinter.generateThermalLabelsHtml(items);

    assert.strictEqual(html.includes('210mm'), false, 'Thermal mode must not contain A4 width (210mm)');
    assert.strictEqual(html.includes('297mm'), false, 'Thermal mode must not contain A4 height (297mm)');
    assert.strictEqual(html.includes('a4-page'), false, 'Thermal mode must not contain a4-page class');
    assert.strictEqual(html.includes('grid-template-columns: repeat(4'), false, 'Thermal mode must not contain 4-column A4 grid');
  });
});

test('Printer Targeting, Silent Dispatch, and Fallback Prevention', async (t) => {
  await t.test('Print request targets configured printer with silent: true and exact microns', () => {
    const options = thermalPrinter.getThermalPrintOptions('TSC TL240');

    assert.strictEqual(options.silent, true, 'Print must be silent without dialog');
    assert.strictEqual(options.deviceName, 'TSC TL240', 'Must target TSC TL240');
    assert.strictEqual(options.pageSize.width, 50800, 'Page width must be 50800 microns');
    assert.strictEqual(options.pageSize.height, 25400, 'Page height must be 25400 microns');
    assert.strictEqual(options.margins.marginType, 'none', 'Must have zero margins');
  });

  await t.test('Validation succeeds when target printer exists in system printers', () => {
    const installed = [
      { name: 'Microsoft Print to PDF', isDefault: false },
      { name: 'TSC TL240', isDefault: true }
    ];

    const result = thermalPrinter.validatePrinterSelection('TSC TL240', installed);
    assert.strictEqual(result.valid, true, 'Validation must pass when printer exists');
    assert.strictEqual(result.matchedPrinter.name, 'TSC TL240');
  });

  await t.test('Validation is case-insensitive for printer names', () => {
    const installed = [{ name: 'TSC TL240', isDefault: true }];
    const result = thermalPrinter.validatePrinterSelection('tsc tl240', installed);
    assert.strictEqual(result.valid, true, 'Case-insensitive printer matching must succeed');
  });

  await t.test('Missing printer configuration returns clear error', () => {
    const result1 = thermalPrinter.validatePrinterSelection('', [{ name: 'TSC TL240' }]);
    assert.strictEqual(result1.valid, false);
    assert.ok(result1.error.includes('not configured'), 'Must report unconfigured printer error');

    const result2 = thermalPrinter.validatePrinterSelection(null, [{ name: 'TSC TL240' }]);
    assert.strictEqual(result2.valid, false);
  });

  await t.test('Non-existent printer rejects immediately and prevents fallback to other printers', () => {
    const installed = [
      { name: 'Office Laser Printer', isDefault: true },
      { name: 'Microsoft XPS Document Writer', isDefault: false }
    ];

    const result = thermalPrinter.validatePrinterSelection('TSC TL240', installed);
    assert.strictEqual(result.valid, false, 'Must reject when TSC TL240 is not found');
    assert.ok(result.error.includes('TSC TL240'), 'Error must name the missing target printer');
    assert.ok(result.error.includes('abort'), 'Error must note printing was aborted to prevent fallback');
    assert.strictEqual(result.matchedPrinter, undefined, 'Must not match or fall back to Office Laser Printer');
  });
});

test('Barcode Vector Graphic Containment', async (t) => {
  await t.test('generateBarcodeSvg produces valid SVG containing bars', () => {
    const svg = thermalPrinter.generateBarcodeSvg('MS-TEST-1234');
    assert.ok(svg.startsWith('<svg'), 'Barcode output must start with <svg');
    assert.ok(svg.includes('</svg>'), 'Barcode output must close </svg>');
    assert.ok(svg.includes('<rect'), 'Barcode SVG must contain barcode bar rects');
  });
});
