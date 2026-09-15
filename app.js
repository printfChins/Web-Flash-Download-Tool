import {
  ESPLoader,
  Transport
} from "https://unpkg.com/esptool-js/lib/index.js";

/*
 * BRD Flash Download Tool
 *
 * [固定] Target chip: ESP32-C3
 * [固定] Flash start address: 0x000000
 * [固定] Flash size option: 4MB
 * [新增] firmware/ 資料夾下拉選擇
 * [新增] 本機 .bin 上傳
 * [刪除] 4,194,304 bytes 強制檔案大小限制
 * [修改] 寫入階段最高 99%，writeFlash() 完成後才顯示 100%
 */

const TARGET_CHIP = "ESP32-C3";
const FLASH_ADDRESS = 0x000000;
const BAUD_RATE = 460800;

const firmwareSelect = document.getElementById("firmwareSelect");
const firmwareFile = document.getElementById("firmwareFile");
const fileInfo = document.getElementById("fileInfo");
const connectBtn = document.getElementById("connectBtn");
const flashBtn = document.getElementById("flashBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const clearLogBtn = document.getElementById("clearLogBtn");
const statusText = document.getElementById("statusText");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const consoleOutput = document.getElementById("consoleOutput");

let port = null;
let transport = null;
let loader = null;
let connectedChip = "";
let selectedFirmware = null;
let selectedFirmwareName = "";

function log(message) {
  const time = new Date().toLocaleTimeString();
  consoleOutput.textContent += `[${time}] ${message}\n`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setProgress(value) {
  const safeValue = Math.max(0, Math.min(100, value));
  progressBar.value = safeValue;
  progressText.textContent = `${safeValue.toFixed(1)}%`;
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString()} bytes`;
}

function updateFlashButton() {
  const chipValid = connectedChip.toUpperCase().includes(TARGET_CHIP);
  flashBtn.disabled = !(selectedFirmware && chipValid && loader);
}

async function loadFirmwareCatalog() {
  try {
    const response = await fetch("./firmware/firmware-list.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const list = await response.json();

    for (const item of list) {
      if (!item.name || !item.path) {
        continue;
      }

      const option = document.createElement("option");
      option.value = item.path;
      option.textContent = item.name;
      firmwareSelect.appendChild(option);
    }

    if (list.length > 0) {
      log(`[Firmware] 已載入 ${list.length} 個預設韌體。`);
    }
  } catch (error) {
    log(`[Firmware] 無法讀取 firmware-list.json：${error.message}`);
  }
}

firmwareSelect.addEventListener("change", async () => {
  if (!firmwareSelect.value) {
    selectedFirmware = null;
    selectedFirmwareName = "";
    fileInfo.textContent = "尚未選擇韌體";
    updateFlashButton();
    return;
  }

  try {
    setStatus("讀取預設韌體");
    const response = await fetch(firmwareSelect.value, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`無法下載韌體：HTTP ${response.status}`);
    }

    selectedFirmware = new Uint8Array(await response.arrayBuffer());
    selectedFirmwareName =
      firmwareSelect.options[firmwareSelect.selectedIndex].textContent;

    firmwareFile.value = "";
    fileInfo.textContent =
      `${selectedFirmwareName} | ${formatBytes(selectedFirmware.byteLength)}`;

    log(`[Firmware] 已選擇預設韌體：${selectedFirmwareName}`);
    setStatus(loader ? `${TARGET_CHIP} 已連接` : "等待連線");
  } catch (error) {
    selectedFirmware = null;
    selectedFirmwareName = "";
    fileInfo.textContent = "韌體讀取失敗";
    setStatus("韌體讀取失敗");
    log(`[ERROR] ${error.message}`);
  }

  updateFlashButton();
});

firmwareFile.addEventListener("change", async () => {
  const file = firmwareFile.files?.[0] ?? null;

  if (!file) {
    selectedFirmware = null;
    selectedFirmwareName = "";
    fileInfo.textContent = "尚未選擇韌體";
    updateFlashButton();
    return;
  }

  selectedFirmware = new Uint8Array(await file.arrayBuffer());
  selectedFirmwareName = file.name;
  firmwareSelect.value = "";

  fileInfo.textContent =
    `${file.name} | ${formatBytes(selectedFirmware.byteLength)}`;

  log(`[Firmware] 已從電腦選擇：${file.name}`);
  updateFlashButton();
});

connectBtn.addEventListener("click", async () => {
  connectBtn.disabled = true;
  setProgress(0);

  try {
    if (!("serial" in navigator)) {
      throw new Error("目前瀏覽器不支援 Web Serial。");
    }

    setStatus("選擇 USB 裝置");
    port = await navigator.serial.requestPort();

    transport = new Transport(port, true);

    const terminal = {
      clean() {
        consoleOutput.textContent = "";
      },
      writeLine(data) {
        log(data);
      },
      write(data) {
        if (data !== undefined && data !== null && String(data).length > 0) {
          log(String(data));
        }
      }
    };

    loader = new ESPLoader({
      transport,
      baudrate: BAUD_RATE,
      terminal,
      debugLogging: false
    });

    setStatus("偵測 ESP 晶片");
    connectedChip = await loader.main();
    log(`[晶片] ${connectedChip}`);

    if (!connectedChip.toUpperCase().includes(TARGET_CHIP)) {
      throw new Error(
        `晶片不符：偵測到 ${connectedChip}，本工具只允許 ${TARGET_CHIP}。`
      );
    }

    setStatus(`${TARGET_CHIP} 已連接`);
    log(`[OK] 已確認目標晶片為 ${TARGET_CHIP}。`);
    disconnectBtn.disabled = false;
    updateFlashButton();
  } catch (error) {
    setStatus("連線失敗");
    log(`[ERROR] ${error?.message ?? error}`);

    try {
      if (transport) {
        await transport.disconnect();
      }
    } catch (_) {
    }

    port = null;
    transport = null;
    loader = null;
    connectedChip = "";
    disconnectBtn.disabled = true;
    updateFlashButton();
  } finally {
    connectBtn.disabled = false;
  }
});

flashBtn.addEventListener("click", async () => {
  if (!loader || !selectedFirmware) {
    return;
  }

  if (!connectedChip.toUpperCase().includes(TARGET_CHIP)) {
    log("[拒絕] 目前連線晶片不是 ESP32-C3。");
    return;
  }

  flashBtn.disabled = true;
  connectBtn.disabled = true;
  firmwareFile.disabled = true;
  firmwareSelect.disabled = true;
  setProgress(0);

  try {
    log("------------------------------------------------");
    log(`[開始] ${selectedFirmwareName}`);
    log(`[固定] Address = 0x${FLASH_ADDRESS.toString(16).padStart(6, "0")}`);
    log(`[Firmware] Size = ${formatBytes(selectedFirmware.byteLength)}`);
    log("[固定] Flash Size = 4MB");
    log("[固定] Erase entire flash = YES");
    log("------------------------------------------------");

    setStatus("清除 Flash 並燒錄中");

    await loader.writeFlash({
      fileArray: [
        {
          data: selectedFirmware,
          address: FLASH_ADDRESS
        }
      ],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "4MB",
      eraseAll: true,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        const rawPercent = total > 0 ? (written / total) * 100 : 0;
        setProgress(Math.min(rawPercent, 99));

        if (written >= total && total > 0) {
          setStatus("正在校驗 Flash");
        }
      }
    });

    setProgress(100);
    setStatus("燒錄完成");
    log("[PASS] Flash 寫入及校驗完成，進度 100%。");

    await loader.after("hard_reset");
    log("[RESET] ESP32-C3 已重啟。");
  } catch (error) {
    setStatus("燒錄失敗");
    log(`[FAIL] ${error?.message ?? error}`);
  } finally {
    firmwareFile.disabled = false;
    firmwareSelect.disabled = false;
    connectBtn.disabled = false;
    updateFlashButton();
  }
});

disconnectBtn.addEventListener("click", async () => {
  try {
    if (transport) {
      await transport.disconnect();
    }
    log("[USB] 已中斷連線。");
  } catch (error) {
    log(`[ERROR] 中斷連線失敗：${error?.message ?? error}`);
  } finally {
    port = null;
    transport = null;
    loader = null;
    connectedChip = "";
    disconnectBtn.disabled = true;
    setStatus("等待連線");
    setProgress(0);
    updateFlashButton();
  }
});

clearLogBtn.addEventListener("click", () => {
  consoleOutput.textContent = "";
});

window.addEventListener("load", async () => {
  log("[READY] BRD Flash Download Tool");
  log("[設定] ESP32-C3 / 0x000000 / 4MB Flash");
  await loadFirmwareCatalog();
});
