/*
 * 檔案位置: tests/device-protocol.test.mjs
 * [新增] 與 BRD_BPX V1.2 brd_settings_model / brd_bbp_protocol 相符的封包測試。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSettingsRequest, decodeSettingsResponse, decodeBbpHeader,
  decodeBbpDump, BbpPageCollector, encodeCsv,
} from '../dist/brd-device-protocol.js';
function put16(bytes, offset, value) { bytes[offset] = value & 255; bytes[offset + 1] = value >> 8; }
function makeDump() {
  const pages = Array.from({ length: 12 }, (_, i) => {
    const packet = new Uint8Array(17);
    packet[0] = i < 8 ? 0xb0 + i : 0x70 + i - 8;
    return packet;
  });
  for (let i = 0; i < 50; i++) put16(pages[i >> 3], 1 + 2 * (i & 7), 1000 + i * 10);
  put16(pages[6], 7, 30000); put16(pages[6], 9, 800); pages[6][11] = 50;
  for (let i = 0; i < 32; i++) put16(pages[8 + (i >> 3)], 1 + 2 * (i & 7), i < 7 ? 500 - i * 20 : 0);
  let checksum = 0;
  for (let i = 0; i < 7; i++) for (let j = 1; j < 17; j++) checksum = (checksum + pages[i][j]) & 255;
  pages[7][16] = checksum;
  return pages;
}
test('settings request encodes 8-byte C1 packet and validates values', () => {
  assert.deepEqual([...encodeSettingsRequest(2, 9, 2, 2000)], [0xc1, 1, 2, 9, 2, 0xd0, 7, 0]);
  assert.deepEqual([...encodeSettingsRequest(3, 10)], [0xc1, 1, 3, 10, 0, 0, 0, 0]);
  assert.throws(() => encodeSettingsRequest(2, 1, 1, -1));
});
test('settings 20-byte C2 reply preserves active/staged and SAVE flags', () => {
  const bytes = new Uint8Array(20);
  bytes.set([0xc2, 1, 3, 10, 2, 0, 0, 1, 0xd0, 7, 0, 1, 0xd0, 7, 0, 30, 30, 2, 3, 0]);
  const out = decodeSettingsResponse(new DataView(bytes.buffer));
  assert.equal(out.status, 2); assert.equal(out.active.mode, 1);
  assert.equal(out.active.autoMinRpm, 2000); assert.equal(out.revision, 3);
  assert.throws(() => decodeSettingsResponse(bytes.subarray(1)));
});
test('BBP A0 maps battery raw 250 to 100 percent and load flag', () => {
  const bytes = new Uint8Array(17);
  bytes[0] = 0xa0; bytes[1] = 0x3a; bytes[3] = 4; bytes[4] = 250;
  put16(bytes, 7, 21000); put16(bytes, 9, 1234);
  const out = decodeBbpHeader(bytes);
  assert.equal(out.batteryPercent, 100); assert.equal(out.load, true);
  assert.equal(out.lifetimeMax, 21000); assert.equal(out.totalLow16, 1234);
});
test('12 BBP pages compose 50 oldest-to-newest records and latest 32-sample profile', () => {
  const pages = makeDump();
  const collector = new BbpPageCollector();
  let snapshot;
  pages.forEach(page => { snapshot = collector.push(new DataView(page.buffer)) || snapshot; });
  assert.equal(snapshot.count, 50);
  assert.equal(snapshot.history[0], 1000); assert.equal(snapshot.latestSp, 1490);
  assert.equal(snapshot.curveRpm.length, 7); assert.equal(snapshot.curveRpm[0], 15000);
  assert.equal(snapshot.totalLow16, 800);
  assert.deepEqual(decodeBbpDump(pages).history, snapshot.history);
  assert.equal(collector.next, 0);
});
test('rejects damaged checksum and mixed-page sequences, then resynchronizes', () => {
  const pages = makeDump();
  const corrupted = pages.map(v => Uint8Array.from(v)); corrupted[2][5] ^= 1;
  assert.throws(() => decodeBbpDump(corrupted), /校驗/);
  const collector = new BbpPageCollector();
  assert.equal(collector.push(pages[0]), null);
  assert.equal(collector.push(pages[2]), null);
  let snapshot;
  pages.forEach(page => { snapshot = collector.push(page) || snapshot; });
  assert.equal(snapshot.count, 50);
});
test('CSV is UTF-8 BOM with stable chronological output', () => {
  assert.equal(encodeCsv([1000, 2000]), '\ufeff# (oldest first),SP\r\n1,1000\r\n2,2000\r\n');
});
