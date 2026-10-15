/*
 * 檔案位置: Web-Flash-Download-Tool/dist/brd-device-protocol.js
 * [新增] BRD_BPX V1.2 Settings / Display Page / BBP 封包解碼。
 * [新增] 獨立純函式，網頁及 Node 測試可共用。
 * [保留] 原 OTA 協議獨立，不改 OTA service UUID / 封包。
 */
export const BRD_UUID = Object.freeze({
  discovery: '55c40000-f8eb-11ec-b939-0242ac120002',
  bbp: '55c4f002-f8eb-11ec-b939-0242ac120002',
  settings: 'c7570001-9040-4c7b-87b1-086ef858ace7',
  request: 'c7570002-9040-4c7b-87b1-086ef858ace7',
  response: 'c7570003-9040-4c7b-87b1-086ef858ace7',
  displayPage: 'c7570004-9040-4c7b-87b1-086ef858ace7',
});
export const SETTING_FIELDS = Object.freeze([
  { id: 1, key: 'mode', min: 0, max: 1 },
  { id: 2, key: 'autoMinRpm', min: 1, max: 59999 },
  { id: 3, key: 'finishPercent', min: 1, max: 100 },
  { id: 4, key: 'chargingBleOff', min: 0, max: 1 },
]);
export const SETTING_STATUS = Object.freeze({
  0: 'OK', 1: 'PENDING', 2: 'SAVED', 3: '封包長度錯誤', 4: '協議版本錯誤',
  5: '不支援的命令', 6: '參數錯誤', 7: '數值超出範圍',
  8: '裝置忙碌（量測中或 GPIO 事件未處理）', 9: 'Flash 儲存失敗', 10: '封包標記錯誤',
});
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('BLE 回覆不是有效的位元組資料。');
}
function u16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }

export function encodeSettingsRequest(command, sequence, parameter = 0, value = 0) {
  if (!Number.isInteger(command) || command < 1 || command > 5 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > 255 ||
      !Number.isInteger(parameter) || parameter < 0 || parameter > 255 ||
      !Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError('設定請求參數不合法。');
  }
  if (command !== 2 && (parameter !== 0 || value !== 0)) throw new Error('只有 SET 可以攜帶參數。');
  return Uint8Array.of(0xc1, 1, command, sequence, parameter, value & 255, (value >>> 8) & 255, (value >>> 16) & 255);
}
export function decodeSettingsResponse(value) {
  const bytes = asBytes(value);
  if (bytes.length !== 20 || bytes[0] !== 0xc2 || bytes[1] !== 1 || bytes[4] > 10) {
    throw new Error('BRD 設定回覆格式不相容（預期 C2 / V1 / 20 bytes）。');
  }
  return {
    command: bytes[2], sequence: bytes[3], status: bytes[4], parameter: bytes[5],
    pending: Boolean(bytes[6] & 1), dirty: Boolean(bytes[6] & 2), storageFault: Boolean(bytes[6] & 4),
    active: { mode: bytes[7], autoMinRpm: u16(bytes, 8), chargingBleOff: bytes[10], finishPercent: bytes[15] },
    staged: { mode: bytes[11], autoMinRpm: u16(bytes, 12), chargingBleOff: bytes[14], finishPercent: bytes[16] },
    lastSaveStatus: bytes[17], revision: u16(bytes, 18),
  };
}
export function decodeBbpHeader(value) {
  const bytes = asBytes(value);
  if (bytes.length !== 17 || bytes[0] !== 0xa0 || bytes[1] !== 0x3a) throw new Error('BBP 狀態封包格式不符。');
  return {
    load: Boolean(bytes[3] & 0x04), batteryPercent: Math.min(100, Math.round(bytes[4] * 100 / 250)),
    lifetimeMax: u16(bytes, 7), totalLow16: u16(bytes, 9),
    uid: Array.from(bytes.slice(11, 17), byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(''),
    flags: bytes[3],
  };
}
export function decodeBbpDump(pagesInput) {
  const pages = Array.from(pagesInput, asBytes);
  if (pages.length !== 12) throw new Error('紀錄封包未收齊 12 頁。');
  for (let i = 0; i < 12; i++) {
    const expected = i < 8 ? 0xb0 + i : 0x70 + i - 8;
    if (pages[i].length !== 17 || pages[i][0] !== expected) throw new Error(`紀錄第 ${i + 1} 頁不正確。`);
  }
  let checksum = 0;
  for (let i = 0; i < 7; i++) for (let j = 1; j < 17; j++) checksum = (checksum + pages[i][j]) & 255;
  if (pages[7][16] !== checksum) throw new Error('歷史紀錄校驗不符，請重新讀取。');
  const count = pages[6][11];
  if (count > 50) throw new Error('歷史紀錄筆數不正確。');
  const allRecords = [];
  for (let i = 0; i < 50; i++) allRecords.push(u16(pages[Math.floor(i / 8)], 1 + i % 8 * 2));
  const history = allRecords.slice(0, count);
  if (history.some(v => v < 1 || v > 60000)) throw new Error('歷史紀錄包含無效 SP。');
  const curveRaw = [];
  for (let i = 0; i < 32; i++) curveRaw.push(u16(pages[8 + Math.floor(i / 8)], 1 + i % 8 * 2));
  let reachedPadding = false;
  for (const raw of curveRaw) {
    if (raw === 0) reachedPadding = true;
    else if (raw < 125 || reachedPadding) throw new Error('最新曲線封包內容不完整。');
  }
  return {
    totalLow16: u16(pages[6], 9), lifetimeMax: u16(pages[6], 7), count,
    history, // [注意] Firmware build_dump 為最舊 -> 最新，非最近先排序。
    latestSp: history.length ? history[history.length - 1] : 0,
    curveRpm: curveRaw.filter(Boolean).map(raw => Math.round(7500000 / raw)),
  };
}
export class BbpPageCollector {
  constructor() { this.reset(); }
  reset() { this.pages = new Array(12).fill(null); this.next = 0; }
  push(value) {
    const bytes = asBytes(value);
    if (bytes.length !== 17) return null;
    const page = bytes[0] >= 0xb0 && bytes[0] <= 0xb7 ? bytes[0] - 0xb0
      : bytes[0] >= 0x70 && bytes[0] <= 0x73 ? bytes[0] - 0x70 + 8 : -1;
    if (page === -1) return null;
    // [新增] 不拼接跨輪通知；只有收到 B0 才開始收完整快照。
    if (page === 0) this.reset();
    if (page !== this.next) { this.reset(); return null; }
    this.pages[page] = Uint8Array.from(bytes);
    this.next++;
    if (this.next !== 12) return null;
    const snapshot = this.pages;
    this.reset();
    return decodeBbpDump(snapshot);
  }
}
export function encodeCsv(values) {
  const records = ['# (oldest first),SP'];
  values.forEach((value, index) => records.push(`${index + 1},${value}`));
  return '\ufeff' + records.join('\r\n') + '\r\n';
}
