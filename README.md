# ESP32-C3 Web Flash Download Tool

可直接部署至 GitHub Pages 的 ESP32-C3 UART 網頁燒錄工具。

## 固定規格

| 項目 | 設定 |
|---|---|
| 目標晶片 | ESP32-C3 |
| 燒錄檔大小 | 4,194,304 bytes（4096 KB） |
| 寫入起始位址 | 0x000000 |
| Flash Size | 4 MB |
| 燒錄流程 | 連線、整顆擦除、寫入、雜湊校驗、重啟 |

## 專案結構

```text
ESP32C3_Web_Flash_Download_Tool/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── .openai/
│   └── hosting.json
├── dist/
│   ├── .nojekyll
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## 部署至 GitHub Pages

1. 在 GitHub 建立新的 Repository。
2. 將本專案內的所有檔案推送到 `main` 分支。
3. 進入 Repository 的 `Settings > Pages`。
4. 將 `Source` 設為 `GitHub Actions`。
5. 等待 `Deploy GitHub Pages` 工作流程完成。
6. 使用 GitHub Pages 提供的 HTTPS 網址開啟工具。

## 使用限制

- 必須使用支援 Web Serial 的桌面版 Chrome 或 Microsoft Edge。
- 必須透過 HTTPS 或 localhost 開啟。
- USB UART 必須使用 3.3 V 邏輯準位。
- iPhone 與 iPad 的 Safari 不支援此燒錄方式。
- 燒錄時會清除 ESP32-C3 全部 Flash 資料。

## ESP32-C3 手動進入 Download Mode

若開發板無法自動進入燒錄模式：

1. 按住 BOOT，使 GPIO9 維持 LOW。
2. 短按 RESET。
3. 放開 BOOT。
4. 回到網站重新執行燒錄。
