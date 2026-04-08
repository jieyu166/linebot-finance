## Context

系統已上線運作，code review 發現 5 個待修正問題。其中 LINE Webhook 簽章驗證為安全性修正，其餘為程式碼品質改善。

## Goals / Non-Goals

**Goals:**
- 防止偽造 Webhook 請求寫入試算表
- 消除重複程式碼
- 減少不必要的試算表存取次數

**Non-Goals:**
- 不新增功能
- 不修改 prompt 或試算表結構

## Decisions

### LINE Webhook 簽章驗證

在 doPost() 開頭使用 HMAC-SHA256 驗證 LINE 簽章：
1. 從 HTTP header 取得 `x-line-signature`
2. 用 LINE_CHANNEL_SECRET 對 request body 計算 HMAC-SHA256
3. Base64 編碼後比對
4. 不符合則記錄 Logger 並直接回傳 200（不處理事件）

選擇在 doPost 層驗證而非獨立 middleware，因為 GAS 無 middleware 架構。
注意：GAS 的 doPost(e) 可能無法取得 HTTP headers，需確認 `e.parameter` 或 `e.headers` 是否包含簽章。若無法取得 headers，改為僅記錄警告但不阻擋（GAS Web App 的限制）。

### 抽取共用統計摘要函式

建立 buildImportSummary(result, source) 函式：
- 接收 parsePdfWithOpenAI 的結果和來源標記（'PDF' 或 '文字'）
- 回傳格式化的回覆訊息字串
- handleFileMessage 和 handleBankStatementText 共用此函式
- 同時將 appendTransactionsBatch 的 source 參數化

### 試算表存取優化

將 SpreadsheetApp.openById() 提升到流程入口：
- handleTextMessage 開頭開啟一次 ss
- 傳入 getCategories(ss, sheetName) 和 appendTransaction(ss, ...)
- handleFileMessage/handleBankStatementText 同理
- 減少每次請求的 API 呼叫從 3-4 次降為 1 次

### 帳單偵測門檻調整

isBankStatement() 修正：
- 關鍵字命中門檻從 2 提高到 3
- 從關鍵字清單移除 '支出'、'存入'（太常見，容易誤判）
- 保留其他專業帳單用語

## Risks / Trade-offs

- [GAS 可能無法取得 HTTP headers] → 若 e.headers 不存在，簽章驗證降級為日誌警告，不阻擋請求。部署後測試確認。
- [試算表物件傳遞增加參數數量] → 函式簽章變長，但減少重複 API 呼叫值得。
