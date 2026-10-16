const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const srcImagePath = 'C:/Users/shuai/.gemini/antigravity-ide/brain/3c166df8-4c96-4d4b-91b8-7bef923cb414/.user_uploaded/media_1792066103706.jpg';

app.whenReady().then(async () => {
  try {
    console.log('Loading source image from:', srcImagePath);
    if (!fs.existsSync(srcImagePath)) {
      throw new Error('Source image not found at ' + srcImagePath);
    }

    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1000,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const fileData = fs.readFileSync(srcImagePath);
    const base64Data = fileData.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;

    const html = `<!DOCTYPE html>
<html>
<body>
<img id="srcImg" src="${dataUrl}">
<canvas id="c"></canvas>
</body>
</html>`;

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const result = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = document.getElementById('srcImg');
        const process = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const canvas = document.getElementById('c');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // Find exact bounding box of dark artwork pixels
          let minX = w, minY = h, maxX = 0, maxY = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
              if (brightness < 230) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          const artW = maxX - minX + 1;
          const artH = maxY - minY + 1;

          // Symmetrical 10px padding for clean borders
          const padX = 10;
          const padY = 8;
          const targetW = artW + padX * 2;
          const targetH = artH + padY * 2;

          const outCanvas = document.createElement('canvas');
          outCanvas.width = targetW;
          outCanvas.height = targetH;
          const outCtx = outCanvas.getContext('2d');

          // Pure crisp white background
          outCtx.fillStyle = '#FFFFFF';
          outCtx.fillRect(0, 0, targetW, targetH);

          // Draw exactly centered artwork
          outCtx.drawImage(canvas, minX, minY, artW, artH, padX, padY, artW, artH);

          // Apply contrast optimization for thermal printing
          const outData = outCtx.getImageData(0, 0, targetW, targetH);
          const px = outData.data;

          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

            if (brightness > 215) {
              // Pure white
              px[i] = 255;
              px[i + 1] = 255;
              px[i + 2] = 255;
              px[i + 3] = 255;
            } else if (brightness < 80) {
              // Deep solid black
              px[i] = 0;
              px[i + 1] = 0;
              px[i + 2] = 0;
              px[i + 3] = 255;
            } else {
              // High-contrast smooth antialiased edge
              const normalized = (brightness - 80) / (215 - 80);
              const val = Math.round(normalized * 255);
              px[i] = val;
              px[i + 1] = val;
              px[i + 2] = val;
              px[i + 3] = 255;
            }
          }

          outCtx.putImageData(outData, 0, 0);

          resolve({
            artW,
            artH,
            targetW,
            targetH,
            padX,
            padY,
            aspectRatio: targetW / targetH,
            dataUrl: outCanvas.toDataURL('image/png')
          });
        };

        if (img.complete) process();
        else img.onload = process;
      });
    `);

    console.log('Processed logo successfully:');
    console.log('Artwork:', result.artW, 'x', result.artH);
    console.log('Final dimensions:', result.targetW, 'x', result.targetH);
    console.log('Aspect ratio (W/H):', result.aspectRatio);

    const base64Png = result.dataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBuffer = Buffer.from(base64Png, 'base64');

    const destPaths = [
      path.join(__dirname, '..', 'receipt_logo_thermal.png'),
      path.join(__dirname, '..', 'public', 'receipt_logo_thermal.png'),
      path.join(__dirname, '..', 'dist', 'receipt_logo_thermal.png')
    ];

    for (const p of destPaths) {
      fs.writeFileSync(p, pngBuffer);
      console.log('Saved PNG to:', p, `(${pngBuffer.length} bytes)`);
    }

    const snippetPath = path.join(__dirname, '..', 'test', 'receipt_logo_data_url.txt');
    fs.writeFileSync(snippetPath, result.dataUrl);
    console.log('Saved Data URL snippet to:', snippetPath);

    win.close();
    app.quit();
  } catch (err) {
    console.error('Error processing logo:', err);
    process.exit(1);
  }
});
