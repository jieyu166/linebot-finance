## 1. 專案初始化與設定

- [x] 1.1 建立 Google Apps Script 專案，建立 6 個 .gs 檔案（Config.gs、Main.gs、LineService.gs、OpenAIService.gs、SheetService.gs、PdfService.gs）——對應「程式碼模組化為 6 個 .gs 檔案」設計決策
- [x] 1.2 實作 Config.gs：getConfig() 函式讀取 Script Properties，initializeProperties() 設定 OPENAI_API_KEY、LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、SHEET_ID——採用「Google Apps Script 作為唯一後端」，所有設定透過 Script Properties 管理
- [x] 1.3 實作 Config.gs 的 initializeSheets() 函式：建立「交易紀錄」工作表（A:日期 B:時間 C:類型 D:分類 E:品項 F:金額 G:原始訊息），以及「Store categories in dedicated worksheets」——建立「支出分類」工作表含 17 項預設分類、「收入分類」工作表含 10 項預設分類
- [x] 1.4 啟用 Google Drive API 進階服務（Apps Script 編輯器 → 服務 → Drive API v3）——對應「Google Drive OCR 擷取 PDF 文字」設計決策

## 2. 試算表讀寫服務

- [x] 2.1 實作 SheetService.gs 的 getCategories(sheetName) 函式：「Dynamically load categories for AI prompt」——從指定工作表讀取 A 欄第 2 列起所有非空值，回傳字串陣列
- [x] 2.2 實作 SheetService.gs 的 appendTransaction(date, time, type, category, item, amount, originalMessage) 函式：「Write transaction to Google Sheets」——新增一列到「交易紀錄」工作表
- [x] 2.3 實作 SheetService.gs 的 appendTransactionsBatch(transactions) 函式：「Batch write transactions and reply summary」——批次寫入多筆交易到「交易紀錄」工作表

## 3. OpenAI 解析服務

- [x] 3.1 實作 OpenAIService.gs 的 buildSystemPrompt(expenseCategories, incomeCategories) 函式：建構文字記帳用 system prompt，包含分類清單、輸入格式說明、JSON 輸出規範、範例——對應「OpenAI gpt-4o-mini 作為解析引擎」設計決策
- [x] 3.2 實作 OpenAIService.gs 的 parseWithOpenAI(message, expenseCategories, incomeCategories) 函式：「Parse text messages with OpenAI」——呼叫 gpt-4o-mini API（temperature:0, response_format:json_object），回傳 {type, category, item, amount}
- [x] 3.3 實作 OpenAIService.gs 的 buildPdfSystemPrompt(expenseCategories, incomeCategories) 函式：建構 PDF 帳單批次解析用 system prompt，涵蓋 11 家台灣銀行格式，回饋歸入收入/回饋分類
- [x] 3.4 實作 OpenAIService.gs 的 parsePdfWithOpenAI(text, expenseCategories, incomeCategories) 函式：「Batch parse bank statement text with OpenAI」——呼叫 gpt-4o-mini 解析 PDF 文字，回傳 {transactions: [{date, type, category, item, amount}]}

## 4. LINE 服務

- [x] 4.1 實作 LineService.gs 的 replyToLine(replyToken, messageText) 函式：「Reply confirmation via LINE」——透過 LINE Reply API 回覆文字訊息
- [x] 4.2 實作 LineService.gs 的 downloadContent(messageId) 函式：「Download PDF from LINE message」——透過 LINE Content API 下載檔案並回傳 Blob

## 5. PDF 處理服務

- [x] 5.1 實作 PdfService.gs 的 extractTextFromPdf(blob) 函式：「Extract text from PDF via Google Drive OCR」——上傳 PDF 到 Drive 轉 Google Doc、擷取文字、刪除暫存檔——對應「Google Drive OCR 擷取 PDF 文字」設計決策
- [x] 5.2 實作 PdfService.gs 的 deleteDriveFile(fileId) 輔助函式：「Clean up temporary files」——刪除 Drive 暫存檔，確保失敗時也能清理

