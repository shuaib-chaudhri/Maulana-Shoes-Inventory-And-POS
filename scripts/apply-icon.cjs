const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rceditExe = path.resolve(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign', '137446567', 'rcedit-x64.exe');
const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Maulana Shoes POS.exe');
const icoPath = path.resolve(__dirname, '..', 'build', 'icon.ico');

if (!fs.existsSync(rceditExe)) {
  console.error('rcedit not found at:', rceditExe);
  process.exit(1);
}
if (!fs.existsSync(exePath)) {
  console.error('Target executable not found at:', exePath);
  process.exit(1);
}
if (!fs.existsSync(icoPath)) {
  console.error('Icon not found at:', icoPath);
  process.exit(1);
}

execFileSync(rceditExe, [exePath, '--set-icon', icoPath], { stdio: 'inherit' });
console.log('Icon successfully embedded into Maulana Shoes POS.exe');
