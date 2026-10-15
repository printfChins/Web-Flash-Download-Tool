/*
 * 檔案位置: Web-Flash-Download-Tool/tests/device-log-removed.test.mjs
 * [新增] 確認設定介面的 DEVICE LOG 移除，不影響燒錄頁的 FLASH LOG 與 BLE 管理功能。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../dist/device-manager.js', import.meta.url), 'utf8');

test('DEVICE LOG 區塊已移除', () => {
  assert.doesNotMatch(html, /<strong>DEVICE LOG<\/strong>/);
  assert.doesNotMatch(html, /id="deviceLog"/);
  assert.doesNotMatch(css, /\.device-terminal\s*\{/);
  assert.doesNotMatch(js, /q\('#deviceLog'\)/);
});
test('保留 FLASH LOG、BLE 設定及資料檢視控制項', () => {
  for (const id of ['logOutput','deviceWorkspace','settingRead','settingSave','displayPageApply','bbpRefresh','curveChart','dataHistory']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, />FLASH LOG</);
  assert.match(js, /this\.errorMessage = '操作失敗：'/);
});
