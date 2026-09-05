const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const appDataDir = process.env.APPDATA || (process.env.USERPROFILE + '\\AppData\\Roaming');
const userDataFile = path.join(appDataDir, 'maulana-shoes-inventory-pos', 'maulana_pos_data.json');
const desktopLnk = 'C:\\Users\\Public\\Desktop\\Maulana Shoes POS.lnk';
const userDesktopLnk = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop', 'Maulana Shoes POS.lnk');
const setupExe = path.resolve(__dirname, 'dist-electron', 'Maulana Shoes POS Setup 1.0.0.exe');

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function killApp() {
  try {
    cp.execSync('powershell -Command "Get-Process -Name \'*Maulana*\', \'*electron*\' -ErrorAction SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
  } catch (e) {}
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const data = await httpGet('http://127.0.0.1:3000/api/pos/bootstrap');
      if (data && data.success) return data;
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error('Server at http://127.0.0.1:3000 did not become ready in time');
}

async function run() {
  console.log('====================================================');
  console.log('  STARTING INSTALLED APP SETTINGS PERSISTENCE TEST');
  console.log('====================================================');

  console.log('\n[1/6] Stopping any running POS instances...');
  killApp();
  await sleep(1500);

  console.log('\n[2/6] Running Silent Installation of Setup.exe...');
  if (!fs.existsSync(setupExe)) {
    throw new Error(`Setup file not found: ${setupExe}`);
  }
  console.log(`Executing: "${setupExe}" /S`);
  cp.execSync(`"${setupExe}" /S`, { stdio: 'inherit' });
  await sleep(4000);

  // Ensure shortcut exists on User desktop too
  if (fs.existsSync(desktopLnk) && fs.existsSync(path.dirname(userDesktopLnk))) {
    try {
      fs.copyFileSync(desktopLnk, userDesktopLnk);
      console.log('Desktop shortcut copied to user desktop:', userDesktopLnk);
    } catch (e) {}
  }

  console.log('\n[3/6] Launching installed app from Desktop shortcut...');
  cp.exec(`powershell -Command "Start-Process '${desktopLnk}'"`);
  console.log('Waiting for app server at http://127.0.0.1:3000...');
  const bootData1 = await waitForServer(40);
  console.log('App successfully booted! Initial settings:', bootData1.data.settings);

  console.log('\n[4/6] Changing settings: Store Name, Phone, and Custom GSTIN...');
  const testSettings1 = {
    storeName: 'Maulana Footwear Flagship Solapur',
    storeAddress: '123 Begumpeth, Solapur, Maharashtra 413002',
    phone: '+91 98903 24362',
    whatsapp: '+91 7588888578',
    gstNumber: '27AABCM8888Z1Z5'
  };

  const saveRes1 = await httpPost('http://127.0.0.1:3000/api/pos/settings', testSettings1);
  console.log('Settings save response:', saveRes1.success ? 'SUCCESS' : 'FAILED');

  // Verify disk file
  if (fs.existsSync(userDataFile)) {
    const diskContent = JSON.parse(fs.readFileSync(userDataFile, 'utf8'));
    console.log('Disk file settings immediately after save:');
    console.log('  storeName:', diskContent.settings.storeName);
    console.log('  phone:    ', diskContent.settings.phone);
    console.log('  gstNumber:', diskContent.settings.gstNumber);
  }

  console.log('\n[5/6] COMPLETELY CLOSING APP (Simulating user closing the app)...');
  killApp();
  await sleep(2500);

  // Verify server is actually dead
  let isDead = false;
  try {
    await httpGet('http://127.0.0.1:3000/api/pos/bootstrap');
  } catch (e) {
    isDead = true;
  }
  console.log('App process completely terminated:', isDead ? 'YES' : 'STILL RUNNING?');

  console.log('\n[6/6] REOPENING APP FROM DESKTOP SHORTCUT...');
  cp.exec(`powershell -Command "Start-Process '${desktopLnk}'"`);
  console.log('Waiting for app server after restart...');
  const bootData2 = await waitForServer(40);
  const loadedSettings2 = bootData2.data.settings;

  console.log('\n====================================================');
  console.log('  VERIFYING SETTINGS AFTER RESTART');
  console.log('====================================================');
  console.log('  storeName:', loadedSettings2.storeName);
  console.log('  phone:    ', loadedSettings2.phone);
  console.log('  whatsapp: ', loadedSettings2.whatsapp);
  console.log('  gstNumber:', loadedSettings2.gstNumber);

  let pass = true;
  if (loadedSettings2.storeName !== testSettings1.storeName) {
    console.error(`FAIL: storeName mismatch! Expected "${testSettings1.storeName}", got "${loadedSettings2.storeName}"`);
    pass = false;
  }
  if (loadedSettings2.phone !== testSettings1.phone) {
    console.error(`FAIL: phone mismatch! Expected "${testSettings1.phone}", got "${loadedSettings2.phone}"`);
    pass = false;
  }
  if (loadedSettings2.whatsapp !== testSettings1.whatsapp) {
    console.error(`FAIL: whatsapp mismatch! Expected "${testSettings1.whatsapp}", got "${loadedSettings2.whatsapp}"`);
    pass = false;
  }
  if (loadedSettings2.gstNumber !== testSettings1.gstNumber) {
    console.error(`FAIL: gstNumber mismatch! Expected "${testSettings1.gstNumber}", got "${loadedSettings2.gstNumber}"`);
    pass = false;
  }

  // Now Test Case B: User removes GSTIN (empty GSTIN should persist and NEVER revert to hardcoded default!)
  console.log('\n====================================================');
  console.log('  TEST CASE B: EMPTY GSTIN PERSISTENCE (NO FALLBACK)');
  console.log('====================================================');
  await httpPost('http://127.0.0.1:3000/api/pos/settings', { gstNumber: '' });
  console.log('Saved empty gstNumber. Closing app again...');
  killApp();
  await sleep(2500);

  console.log('Reopening app again from Desktop shortcut...');
  cp.exec(`powershell -Command "Start-Process '${desktopLnk}'"`);
  const bootData3 = await waitForServer(40);
  const loadedSettings3 = bootData3.data.settings;

  console.log('  storeName after restart 2:', loadedSettings3.storeName);
  console.log('  phone after restart 2:    ', loadedSettings3.phone);
  console.log('  gstNumber after restart 2:', JSON.stringify(loadedSettings3.gstNumber));

  if (loadedSettings3.gstNumber !== '') {
    console.error(`FAIL: Empty gstNumber reverted to: "${loadedSettings3.gstNumber}"!`);
    pass = false;
  }
  if (loadedSettings3.storeName !== testSettings1.storeName) {
    console.error(`FAIL: storeName lost when saving single setting!`);
    pass = false;
  }

  // Cleanup
  killApp();

  if (pass) {
    console.log('\n====================================================');
    console.log('  ALL PERSISTENCE CHECKS PASSED ON INSTALLED APP!   ');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error('\nONE OR MORE CHECKS FAILED!');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  killApp();
  process.exit(1);
});
