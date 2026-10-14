/* [V1.2 新增] 真實傳輸模組；GATT 邊界使用可掉包的記憶體裝置。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { OtaClient, validateFirmware, decodeStatus, UUIDS } from '../dist/ota-protocol.js';
function firmware(size = 160) {
  const b = new Uint8Array(size).fill(0x55); b[0] = 0xe9; b[12] = 5; b[13] = 0;
  new DataView(b.buffer).setUint32(32, 0xabcd5432, true);
  b.set(new TextEncoder().encode('BRD_BPX_OTA_IMAGE_V1_C3'), 70); return b;
}
function status(op, id, result, phase, offset, total, maxData = 14, flags = 6) {
  const b = new Uint8Array(20); const v = new DataView(b.buffer);
  b.set([op, id, result, phase]); v.setUint32(4, offset, true); v.setUint32(8, total, true);
  v.setUint32(12, 0x140000, true); v.setUint16(16, maxData, true); b[18] = flags; b[19] = 1;
  return b;
}
class Characteristic extends EventTarget {
  constructor(device, kind) { super(); this.device = device; this.kind = kind; }
  async startNotifications() { return this; }
  async stopNotifications() { return this; }
  async readValue() { return new DataView(this.device.read.buffer.slice(0)); }
  async writeValueWithResponse(value) { this.device.receive(this, new Uint8Array(value)); }
  async writeValueWithoutResponse(value) { this.device.receive(this, new Uint8Array(value)); }
  emit(bytes) { this.value = new DataView(bytes.buffer.slice(0)); this.dispatchEvent(new Event('characteristicvaluechanged')); }
}
class Device {
  constructor({ batch = false, dropPacket = -1, maxData = 14, dropSync = false } = {}) {
    this.maxData = maxData; this.dropSync = dropSync;
    this.batch = batch; this.dropPacket = dropPacket; this.dataCount = 0; this.batchMode = false;
    this.control = new Characteristic(this, 'control'); this.data = new Characteristic(this, 'data');
    this.status = new Characteristic(this, 'status'); this.read = status(1, 7, 0, 0, 0, 0);
    this.phase = 0; this.offset = 0; this.total = 0; this.image = []; this.hash = null;
    this.packets = []; this.writes = 0; this.ends = 0; this.aborts = 0; this.dropData = false;
    this.dropEnd = false; this.verifyFail = false; this.onReceive = null;
  }
  receive(characteristic, p) {
    assert.equal(characteristic.kind === 'data', p[0] === 16);
    assert.ok(p.length <= (p[0] === 16 ? this.maxData + 6 : 20), '封包不得超過協商後 ATT Payload');
    this.packets.push(p.slice()); let result = 0; const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
    if (p[0] === 2) { assert.equal(p.length, 18); this.hash = p.slice(2); }
    if (p[0] === 3) { this.total = v.getUint32(2, true); this.phase = 1; this.offset = 0; this.image = []; }
    if (p[0] === 6) { assert.equal(this.batch, true); this.batchMode = true; }
    if (p[0] === 16) {
      this.dataCount++;
      if (this.dataCount === this.dropPacket) return; // 模擬裝置 GATT 佇列掉包
      const offset = v.getUint32(2, true);
      if (offset === this.offset) { this.image.push(...p.slice(6)); this.offset += p.length - 6; this.writes++; }
      else if (this.batchMode) { /* 包可能晚到或中間有遺失；不修改 offset。 */ }
      else { assert.equal(offset + p.length - 6, this.offset, 'only the last packet can repeat'); }
    }
    if (p[0] === 4) {
      if (this.phase !== 2) {
        this.ends++; assert.equal(this.offset, this.total);
        const actual = createHash('md5').update(Uint8Array.from(this.image)).digest();
        result = this.verifyFail || !Buffer.from(this.hash).equals(actual) ? 9 : 0;
        this.phase = result ? 3 : 2;
      }
    }
    if (p[0] === 5) { this.aborts++; this.phase = 0; }
    const reply = status(p[0], p[1], result, this.phase, this.offset, this.total, this.maxData, this.batch ? 14 : 6);
    if (p[0] === 16 && this.batchMode) return; // DATA 不逐包 Notify
    if (p[0] === 16 && this.dropData) { this.dropData = false; return; }
    this.read = reply;
    if (p[0] === 4 && this.dropEnd) { this.dropEnd = false; return; }
    if (p[0] === 6 && this.dropSync) { this.dropSync = false; return; }
    this.status.emit(reply); this.onReceive?.(p);
  }
}
function client(d, options = {}) {
  return new OtaClient({ control: d.control, data: d.data, status: d.status },
    { transactionId: 7, ackTimeoutMs: 12, writeTimeoutMs: 60, maxRetries: 2, ...options });
}
const md5 = b => new Uint8Array(createHash('md5').update(b).digest());
test('firmware accepts only BRD C3 app images within the reported slot', () => {
  const b = firmware(); assert.equal(validateFirmware(b, 0x140000).length, b.length);
  assert.throws(() => validateFirmware(b, 100), /分區|大小/);
  const chip = b.slice(); chip[12] = 9; assert.throws(() => validateFirmware(chip), /ESP32-C3/);
  const desc = b.slice(); desc[32] = 0; assert.throws(() => validateFirmware(desc), /應用|app/i);
  const tag = b.slice(); tag[70] = 0; assert.throws(() => validateFirmware(tag), /BRD|OTA/);
  assert.throws(() => validateFirmware(new Uint8Array(4 * 1024 * 1024)), /分區|大小|映像/);
});
test('status wire format matches the firmware 20-byte little-endian response', () => {
  const s = decodeStatus(new DataView(status(16, 7, 0, 1, 1024, 600000).buffer));
  assert.equal(s.offset, 1024); assert.equal(s.total, 600000); assert.equal(s.maxData, 14);
  assert.equal(s.capacity, 0x140000); assert.equal(s.protocol, 1);
  assert.throws(() => decodeStatus(new Uint8Array(19)), /回覆/);
  const b = status(1, 7, 0, 0, 0, 0); b[19] = 2;
  assert.throws(() => decodeStatus(b), /協議/);
  assert.equal(UUIDS.service, 'c7570010-9040-4c7b-87b1-086ef858ace7');
});
test('lost data ACK resends exactly the last packet without advancing progress twice', async () => {
  const d = new Device(); d.dropData = true; const c = client(d); const b = firmware();
  await c.initialize(); const progress = [];
  const done = await c.transfer(b, md5(b), { onProgress: value => progress.push(value) });
  assert.equal(done.phase, 2); assert.equal(d.writes, Math.ceil(b.length / 14));
  assert.ok(d.packets.filter(p => p[0] === 16).length > d.writes);
  assert.ok(progress.slice(0, -1).every(p => p < 100)); assert.equal(progress.at(-1), 100);
  assert.deepEqual(Uint8Array.from(d.image), b); c.dispose();
});
test('lost END notification uses READ confirmation and commits once', async () => {
  const d = new Device(); d.dropEnd = true; const c = client(d); const b = firmware();
  await c.initialize(); assert.equal((await c.transfer(b, md5(b))).phase, 2);
  assert.equal(d.ends, 1); assert.equal(d.aborts, 0); c.dispose();
});
test('cancel during data sends ABORT and never END or 100 percent', async () => {
  const d = new Device(); const c = client(d); const b = firmware(); const abort = new AbortController();
  await c.initialize(); const progress = [];
  await assert.rejects(c.transfer(b, md5(b), { signal: abort.signal, onProgress: n => {
    progress.push(n); if (n > 0) abort.abort();
  } }), e => e.name === 'AbortError');
  assert.equal(d.ends, 0); assert.equal(d.aborts, 1); assert.ok(progress.every(n => n < 100)); c.dispose();
});
test('verification failure never reports success', async () => {
  const d = new Device(); d.verifyFail = true; const c = client(d); const b = firmware(); const progress = [];
  await c.initialize(); await assert.rejects(c.transfer(b, md5(b), { onProgress: n => progress.push(n) }), /校驗/);
  assert.ok(progress.every(n => n < 100)); c.dispose();
});
test('disconnect rejects a pending request and never reports success', async () => {
  const d = new Device(); const c = client(d); const b = firmware();
  await c.initialize(); d.receive = () => { c.disconnected(); };
  await assert.rejects(c.transfer(b, md5(b)), /斷線/); c.dispose();
});
test('commit stage completes even if an external cancel arrives during verification', async () => {
  const d = new Device(); const c = client(d); const b = firmware(); const abort = new AbortController();
  await c.initialize(); const done = await c.transfer(b, md5(b), {
    signal: abort.signal, onStage: stage => { if (stage === 'verify') abort.abort(); }
  });
  assert.equal(done.phase, 2); assert.equal(d.aborts, 0); c.dispose();
});
test('cancel waits for an in-flight GATT write before sending ABORT', async () => {
  const d = new Device(); const c = client(d); const b = firmware(); const cancel = new AbortController();
  await c.initialize(); let writing = false, overlapping = 0;
  const write = d.data.writeValueWithoutResponse.bind(d.data);
  d.data.writeValueWithoutResponse = async p => {
    writing = true; await write(p); cancel.abort();
    await new Promise(resolve => setTimeout(resolve, 20)); writing = false;
  };
  const control = d.control.writeValueWithResponse.bind(d.control);
  d.control.writeValueWithResponse = async p => { if (writing) overlapping++; return control(p); };
  await assert.rejects(c.transfer(b, md5(b), { signal: cancel.signal }), e => e.name === 'AbortError');
  assert.equal(overlapping, 0); assert.equal(d.aborts, 1); assert.equal(d.ends, 0); c.dispose();
});
test('cancel waits for an in-flight READ fallback before sending ABORT', async () => {
  const d = new Device(); const c = client(d); const b = firmware(); const cancel = new AbortController();
  await c.initialize(); d.dropData = true; let reading = false, overlapping = 0;
  const read = d.status.readValue.bind(d.status);
  d.status.readValue = async () => {
    reading = true; cancel.abort(); await new Promise(resolve => setTimeout(resolve, 20));
    reading = false; return read();
  };
  const control = d.control.writeValueWithResponse.bind(d.control);
  d.control.writeValueWithResponse = async p => { if (reading) overlapping++; return control(p); };
  await assert.rejects(c.transfer(b, md5(b), { signal: cancel.signal }), e => e.name === 'AbortError');
  assert.equal(overlapping, 0); assert.equal(d.aborts, 1); assert.equal(d.ends, 0); c.dispose();
});

