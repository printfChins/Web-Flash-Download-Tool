/*
 * 檔案位置: Web-Flash-Download-Tool/dist/app.js
 * 貼放位置: 完整替換原 app.js。
 * [V1.2 新增] USB / BLE OTA 切換、相容檔案檢查、裝置確認進度與取消。
 * [V1.2 修改] esptool-js 於 USB 操作才載入，BLE 不依賴序列埠套件。
 * [V1.2 手機修正 新增] 依瀏覽器能力選擇預設模式，提示不影響選檔與切換。
 */
import { OtaClient, UUIDS, validateFirmware } from "./ota-protocol.js";
const IMAGE_SIZE = 4 * 1024 * 1024;
const FLASH_ADDRESS = 0x000000;
const BAUD_RATE = 460800;
const elements = {
  input: document.querySelector("#firmwareInput"),
  dropZone: document.querySelector("#dropZone"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
  fileHeading: document.querySelector("#fileHeading"),
  modeHint: document.querySelector("#modeHint"),
  modeUsb: document.querySelector("#modeUsb"),
  modeBle: document.querySelector("#modeBle"),
  flashButton: document.querySelector("#flashButton"),
  disconnectButton: document.querySelector("#disconnectButton"),
  buttonText: document.querySelector("#buttonText"),
  statusPill: document.querySelector("#statusPill"),
  stageLabel: document.querySelector("#stageLabel"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
  log: document.querySelector("#logOutput"),
  clearLog: document.querySelector("#clearLog"),
  warning: document.querySelector("#browserWarning"),
  stages: ["#stageConnect", "#stageErase", "#stageWrite", "#stageVerify"].map(id => document.querySelector(id)),
};
let mode = "usb";
let firmwareFile = null, firmwareBytes = null, transport = null;
let device = null, client = null, controller = null;
let busy = false, verifying = false, completed = false, selection = 0;

function appendLog(message) {
  const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  elements.log.textContent += "\n[" + time + "] " + String(message).trimEnd();
  elements.log.scrollTop = elements.log.scrollHeight;
}
function setStatus(text, state = "idle") {
  elements.statusPill.textContent = text; elements.statusPill.dataset.state = state;
}
function setProgress(percent, label) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.progressBar.style.width = p + "%";
  // [V1.2 修改] 校驗前最多 99%，避免 99.9 四捨五入顯示 100。
  elements.progressText.textContent = Math.floor(p) + "%"; elements.stageLabel.textContent = label;
}
function setStage(index) {
  elements.stages.forEach((stage, i) => {
    stage.classList.toggle("active", i === index); stage.classList.toggle("done", i < index);
  });
}
function resetStages() { elements.stages.forEach(stage => stage.classList.remove("active", "done")); }
function supported(kind = mode) {
  return window.isSecureContext && (kind === "usb"
    ? typeof navigator.serial?.requestPort === "function" : typeof navigator.bluetooth?.requestDevice === "function");
}
function updateControls() {
  elements.input.disabled = busy; elements.modeUsb.disabled = busy; elements.modeBle.disabled = busy;
  elements.dropZone.setAttribute("aria-disabled", String(busy));
  elements.flashButton.disabled = busy || !firmwareFile || !firmwareBytes || !supported();
  elements.buttonText.textContent = busy ? (verifying ? "正在校驗韌體" : "更新進行中")
    : firmwareFile ? (!supported() ? (mode === "ble" ? "此瀏覽器無法進行藍牙更新" : "此瀏覽器無法進行 USB 燒錄")
      : mode === "ble" ? "連接藍牙並開始更新" : "連接並開始燒錄") : "請先選擇燒錄檔";
  elements.disconnectButton.hidden = !busy; elements.disconnectButton.disabled = verifying;
  elements.disconnectButton.textContent = verifying ? "校驗中，請等待完成" : "取消更新";
  elements.warning.hidden = supported();
  elements.warning.textContent = !window.isSecureContext ? "請透過 HTTPS 或 localhost 開啟此工具。"
    : mode === "ble" ? "此瀏覽器不支援藍牙更新。Android 請用 Chrome 開啟；iPhone / iPad 一般瀏覽器需另用原生 BLE App。"
    : "USB 燒錄需使用電腦 Chrome / Edge。Android 手機請切換藍牙 OTA，並用 Chrome 開啟。";
}
function checkFile(file, value) {
  if (!file || !file.name.toLowerCase().endsWith(".bin")) throw new Error("僅允許選擇 .bin 燒錄檔。");
  if (mode === "ble") return validateFirmware(value);
  if (value.length !== IMAGE_SIZE) throw new Error("USB 燒錄請使用完整 4 MB merged.bin；純 app BIN 請選藍牙 OTA。");
  if (value[0] !== 0xe9 || value[12] !== 5 || value[13] !== 0) throw new Error("完整映像必須是 ESP32-C3 韌體。");
  return value;
}
async function selectFile(file) {
  const token = ++selection;
  firmwareFile = null; firmwareBytes = null;
  elements.dropZone.classList.remove("valid", "invalid");
  elements.fileName.textContent = file?.name || "選擇 BIN"; elements.fileMeta.textContent = "正在檢查檔案";
  updateControls();
  try {
    if (!file || !file.name.toLowerCase().endsWith(".bin")) throw new Error("僅允許選擇 .bin 燒錄檔。");
    const value = new Uint8Array(await file.arrayBuffer());
    if (token !== selection) return;
    checkFile(file, value); firmwareFile = file; firmwareBytes = value;
    elements.dropZone.classList.add("valid");
    elements.fileMeta.textContent = file.size.toLocaleString() + " bytes / " + (mode === "ble" ? "OTA 映像檢查通過" : "完整映像檢查通過");
    appendLog("已載入 " + file.name + "。"); setStatus("檔案就緒", "success");
  } catch (error) {
    if (token !== selection) return;
    elements.dropZone.classList.add("invalid"); elements.fileMeta.textContent = error.message;
    appendLog("檔案錯誤：" + error.message); setStatus("檔案錯誤", "error");
  }
  updateControls();
}
function changeMode(next) {
  if (busy) return;
  const file = firmwareFile || elements.input.files[0];
  mode = next; resetStages(); setProgress(0, "等待操作");
  elements.modeUsb.setAttribute("aria-pressed", String(mode === "usb"));
  elements.modeBle.setAttribute("aria-pressed", String(mode === "ble"));
  elements.fileHeading.textContent = mode === "ble" ? "選擇 OTA 韌體" : "選擇完整映像";
  elements.modeHint.textContent = mode === "ble"
    ? "裝置需先安裝 V1.2。選擇純 app BIN，更新會保留設定與歷史紀錄。"
    : "選擇完整 4 MB merged.bin。此方式會清除設定與歷史紀錄。";
  const copy = mode === "ble" ? [
    ["連接藍牙裝置", "請解除裝載並等待量測結束"],
    ["準備 OTA", "確認裝置與韌體相容"],
    ["傳送韌體", "依裝置確認的資料更新進度"],
    ["校驗並重啟", "校驗成功後才顯示 100%"],
  ] : [
    ["連接裝置", "偵測 ESP32-C3"],
    ["擦除 Flash", "清除完整 4 MB 空間"],
    ["寫入映像", "起始位址 0x000000"],
    ["校驗並重啟", "確認資料完整性"],
  ];
  elements.stages.forEach((stage, i) => {
    stage.querySelector("strong").textContent = copy[i][0]; stage.querySelector("small").textContent = copy[i][1];
  });
  setStatus("待命");
  if (file) void selectFile(file); else updateControls();
}
function checkCancel() { if (controller?.signal.aborted) throw new DOMException("已取消更新。", "AbortError"); }
function md5(value) {
  if (!window.CryptoJS) throw new Error("校驗套件載入失敗，請重新整理網頁。");
  const hex = window.CryptoJS.MD5(window.CryptoJS.lib.WordArray.create(value)).toString();
  return Uint8Array.from(hex.match(/../g), part => parseInt(part, 16));
}
async function disconnectUsb() {
  if (!transport) return;
  try { await transport.disconnect(); } catch (error) { appendLog("序列埠中斷：" + (error.message || error)); }
  finally { transport = null; }
}
const terminal = {
  clean() { elements.log.textContent = ""; },
  writeLine: appendLog,
  write(data) { const text = String(data).trimEnd(); if (text) appendLog(text); },
};
async function flashUsb() {
  checkCancel();
  const { ESPLoader, Transport } = await import("https://unpkg.com/esptool-js@0.5.7/bundle.js");
  checkCancel(); setStage(0); appendLog("請選擇 ESP32-C3 的序列埠。");
  const port = await navigator.serial.requestPort({}); checkCancel();
  transport = new Transport(port, true);
  const loader = new ESPLoader({ transport, baudrate: BAUD_RATE, terminal, debugLogging: false });
  const chip = await loader.main(); checkCancel();
  if (!String(chip).toUpperCase().includes("ESP32-C3")) throw new Error("晶片型號不符，只允許 ESP32-C3。");
  setStage(1); setProgress(1, "準備完整映像");
  const chunks = [];
  for (let offset = 0; offset < firmwareBytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...firmwareBytes.subarray(offset, offset + 32768)));
  }
  const data = chunks.join("");
  checkCancel(); setStage(2); appendLog("開始擦除完整 Flash 並從 0x000000 寫入。");
  if (!window.CryptoJS) throw new Error("校驗套件載入失敗，請重新整理網頁。");
  await loader.writeFlash({
    fileArray: [{ data, address: FLASH_ADDRESS }], flashSize: "4MB",
    flashMode: "keep", flashFreq: "keep", eraseAll: true, compress: true,
    reportProgress: (_index, written, total) => {
      if (controller.signal.aborted) return;
      const raw = total > 0 ? written * 100 / total : 0;
      verifying = written >= total; updateControls();
      setProgress(Math.min(raw, 99), verifying ? "正在校驗 Flash" : "正在寫入 Flash");
    },
    calculateMD5Hash: image => window.CryptoJS.MD5(window.CryptoJS.enc.Latin1.parse(image)).toString(),
  });
  checkCancel(); setStage(3); setProgress(100, "校驗完成，重新啟動");
  await loader.after("hard_reset"); completed = true; setStatus("燒錄完成", "success");
  appendLog("寫入及校驗完成，裝置已重新啟動。");
}
function deviceDisconnected() {
  client?.disconnected();
  if (!completed) appendLog("藍牙已斷線；尚未取得校驗成功確認的更新，請重新連線確認。");
}
async function flashBle() {
  checkCancel(); setStage(0); appendLog("請選擇 BRD 裝置。V1.1 請先以 USB 安裝 V1.2。");
  // [保留] 裝置廣播既有服務；以 optionalServices 授權存取新增的 OTA 服務。
  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [UUIDS.discovery], namePrefix: "BEYBLADE_TOOL_BRD_" }],
    optionalServices: [UUIDS.service],
  });
  checkCancel(); device.addEventListener("gattserverdisconnected", deviceDisconnected);
  const server = await device.gatt.connect(); checkCancel();
  let service;
  try { service = await server.getPrimaryService(UUIDS.service); }
  catch { throw new Error("此裝置尚未支援 BRD BLE OTA，請先以 USB 安裝 V1.2。"); }
  const control = await service.getCharacteristic(UUIDS.control);
  const data = await service.getCharacteristic(UUIDS.data);
  const status = await service.getCharacteristic(UUIDS.status); checkCancel();
  client = new OtaClient({ control, data, status });
  const info = await client.initialize(); checkCancel();
  validateFirmware(firmwareBytes, info.capacity);
  appendLog("已連接 " + (device.name || "BRD") + "。");
  await client.transfer(firmwareBytes, md5(firmwareBytes), {
    signal: controller.signal,
    onStage(stage) {
      if (stage === "prepare") { setStage(1); setProgress(0, "準備 OTA"); }
      if (stage === "write") { setStage(2); }
      if (stage === "verify") { verifying = true; setStage(3); setProgress(99, "正在校驗韌體"); updateControls(); }
      if (stage === "done") { completed = true; setProgress(100, "校驗完成，裝置即將重新啟動"); }
    },
    onProgress(percent, accepted, total) {
      setProgress(percent, percent === 100 ? "校驗完成，裝置即將重新啟動" : "已確認 " + accepted.toLocaleString() + " / " + total.toLocaleString() + " bytes");
    },
    onRetry(attempt) { appendLog("裝置回覆逾時，重傳第 " + attempt + " 次。"); },
  });
  setStatus("更新完成", "success");
  appendLog("裝置確認校驗成功。設定與歷史紀錄保留，約 5 秒後重新啟動。");
}
async function flashFirmware() {
  if (busy || !firmwareFile || !firmwareBytes || !supported()) return;
  busy = true; verifying = false; completed = false; controller = new AbortController();
  resetStages(); setProgress(0, "準備連線"); setStatus("處理中", "busy"); updateControls();
  try {
    checkFile(firmwareFile, firmwareBytes);
    if (mode === "ble") await flashBle(); else await flashUsb();
    elements.stages.forEach(stage => { stage.classList.add("done"); stage.classList.remove("active"); });
  } catch (error) {
    if (error.name === "AbortError") { setStatus("已取消", "idle"); appendLog("更新已取消。"); }
    else { setStatus("更新失敗", "error"); appendLog("更新失敗：" + (error.message || error)); }
  } finally {
    await disconnectUsb();
    if (client) { client.dispose(); client = null; }
    if (device) { device.removeEventListener("gattserverdisconnected", deviceDisconnected); if (device.gatt.connected) device.gatt.disconnect(); device = null; }
    busy = false; verifying = false; controller = null; updateControls();
  }
}
elements.input.addEventListener("change", event => { if (!busy) void selectFile(event.target.files[0]); });
elements.modeUsb.addEventListener("click", () => changeMode("usb"));
elements.modeBle.addEventListener("click", () => changeMode("ble"));
elements.flashButton.addEventListener("click", flashFirmware);
elements.disconnectButton.addEventListener("click", async () => {
  if (!busy || verifying) return;
  controller.abort(); elements.disconnectButton.disabled = true;
  appendLog("正在取消更新，等待目前操作結束。");
  if (mode === "usb") await disconnectUsb();
});
elements.clearLog.addEventListener("click", () => { elements.log.textContent = "紀錄已清除。"; });
for (const name of ["dragenter", "dragover"]) elements.dropZone.addEventListener(name, event => {
  event.preventDefault(); if (!busy) elements.dropZone.classList.add("dragging");
});
for (const name of ["dragleave", "drop"]) elements.dropZone.addEventListener(name, event => {
  event.preventDefault(); elements.dropZone.classList.remove("dragging");
});
elements.dropZone.addEventListener("drop", event => { if (!busy) void selectFile(event.dataTransfer.files[0]); });
/* [V1.2 手機修正 修改] 有 BLE、無 Serial 的手機直接顯示可用的 OTA 操作。 */
changeMode(supported("ble") && !supported("usb") ? "ble" : "usb");
