# linebot-finance

LINE Bot + Google Apps Script + OpenAI 個人記帳系統

## 功能

- **文字記帳**：透過 LINE 傳送「午餐80」等自然語言，AI 自動解析分類、品項、金額
- **固定格式**：支援「飲食 午餐便當 80」指定分類格式
- **銀行帳單匯入**：貼上銀行帳單文字或傳送 PDF，批次匯入交易紀錄
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
    ├── Google Sheets — 儲存交易紀錄
    ├── Google Drive — PDF OCR 文字擷取
    └── LINE Reply API — 回覆確認訊息
```

## 檔案結構

```
src/
├── Config.gs          # Script Properties 存取、初始化
├── Main.gs            # doPost() 進入點、訊息路由
├── LineService.gs     # LINE API 互動
├── OpenAIService.gs   # OpenAI API 呼叫、Prompt 設計
├── SheetService.gs    # Google 試算表讀寫
└── PdfService.gs      # PDF OCR 文字擷取
```

## 交易紀錄格式

| 日期 | 金融機構 | 帳戶名稱 | 類型 | 分類 | 品項 | 明細描述 | 幣別 | 金額 | 原始訊息 |
|------|---------|---------|------|------|------|---------|------|------|---------|

## 分類

**支出（20 項）**：飲食、服飾、家庭、交通、學習、休閒、購物、醫療、其他、保險、手續費、稅金、工作、父母、老婆、買房、紅包、投資、轉帳、貸款

**收入（10 項）**：薪資、利息、兼職、獎金、回饋、投資獲利、股利、家人給、保險、其他

## 設定步驟

1. 建立 Google 試算表
2. 建立 LINE Official Account + Messaging API Channel
3. 取得 OpenAI API Key
4. 從試算表「擴充功能 → Apps Script」開啟編輯器
5. 建立 6 個 .gs 檔案，貼入 `src/` 下的程式碼
6. 啟用 Drive API 進階服務
7. 設定 Script Properties（OPENAI_API_KEY、LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、SHEET_ID）
8. 執行 `initializeSheets()` 建立工作表結構
9. 部署為 Web App（存取權限：所有人）
10. 在 LINE Developers 設定 Webhook URL

## 技術

- **後端**：Google Apps Script (JavaScript)
- **AI**：OpenAI gpt-4o-mini（JSON mode）
- **資料庫**：Google Sheets
- **PDF OCR**：Google Drive API
- **前端**：LINE Messaging API

## 授權

MIT License
