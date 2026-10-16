const JsBarcode = require('jsbarcode');

// Physical specifications for 2 x 1 inch thermal label (TSC TL240)
const THERMAL_WIDTH_MM = 50.8;
const THERMAL_HEIGHT_MM = 25.4;
const THERMAL_WIDTH_MICRONS = 50800; // 50.8mm * 1000
const THERMAL_HEIGHT_MICRONS = 25400; // 25.4mm * 1000
const THERMAL_WIDTH_PT = 144.0; // 72 DPI * 2.0 inches
const THERMAL_HEIGHT_PT = 72.0; // 72 DPI * 1.0 inch
const DEFAULT_PRINTER_NAME = 'TSC TL240';

// Physical specifications for thermal receipt paper roll (RETSOL RTP82)
const RECEIPT_80MM_WIDTH_MM = 80;
const RECEIPT_58MM_WIDTH_MM = 58;
const RECEIPT_ROLL_HEIGHT_MM = 297;
const RECEIPT_80MM_WIDTH_MICRONS = 80000; // 80mm * 1000
const RECEIPT_58MM_WIDTH_MICRONS = 58000; // 58mm * 1000
const RECEIPT_ROLL_HEIGHT_MICRONS = 297000; // 297mm * 1000
const DEFAULT_RECEIPT_PRINTER_NAME = 'RETSOL RTP82';

// Barcode dot grid for the thermal label printer. Every CODE128 module is drawn as a whole number
// of printer dots so bar/space proportions survive rasterisation (a fractional module, e.g.
// 0.18mm = 1.44 dots, rounds to uneven 1- and 2-dot bars). Keep in sync with index.html.
const THERMAL_PRINTER_DPI = 203; // TSC TL240 native resolution (8 dots/mm). Set to 300 for a 300 DPI model.
const BARCODE_QUIET_ZONE_MODULES = 10; // CODE128 minimum quiet zone (10X) on each side
const BARCODE_MAX_DOTS_PER_MODULE = 2;

/**
 * Generate inline SVG barcode string using JsBarcode object encoder (zero DOM dependencies).
 * The SVG spans the full label width and is pinned to the label's left edge (x = 0, a printer
 * dot boundary), so every bar edge lands on a dot boundary. Requires .thermal-label-page to be
 * position:relative.
 */
