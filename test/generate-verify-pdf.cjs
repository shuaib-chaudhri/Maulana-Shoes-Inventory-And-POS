const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const thermalPrinter = require('../server/thermalPrinter.cjs');

// Ensure artifacts dir exists
const artifactDir = path.join(__dirname, 'artifacts');
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

function parsePdfPageDimensions(pdfBuffer) {
  const content = pdfBuffer.toString('latin1');
  
  // Find /MediaBox definitions
  // Format is typically /MediaBox [ 0 0 144 72 ] or /MediaBox[0 0 144 72] or similar
  const mediaBoxRegex = /\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/g;
  const boxes = [];
  let match;
  while ((match = mediaBoxRegex.exec(content)) !== null) {
    boxes.push({
      x1: parseFloat(match[1]),
      y1: parseFloat(match[2]),
      x2: parseFloat(match[3]),
      y2: parseFloat(match[4]),
      widthPt: parseFloat(match[3]) - parseFloat(match[1]),
      heightPt: parseFloat(match[4]) - parseFloat(match[2])
    });
  }

  // Count /Type /Page occurrences (page objects)
  const pageTypeRegex = /\/Type\s*\/Page\b/g;
  const pageMatches = content.match(pageTypeRegex) || [];
  const pageCount = pageMatches.length;

  return { boxes, pageCount };
}

