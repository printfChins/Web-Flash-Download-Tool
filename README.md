# BRD Web Flash Download Tool

BRD 裝置韌體線上燒錄工具，可透過瀏覽器選擇韌體檔案並寫入裝置。

## V1.2 藍牙 OTA

[V1.2 新增] 網站提供 USB 燒錄 / 藍牙 OTA 切換，保持共用 BIN 上傳區。裝置端需先安裝 BRD BPX V1.2。

| 更新方式 | 選擇的檔案 | 設定與歷史 |
|---|---|---|
| USB 燒錄 | 完整 4 MB `BRD_BPX.ino.merged.bin` | 沿用完整擦除流程，會清除 |
| 藍牙 OTA | 純 app `BRD_BPX.ino.bin` | 僅寫備用 app 分區，保留 |

第一次由 V1.1 安裝 V1.2 必須使用 USB。後續才可選藍牙 OTA：解除裝載、停止轉動、等待最後一筆歷史保存；SOC 至少 20% 或正在充電且電池讀取有效。若已啟用充電關閉 BLE，需先讓 BLE 恢復才能連線。

網頁以 Web Bluetooth 分包傳送，依裝置確認位移更新進度；Notify 遺失先 READ，必要時重傳最後一包。校驗前最多 99%，裝置完成串流及 Flash 讀回 MD5、映像驗證及分區提交後才顯示 100%。裝置約 5 秒後重啟。

傳輸期間可取消；取消會等待目前 GATT 操作完成再送 ABORT。校驗/提交期間取消按鈕停用。斷線後重新連線並從頭更新，不支援跨斷線續傳。

支援環境：電腦 Chrome/Edge、Android Chrome，必須 HTTPS 或 localhost。iPhone/iPad 一般瀏覽器需要另以原生 BLE App 支援。

協議及 UUID 見 [OTA_PROTOCOL.md](OTA_PROTOCOL.md)。不更動現有裝置的 BBP 廣播 UUID，透過 optionalServices 取得獨立 OTA 服務。

## 開發驗證

`npm test`：十項原生 Node 協議測試。`npm run check`：JavaScript 語法檢查。無執行期 npm 套件安裝需求。

`node tests/ui-smoke.mjs`：選配 Playwright 桌面/手機版面及 BLE/USB 操作測試，需要安裝 Playwright 與 Chromium。本交付環境有 Playwright 但無瀏覽器，該項未完成執行；未進行 ESP32-C3 MCU 編譯或硬體 OTA 實測。

合併至 main 後，既有 deploy-pages.yml 將 dist 部署至 GitHub Pages；草稿 PR 不會發布網站。

## 線上燒錄工具

[開啟 BRD Web Flash Download Tool](https://printfchins.github.io/Web-Flash-Download-Tool/)

## 韌體更新檔下載

- [Google Drive](https://drive.google.com/drive/u/2/folders/1df_d3WwyNwN_5a1xjOPlaxv0U6i8O7o6)
- [GitHub](https://github.com/printfChins/Beyblade-RPM-Detector-Device/tree/main/update%20file)

---

## 使用方式

### 參考文章

-[Threads](https://www.threads.com/share/BAaVu8yc1i/)

### 1. 使用數據線連接裝置於電腦

!!! 請注意需使用數據線，而非充電線 !!!

### 2. 選擇燒錄檔並點擊燒錄

選擇要更新的韌體檔案後，點擊燒錄按鈕開始操作。

<p align="center">
  <img width="631" height="277" alt="選擇燒錄檔並開始燒錄" src="https://github.com/user-attachments/assets/0d7b90b8-9a98-4f4d-8d89-85aa5e7e2ad7" />
</p>

### 3. 選擇 COM Port

在瀏覽器跳出的連接視窗中，選擇：

`USB JTAG/Serial debug unit`

<p align="center">
  <img width="479" height="472" alt="選擇 USB JTAG Serial Debug Unit COM Port" src="https://github.com/user-attachments/assets/0978bc90-d744-4bbe-986b-a27c690e1ca5" />
</p>

### 4. 等待燒錄完成

等待燒錄進度完成，畫面顯示 **100%** 即完成韌體燒錄。

<p align="center">
  <img width="590" height="451" alt="燒錄完成顯示 100%" src="https://github.com/user-attachments/assets/7b7cb53e-86a8-4bf8-b3a0-f0c09e3a4de8" />
</p>
