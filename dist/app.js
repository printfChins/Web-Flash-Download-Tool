import { ESPLoader, Transport } from "https://unpkg.com/esptool-js@0.5.7/bundle.js";

const IMAGE_SIZE = 4 * 1024 * 1024;
const FLASH_ADDRESS = 0x000000;
// [V1.0.1 新增] 移除鮑率選單後固定使用原預設值。
const BAUD_RATE = 460800;

const elements = {
  input: document.querySelector("#firmwareInput"),
  firmwareSelect: document.querySelector("#firmwareSelect"),
  dropZone: document.querySelector("#dropZone"),
  fileName: document.querySelector("#fileName"),
  fileMeta: document.querySelector("#fileMeta"),
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
  stages: [
    document.querySelector("#stageConnect"),
    document.querySelector("#stageErase"),
    document.querySelector("#stageWrite"),
    document.querySelector("#stageVerify"),
  ],
};

let firmwareFile = null;
let transport = null;
let busy = false;

function appendLog(message) {
  const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
  elements.log.textContent += `\n[${time}] ${String(message).trimEnd()}`;
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setStatus(text, state = "idle") {
  elements.statusPill.textContent = text;
  elements.statusPill.dataset.state = state;
}

function setProgress(percent, label) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  elements.progressBar.style.width = `${normalized}%`;
  elements.progressText.textContent = `${normalized.toFixed(0)}%`;
  elements.stageLabel.textContent = label;
}

function setStage(index) {
  elements.stages.forEach((stage, stageIndex) => {
    stage.classList.toggle("active", stageIndex === index);
    stage.classList.toggle("done", stageIndex < index);
  });
}

function resetStages() {
  elements.stages.forEach((stage) => stage.classList.remove("active", "done"));
}

function updateControls() {
  elements.input.disabled = busy;
  if (elements.firmwareSelect) elements.firmwareSelect.disabled = busy;
  elements.flashButton.disabled = busy || !firmwareFile || !("serial" in navigator);
  elements.buttonText.textContent = busy
    ? "燒錄進行中"
    : firmwareFile
      ? "連接並開始燒錄"
      : "請先選擇燒錄檔";
  elements.disconnectButton.hidden = !busy;
}

function validateFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".bin")) {
    throw new Error("僅允許選擇 .bin 燒錄檔。");
  }
}

