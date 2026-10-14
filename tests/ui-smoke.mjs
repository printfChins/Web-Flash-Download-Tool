/* [V1.2 新增] 瀏覽器操作驗證；GATT / Serial 位於測試硬體邊界。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const path = resolve(root, '.' + name);
    if (!path.startsWith(root + '/')) throw new Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  /* [V1.2 手機修正 修改] 禁止外部校驗 CDN，驗證網站內建套件的真實 MD5 結果。 */
  await page.route('https://cdn.jsdelivr.net/**', route => route.abort());
  await page.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'text/javascript', body:
    'export class Transport {async disconnect(){}};export class ESPLoader {async main(){return "ESP32-C3"} async writeFlash(o){window.testUsbMd5=o.calculateMD5Hash(o.fileArray[0].data);o.reportProgress(0,1,1)} async after(){}};' }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => ({}) } });
    const s = { offset: 0, total: 0, phase: 0, end: 0, abort: 0, hash: null };
    class Char extends EventTarget {
      constructor(kind) { super(); this.kind = kind; }
      async startNotifications() { return this; }
      async stopNotifications() { return this; }
      async readValue() { return this.value; }
      async writeValueWithoutResponse(p) { return this.writeValueWithResponse(p); }
      async writeValueWithResponse(p) {
        const b = new Uint8Array(p); const v = new DataView(b.buffer);
        if (b[0] === 2) s.hash = Array.from(b.subarray(2));
        if (b[0] === 3) { s.total = v.getUint32(2, true); s.offset = 0; s.phase = 1; }
        if (b[0] === 16) s.offset = v.getUint32(2, true) + b.length - 6;
        if (b[0] === 4) { s.phase = 2; s.end++; }
        if (b[0] === 5) { s.phase = 0; s.abort++; }
        const r = new Uint8Array(20); const rv = new DataView(r.buffer);
        r.set([b[0], b[1], 0, s.phase]); rv.setUint32(4, s.offset, true); rv.setUint32(8, s.total, true);
        rv.setUint32(12, 0x140000, true); rv.setUint16(16, 14, true); r[18] = 6; r[19] = 1;
        status.value = rv; status.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }
    const control = new Char('control'), data = new Char('data'), status = new Char('status');
    const device = new EventTarget(); device.name = 'BEYBLADE_TOOL_BRD_12AF';
    const service = { getCharacteristic: async uuid => uuid.startsWith('c7570011') ? control : uuid.startsWith('c7570012') ? data : status };
    device.gatt = { connected: false, connect: async () => { device.gatt.connected = true; return { getPrimaryService: async () => service }; },
      disconnect: () => { device.gatt.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); } };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } });
    window.testOta = s;
  });
  await page.goto('http://127.0.0.1:' + server.address().port + '/');
  await page.getByRole('button', { name: '藍牙 OTA', exact: true }).click({ timeout: 5000 });
  const bytes = Buffer.alloc(160, 0x55); bytes[0] = 0xe9; bytes[12] = 5; bytes[13] = 0;
  bytes.writeUInt32LE(0xabcd5432, 32); bytes.write('BRD_BPX_OTA_IMAGE_V1_C3', 70);
  await page.locator('#firmwareInput').setInputFiles({ name: 'BRD_BPX.ino.bin', mimeType: 'application/octet-stream', buffer: bytes });
  await page.waitForFunction(() => !document.querySelector('#flashButton').disabled);
  await page.locator('#flashButton').click();
  await page.waitForFunction(() => document.querySelector('#statusPill').textContent === '更新完成');
  assert.equal(await page.locator('#progressText').textContent(), '100%');
  assert.equal(await page.evaluate(() => window.testOta.end), 1);
  assert.deepEqual(await page.evaluate(() => window.testOta.hash), Array.from(createHash('md5').update(bytes).digest()));
  await page.getByRole('button', { name: 'USB 燒錄', exact: true }).click();
  assert.equal(await page.locator('#flashButton').isDisabled(), true, 'raw app cannot be flashed at 0x0');
  const merged = Buffer.alloc(4 * 1024 * 1024, 0xff); merged[0] = 0xe9; merged[12] = 5; merged[13] = 0;
  await page.locator('#firmwareInput').setInputFiles({ name: 'BRD_BPX.ino.merged.bin', mimeType: 'application/octet-stream', buffer: merged });
  await page.waitForFunction(() => !document.querySelector('#flashButton').disabled);
  await page.locator('#flashButton').click();
  await page.waitForFunction(() => document.querySelector('#statusPill').textContent === '燒錄完成');
  assert.equal(await page.locator('#progressText').textContent(), '100%');
  assert.equal(await page.evaluate(() => window.testUsbMd5), createHash('md5').update(merged).digest('hex'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: browser BLE transfer, verified 100%, USB mode/file isolation, desktop/mobile layout and no page errors.');
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