function generateBarcodeSvg(barcodeText) {
  const labelDots = Math.round(THERMAL_WIDTH_MM / 25.4 * THERMAL_PRINTER_DPI);
  const heightDots = Math.round(6.5 / 25.4 * THERMAL_PRINTER_DPI);
  const widthIn = labelDots / THERMAL_PRINTER_DPI;
  const heightIn = heightDots / THERMAL_PRINTER_DPI;
  const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthIn}in" height="${heightIn}in" viewBox="0 0 ${labelDots} ${heightDots}" preserveAspectRatio="none" shape-rendering="crispEdges"`;
  const svgStyle = `position:absolute; left:0; display:block; margin:0; width:${widthIn}in; height:${heightIn}in; max-width:none;`;
  try {
    const text = String(barcodeText || '').trim() || '000000';
    const obj = {};
    JsBarcode(obj, text, {
      format: 'CODE128',
      displayValue: false
    });
    const binary = obj.encodings && obj.encodings[0] ? obj.encodings[0].data : '';
    if (!binary) throw new Error('No barcode binary generated');

    // Largest whole-dot module width that fits the symbol plus both quiet zones,
    // keeping 0.5mm clear of the die-cut edges
    const edgeDots = Math.ceil(0.5 / 25.4 * THERMAL_PRINTER_DPI);
    const neededModules = binary.length + (BARCODE_QUIET_ZONE_MODULES * 2);
    let dotsPerModule = Math.min(BARCODE_MAX_DOTS_PER_MODULE, Math.floor((labelDots - edgeDots * 2) / neededModules));
    if (dotsPerModule < 1) dotsPerModule = 1;

    const startDot = Math.floor((labelDots - (binary.length * dotsPerModule)) / 2);

    let rects = '';
    let i = 0;
    while (i < binary.length) {
      let j = i;
      while (j < binary.length && binary[j] === binary[i]) j++;
      if (binary[i] === '1') {
        rects += `<rect x="${startDot + i * dotsPerModule}" y="0" width="${(j - i) * dotsPerModule}" height="${heightDots}" fill="#000000"/>`;
      }
      i = j;
    }

    return `${svgOpen} data-dots-per-module="${dotsPerModule}" style="${svgStyle}"><rect width="${labelDots}" height="${heightDots}" fill="#ffffff"/>${rects}</svg>`;
  } catch (err) {
    return `${svgOpen} style="${svgStyle}"><rect width="${labelDots}" height="${heightDots}" fill="#ffffff"/></svg>`;
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
    // Display ONLY ONE unique identifier: the exact value encoded in the barcode
    const uniqueIdentifier = barcodeVal;

    let barcodeContent = '';
    if (item.barcodeDataUrl) {
      barcodeContent = `<img class="barcode-graphic" src="${item.barcodeDataUrl}" alt="" />`;
    } else {
      const svg = generateBarcodeSvg(barcodeVal);
      barcodeContent = `<div class="barcode-svg-container">${svg}</div>`;
    }

    return `
      <div class="thermal-label-page" data-page-index="${index + 1}">
        <div class="label-header">
          <div class="store-name">${storeName}</div>
          <div class="product-title">${pName}</div>
        </div>
        <div class="barcode-area">
          ${barcodeContent}
        </div>
        <div class="label-footer">
          <div class="size-price-line">
            <span class="size-text">${size}</span>
            <span class="sep">•</span>
            <span class="price-text">${price}</span>
          </div>
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
      width: 50.8mm;
      background: #ffffff;
      color: #000000;
      font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .thermal-label-page {
      position: relative;
      width: 50.8mm;
      height: 25.4mm;
      max-width: 50.8mm;
      max-height: 25.4mm;
      padding: 1.8mm 1.5mm 1.8mm 1.5mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
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
      justify-content: center;
      text-align: center;
      line-height: 1.15;
    }
    .store-name {
      font-size: 6.5pt;
      font-weight: 900;
      color: #000000;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      text-align: center;
    }
    .product-title {
      font-size: 5.8pt;
      font-weight: 800;
      color: #000000;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      text-align: center;
      margin-top: 0.15mm;
    }
    .barcode-area {
      width: 100%;
      height: 6.8mm;
      max-height: 6.8mm;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin: 0.25mm 0;
    }
    .barcode-graphic {
      height: 6.5mm;
      max-width: 42mm;
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
    .label-footer {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      line-height: 1.15;
    }
    .size-price-line {
      font-size: 6.8pt;
      font-weight: 900;
      color: #000000;
      line-height: 1.15;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      width: 100%;
      white-space: nowrap;
      text-align: center;
    }
    .size-text {
      font-size: 7.7pt;
      font-weight: 900;
      color: #000000;
    }
    .sep {
      color: #000000;
      font-size: 5.5pt;
      font-weight: 900;
    }
    .price-text {
      font-weight: 900;
      color: #000000;
    }
    .barcode-number {
      font-family: "Courier New", Courier, monospace;
      font-size: 6.5pt;
      font-weight: 900;
      color: #000000;
      letter-spacing: 0.5px;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.15mm;
      text-align: center;
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
function validatePrinterSelection(printerName, installedPrinters, printerRole) {
  const role = printerRole || (printerName && /retsol|rtp/i.test(printerName) ? 'receipt printer' : 'thermal barcode printer');
  if (!printerName || typeof printerName !== 'string' || !printerName.trim()) {
    return {
      valid: false,
      error: `${role.charAt(0).toUpperCase() + role.slice(1)} name is not configured. Please set the printer name in Store Settings.`
    };
  }

  const target = printerName.trim();
  if (!Array.isArray(installedPrinters) || installedPrinters.length === 0) {
    return {
      valid: false,
      error: `Configured ${role} "${target}" is not installed or detected on this system (no printers detected). Printing was aborted to prevent fallback.`
    };
  }

  // 1. Exact case-insensitive match
  let matched = installedPrinters.find(p => {
    const name = (p.name || p.displayName || '').trim();
    return name.toLowerCase() === target.toLowerCase();
  });

  // 2. Intelligent normalized match (e.g. "RETSOL RTP-82UE" vs "RETSOL RTP82")
  if (!matched) {
    const norm = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetNorm = norm(target);

    matched = installedPrinters.find(p => {
      const name = p.name || p.displayName || '';
      const nameNorm = norm(name);
      if (nameNorm && nameNorm === targetNorm) return true;

      // Handle RETSOL 82 models safely (e.g., RETSOL RTP-82UE configured, installed as RETSOL RTP82)
      const isTargetRetsol82 = targetNorm.includes('retsol') && (targetNorm.includes('rtp82') || targetNorm.includes('82'));
      const isInstalledRetsol82 = nameNorm.includes('retsol') && (nameNorm.includes('rtp82') || nameNorm.includes('82'));
      if (isTargetRetsol82 && isInstalledRetsol82) {
        return true;
      }
      return false;
    });
  }

  if (!matched) {
    const listStr = installedPrinters.map(p => `"${p.name || p.displayName}"`).join(', ');
    return {
      valid: false,
      error: `Configured ${role} "${target}" is not installed or detected on this system. Available printers: [${listStr}]. Direct printing was aborted to prevent silent fallback to another device.`
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

/**
 * Generate Electron webContents.print options for silent receipt printing
 * Matches actual configured paper width (80mm standard or 58mm compact)
 */
function getReceiptPrintOptions(printerDeviceName, paperWidth = '80mm') {
  const is58 = String(paperWidth).trim().toLowerCase() === '58mm';
  return {
    silent: true,
    printBackground: true,
    deviceName: printerDeviceName,
    margins: { marginType: 'none' },
    pageSize: {
      width: is58 ? RECEIPT_58MM_WIDTH_MICRONS : RECEIPT_80MM_WIDTH_MICRONS,
      height: RECEIPT_ROLL_HEIGHT_MICRONS
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
  RECEIPT_80MM_WIDTH_MM,
  RECEIPT_58MM_WIDTH_MM,
  RECEIPT_ROLL_HEIGHT_MM,
  RECEIPT_80MM_WIDTH_MICRONS,
  RECEIPT_58MM_WIDTH_MICRONS,
  RECEIPT_ROLL_HEIGHT_MICRONS,
  DEFAULT_RECEIPT_PRINTER_NAME,
  generateBarcodeSvg,
  generateThermalLabelsHtml,
  validatePrinterSelection,
  getThermalPrintOptions,
  getReceiptPrintOptions
};