function selectFile(file) {
  firmwareFile = null;
  elements.dropZone.classList.remove("valid", "invalid");
  try {
    validateFile(file);
    firmwareFile = file;
    elements.dropZone.classList.add("valid");
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${file.size.toLocaleString()} bytes / BIN 格式檢查通過`;
    appendLog(`已載入 ${file.name}，大小 ${file.size.toLocaleString()} bytes。`);
    setStatus("檔案就緒", "success");
  } catch (error) {
    elements.dropZone.classList.add("invalid");
    elements.fileName.textContent = file?.name || "檔案無效";
    elements.fileMeta.textContent = error.message;
    appendLog(`錯誤：${error.message}`);
    setStatus("檔案錯誤", "error");
  }
  updateControls();
}

function readBinaryString(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("無法讀取 BIN 檔。"));
    reader.readAsBinaryString(file);
  });
}

const terminal = {
  clean() {
    elements.log.textContent = "";
  },
  writeLine(data) {
    appendLog(data);
  },
  write(data) {
    const text = String(data).replace(/[\r\n]+$/g, "");
    if (text) appendLog(text);
  },
};

async function disconnect() {
  if (!transport) return;
  try {
    await transport.disconnect();
  } catch (error) {
    appendLog(`中斷連線訊息：${error.message || error}`);
  } finally {
    transport = null;
  }
}

async function flashFirmware() {
  if (busy || !firmwareFile) return;
  if (!window.isSecureContext) {
    setStatus("需要 HTTPS", "error");
    appendLog("錯誤：Web Serial 只能在 HTTPS 或 localhost 中使用。");
    return;
  }

  busy = true;
  resetStages();
  setProgress(0, "準備連線");
  setStatus("處理中", "busy");
  updateControls();

  try {
    validateFile(firmwareFile);
    setStage(0);
    appendLog("請在瀏覽器視窗中選擇 ESP32-C3 的序列埠。");
    const port = await navigator.serial.requestPort({});
    transport = new Transport(port, true);
    const loader = new ESPLoader({
      transport,
      baudrate: BAUD_RATE,
      terminal,
      debugLogging: false,
    });

    const chip = await loader.main();
    appendLog(`偵測到晶片：${chip}`);
    if (!String(chip).toUpperCase().includes("ESP32-C3")) {
      throw new Error(`晶片型號不符：偵測到 ${chip}，僅允許 ESP32-C3。`);
    }

    setStage(1);
    setProgress(1, "讀取 4096 KB 映像");
    const data = await readBinaryString(firmwareFile);

    setStage(2);
    appendLog("開始擦除完整 Flash 並從 0x000000 寫入。");
    await loader.writeFlash({
      fileArray: [{ data, address: FLASH_ADDRESS }],
      flashSize: "4MB",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: true,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        const rawPercent = total > 0 ? (written / total) * 100 : 0;
        const displayPercent = Math.min(rawPercent, 99);
        setProgress(displayPercent, written >= total ? "正在校驗 Flash" : "正在寫入 Flash");
      },
      calculateMD5Hash: (image) => window.CryptoJS.MD5(
        window.CryptoJS.enc.Latin1.parse(image)
      ).toString(),
    });

    setStage(3);
    setProgress(100, "校驗完成，重新啟動");
    appendLog("寫入及雜湊校驗完成，正在重新啟動 ESP32-C3。");
    await loader.after("hard_reset");
    await disconnect();
    elements.stages.forEach((stage) => stage.classList.add("done"));
    elements.stages.forEach((stage) => stage.classList.remove("active"));
    setStatus("燒錄完成", "success");
    appendLog("燒錄成功。裝置已重新啟動。");
  } catch (error) {
    await disconnect();
    setStatus("燒錄失敗", "error");
    appendLog(`燒錄失敗：${error.message || error}`);
  } finally {
    busy = false;
    updateControls();
  }
}

elements.input.addEventListener("change", (event) => selectFile(event.target.files[0]));
elements.flashButton.addEventListener("click", flashFirmware);
elements.disconnectButton.addEventListener("click", async () => {
  await disconnect();
  busy = false;
  setStatus("已中斷", "idle");
  appendLog("使用者已中斷序列埠連線。");
  updateControls();
});
elements.clearLog.addEventListener("click", () => {
  elements.log.textContent = "紀錄已清除。";
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!busy) elements.dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => {
  if (!busy) selectFile(event.dataTransfer.files[0]);
});

if (!("serial" in navigator)) {
  elements.warning.hidden = false;
  setStatus("瀏覽器不支援", "error");
  appendLog("目前瀏覽器不支援 Web Serial API。請使用桌面版 Chrome 或 Edge。");
}
updateControls();


/*
 * [新增] BRD 內建 Firmware 下拉選單。
 * 內建 BIN 與使用者上傳 BIN 共用 selectFile() / flashFirmware() 流程。
 */
async function loadBuiltinFirmwareList() {
  if (!elements.firmwareSelect) return;

  try {
    const response = await fetch("./firmware/firmware-list.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const list = await response.json();
    for (const item of list) {
      if (!item.name || !item.path) continue;

      const option = document.createElement("option");
      option.value = item.path;
      option.textContent = item.name;
      elements.firmwareSelect.appendChild(option);
    }

    if (list.length > 0) {
      appendLog(`已載入 ${list.length} 個內建 Firmware 選項。`);
    }
  } catch (error) {
    appendLog(`內建 Firmware 清單讀取失敗：${error.message || error}`);
  }
}

if (elements.firmwareSelect) {
  elements.firmwareSelect.addEventListener("change", async () => {
    if (!elements.firmwareSelect.value) return;

    try {
      const response = await fetch(elements.firmwareSelect.value, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const optionText =
        elements.firmwareSelect.options[elements.firmwareSelect.selectedIndex].textContent ||
        "firmware.bin";
      const fileName = optionText.toLowerCase().endsWith(".bin")
        ? optionText
        : `${optionText}.bin`;

      const file = new File([blob], fileName, { type: "application/octet-stream" });
      elements.input.value = "";
      selectFile(file);
    } catch (error) {
      appendLog(`內建 Firmware 載入失敗：${error.message || error}`);
      setStatus("Firmware 錯誤", "error");
    }
  });
}

/* [新增] 使用本機上傳時，取消內建 Firmware 的選取狀態。 */
elements.input.addEventListener("click", () => {
  if (elements.firmwareSelect) elements.firmwareSelect.value = "";
});

loadBuiltinFirmwareList();
