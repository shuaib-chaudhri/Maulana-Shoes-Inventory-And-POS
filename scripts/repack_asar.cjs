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

// Collect ALL production dependencies dynamically + comprehensive safety list
function getProductionDependencies() {
  const deps = new Set([
    'electron-updater',
    'builder-util-runtime',
    'fs-extra',
    'graceful-fs',
    'jsonfile',
    'universalify',
    'semver',
    'js-yaml',
    'argparse',
    'lazy-val',
    'lodash.escaperegexp',
    'lodash.isequal',
    'tiny-typed-emitter',
    'debug',
    'ms',
    'sax'
  ]);

  try {
    const raw = cp.execSync('npm ls --omit=dev --all --json', { cwd: rootDir, encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    function collect(node) {
      if (node && node.dependencies) {
        for (const [name, info] of Object.entries(node.dependencies)) {
          deps.add(name);
          collect(info);
        }
      }
    }
    collect(parsed);
  } catch (err) {
    console.warn('Could not read npm ls output, using comprehensive fallback list:', err.message);
  }

  return Array.from(deps);
}

console.log('Copying production dependencies into staging...');
const allDeps = getProductionDependencies();
const destModulesDir = path.join(stagingDir, 'node_modules');
if (!fs.existsSync(destModulesDir)) fs.mkdirSync(destModulesDir, { recursive: true });

for (const dep of allDeps) {
  if (dep === 'better-sqlite3') continue; // Preserve existing native addon from extracted ASAR
  const src = path.join(rootDir, 'node_modules', dep);
  const dest = path.join(destModulesDir, dep);
  if (fs.existsSync(src)) {
    if (dep.includes('/')) {
      const parentDir = path.dirname(dest);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    }
    copyDirSync(src, dest);
  }
}

console.log('Verifying staging dependencies before repacking...');
const verifyCmd = 'node -e "require(\'./node_modules/electron-updater\'); require(\'./node_modules/fs-extra\'); require(\'./node_modules/graceful-fs\'); console.log(\'DEPENDENCY_CHECK_PASSED\');"';
const verifyRes = cp.execSync(verifyCmd, { cwd: stagingDir, encoding: 'utf8' });
console.log('Staging verification result:', verifyRes.trim());

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
