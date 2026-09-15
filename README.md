# BRD Flash Download Tool

## 固定燒錄設定

- Target：ESP32-C3
- Start Address：0x000000
- Flash Size：4 MB
- Baud Rate：460800
- Erase All：YES
- 寫入進度最高 99%，校驗完成後才顯示 100%

## 資料夾結構

BRD_Flash_Download_Tool/
├── index.html
├── app.js
├── style.css
├── README.md
└── firmware/
    ├── firmware-list.json
    └── README.txt

## 加入預設 BIN

1. 將 .bin 放入 firmware/。
2. 編輯 firmware/firmware-list.json。
3. 每個韌體加入 name 與 path。

範例：

[
  {
    "name": "BRD V1.16",
    "path": "firmware/BRD_V1.16.bin"
  }
]

重新部署網站後，下拉選單即可選擇。

## 本機 BIN

使用者也可以使用頁面的「從電腦選擇 .bin」直接選擇自己的 BIN。

## 燒錄位置

所有韌體固定從：

0x000000

開始寫入。

不提供使用者修改 Address。

## 注意

燒錄流程會執行整顆 Flash erase。
