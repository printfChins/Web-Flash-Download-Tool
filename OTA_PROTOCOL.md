# BRD BPX BLE OTA 協議 V1

[V1.2 新增] 對應 BRD BPX V1.2 的自訂 OTA，供網頁或後續原生 App 使用。

| 用途 | UUID | 屬性 |
|---|---|---|
| Service | c7570010-9040-4c7b-87b1-086ef858ace7 | OTA |
| Control | c7570011-9040-4c7b-87b1-086ef858ace7 | Write |
| Data | c7570012-9040-4c7b-87b1-086ef858ace7 | Write / Write without response |
| Status | c7570013-9040-4c7b-87b1-086ef858ace7 | Read / Notify |

裝置仍廣播既有 55c40000-f8eb-11ec-b939-0242ac120002，以名稱 BEYBLADE_TOOL_BRD_XXXX 辨識；網頁 requestDevice 必須將 OTA Service 放入 optionalServices。

所有整數均為 little endian。一次一包；收到預期 opcode/id/offset 的成功回覆後才送下一包。

| 命令 | opcode | 完整格式 |
|---|---|---|
| INFO | 1 | opcode、id |
| HASH | 2 | opcode、id、16 bytes MD5 |
| BEGIN | 3 | opcode、id、uint32 BIN 大小 |
| END | 4 | opcode、id |
| ABORT | 5 | opcode、id |
| DATA | 16 | opcode、id、uint32 offset、1..payload_limit bytes |

HASH、BEGIN、DATA、END、ABORT 使用同一個非零 id。控制包最大 20 bytes。Data limit 由裝置回報，為 min(240, negotiated_MTU - 9)；MTU=23 時是 14 bytes。不得假設網頁可以控制 MTU。

| Status byte | 內容 |
|---|---|
| 0 | 回覆命令 opcode |
| 1 | id |
| 2 | result |
| 3 | phase |
| 4..7 | 已接受 offset |
| 8..11 | total |
| 12..15 | 備用 app 分區容量 |
| 16..17 | payload_limit |
| 18 | flags：bit0 充電、bit1 電源允許、bit2 啟動窗口允許 |
| 19 | protocol_version=1 |

Phase：0 IDLE、1 RECEIVING、2 COMPLETE、3 ERROR。

Result：0 OK、1 BAD_LENGTH、2 BUSY、3 POWER、4 SIZE、5 SESSION、6 OFFSET、7 IMAGE、8 WRITE、9 VERIFY、10 TIMEOUT、11 BAD_COMMAND。

重送必須為完全相同的最後一包，裝置不重複寫入。END 可重送且不重複提交。COMPLETE 後 ABORT 回 BUSY，因為開機分區已切換。

純 app BIN 需 ESP32-C3 chip_id=5、ESP app description magic=0xABCD5432、BRD_BPX_OTA_IMAGE_V1_C3 標記，且大小不超過備用分區。MD5 與標記不是發布者簽章。

OTA 啟動前最後一筆歷史必須發布並成功保存；OTA 期間暫停 GPIO 量測與 NVS 保存。驗證時讀回 Flash 比較 MD5，並在切換分區的原子提交檢查確認連線世代。提交檢查前斷線會中止；提交已開始則不能取消。15 秒無有效傳輸中止，成功後約 5 秒重啟。
