/* [V1.2 手機修正 新增] 真實觸控事件、原生檔案選擇器及手機版面回歸測試。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
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
    const name = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!path.startsWith(root + '/')) throw new Error('path');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const origin = 'http://127.0.0.1:' + server.address().port;
const firmware = Buffer.alloc(160, 0x55);
firmware[0] = 0xe9; firmware[12] = 5; firmware[13] = 0;
firmware.writeUInt32LE(0xabcd5432, 32);
firmware.write('BRD_BPX_OTA_IMAGE_V1_C3', 70);

async function mobilePage({ width = 390, height = 844, bluetooth = false, stallCdn = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(2500);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ bluetooth }) => {
    window.testBleRequests = 0; window.testBleUserGesture = false;
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: bluetooth
      ? { requestDevice: () => {
        window.testBleRequests++; window.testBleUserGesture = navigator.userActivation.isActive;
        return Promise.reject(new DOMException('cancelled', 'NotFoundError'));
      } } : undefined });
  }, { bluetooth });
  await page.route('https://cdn.jsdelivr.net/**', route => {
    if (!stallCdn) return route.fulfill({ contentType: 'text/javascript', body: '/* old CDN available */' });
    // 模擬手機網路無法完成外部校驗套件下載；保持請求等待。
  });
  await page.goto(origin, { waitUntil: 'commit' });
  await page.locator('#modeBle').waitFor({ state: 'visible' });
  return { context, page, errors };
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#modeHint').textContent.length > 0);
}
async function chooseFirmware(page, name = 'BRD_BPX.ino.bin') {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#dropZone').tap();
  await (await chooser).setFiles({ name, mimeType: '', buffer: firmware });
  await page.waitForFunction(() => document.querySelector('#statusPill').textContent === '檔案就緒');
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await test('slow external CDN cannot freeze mode switching or file selection', async () => {
    const { context, page } = await mobilePage({ stallCdn: true });
    try {
      await page.locator('#modeBle').tap();
      await page.waitForFunction(() => document.querySelector('#fileHeading').textContent === '選擇 OTA 韌體');
      await chooseFirmware(page);
      assert.equal(await page.locator('#modeBle').getAttribute('aria-pressed'), 'true');
    } finally { await context.close(); }
  });
  await test('a phone with Bluetooth and no Serial starts in usable OTA mode', async () => {
    const { context, page, errors } = await mobilePage({ bluetooth: true });
    try {
      await ready(page);
      assert.equal(await page.locator('#modeBle').getAttribute('aria-pressed'), 'true');
      await chooseFirmware(page);
      assert.equal(await page.locator('#flashButton').isEnabled(), true);
      /* [新增] 以手機觸控點擊開始，確認事件抵達藍牙選擇器，且仍具有使用者操作權限。 */
      await page.locator('#flashButton').tap();
      await page.waitForFunction(() => window.testBleRequests === 1 && !document.querySelector('#modeBle').disabled);
      assert.equal(await page.evaluate(() => window.testBleUserGesture), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  for (const [width, height] of [[320, 280], [320, 568], [360, 640], [390, 844], [430, 932], [844, 390], [1024, 768], [1280, 720]]) {
    await test(`touch controls, long filenames and unsupported-browser warning fit ${width}x${height}`, async () => {
      const { context, page, errors } = await mobilePage({ width, height });
      try {
        await ready(page);
        await page.locator('#modeBle').tap();
        assert.equal(await page.locator('#modeBle').getAttribute('aria-pressed'), 'true');
        await chooseFirmware(page, 'BRD_BPX_' + 'mobile_firmware_'.repeat(9) + '.bin');
        assert.equal(await page.locator('#flashButton').isEnabled(), false);
        assert.equal(await page.locator('#modeUsb').isEnabled(), true);
        assert.equal(await page.locator('#modeBle').isEnabled(), true);
        assert.equal(await page.locator('#browserWarning').isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
        /* [新增] 手機直向、橫向及較寬的觸控視窗：操作區在上，狀態區完整排列在下。 */
        const vertical = await page.evaluate(() => {
          const control = document.querySelector('.control-panel').getBoundingClientRect();
          const monitor = document.querySelector('.monitor-panel').getBoundingClientRect();
          return monitor.top >= control.bottom - 1 && Math.abs(control.left - monitor.left) < 1
            && Math.abs(control.width - monitor.width) < 1;
        });
        assert.equal(vertical, true, 'file and OTA controls must be above the status panel');
        for (const id of ['modeUsb', 'modeBle', 'dropZone', 'clearLog']) {
          await page.locator('#' + id).scrollIntoViewIfNeeded();
          const unobstructed = await page.locator('#' + id).evaluate(el => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return hit === el || el.contains(hit);
          });
          assert.equal(unobstructed, true, id + ' receives the touch rather than an overlay');
        }
        await page.locator('#clearLog').tap();
        assert.equal(await page.locator('#logOutput').textContent(), '紀錄已清除。');
        await page.locator('#modeUsb').tap();
        assert.equal(await page.locator('#modeUsb').getAttribute('aria-pressed'), 'true');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
