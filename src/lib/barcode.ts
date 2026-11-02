// Bundled JsBarcode for the inline POS script in index.html (barcode labels, box tags, previews).
// Vite packs it into dist/assets, so barcodes render without an internet connection.
import JsBarcode from 'jsbarcode';

(window as any).JsBarcode = JsBarcode;
