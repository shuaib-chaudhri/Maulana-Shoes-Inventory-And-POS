const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const asarFile = path.join(rootDir, 'release', 'win-unpacked', 'resources', 'app.asar');
const stagingDir = path.join(rootDir, 'release', 'app_staging');

console.log('Extracting asar from:', asarFile);
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}

cp.execSync(`npx asar extract "${asarFile}" "${stagingDir}"`, { stdio: 'inherit' });

console.log('Copying updated project files into staging...');
const filesToCopy = [
  'main.cjs',
  'preload.cjs',
  'server.cjs',
  'maulana_pos_data.json',
  'logo.png',
  'package.json'
];

for (const f of filesToCopy) {
  const src = path.join(rootDir, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stagingDir, f));
  }
}

// Copy directories: dist, server, build
function copyDirSync(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirSync(path.join(rootDir, 'dist'), path.join(stagingDir, 'dist'));
copyDirSync(path.join(rootDir, 'server'), path.join(stagingDir, 'server'));
if (fs.existsSync(path.join(rootDir, 'build'))) {
  copyDirSync(path.join(rootDir, 'build'), path.join(stagingDir, 'build'));
}

// Copy updater runtime dependencies into staging node_modules
const updaterModules = [
  'electron-updater',
  'builder-util-runtime',
  'fs-extra',
  'jsonfile',
  'semver',
  'universalify',
  'lodash.escaperegexp',
  'lodash.isequal',
  'tiny-typed-emitter',
  'js-yaml',
  'lazy-val'
];

for (const mod of updaterModules) {
  const src = path.join(rootDir, 'node_modules', mod);
  const dest = path.join(stagingDir, 'node_modules', mod);
  if (fs.existsSync(src)) {
    copyDirSync(src, dest);
  }
}

// Write app-update.yml config
const appUpdateYaml = `owner: shuaib-chaudhri
repo: Maulana-Shoes-Inventory-And-POS
provider: github
updaterCacheDirName: maulana-shoes-inventory-pos-updater
`;

fs.writeFileSync(path.join(stagingDir, 'app-update.yml'), appUpdateYaml, 'utf8');

// Copy directly to resources as unbundled backup
const resDir = path.join(rootDir, 'release', 'win-unpacked', 'resources');
fs.writeFileSync(path.join(resDir, 'app-update.yml'), appUpdateYaml, 'utf8');
fs.copyFileSync(path.join(rootDir, 'maulana_pos_data.json'), path.join(resDir, 'maulana_pos_data.json'));
fs.copyFileSync(path.join(rootDir, 'logo.png'), path.join(resDir, 'logo.png'));

console.log('Repacking asar to:', asarFile);
cp.execSync(`npx asar pack "${stagingDir}" "${asarFile}" --unpack "**/*.node"`, { stdio: 'inherit' });

console.log('Cleaning up staging directory...');
fs.rmSync(stagingDir, { recursive: true, force: true });
console.log('Repack completed successfully!');