## 6. 主流程路由

- [x] 6.1 實作 Main.gs 的 doPost(e) 函式：「Receive text messages via LINE Webhook」——解析 LINE Webhook JSON，區分文字訊息、檔案訊息（PDF）、其他訊息類型，一律回傳 HTTP 200
- [x] 6.2 實作 Main.gs 的 handleTextMessage(event) 函式：處理文字記帳流程——讀取分類 → OpenAI 解析 → 寫入試算表 → 回覆確認。「Handle parsing failures」——偵測無效結果回覆提示
- [x] 6.3 實作 Main.gs 的 handleFileMessage(event) 函式：處理 PDF 檔案流程——下載 PDF → OCR 擷取文字 → 批次解析寫入 → 回覆摘要。偵測加密 PDF 回覆「此 PDF 已加密，請先自行解密後再傳送。」

## 7. 部署與測試

- [x] 7.1 部署 Apps Script 為 Web App（執行身分：自己，存取權限：所有人），取得 Webhook URL
- [x] 7.2 在 LINE Developers Console 設定 Webhook URL，開啟 Use webhook，驗證連線
- [x] 7.3 端到端測試：自然語言記帳——LINE 傳「午餐80」，確認回覆正確且試算表有紀錄（「Parse text messages with OpenAI」的自然語言場景）
- [x] 7.4 端到端測試：固定格式記帳——LINE 傳「飲食 午餐便當 80」，確認分類正確（「Parse text messages with OpenAI」的固定格式場景）
- [x] 7.5 端到端測試：收入記帳——LINE 傳「收到薪水50000」，確認類型為收入（「Parse text messages with OpenAI」的收入場景）
- [x] 7.6 端到端測試：未加密 PDF 匯入——LINE 傳銀行帳單 PDF，確認批次匯入結果正確
- [x] 7.7 端到端測試：動態分類——在試算表新增「寵物」分類 → LINE 傳「貓飼料500」→ 確認 AI 使用新分類（「Dynamically load categories for AI prompt」的新增分類場景）

## 8. 銀行帳單 prompt 強化

- [x] 8.1 在試算表「支出分類」新增 3 個分類：投資、轉帳、貸款——對應「Store categories in dedicated worksheets」更新預設分類為 20 項
- [x] 8.2 更新 Config.gs 的 initializeSheets()，將預設支出分類從 17 項更新為 20 項（新增投資、轉帳、貸款）
- [x] 8.3 重寫 OpenAIService.gs 的 buildPdfSystemPrompt()——對應「銀行帳單 prompt 設計策略」，納入民國年轉換規則（115年=2026年）、跳過繳款/自扣行、回饋金辨識（含描述中嵌入金額）、國外交易服務費歸手續費、證券交易歸投資、貸款利息/本金歸貸款、過濾行銷雜訊和資產摘要、PDF 分頁去重、中國信託格式損壞偵測，涵蓋 10 家銀行格式：第一銀行、LINE Bank、王道、永豐、玉山、台新、富邦、國泰、樂天及證券帳單
- [x] 8.4 更新 Main.gs 的 handleFileMessage()——加入中國信託 OCR 格式損壞偵測，若擷取文字雜亂則回覆「此帳單格式無法正確辨識，請嘗試其他方式提供明細。」
- [x] 8.5 端到端測試：第一銀行信用卡 PDF 匯入——確認民國年正確轉換、回饋金記為收入、國外交易服務費記為手續費、繳款行跳過
- [x] 8.6 端到端測試：永豐銀行帳戶明細 PDF 匯入——確認股款交割記為投資、利息記為收入、跨行轉帳記為轉帳
- [x] 8.7 端到端測試：永豐證券對帳單 PDF 匯入——確認現買記為支出/投資、庫存摘要跳過
