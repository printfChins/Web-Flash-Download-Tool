/*
 * 檔案位置: Web-Flash-Download-Tool/dist/ota-protocol.js
 * 貼放位置: 與 app.js 同一資料夾，完整新增檔案。
 * [V1.2 新增] 自訂 BRD OTA 協議、MTU 分包、逐包 ACK、READ 備援與重傳。
 * [V1.2 新增] 不依賴 DOM，便於 App 共用協議及主機測試。
 */
export const UUIDS = Object.freeze({
  service: 'c7570010-9040-4c7b-87b1-086ef858ace7',
  control: 'c7570011-9040-4c7b-87b1-086ef858ace7',
  data: 'c7570012-9040-4c7b-87b1-086ef858ace7',
  status: 'c7570013-9040-4c7b-87b1-086ef858ace7',
  discovery: '55c40000-f8eb-11ec-b939-0242ac120002',
});
const OP = { INFO: 1, HASH: 2, BEGIN: 3, END: 4, ABORT: 5, DATA: 16 };
const RESULT_TEXT = [
  '', '封包長度不正確', '裝置忙碌，請解除裝載並等待量測結束',
  '電量不足或電池讀取異常，請充電後重試', '韌體大小不符合 OTA 分區',
  'OTA 交易已結束或不相符，請重新連線', '封包位移不一致，請重新更新',
  '韌體不是相容的 BRD ESP32-C3 應用映像', 'Flash 寫入或安全窗口失敗',
  '韌體校驗失敗，未切換開機分區', '裝置 OTA 逾時，請重新更新', '不支援的 OTA 命令',
];
function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('無法讀取韌體或裝置回覆。');
}
export function validateFirmware(value, capacity = 0x140000) {
  const data = bytes(value);
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || data.length < 36 || data.length > capacity) {
    throw new Error('韌體映像大小超出 OTA 分區；請使用純應用程式 BIN。');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[0] !== 0xe9 || view.getUint16(12, true) !== 5) {
    throw new Error('韌體必須是 ESP32-C3 映像。');
  }
  if (view.getUint32(32, true) !== 0xabcd5432) {
    throw new Error('請選擇純應用程式 app BIN，不可使用 merged.bin 或 bootloader.bin。');
  }
  const tag = new TextEncoder().encode('BRD_BPX_OTA_IMAGE_V1_C3');
  let found = false;
  outer: for (let i = 0; i <= data.length - tag.length; i++) {
    for (let j = 0; j < tag.length; j++) if (data[i + j] !== tag[j]) continue outer;
    found = true; break;
  }
  if (!found) throw new Error('此 BIN 缺少 BRD OTA 標記，請使用 V1.2 或之後的 OTA 韌體。');
  return data;
}
export function decodeStatus(value) {
  const data = bytes(value);
  if (data.length !== 20) throw new Error('OTA 回覆長度不是 20 bytes。');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[19] !== 1) throw new Error('裝置 OTA 協議版本不相容。');
  const result = {
    opcode: data[0], id: data[1], result: data[2], phase: data[3],
    offset: v.getUint32(4, true), total: v.getUint32(8, true), capacity: v.getUint32(12, true),
    maxData: v.getUint16(16, true), flags: data[18], protocol: data[19],
  };
  if (result.result > 11 || result.phase > 3 || result.offset > result.total || result.maxData < 1 || result.maxData > 240) {
    throw new Error('OTA 回覆內容無效。');
  }
  return result;
}
function abortError() { return new DOMException('已取消 OTA 更新。', 'AbortError'); }
function timeoutError(code) { const error = new Error('等待 OTA 裝置回覆逾時。'); error.code = code; return error; }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
function bounded(promise, milliseconds, signal, code) {
  return new Promise((resolve, reject) => {
    let timer;
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { clean(); reject(abortError()); };
    if (signal?.aborted) { reject(abortError()); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { clean(); reject(timeoutError(code)); }, milliseconds);
    Promise.resolve(promise).then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
  });
}
export class OtaClient {
  constructor(characteristics, options = {}) {
    this.control = characteristics.control; this.data = characteristics.data; this.status = characteristics.status;
    this.id = options.transactionId ?? (globalThis.crypto?.getRandomValues(new Uint8Array(1))[0] % 255 + 1 || 1);
    this.ackTimeoutMs = options.ackTimeoutMs ?? 1500;
    this.writeTimeoutMs = options.writeTimeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
    this.pending = null; this.info = null; this.closed = false; this.transferring = false;
    this.listener = event => {
      try { this.deliver(decodeStatus(event.target.value)); }
      catch (error) { this.pending?.reject(error); }
    };
  }
  match(reply, opcode, id, expectedOffset) {
    return reply.opcode === opcode && reply.id === id &&
      (reply.result !== 0 || expectedOffset === undefined || reply.offset === expectedOffset);
  }
  deliver(reply) {
    const wait = this.pending;
    if (wait && this.match(reply, wait.opcode, wait.id, wait.expectedOffset)) wait.resolve(reply);
  }
  async request(characteristic, packet, { signal, expectedOffset, onRetry } = {}) {
    if (this.closed) throw new Error('裝置已斷線，請重新連線後更新。');
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      throwIfAborted(signal);
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      // [新增] ACK 可能在 write Promise 完成前抵達；立即接上 rejection handler。
      promise.catch(() => {});
      this.pending = { opcode: packet[0], id: packet[1], expectedOffset, resolve, reject };
      let reply;
      try {
        const method = characteristic === this.data && typeof characteristic.writeValueWithoutResponse === 'function'
          ? 'writeValueWithoutResponse' : 'writeValueWithResponse';
        // [新增] GATT write 尚未完成時不發出其他 GATT 操作。
        try {
          // [修正] 取消只在當前 GATT 操作完成後生效，避免 ABORT 與未完成 write 重疊。
          await bounded(characteristic[method](packet), this.writeTimeoutMs, undefined, 'WRITE_TIMEOUT');
          throwIfAborted(signal);
        }
        catch (error) { if (error.code === 'WRITE_TIMEOUT') this.closed = true; throw error; }
        try { reply = await bounded(promise, this.ackTimeoutMs, signal, 'ACK_TIMEOUT'); }
        catch (error) {
          if (error.code !== 'ACK_TIMEOUT') throw error;
          this.pending = null;
          // [新增] Notify 遺失時先讀快照，僅匹配本命令及預期位移才接受。
          try {
            const read = decodeStatus(await bounded(this.status.readValue(), this.writeTimeoutMs, undefined, 'READ_TIMEOUT'));
            throwIfAborted(signal);
            if (this.match(read, packet[0], packet[1], expectedOffset)) reply = read;
          } catch (readError) {
            if (readError.name === 'AbortError' || this.closed) throw readError;
            if (readError.code === 'READ_TIMEOUT') { this.closed = true; throw readError; }
          }
          if (!reply) {
            if (attempt === this.maxRetries) throw error;
            onRetry?.(attempt + 1); continue;
          }
        }
      } finally { this.pending = null; }
      if (reply.result !== 0) throw new Error(RESULT_TEXT[reply.result] || 'OTA 裝置拒絕請求。');
      return reply;
    }
    throw timeoutError('ACK_TIMEOUT');
  }
  async initialize() {
    this.status.addEventListener('characteristicvaluechanged', this.listener);
    await bounded(this.status.startNotifications(), this.writeTimeoutMs, undefined, 'SUBSCRIBE_TIMEOUT');
    this.info = await this.request(this.control, Uint8Array.of(OP.INFO, this.id));
    if (this.info.capacity < 36) throw new Error('裝置沒有可用 OTA 分區，請先使用 USB 燒錄。');
    return this.info;
  }
  async transfer(value, expectedMd5, { signal, onProgress, onStage, onRetry } = {}) {
    if (!this.info || this.transferring) throw new Error('請先完成 OTA 連線，且一次只能執行一筆更新。');
    const image = validateFirmware(value, this.info.capacity); const digest = bytes(expectedMd5);
    if (digest.length !== 16) throw new Error('OTA MD5 長度不正確。');
    this.transferring = true; let committing = false;
    try {
      throwIfAborted(signal); onStage?.('prepare');
      const hash = new Uint8Array(18); hash.set([OP.HASH, this.id]); hash.set(digest, 2);
      await this.request(this.control, hash, { signal, onRetry });
      const begin = new Uint8Array(6); begin.set([OP.BEGIN, this.id]);
      new DataView(begin.buffer).setUint32(2, image.length, true);
      const ready = await this.request(this.control, begin, { signal, onRetry });
      if (ready.phase !== 1 || ready.offset !== 0 || ready.total !== image.length) throw new Error('裝置 OTA 起始狀態不正確。');
      const maxData = Math.min(240, ready.maxData, this.info.maxData);
      onStage?.('write'); onProgress?.(0, 0, image.length);
      for (let offset = 0; offset < image.length;) {
        throwIfAborted(signal);
        const length = Math.min(maxData, image.length - offset); const packet = new Uint8Array(6 + length);
        packet.set([OP.DATA, this.id]); new DataView(packet.buffer).setUint32(2, offset, true);
        packet.set(image.subarray(offset, offset + length), 6);
        const ack = await this.request(this.data, packet, { signal, expectedOffset: offset + length, onRetry });
        if (ack.phase !== 1 || ack.total !== image.length) throw new Error('裝置 OTA 傳輸狀態不正確。');
        offset = ack.offset; onProgress?.(Math.min(99, offset * 100 / image.length), offset, image.length);
      }
      throwIfAborted(signal);
      // [新增] END 會驗證並切換開機分區，此階段不接受取消。
      committing = true; onStage?.('verify');
      const done = await this.request(this.control, Uint8Array.of(OP.END, this.id), { expectedOffset: image.length, onRetry });
      if (done.phase !== 2 || done.total !== image.length) throw new Error('裝置未確認韌體校驗完成。');
      onProgress?.(100, image.length, image.length); onStage?.('done'); return done;
    } catch (error) {
      if (!committing && !this.closed) {
        try { await this.request(this.control, Uint8Array.of(OP.ABORT, this.id)); } catch { /* 主機斷線後裝置亦會中止。 */ }
      }
      throw error;
    } finally { this.transferring = false; }
  }
  disconnected() {
    this.closed = true; this.pending?.reject(new Error('裝置已斷線，尚未取得更新完成確認。'));
  }
  dispose() {
    this.disconnected(); this.status.removeEventListener('characteristicvaluechanged', this.listener);
    this.status.stopNotifications?.().catch(() => {});
  }
}
