## Why

使用者目前使用的記帳程式即將收費，需要一套免費且可自主掌控的替代方案。利用 LINE Bot 作為前端（亞洲使用者熟悉的介面）、Google Apps Script 作為後端、OpenAI gpt-4o-mini 作為 AI 解析引擎、Google 試算表作為資料庫，打造零成本的個人記帳系統。先前軟體好處是可自動抓取銀行資料同步，但不同銀行常有問題。

## What Changes

- 建立 LINE Bot Webhook 接收使用者訊息（文字與檔案），並回覆處理結果
- 整合 OpenAI gpt-4o-mini 解析自然語言和固定格式的記帳訊息，自動判斷支出/收入、分類、品項、金額
- 支援 11 家台灣銀行帳單 PDF 上傳，透過 Google Drive OCR 擷取文字後批次建立交易紀錄（使用者須自行解密加密 PDF 後再傳送）
- Google 試算表儲存交易紀錄，分類表獨立存放以支援動態新增分類
- 消費支出 20 個分類（飲食、服飾、家庭、交通、學習、休閒、購物、醫療、其他、保險、手續費、稅金、工作、父母、老婆、買房、紅包、投資、轉帳、貸款）
- 收入 10 個分類（薪資、利息、兼職、獎金、回饋、投資獲利、股利、家人給、保險、其他）
- 交易紀錄格式 10 欄：日期、金融機構、帳戶名稱、類型、分類、品項、明細描述、幣別、金額、原始訊息
- PDF 帳單 prompt 需處理：民國年轉換、過濾雜訊（行銷文字/資產摘要）、跳過繳款扣繳、辨識回饋金、國外交易服務費歸手續費、證券買賣歸投資、去重（分頁重複）
- 已分析 10 家銀行帳單格式（第一、永豐、LINE Bank、王道、玉山、台新、富邦、國泰、樂天），中國信託 PDF 格式損壞需其他方式處理

## Capabilities

### New Capabilities

- `text-accounting`: 透過 LINE 傳送文字訊息記帳。支援自然語言（「午餐80」）和固定格式（「飲食 午餐便當 80」），由 OpenAI 解析後寫入 Google 試算表並回覆確認。
- `pdf-batch-import`: 透過 LINE 傳送銀行帳單 PDF 檔案（須為未加密），系統自動擷取文字、批次解析交易明細（含回饋金），寫入試算表並回覆匯入摘要。
- `dynamic-categories`: 分類資料儲存於 Google 試算表獨立工作表，系統每次動態讀取分類清單注入 AI prompt，使用者可直接在試算表新增分類而不需修改程式碼。

### Modified Capabilities

（無，此為全新專案）

## Impact

- 新增程式碼：Google Apps Script 專案中 5 個 .gs 檔案（Config.gs、Main.gs、LineService.gs、OpenAIService.gs、SheetService.gs、PdfService.gs）
- 外部 API 依賴：LINE Messaging API、OpenAI API (gpt-4o-mini)
- Google 服務依賴：Google Sheets API、Google Drive API（進階服務，用於 PDF OCR）
- 需設定 4 個 Script Properties：OPENAI_API_KEY、LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、SHEET_ID
- 部署為 Google Apps Script Web App，設定 LINE Webhook
