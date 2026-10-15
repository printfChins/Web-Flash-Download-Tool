# 裝置管理介面：移除 DEVICE LOG

基準版本：`Web-Flash-Download-Tool_BLE_Manager_V1.2.zip`

## [刪減]

- `dist/index.html`：移除裝置管理頁底部的 `DEVICE LOG` 標題與 `#deviceLog` `<pre>` 內容；保留燒錄頁 `FLASH LOG`。
- `dist/styles.css`：移除僅供 `DEVICE LOG` 使用的 `.device-terminal` 樣式。
- `dist/device-manager.js`：刪除 `#deviceLog` DOM 引用與對該區塊的文字追加、捲動處理。

## [修改]

- `dist/device-manager.js`：將偵錯記錄改輸出至瀏覽器開發者工具 Console；操作錯誤保留在原本的紅色 `deviceWarning` 訊息區，確保使用者仍能看見失敗原因。
- `dist/index.html`：更新 CSS / JS 版本查詢參數，以降低部署後舊版快取問題。

## [新增]

- `tests/device-log-removed.test.mjs`：確認裝置管理頁不含 DEVICE LOG、保留 FLASH LOG 與原 BLE 操作控制項。

## 未修改

- USB 有線燒錄、BLE OTA、BLE 裝置設定、IR TEST 頁面、BBP 資料檢視及 CSV 匯出流程。
- BRD_BPX 韌體；本次僅修改 Web Flash Tool 網站。

## 驗證

- `npm run check`：通過。
- `npm test`：23/23 通過。
- `npm run test:ui`：此環境缺少 Playwright 套件，無法執行瀏覽器測試；部署前請在安裝相依套件後執行。
