const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
const JsBarcode = require('jsbarcode');

// Physical specifications for 2 x 1 inch thermal label (TSC TL240)
const THERMAL_WIDTH_MM = 50.8;
const THERMAL_HEIGHT_MM = 25.4;
const THERMAL_WIDTH_MICRONS = 50800; // 50.8mm * 1000
const THERMAL_HEIGHT_MICRONS = 25400; // 25.4mm * 1000
const THERMAL_WIDTH_PT = 144.0; // 72 DPI * 2.0 inches
const THERMAL_HEIGHT_PT = 72.0; // 72 DPI * 1.0 inch
const DEFAULT_PRINTER_NAME = 'TSC TL240';

/**
 * Generate inline SVG barcode string using JsBarcode
 */
function generateBarcodeSvg(barcodeText) {
  try {
    const xmlDoc = new DOMImplementation().createDocument('http://www.w3.org/2000/svg', 'svg', null);
    JsBarcode(xmlDoc.documentElement, String(barcodeText || '000000'), {
      format: 'CODE128',
      width: 1.25,
      height: 30,
      margin: 0,
      displayValue: false,
      xmlDocument: xmlDoc
    });
    return new XMLSerializer().serializeToString(xmlDoc);
  } catch (err) {
    return `<svg width="120" height="28" xmlns="http://www.w3.org/2000/svg"><text x="0" y="18" font-size="12">${barcodeText}</text></svg>`;
  }
}

/**
 * Generate dedicated thermal label HTML document
 * Exactly 50.8 x 25.4 mm (2 x 1 inch) per label page
 */
function generateThermalLabelsHtml(items, options = {}) {
  const storeName = (options.storeName || 'MAULANA SHOES').toUpperCase();
  const labelList = Array.isArray(items) ? items : [];

  const pagesHtml = labelList.map((item, index) => {
    const pName = item.productName || item.name || 'Footwear';
    const size = item.size ? `Size: ${item.size}` : 'Free Size';
    const price = item.priceFormatted || (typeof item.price !== 'undefined' ? `₹${Number(item.price).toLocaleString('en-IN')}` : '');
    const barcodeVal = item.barcode || item.pieceCode || '000000';
    // Display ONLY ONE existing unique identifier for the variant/piece
    const uniqueIdentifier = item.pieceCode || item.barcode || item.sku || '000000';

    let barcodeContent = '';
    if (item.barcodeDataUrl) {
      barcodeContent = `<img class="barcode-graphic" src="${item.barcodeDataUrl}" alt="barcode" />`;
    } else {
      const svg = generateBarcodeSvg(barcodeVal);
      barcodeContent = `<div class="barcode-svg-container">${svg}</div>`;
    }

    return `
      <div class="thermal-label-page" data-page-index="${index + 1}">
        <div class="label-header">
          <div class="store-name">${storeName}</div>
          <div class="product-title">${pName}</div>
          <div class="size-price-line">
            <span class="size-text">${size}</span>
            <span class="sep">•</span>
            <span class="price-text">${price}</span>
          </div>
        </div>
        <div class="barcode-area">
          ${barcodeContent}
        </div>
        <div class="label-footer">
          <div class="barcode-number">${uniqueIdentifier}</div>
        </div>
      </div>
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Thermal Barcode Labels</title>
  <style>
    @page {
      size: 50.8mm 25.4mm;
      margin: 0mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .thermal-label-page {
      width: 50.8mm;
      height: 25.4mm;
      max-width: 50.8mm;
      max-height: 25.4mm;
      padding: 1.0mm 1.5mm 0.8mm 1.5mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      background: #ffffff;
      color: #000000;
      overflow: hidden;
      page-break-after: always;
      break-after: page;
    }
    .thermal-label-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .label-header {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.15;
    }
    .store-name {
      font-size: 7.2pt;
      font-weight: 900;
      color: #000000;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
    }
    .product-title {
      font-size: 6.6pt;
      font-weight: 800;
      color: #000000;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      margin-top: 0.2mm;
    }
    .size-price-line {
      font-size: 7.6pt;
      font-weight: 900;
      color: #000000;
      margin-top: 0.3mm;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
      white-space: nowrap;
    }
    .size-text {
      font-weight: 900;
      color: #000000;
    }
    .sep {
      color: #000000;
      font-size: 6.5pt;
      font-weight: 900;
    }
    .price-text {
      font-weight: 900;
      color: #000000;
    }
    .barcode-area {
      width: 100%;
      height: 9.8mm;
      max-height: 9.8mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin: 0.2mm 0;
    }
    .barcode-graphic {
      height: 9.5mm;
      max-width: 44mm;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .barcode-svg-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .barcode-svg-container svg {
      height: 9.5mm;
      max-width: 44mm;
      width: auto;
    }
    .label-footer {
      width: 100%;
      line-height: 1;
    }
    .barcode-number {
      font-family: "Courier New", Courier, monospace;
      font-size: 7.2pt;
      font-weight: 900;
      color: #000000;
      letter-spacing: 0.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

/**
 * Validate that the configured printer exists in the installed printer list.
 * Prevents silent fallback to default printer.
 */
function validatePrinterSelection(printerName, installedPrinters) {
  if (!printerName || typeof printerName !== 'string' || !printerName.trim()) {
    return {
      valid: false,
      error: 'Thermal printer name is not configured. Please set the printer name in Store Settings.'
    };
  }

  const target = printerName.trim();
  if (!Array.isArray(installedPrinters) || installedPrinters.length === 0) {
    return {
      valid: false,
      error: `Configured thermal printer "${target}" is not installed or detected on this system (no printers detected). Printing was aborted to prevent fallback.`
    };
  }

  const matched = installedPrinters.find(p => {
    const name = (p.name || p.displayName || '').trim();
    return name.toLowerCase() === target.toLowerCase();
  });

  if (!matched) {
    const listStr = installedPrinters.map(p => `"${p.name || p.displayName}"`).join(', ');
    return {
      valid: false,
      error: `Configured thermal printer "${target}" is not installed or detected on this system. Available printers: [${listStr}]. Direct printing was aborted to prevent silent fallback to another device.`
    };
  }

  return {
    valid: true,
    matchedPrinter: matched
  };
}

/**
 * Generate Electron webContents.print options for silent 2x1 inch printing
 */
function getThermalPrintOptions(printerDeviceName) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerDeviceName,
    margins: { marginType: 'none' },
    pageSize: {
      width: THERMAL_WIDTH_MICRONS,
      height: THERMAL_HEIGHT_MICRONS
    },
    landscape: false,
    color: false
  };
}

module.exports = {
  THERMAL_WIDTH_MM,
  THERMAL_HEIGHT_MM,
  THERMAL_WIDTH_MICRONS,
  THERMAL_HEIGHT_MICRONS,
  THERMAL_WIDTH_PT,
  THERMAL_HEIGHT_PT,
  DEFAULT_PRINTER_NAME,
  generateBarcodeSvg,
  generateThermalLabelsHtml,
  validatePrinterSelection,
  getThermalPrintOptions
};
