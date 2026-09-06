# linebot-finance

LINE Bot + Google Apps Script + OpenAI 個人記帳系統

## 功能

- **文字記帳**：透過 LINE 傳送「午餐80」等自然語言，AI 自動解析分類、品項、金額
- **固定格式**：支援「飲食 午餐便當 80」指定分類格式
- **銀行帳單匯入**：貼上銀行帳單文字或傳送 PDF，批次匯入交易紀錄
- **帳戶餘額查詢**：在「帳戶管理」工作表填入初始餘額後，傳送「餘額」即可查詢各帳戶當前餘額
- **動態分類**：在 Google 試算表直接新增分類，不需修改程式碼
- **多幣別**：支援 TWD、USD、JPY 等幣別辨識

## 支援的銀行

| 銀行 | 信用卡 | 帳戶明細 | 證券 |
|------|--------|---------|------|
| 第一銀行 | ✅ | | |
| 永豐銀行 | ✅ | ✅ | ✅（國內+復委託）|
| 玉山銀行 | ✅ | ✅ | |
| 台新銀行 | ✅ | ✅（Richart）| ✅ |
| 富邦銀行 | ✅ | ✅ | |
| 國泰銀行 | ✅ | | |
| LINE Bank | | ✅ | |
| 王道銀行 | | ✅ | |
| 樂天銀行 | | ✅ | |
| 中國信託 | ⚠️ PDF 格式損壞 | ⚠️ | |

## 架構

```
使用者 (LINE App)
    │
    ▼ (Webhook POST)
Google Apps Script (Web App)
    ├── OpenAI API (gpt-4o-mini) — 解析記帳訊息
    ├── Google Sheets — 儲存交易紀錄、帳戶主檔
    ├── Google Drive — PDF OCR 文字擷取
    └── LINE Reply API — 回覆確認訊息
```

## 檔案結構

```
src/
├── Config.gs          # Script Properties 存取、初始化
├── Main.gs            # doPost() 進入點、訊息路由、餘額指令
├── LineService.gs     # LINE API 互動
├── OpenAIService.gs   # OpenAI API 呼叫、Prompt 設計
├── SheetService.gs    # Google 試算表讀寫、餘額計算
└── PdfService.gs      # PDF OCR 文字擷取
openspec/
├── specs/             # 現行規格（text-accounting、pdf-batch-import、
│                      #   dynamic-categories、account-management、balance-query）
└── changes/           # 變更提案（Spectra 規格驅動開發）
```

## 工作表結構

### 交易紀錄

| 日期 | 金融機構 | 帳戶名稱 | 類型 | 分類 | 品項 | 明細描述 | 幣別 | 金額 | 原始訊息 |
|------|---------|---------|------|------|------|---------|------|------|---------|

### 帳戶管理

| 帳戶名稱 | 金融機構 | 幣別 | 初始餘額 | 初始日期 | 備註 | 是否啟用 |
|---------|---------|------|---------|---------|------|---------|

- 執行 `initializeSheets()` 會預填 13 個帳戶（現金、一銀、LineBank、王道、永豐大戶、永豐證券、永豐外幣、玉山、台新、中信、富邦、國泰、樂天），初始餘額與初始日期留空由使用者填入。
- **帳戶名稱**是交易紀錄 C 欄的比對鍵，OpenAI 解析時會從此清單選擇最接近的名稱。
- **初始日期**當天（含）以前的交易不計入，從次日起累計。留空則計入全部交易。
- 分類為「繳信用卡」的交易不計入餘額，避免與匯入的信用卡帳單消費重複扣款。
- 交易列對應帳戶的規則（依序）：C 欄 = 帳戶名稱；C 欄 = 金融機構名稱；C 欄空白且 B 欄 = 金融機構（舊資料）；C 欄與 B 欄皆空白視為現金。比對忽略空白與大小寫。
- 金額欄可為數字或含千分位的字串（如 `1,234`），支出取絕對值。
- 餘額算不對時，在 Apps Script 編輯器執行 `debugAccountBalance('帳戶名稱')`，Logger 會列出每筆交易被排除的原因統計。

## 餘額查詢指令

| 傳送內容 | 回覆 |
|---------|------|
| `餘額`、`查餘額`、`所有餘額`、`帳戶餘額` | 所有啟用帳戶的當前餘額一覽 |
| `永豐大戶餘額` 或 `餘額 永豐大戶` | 單一帳戶：初始餘額、交易調整（筆數）、當前餘額 |
| `帳戶清單`、`帳戶列表` | 所有啟用帳戶名稱與幣別 |

餘額 = 初始餘額 + 收入 − 支出，每次查詢即時計算，不在工作表存快取。

## 分類

**支出（21 項）**：飲食、服飾、家庭、交通、學習、休閒、購物、醫療、其他、保險、手續費、稅金、工作、父母、老婆、買房、紅包、投資、轉帳、貸款、繳信用卡

**收入（10 項）**：薪資、利息、兼職、獎金、回饋、投資獲利、股利、家人給、保險、其他

## 設定步驟

1. 建立 Google 試算表
2. 建立 LINE Official Account + Messaging API Channel
3. 取得 OpenAI API Key
4. 從試算表「擴充功能 → Apps Script」開啟編輯器
5. 建立 6 個 .gs 檔案，貼入 `src/` 下的程式碼
6. 啟用 Drive API 進階服務
7. 設定 Script Properties（OPENAI_API_KEY、LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、SHEET_ID）
8. 執行 `initializeSheets()` 建立工作表結構（已存在的工作表不會被覆蓋）
9. 在「帳戶管理」工作表填入各帳戶的初始餘額與初始日期
10. 部署為 Web App（存取權限：所有人）
11. 在 LINE Developers 設定 Webhook URL

## 本機測試

```bash
npm test
```

`test/balance.test.js` 以 Node 載入 `src/*.gs`，stub 掉 GAS 全域物件後測試餘額計算與指令偵測邏輯。

## 技術

- **後端**：Google Apps Script (JavaScript)
- **AI**：OpenAI gpt-4o-mini（JSON mode）
- **資料庫**：Google Sheets
- **PDF OCR**：Google Drive API
- **前端**：LINE Messaging API

## 授權

MIT License
