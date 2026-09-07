const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findRcedit() {
  const defaultPath = path.resolve(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', '137446567', 'rcedit-x64.exe');
  if (fs.existsSync(defaultPath)) return defaultPath;

  const baseCache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
  if (fs.existsSync(baseCache)) {
    function search(dir, depth = 0) {
      if (depth > 5) return null;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            const res = search(full, depth + 1);
            if (res) return res;
          } else if (e.name === 'rcedit-x64.exe' || e.name === 'rcedit.exe') {
            return full;
          }
        }
      } catch (err) {}
      return null;
    }
    return search(baseCache);
  }
  return null;
}

const rceditExe = findRcedit();
const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Maulana Shoes POS.exe');
const icoPath = path.resolve(__dirname, '..', 'build', 'icon.ico');

if (!fs.existsSync(exePath)) {
  console.warn('Target executable not found at:', exePath);
  process.exit(0);
}
if (!fs.existsSync(icoPath)) {
  console.warn('Icon not found at:', icoPath);
  process.exit(0);
}

if (rceditExe && fs.existsSync(rceditExe)) {
  try {
    execFileSync(rceditExe, [exePath, '--set-icon', icoPath], { stdio: 'inherit' });
    console.log('Icon successfully embedded into Maulana Shoes POS.exe');
  } catch (err) {
    console.warn('Could not embed icon using rcedit:', err.message);
  }
} else {
  console.log('rcedit not present in cache yet, electron-builder will apply icon automatically.');
}