/* [V1.2 新增] 8 包累計 ACK、漏包重傳、相容模式均由主機模擬驗證。 */
test('batch mode uses cumulative SYNC acknowledgements, without DATA notifications', async () => {
  const d = new Device({ batch: true }); const c = client(d); const b = firmware(2183);
  await c.initialize();
  const modes = [];
  const done = await c.transfer(b, md5(b), { onMode: (...args) => modes.push(args) });
  assert.equal(done.phase, 2);
  assert.deepEqual(modes[0], ['batch', 14, 8]);
  const synced = d.packets.filter(p => p[0] === 6).length;
  const dataCount = d.packets.filter(p => p[0] === 16).length;
  assert.ok(dataCount > 100);
  assert.ok(synced < dataCount / 5, '8 包傳完才確認一次');
  assert.deepEqual(Uint8Array.from(d.image), b);
  c.dispose();
});
test('batch mode recovers after one silent DATA loss by cumulative-offset retry', async () => {
  const d = new Device({ batch: true, dropPacket: 4 }); const c = client(d); const b = firmware(1087);
  const retries = [];
  await c.initialize();
  const done = await c.transfer(b, md5(b), { onRetry: n => retries.push(n) });
  assert.equal(done.phase, 2); assert.ok(retries.length >= 1);
  assert.deepEqual(Uint8Array.from(d.image), b);
  c.dispose();
});
test('old firmware without batch flag stays in stop-and-wait mode', async () => {
  const d = new Device(); const c = client(d); const b = firmware(321);
  const modes = [];
  await c.initialize();
  assert.equal((await c.transfer(b, md5(b), { onMode: (...v) => modes.push(v) })).phase, 2);
  assert.equal(modes[0][0], 'legacy'); assert.equal(d.packets.filter(p => p[0] === 6).length, 0);
  c.dispose();
});

test('MTU 247 sends 238-byte DATA payload and requires fewer SYNC responses', async () => {
  const d = new Device({ batch: true, maxData: 238 }); const c = client(d); const b = firmware(5003);
  await c.initialize(); const modes = [];
  assert.equal((await c.transfer(b, md5(b), { onMode: (...args) => modes.push(args) })).phase, 2);
  assert.deepEqual(modes[0], ['batch', 238, 8]);
  const data = d.packets.filter(p => p[0] === 16);
  assert.equal(data.length, Math.ceil(b.length / 238));
  assert.equal(Math.max(...data.map(p => p.length)), 244);
  assert.ok(d.packets.filter(p => p[0] === 6).length < 6);
  c.dispose();
});
test('lost SYNC notification uses read fallback without duplicating committed data', async () => {
  const d = new Device({ batch: true, dropSync: true }); const c = client(d); const b = firmware(533);
  await c.initialize();
  assert.equal((await c.transfer(b, md5(b))).phase, 2);
  assert.deepEqual(Uint8Array.from(d.image), b);
  c.dispose();
});
