const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const asarFile = path.join(unpackedDir, 'resources', 'app.asar');
const resDir = path.join(unpackedDir, 'resources');
const stagingDir = path.join(releaseDir, 'app_staging');

// Helper to recursively copy directories
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

// 1. If unpacked release does not exist (e.g. fresh clone or CI runner), bootstrap it via electron-builder
if (!fs.existsSync(asarFile)) {
  console.log('Unpacked base not found at:', asarFile);
  console.log('Generating win-unpacked directory using electron-builder...');
  cp.execSync('npx electron-builder --win --dir --config.directories.output=release', { cwd: rootDir, stdio: 'inherit' });
}

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

// Copy build output directories: dist, server, build
copyDirSync(path.join(rootDir, 'dist'), path.join(stagingDir, 'dist'));
copyDirSync(path.join(rootDir, 'server'), path.join(stagingDir, 'server'));
if (fs.existsSync(path.join(rootDir, 'build'))) {
  copyDirSync(path.join(rootDir, 'build'), path.join(stagingDir, 'build'));
}

// 2. Collect ALL production & transitive dependencies dynamically
function collectProductionDependencies() {
  const relativePaths = new Set();

  // Tier A: Query npm for all production package paths
  try {
    const raw = cp.execSync('npm ls --omit=dev --parseable --all', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const rootNodeModules = path.join(rootDir, 'node_modules');
    for (const line of lines) {
      if (line === rootDir) continue;
      const rel = path.relative(rootNodeModules, line);
      if (rel && !rel.startsWith('..')) {
        relativePaths.add(rel.replace(/\\/g, '/'));
      }
    }
  } catch (err) {
    console.warn('npm ls parseable notice:', err.message);
  }

  // Tier B: Recursive dependency crawler for all packages in package.json
  function crawlDeps(pkgDir, currentRel) {
    const pJson = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pJson)) return;
    try {
      const data = JSON.parse(fs.readFileSync(pJson, 'utf8'));
      const deps = Object.keys(data.dependencies || {});
      for (const dep of deps) {
        if (dep === 'better-sqlite3') continue;
        // Check nested node_modules first, then root
        const nestedDir = path.join(pkgDir, 'node_modules', dep);
        const rootDepDir = path.join(rootDir, 'node_modules', dep);
        if (fs.existsSync(nestedDir)) {
          const nestedRel = `${currentRel}/node_modules/${dep}`;
          if (!relativePaths.has(nestedRel)) {
            relativePaths.add(nestedRel);
            crawlDeps(nestedDir, nestedRel);
          }
        } else if (fs.existsSync(rootDepDir)) {
          if (!relativePaths.has(dep)) {
            relativePaths.add(dep);
            crawlDeps(rootDepDir, dep);
          }
        }
      }
    } catch (e) {}
  }

  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(rootPkg.dependencies || {})) {
    if (dep === 'better-sqlite3') continue;
    relativePaths.add(dep);
    crawlDeps(path.join(rootDir, 'node_modules', dep), dep);
  }

  // Tier C: Comprehensive safety list of electron-updater transitive dependencies
  const safetyList = [
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
    'sax',
    'debug',
    'ms'
  ];
  for (const s of safetyList) {
    if (fs.existsSync(path.join(rootDir, 'node_modules', s))) {
      relativePaths.add(s);
    }
  }

  return Array.from(relativePaths);
}

console.log('Copying production dependencies into staging...');
const allDeps = collectProductionDependencies();
const stagingNodeModules = path.join(stagingDir, 'node_modules');
if (!fs.existsSync(stagingNodeModules)) fs.mkdirSync(stagingNodeModules, { recursive: true });

for (const depRel of allDeps) {
  if (depRel === 'better-sqlite3') continue; // Native addon already preserved from extracted ASAR
  const src = path.join(rootDir, 'node_modules', depRel);
  const dest = path.join(stagingNodeModules, depRel);
  if (fs.existsSync(src)) {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    copyDirSync(src, dest);
  }
}

// Extra redundancy: ensure graceful-fs and fs-extra are present both at root staging and nested under electron-updater
const rootGracefulFs = path.join(rootDir, 'node_modules', 'graceful-fs');
const nestedEuModules = path.join(stagingNodeModules, 'electron-updater', 'node_modules');
if (fs.existsSync(rootGracefulFs) && fs.existsSync(nestedEuModules)) {
  copyDirSync(rootGracefulFs, path.join(nestedEuModules, 'graceful-fs'));
}

// Write app-update.yml configuration
const appUpdateYaml = `owner: shuaib-chaudhri
repo: Maulana-Shoes-Inventory-And-POS
provider: github
updaterCacheDirName: maulana-shoes-inventory-pos-updater
`;

fs.writeFileSync(path.join(stagingDir, 'app-update.yml'), appUpdateYaml, 'utf8');
fs.writeFileSync(path.join(resDir, 'app-update.yml'), appUpdateYaml, 'utf8');
fs.copyFileSync(path.join(rootDir, 'maulana_pos_data.json'), path.join(resDir, 'maulana_pos_data.json'));
fs.copyFileSync(path.join(rootDir, 'logo.png'), path.join(resDir, 'logo.png'));

// 3. Staging Pre-Pack Verification
console.log('Running pre-pack dependency verification in staging...');
const prePackCheck = `
  const eu = require('./node_modules/electron-updater');
  const fe = require('./node_modules/fs-extra');
  const gfs = require('./node_modules/graceful-fs');
  const bur = require('./node_modules/builder-util-runtime');
  const jy = require('./node_modules/js-yaml');
  console.log('STAGING_CHECK_PASSED: electron-updater v' + (require('./node_modules/electron-updater/package.json').version));
`;

try {
  const checkOut = cp.execSync(`node -e "${prePackCheck.replace(/\r?\n/g, ' ')}"`, {
    cwd: stagingDir,
    encoding: 'utf8'
  });
  console.log(checkOut.trim());
} catch (checkErr) {
  console.error('FATAL: Staging pre-pack dependency verification failed!', checkErr.message);
  process.exit(1);
}

// 4. Repack ASAR
console.log('Repacking asar to:', asarFile);
cp.execSync(`npx asar pack "${stagingDir}" "${asarFile}" --unpack "**/*.node"`, { stdio: 'inherit' });

// 5. Post-Pack ASAR Verification
console.log('Running post-pack ASAR verification...');
const asarList = cp.execSync(`npx asar list "${asarFile}"`, { encoding: 'utf8' });
const requiredEntries = [
  'node_modules/electron-updater',
  'node_modules/graceful-fs',
  'node_modules/builder-util-runtime',
  'node_modules/js-yaml',
  'app-update.yml',
  'main.cjs',
  'preload.cjs',
  'server.cjs'
];

for (const entry of requiredEntries) {
  const normFwd = '/' + entry.replace(/\\/g, '/');
  const normBack = '\\' + entry.replace(/\//g, '\\');
  if (!asarList.includes(normFwd) && !asarList.includes(normBack)) {
    console.error(`FATAL: Required entry "${entry}" missing from repacked ASAR!`);
    process.exit(1);
  }
}
console.log('ASAR_VERIFICATION_PASSED: All required updater modules and metadata verified inside app.asar!');

// 6. Clean up staging directory
console.log('Cleaning up staging directory...');
if (fs.existsSync(stagingDir)) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
console.log('Repack completed successfully with 100% verified updater dependencies!');


