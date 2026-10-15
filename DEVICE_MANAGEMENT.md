# BRD Flash Download Tool — BLE 裝置管理

**整合基準**

- 網頁：`Web-Flash-Download-Tool(2).zip`（原 USB 完整燒錄 / BLE OTA 保留）
- 韌體：`BRD_BPX_IR_TEST_V1.2.zip`（保留現有 BBP、Settings 和 IR TEST 協議）
- 網頁不會變更韌體、Bootloader、NVS 佈局或 UUID；無須為此網頁更新韌體。

## 導覽

網站 `dist/index.html` 包含三個模式：

1. USB 燒錄：**原版完整 4 MB merged.bin、從 0x000000 擦寫**，不變。
2. 藍牙 OTA：**原版純 App BIN、保留設定與紀錄**，不變。
3. 裝置管理：用瀏覽器 Web Bluetooth 連線 BRD，讀寫設定、IR TEST 切頁、檢視資料。

> 本次未把 USB 燒錄轉換為 App-only；原版仍會擦除 Flash。若要達成 USB App-only，必須另行完成分割區位址和啟動映像的安全驗證。

## BLE 連線

- 在裝置管理頁選「連接 BLE」，網頁會尋找 `BEYBLADE_TOOL_BRD_XXXX`。
- 廣播的 BBP service：`55c40000-f8eb-11ec-b939-0242ac120002`
- 瀏覽器需要 **HTTPS** 或 `localhost`，且具有 Web Bluetooth。
- 裝置管理與 OTA 不可共用同時進行的兩個 GATT 連線；離開裝置管理會主動釋放連線。
- Android：推薦 Chrome；Windows：Chrome / Edge；iOS Safari 一般不支援 Web Bluetooth，需另用原生 App。
- 某些 Android 手機可能因系統、裝置限制或權限設定而不支援；實際以 Web Bluetooth 能力檢查結果為準。

## Settings（8-byte C1 請求 / 20-byte C2 回覆）

| 選項 | ID | 值 | 說明 |
|---|---|---|---|
| 量測模式 | `01` | `0=LOAD`, `1=AUTO` | 儲存到 NVS |
| AUTO 最低 RPM | `02` | `1..59999` | 儲存到 NVS |
| 結束百分比 | `03` | `1..100` | 儲存到 NVS |
| 充電關閉 BLE | `04` | `0=關閉此功能`, `1=啟用` | 儲存到 NVS |

- Settings Service：`c7570001-9040-4c7b-87b1-086ef858ace7`
- Request：`c7570002-9040-4c7b-87b1-086ef858ace7`（Write With Response）
- Response：`c7570003-9040-4c7b-87b1-086ef858ace7`（Read、Notify）
- 網頁先 GET，使用者修改表單後按「儲存至裝置」。修改的值依序 SET，最後發 SAVE；等 `SAVED` 確認才顯示成功。
- 修改中、量測中或不安全窗口可能得到 `BUSY`；不會因此自動寫入 Flash。
- 「表單恢復預設」只修改網頁欄位；不會立即清除裝置設定，需按 SAVE 才寫入。
- 充電時如果保存「關閉 BLE」=1，韌體可能主動斷線；應先中止充電再連線讀取，避免重複保存。

## OLED 頁面（獨立 1-byte RAM Characteristic）

- Page：`c7570004-9040-4c7b-87b1-086ef858ace7`（Read / Write With Response）。
- `00`：MAIN；`01`：IR TEST。
- 即時切換、**不需 SAVE、不寫 Flash**；BLE 斷線即恢復 MAIN。
- 此 Feature 需已安裝先前交付的 **BRD_BPX_IR_TEST_V1.2** 韌體；原版 V1.2 若沒有此特徵，裝置管理會顯示不支援。

## BBP 資料檢視

- Characteristic：`55c4f002-f8eb-11ec-b939-0242ac120002`（Notify + Write）。
- 透過 `0x51` 要求 A0 狀態；`0x74` 要求 B0..B7 與 70..73（共 12 頁）。
- A0 顯示 LOAD 旗標、估算電量百分比、最高 SP、總次數的**低 16 位**。
- 歷史紀錄最多 50 筆，以最新優先顯示，資料來源原本儲存的 SP 代表值。
- 曲線：最近一輪最新 32 點周期資料中的有效點。來源是原始 period/8 量化值，圖表依 `7500000/raw` 換算 RPM；取樣點並非固定時間間隔，**不標記時間軸**。
- 只接受依序完整的 12 頁快照，檢查 B7 checksum；不會拼接不同輪的封包。
- 可以把歷史匯出成 UTF-8 BOM CSV。

**可用性限制：** 現有韌體沒有專屬的 BLE 即時 RPM、IR1/IR2 即時數位狀態或實際電池電壓 Notify。因此網頁不會捏造這些欄位；如需瀏覽器實時監控，應另行擴充韌體唯讀 characteristic。

## 目錄與部署

```text
Web-Flash-Download-Tool/
├── dist/
│   ├── index.html                    # [修改] 三種模式、裝置設定與資料檢視
│   ├── styles.css                    # [修改] 延續原風格和行動版直式布局
│   ├── app.js                        # [修改] 導覽切換、BLE 與 OTA 互斥
│   ├── ota-protocol.js               # [保留] 原 OTA 協議
│   ├── brd-device-protocol.js        # [新增] 設定/BBP 編解碼及 CSV
│   ├── device-manager.js             # [新增] BLE 連線/設定/歷史/曲線 UI
│   └── vendor/
├── tests/
│   ├── ota.test.mjs                  # [保留] 原 OTA 測試
│   └── device-protocol.test.mjs      # [新增] 設定及資料協議測試
├── package.json                     # [修改] 補齊 JS check
└── DEVICE_MANAGEMENT.md             # [新增] 本說明文件
```

使用原 GitHub Pages 工作流程推送 `main` 分支即可部署 `dist/` 內容；不需要 npm build。請清除網站快取或強制更新頁面，才能載入新 JS/CSS。

## 驗證

- 已通過 Node.js 原有 OTA 15 項與新增協議 6 項測試（21 項）。
- 使用無網路 mock 模擬 Web Bluetooth、8-byte Settings / 20-byte Response / 12 頁 BBP Notify，完成 GET/SET/SAVE/切頁/曲線/資料刷新測試；已檢視 1280、390、320 px 版面。
- **尚未使用 ESP32-C3 實機 BLE 連線驗證**；GitHub Pages 上線前建議實測連線、裝載期間 BUSY、低電/充電時斷線及 CSV 匯出。

**舊版相容**：沒有 Display Page Characteristic 的舊版韌體仍可讀取設定及 BBP 資料，僅停用「OLED 頁面」區塊；不會因此拒絕整條 BLE 連線。
