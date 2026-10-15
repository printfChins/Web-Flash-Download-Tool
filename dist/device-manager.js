/*
 * 檔案位置: Web-Flash-Download-Tool/dist/device-manager.js
 * [新增] BRD BLE 裝置管理。設定 C1/C2、1-byte 顯示頁、BBP A0/12 頁資料視圖。
 * [新增] 僅在使用者點擊後呼叫 requestDevice，操作 GATT 完成前不並行存取。
 * [保留] USB / OTA 使用原 app.js，不在此啟動 OTA 或寫入 Flash。
 */
import {
  BRD_UUID, SETTING_FIELDS, SETTING_STATUS, encodeSettingsRequest,
  decodeSettingsResponse, decodeBbpHeader, BbpPageCollector, encodeCsv,
} from './brd-device-protocol.js';
const q = selector => document.querySelector(selector);
const els = {
  connect: q('#deviceConnect'), disconnect: q('#deviceDisconnect'), status: q('#deviceStatus'),
  warning: q('#deviceWarning'), name: q('#deviceName'),
  read: q('#settingRead'), save: q('#settingSave'), defaults: q('#settingDefaults'), discard: q('#settingDiscard'),
  mode: q('#settingMode'), rpm: q('#settingAutoMin'), percent: q('#settingFinish'), charging: q('#settingCharge'),
  page: q('#displayPage'), applyPage: q('#displayPageApply'), readPage: q('#displayPageRead'),
  refresh: q('#bbpRefresh'), export: q('#bbpExport'),
  load: q('#dataLoad'), battery: q('#dataBattery'), total: q('#dataTotal'),
  lifetime: q('#dataLifetime'), latest: q('#dataLatest'),
  history: q('#dataHistory'), chart: q('#curveChart'),
};
function bytesOf(value) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function timed(promise, timeoutMs, name) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(name + ' 逾時，請重新連線。')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}
function settingsDisplay(value) {
  els.mode.value = String(value.mode);
  els.rpm.value = String(value.autoMinRpm);
  els.percent.value = String(value.finishPercent);
  els.charging.value = String(value.chargingBleOff);
}
function currentInput() {
  const values = {
    mode: Number(els.mode.value), autoMinRpm: Number(els.rpm.value),
    finishPercent: Number(els.percent.value), chargingBleOff: Number(els.charging.value),
  };
  for (const field of SETTING_FIELDS) {
    const value = values[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      throw new Error(`${field.key} 必須介於 ${field.min}～${field.max}。`);
    }
  }
  return values;
}
function drawChart(values) {
  const svg = els.chart;
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag, attributes, content = null) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attributes).forEach(([key, val]) => node.setAttribute(key, String(val)));
    if (content !== null) node.textContent = content;
    svg.appendChild(node);
    return node;
  };
  if (!values.length) {
    add('text', { x: 160, y: 62, fill: '#8ba3b4', 'text-anchor': 'middle', 'font-size': 13 }, '尚無有效曲線資料');
    return;
  }
  const left = 38, top = 12, right = 310, bottom = 97;
  const maximum = Math.max(1000, Math.ceil(Math.max(...values) / 1000) * 1000);
  for (let i = 0; i <= 2; i++) {
    const y = top + i * (bottom - top) / 2;
    add('line', { x1: left, y1: y, x2: right, y2: y, stroke: '#2b4659', 'stroke-width': 1 });
    add('text', { x: 31, y: y + 4, fill: '#8ba3b4', 'text-anchor': 'end', 'font-size': 9 }, String(Math.round(maximum * (1 - i / 2))));
  }
  const points = values.map((rpm, i) => {
    const x = left + (values.length === 1 ? 0 : i * (right - left) / (values.length - 1));
    return `${x.toFixed(1)},${(bottom - rpm / maximum * (bottom - top)).toFixed(1)}`;
  });
  add('polyline', { points: points.join(' '), fill: 'none', stroke: '#38d9ff', 'stroke-width': 2, 'stroke-linejoin': 'round' });
  add('text', { x: 170, y: 118, fill: '#8ba3b4', 'text-anchor': 'middle', 'font-size': 10 },
    `第 1～${values.length} 筆有效週期（非固定時間間隔）`);
}