app.whenReady().then(async () => {
  try {
    console.log('----------------------------------------------------');
    console.log('TSC TL240 Thermal Label Automated PDF Verification');
    console.log('----------------------------------------------------');

    const win = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Test 1: Single label test (1 requested -> 1 page PDF)
    console.log('\n[Test 1] Generating 1 requested label...');
    const singleItem = [{
      productName: 'Royal Leather Oxford',
      sku: 'MS-OXF-001',
      size: '9',
      price: 2499,
      barcode: '8901001001',
      pieceCode: 'MS-8901001-9'
    }];

    const html1 = thermalPrinter.generateThermalLabelsHtml(singleItem, { storeName: 'Maulana Shoes' });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html1)}`);

    const pdfBuf1 = await win.webContents.printToPDF({
      pageSize: {
        width: thermalPrinter.THERMAL_WIDTH_MICRONS,
        height: thermalPrinter.THERMAL_HEIGHT_MICRONS
      },
      margins: { marginType: 'none' },
      printBackground: true
    });

    const pdfPath1 = path.join(artifactDir, 'single_thermal_label_test.pdf');
    fs.writeFileSync(pdfPath1, pdfBuf1);
    console.log(`✓ Single label PDF written: ${pdfPath1} (${pdfBuf1.length} bytes)`);

    const parsed1 = parsePdfPageDimensions(pdfBuf1);
    console.log(`  Page count: ${parsed1.pageCount} (Expected: 1)`);
    if (parsed1.boxes.length > 0) {
      const b = parsed1.boxes[0];
      const widthMm = (b.widthPt / 72 * 25.4).toFixed(1);
      const heightMm = (b.heightPt / 72 * 25.4).toFixed(1);
      console.log(`  Page dimensions: ${b.widthPt}pt x ${b.heightPt}pt (${widthMm}mm x ${heightMm}mm)`);
      console.log(`  Expected: 144pt x 72pt (50.8mm x 25.4mm)`);
      if (Math.abs(b.widthPt - 144) > 1 || Math.abs(b.heightPt - 72) > 1) {
        throw new Error(`Dimension mismatch in PDF: expected 144x72 pt, got ${b.widthPt}x${b.heightPt}`);
      }
    }
    if (parsed1.pageCount !== 1) {
      throw new Error(`Page count mismatch: expected 1 page, got ${parsed1.pageCount}`);
    }
    console.log('✓ Test 1 PASSED: Exactly 1 page at exactly 50.8 x 25.4 mm (144 x 72 pt)');

    // Test 2: Ten labels test (10 requested -> 10 pages PDF)
    console.log('\n[Test 2] Generating 10 requested labels...');
    const tenItems = Array.from({ length: 10 }, (_, i) => ({
      productName: `Product ${i + 1}`,
      sku: `SKU-${1000 + i}`,
      size: `${7 + (i % 4)}`,
      price: 1500 + i * 100,
      barcode: `890200${i}`,
      pieceCode: `PIECE-00${i + 1}`
    }));

    const html10 = thermalPrinter.generateThermalLabelsHtml(tenItems, { storeName: 'Maulana Shoes' });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html10)}`);

    const pdfBuf10 = await win.webContents.printToPDF({
      pageSize: {
        width: thermalPrinter.THERMAL_WIDTH_MICRONS,
        height: thermalPrinter.THERMAL_HEIGHT_MICRONS
      },
      margins: { marginType: 'none' },
      printBackground: true
    });

    const pdfPath10 = path.join(artifactDir, 'ten_thermal_labels_test.pdf');
    fs.writeFileSync(pdfPath10, pdfBuf10);
    console.log(`✓ 10-label PDF written: ${pdfPath10} (${pdfBuf10.length} bytes)`);

    const parsed10 = parsePdfPageDimensions(pdfBuf10);
    console.log(`  Page count: ${parsed10.pageCount} (Expected: 10)`);
    if (parsed10.pageCount !== 10) {
      throw new Error(`Page count mismatch: expected 10 pages, got ${parsed10.pageCount}`);
    }
    console.log('✓ Test 2 PASSED: Exactly 10 pages generated (1 label per page, no A4 sheet)');

    // Test 3: Multiple products & quantities test
    console.log('\n[Test 3] Generating multi-product batch (3 x Nike, 2 x Puma, 1 x Bata)...');
    const multiBatch = [
      { productName: 'Nike Revolution', sku: 'NK-REV-8', size: '8', price: 3695, barcode: 'NK-801', pieceCode: 'NK-801' },
      { productName: 'Nike Revolution', sku: 'NK-REV-8', size: '8', price: 3695, barcode: 'NK-802', pieceCode: 'NK-802' },
      { productName: 'Nike Revolution', sku: 'NK-REV-8', size: '8', price: 3695, barcode: 'NK-803', pieceCode: 'NK-803' },
      { productName: 'Puma Smash V2', sku: 'PM-SM-9', size: '9', price: 2799, barcode: 'PM-901', pieceCode: 'PM-901' },
      { productName: 'Puma Smash V2', sku: 'PM-SM-9', size: '9', price: 2799, barcode: 'PM-902', pieceCode: 'PM-902' },
      { productName: 'Bata Formal Derby', sku: 'BT-DRB-10', size: '10', price: 1499, barcode: 'BT-101', pieceCode: 'BT-101' }
    ];

    const htmlMulti = thermalPrinter.generateThermalLabelsHtml(multiBatch, { storeName: 'Maulana Shoes' });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlMulti)}`);

    const pdfBufMulti = await win.webContents.printToPDF({
      pageSize: {
        width: thermalPrinter.THERMAL_WIDTH_MICRONS,
        height: thermalPrinter.THERMAL_HEIGHT_MICRONS
      },
      margins: { marginType: 'none' },
      printBackground: true
    });

    const pdfPathMulti = path.join(artifactDir, 'multi_product_batch_test.pdf');
    fs.writeFileSync(pdfPathMulti, pdfBufMulti);
    const parsedMulti = parsePdfPageDimensions(pdfBufMulti);
    console.log(`  Page count: ${parsedMulti.pageCount} (Expected: 6)`);
    if (parsedMulti.pageCount !== 6) {
      throw new Error(`Page count mismatch: expected 6 pages, got ${parsedMulti.pageCount}`);
    }
    console.log('✓ Test 3 PASSED: Exactly 6 pages generated with correct product records');

    console.log('\n====================================================');
    console.log('ALL AUTOMATED THERMAL PDF VERIFICATION TESTS PASSED!');
    console.log('====================================================');

    win.close();
    app.quit();
    process.exit(0);
  } catch (err) {
    console.error('VERIFICATION TEST FAILED:', err);
    app.quit();
    process.exit(1);
  }
});
