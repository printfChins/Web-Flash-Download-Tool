# V1.2 手機網頁修正

/* [新增] 本文件說明手機版操作修正。檔案位置：專案根目錄。 */

本次修正以 `printfChins/Web-Flash-Download-Tool` 的網頁程式為基礎。

- [修改] CryptoJS 4.2.0 隨 `dist/vendor/` 提供。手機操作介面不再等待外部 CDN 下載校驗套件。
- [修改] 原生檔案輸入框涵蓋整個上傳區，可直接接收手機觸控。
- [刪減] 移除檔案選擇器的 `accept` MIME 過濾，避免手機把 MIME 未知的 BIN 設為不可選。程式仍檢查 `.bin` 副檔名、晶片、映像類型及大小。
- [新增] 支援 Bluetooth、但沒有 Serial 的瀏覽器，預設顯示藍牙 OTA。
- [修改] 相容性提示改為操作區內的區塊。模式切換與選檔保持可用，開始更新按鈕會依瀏覽器能力顯示提示。
- [修改] 小螢幕、長檔名與進度文字可換行；模式、選檔、清除紀錄等操作保留足夠觸控範圍。
- [修改] 手機與 1024 像素以下視窗改為直式上下排列：選檔與 OTA 操作在上，燒錄狀態在下。手機橫向與較寬的觸控視窗也使用相同順序。

## 檔案與貼放位置

`dist/index.html`、`dist/app.js`、`dist/styles.css` 為完整修改後的檔案。新增的 `dist/vendor/` 必須一起部署。專案內含完整網站程式、相同的 OTA 協議程式與測試。

請將完整 `dist/` 放回 GitHub 專案的同名資料夾，不要只複製三個修改檔。既有 GitHub Pages 工作流程會部署此資料夾。完成部署後重新整理網頁；HTML 已更新 CSS 與 app.js 的版本參數。

USB 燒錄使用完整 4 MB `merged.bin`。藍牙 OTA 使用純應用程式 `app.bin`，裝置需先安裝支援此協議的 V1.2 韌體。

## 已執行驗證

- 十項 Node OTA 協議測試。
- 十項 Chromium 手機觸控測試，包含外部 CDN 等待、手機預設 OTA、原生選檔器、點擊開始 OTA、長檔名、模式切換與兩區上下順序。
- 手機與觸控視窗尺寸：320 x 280、320 x 568、360 x 640、390 x 844、430 x 932、844 x 390、1024 x 768、1280 x 720。
- 桌面 1280 x 900 仍為左右兩區排列。
- 桌面 BLE/USB 模擬更新至 100%，並比對實際內建校驗套件產生的 MD5。
- JavaScript 語法及 Git 差異格式檢查。

執行方式：`npm ci`、`npx playwright install chromium`、`npm test`、`npm run check`、`npm run test:ui`。

上述手機驗證為 Chromium 的尺寸與觸控模擬。GATT 與 Serial 使用測試替身，尚未進行 Android/iOS 真機或 ESP32-C3 硬體 OTA 實測。

Android Chrome 可使用 Web Bluetooth。iPhone/iPad 一般瀏覽器未提供 Web Bluetooth 時，可操作選檔與模式切換，但無法直接執行 BLE OTA；網頁會依實際 API 能力顯示此限制。