export class DeviceManager {
  constructor() {
    this.device = null;
    this.settings = null;
    this.bbp = null;
    this.pageChar = null;
    this.settingsRequest = null;
    this.settingsResponse = null;
    this.settingsNotify = null;
    this.activeSettings = null;
    this.collector = new BbpPageCollector();
    this.snapshot = null;
    this.pending = null;
    this.sequence = 0;
    this.working = false;
    this.connected = false;
    this.active = false;
    /* [新增] DEVICE LOG 移除後，錯誤保留於既有 deviceWarning 提示區。 */
    this.errorMessage = '';
    this.header = null;
    this.onSettingsValue = event => this.handleSettingsValue(event);
    this.onBbpValue = event => this.handleBbpValue(event);
    this.onDisconnect = () => this.close(false);
    this.attach();
    this.update();
  }
  /* [修改] 刪除 DEVICE LOG DOM 寫入；內部診斷仍可在瀏覽器開發者工具查看。 */
  log(message) {
    console.debug('[BRD DEVICE]', message);
  }
  supported() { return window.isSecureContext && typeof navigator.bluetooth?.requestDevice === 'function'; }
  setStatus(message, state = 'idle') {
    els.status.textContent = message;
    els.status.dataset.state = state;
  }
  update() {
    const locked = this.working;
    els.connect.disabled = locked || this.connected || !this.supported();
    /* [新增] GATT 操作中鎖住其他模式按鈕，避免使用者誤認可以中途切換 OTA。 */
    if (this.active) {
      q('#modeUsb').disabled = locked;
      q('#modeBle').disabled = locked;
      q('#modeManage').disabled = locked;
    }
    els.disconnect.disabled = locked || !this.connected;
    for (const element of [els.read, els.save, els.defaults, els.discard,
      els.refresh, els.mode, els.rpm, els.percent, els.charging]) {
      element.disabled = locked || !this.connected;
    }
    for (const element of [els.applyPage, els.readPage, els.page]) {
      element.disabled = locked || !this.connected || !this.pageChar;
    }
    els.export.disabled = !this.snapshot?.history.length;
    /* [修改] 移除 DEVICE LOG 後，保留連線錯誤與操作拒絕的畫面提示。 */
    const supported = this.supported();
    els.warning.hidden = supported && !this.errorMessage;
    els.warning.textContent = !supported
      ? (!window.isSecureContext ? '請使用 HTTPS 或 localhost，才能開啟 Web Bluetooth。'
        : '此瀏覽器不支援 Web Bluetooth。請使用電腦 Chrome / Edge 或 Android Chrome；iPhone / iPad 一般瀏覽器不支援。')
      : this.errorMessage;
  }
  activate() { this.active = true; this.update(); }
  deactivate() { this.active = false; this.close(true); }
  async action(fn) {
    if (this.working) return;
    this.working = true;
    this.errorMessage = '';
    this.update();
    try { await fn(); }
    catch (error) {
      this.errorMessage = '操作失敗：' + (error.message || String(error));
      this.setStatus('操作失敗', 'error');
      this.log(this.errorMessage);
    }
    finally { this.working = false; this.update(); }
  }
  attach() {
    els.connect.addEventListener('click', () => { void this.action(() => this.connect()); });
    els.disconnect.addEventListener('click', () => this.close(true));
    els.read.addEventListener('click', () => { void this.action(() => this.readSettings()); });
    els.save.addEventListener('click', () => { void this.action(() => this.saveSettings()); });
    els.defaults.addEventListener('click', () => {
      settingsDisplay({ mode: 0, autoMinRpm: 2000, finishPercent: 30, chargingBleOff: 0 });
      this.log('已將表單帶入韌體預設值，尚未儲存至裝置。');
    });
    els.discard.addEventListener('click', () => { if (this.activeSettings) settingsDisplay(this.activeSettings); });
    els.applyPage.addEventListener('click', () => { void this.action(() => this.setDisplayPage()); });
    els.readPage.addEventListener('click', () => { void this.action(() => this.readDisplayPage()); });
    els.refresh.addEventListener('click', () => { void this.action(() => this.refreshData()); });
    els.export.addEventListener('click', () => this.exportCsv());
  }
  async connect() {
    if (!this.supported()) throw new Error('目前瀏覽器不支援藍牙。');
    this.log('請選擇 BRD 裝置。');
    // [新增] 以廣播 BBP service 篩選裝置，額外授權非廣播的 Settings Service。
    const selected = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BRD_UUID.discovery], namePrefix: 'BEYBLADE_TOOL_BRD_' }],
      optionalServices: [BRD_UUID.settings],
    });
    this.device = selected;
    selected.addEventListener('gattserverdisconnected', this.onDisconnect);
    try {
      const server = await timed(selected.gatt.connect(), 8000, 'BLE 連線');
      const settings = await server.getPrimaryService(BRD_UUID.settings);
      const bbp = await server.getPrimaryService(BRD_UUID.discovery);
      const [request, response, bbpChar] = await Promise.all([
        settings.getCharacteristic(BRD_UUID.request), settings.getCharacteristic(BRD_UUID.response),
        bbp.getCharacteristic(BRD_UUID.bbp),
      ]);
      /* [新增] 舊版沒有 IR TEST Characteristic 時，設定與資料檢視仍可正常使用。 */
      let page = null;
      try { page = await settings.getCharacteristic(BRD_UUID.displayPage); }
      catch { this.log('韌體沒有 IR TEST 頁面 API，僅停用 OLED 切頁功能。'); }
      this.settings = settings; this.bbp = bbp;
      this.settingsRequest = request; this.settingsResponse = response; this.pageChar = page; this.bbpChar = bbpChar;
      response.addEventListener('characteristicvaluechanged', this.onSettingsValue);
      await response.startNotifications();
      bbpChar.addEventListener('characteristicvaluechanged', this.onBbpValue);
      await bbpChar.startNotifications();
      this.connected = true;
      els.name.textContent = selected.name || 'BRD';
      this.setStatus('已連線', 'success');
      this.log('已連線 ' + els.name.textContent + '，設定與 BBP Notify 已訂閱。');
      await this.readSettings();
      if (this.pageChar) await this.readDisplayPage();
      await this.refreshData();
    } catch (error) {
      this.close(true);
      throw error;
    }
  }
  close(disconnectGatt) {
    if (this.pending) {
      this.pending.reject(new Error('BLE 連線已中斷。'));
      this.pending = null;
    }
    const previous = this.device;
    this.device = null;
    this.connected = false;
    if (this.settingsResponse) this.settingsResponse.removeEventListener('characteristicvaluechanged', this.onSettingsValue);
    if (this.bbpChar) this.bbpChar.removeEventListener('characteristicvaluechanged', this.onBbpValue);
    this.settingsResponse = this.settingsRequest = this.pageChar = this.bbpChar = null;
    this.settings = this.bbp = null;
    this.activeSettings = null;
    /* [新增] 斷線後 UI 頁面回到 MAIN，歷史快照保留供離線檢視。 */
    els.page.value = '0';
    if (previous) {
      previous.removeEventListener('gattserverdisconnected', this.onDisconnect);
      if (disconnectGatt && previous.gatt.connected) previous.gatt.disconnect();
      this.log('BLE 裝置已中斷。');
    }
    els.name.textContent = '未連線';
    this.setStatus('未連線');
    this.update();
  }
  handleSettingsValue(event) {
    try {
      const response = decodeSettingsResponse(event.target.value);
      if (this.pending && response.command === this.pending.command && response.sequence === this.pending.sequence) {
        if (response.status !== 1 || !this.pending.waitSaved) this.pending.resolve(response);
      }
    } catch (error) { this.log('略過無效 Settings Notify：' + error.message); }
  }
  async requestSettings(command, parameter = 0, value = 0, waitSaved = false) {
    if (!this.connected) throw new Error('請先連線。');
    const seq = this.sequence = (this.sequence + 1) & 255;
    const packet = encodeSettingsRequest(command, seq, parameter, value);
    let resolveReply, rejectReply;
    const promise = new Promise((resolve, reject) => { resolveReply = resolve; rejectReply = reject; });
    promise.catch(() => {});
    const pending = { sequence: seq, command, waitSaved, resolve: resolveReply, reject: rejectReply };
    this.pending = pending;
    try {
      await timed(this.settingsRequest.writeValueWithResponse(packet), 5000, '設定寫入');
      // [新增] Notify 為主要來源；Read 快照輪詢補救遺失通知。
      for (let attempts = 0; attempts < (waitSaved ? 75 : 22); attempts++) {
        if (!this.connected) throw new Error('裝置已斷線。');
        const result = await Promise.race([promise.then(reply => ({ reply })), delay(135).then(() => ({ tick: true }))]);
        if (result.reply) {
          if (result.reply.status > 2) throw new Error(SETTING_STATUS[result.reply.status] || '設定被拒絕。');
          return result.reply;
        }
        const read = decodeSettingsResponse(await timed(this.settingsResponse.readValue(), 5000, '設定讀取'));
        if (read.command === command && read.sequence === seq) {
          if (read.status > 2) throw new Error(SETTING_STATUS[read.status] || '設定被拒絕。');
          if (!waitSaved || read.status === 2) return read;
        }
      }
      throw new Error(waitSaved ? '等待設定保存完成逾時。請重新連線 GET 確認，避免重複寫入。' : '等待設定回覆逾時。');
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }
  async readSettings() {
    const response = await this.requestSettings(1);
    this.activeSettings = { ...response.active };
    settingsDisplay(response.staged);
    this.setStatus('設定已讀取', 'success');
    this.log(`GET：${JSON.stringify(response.active)}；${response.dirty ? 'RAM 有草稿' : 'RAM 與執行值一致'}。`);
    if (response.storageFault) this.log('注意：設定 Flash 尚無有效保存紀錄，或上次保存失敗。');
  }
  async saveSettings() {
    const form = currentInput();
    const current = await this.requestSettings(1);
    // [新增] 一律在原草稿上逐項 SET；只修改不同的欄位。
    for (const field of SETTING_FIELDS) {
      if (form[field.key] === current.staged[field.key]) continue;
      await this.requestSettings(2, field.id, form[field.key]);
      this.log(`SET #${field.id} = ${form[field.key]}（RAM 草稿）`);
    }
    this.log('SAVE：等待韌體安全時段寫入 Flash，測量中可能回 BUSY。');
    const saved = await this.requestSettings(3, 0, 0, true);
    if (saved.status !== 2) throw new Error('裝置未確認 SAVED。');
    this.activeSettings = { ...saved.active };
    settingsDisplay(saved.active);
    this.setStatus('設定已保存', 'success');
    this.log(`SAVE 完成，Flash revision=${saved.revision}。`);
  }
  async readDisplayPage() {
    if (!this.pageChar) throw new Error('此韌體不支援 IR TEST 頁面切換，請更新韌體。');
    const value = bytesOf(await timed(this.pageChar.readValue(), 5000, '頁面讀取'));
    if (value.length !== 1 || value[0] > 1) throw new Error('顯示頁面回覆格式不符。');
    els.page.value = String(value[0]);
    this.log('目前 OLED 頁面：' + (value[0] === 0 ? 'MAIN' : 'IR TEST'));
  }
  async setDisplayPage() {
    const page = Number(els.page.value);
    if (page !== 0 && page !== 1) throw new Error('顯示頁面參數不正確。');
    await timed(this.pageChar.writeValueWithResponse(Uint8Array.of(page)), 5000, '頁面切換');
    await this.readDisplayPage();
    if (Number(els.page.value) !== page) throw new Error('裝置未成功切換 OLED 頁面。');
    this.setStatus('頁面已切換', 'success');
    this.log('已切換 OLED 頁面；僅修改 RAM，不會寫入 Flash。');
  }
  handleBbpValue(event) {
    if (!this.connected) return;
    const bytes = bytesOf(event.target.value);
    try {
      if (bytes[0] === 0xa0) {
        this.header = decodeBbpHeader(bytes);
        els.load.textContent = this.header.load ? 'LOADED' : 'WAIT / AUTO';
        els.battery.textContent = `${this.header.batteryPercent}%`;
        els.total.textContent = this.header.totalLow16.toLocaleString() + ' (低 16 位)';
        els.lifetime.textContent = this.header.lifetimeMax.toLocaleString() + ' SP';
      } else {
        const snapshot = this.collector.push(bytes);
        if (snapshot) {
          this.snapshot = snapshot;
          this.renderSnapshot(snapshot);
          this.log(`歷史資料已讀取：${snapshot.count} 筆；最新曲線 ${snapshot.curveRpm.length} 點。`);
          this.update();
        }
      }
    } catch (error) {
      this.collector.reset();
      this.log('資料檢查失敗：' + error.message + '，請重新讀取。');
    }
  }
  renderSnapshot(snapshot) {
    els.total.textContent = snapshot.totalLow16.toLocaleString() + ' (低 16 位)';
    els.lifetime.textContent = snapshot.lifetimeMax.toLocaleString() + ' SP';
    els.latest.textContent = snapshot.latestSp ? snapshot.latestSp.toLocaleString() + ' SP' : '尚無資料';
    els.history.replaceChildren();
    [...snapshot.history].reverse().forEach((sp, reversedIndex) => {
      const tr = document.createElement('tr');
      const number = document.createElement('td');
      number.textContent = `#${snapshot.history.length - reversedIndex}`;
      const value = document.createElement('td');
      value.textContent = sp.toLocaleString() + ' SP';
      tr.append(number, value);
      els.history.appendChild(tr);
    });
    if (!snapshot.history.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 2; td.textContent = '尚無發射紀錄'; tr.appendChild(td); els.history.appendChild(tr);
    }
    drawChart(snapshot.curveRpm);
  }
  async refreshData() {
    this.collector.reset();
    // [新增] 原韌體允許 0x51 回 A0、0x74 回 12 頁歷史和最近曲線。
    await timed(this.bbpChar.writeValueWithResponse(Uint8Array.of(0x51)), 5000, '裝置狀態查詢');
    await timed(this.bbpChar.writeValueWithResponse(Uint8Array.of(0x74)), 5000, '發射紀錄查詢');
    this.log('已送出 A0 狀態與 B0～B7 / 70～73 紀錄查詢，等待 Notify。');
  }
  exportCsv() {
    if (!this.snapshot?.history.length) return;
    const data = new Blob([encodeCsv(this.snapshot.history)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url; a.download = 'BRD_SP_History.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
