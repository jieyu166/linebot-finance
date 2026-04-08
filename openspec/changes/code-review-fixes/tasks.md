## 1. LINE 簽章驗證

- [x] 1.1 在 LineService.gs 新增 verifyLineSignature(body, signature) 函式——使用 Utilities.computeHmacSha256Signature() 和 Utilities.base64Encode() 比對簽章，對應「LINE Webhook 簽章驗證」設計決策
- [x] 1.2 在 Main.gs 的 doPost(e) 開頭加入簽章驗證——修改「Receive text messages via LINE Webhook」的 doPost，檢查 e.postData.headers 或 e.parameter 取得 x-line-signature，呼叫 verifyLineSignature()，失敗則 Logger.log 並直接 return 200。若 GAS 無法取得 headers 則記錄警告並繼續。對應「Verify LINE Webhook signature」

## 2. 抽取共用統計摘要函式

- [x] 2.1 在 Main.gs 新增 buildImportSummary(result, source) 函式——接收 parsePdfWithOpenAI 結果和來源字串（'PDF' 或 '文字'），回傳格式化的回覆訊息字串，含銀行名稱、筆數、支出/收入統計、跳過數。對應「抽取共用統計摘要函式」設計決策
- [x] 2.2 重構 handleFileMessage() 使用 buildImportSummary(result, 'PDF') 取代內嵌的統計邏輯——「Batch write transactions and reply summary」
- [x] 2.3 重構 handleBankStatementText() 使用 buildImportSummary(result, '文字') 取代內嵌的統計邏輯——「Batch write transactions and reply summary」

## 3. 批次匯入來源標記

- [x] 3.1 修改 SheetService.gs 的 appendTransactionsBatch(transactions, source) 加入 source 參數——原始訊息欄使用 source 值而非固定 'PDF匯入'。handleFileMessage 傳入 'PDF匯入'，handleBankStatementText 傳入 '文字匯入'

## 4. 試算表存取優化

- [x] 4.1 修改 SheetService.gs 的 getCategories、appendTransaction、appendTransactionsBatch 接受可選的 ss 參數——若傳入則直接使用，否則自行 openById（向下相容）。對應「試算表存取優化」設計決策
- [x] 4.2 修改 Main.gs 的 handleTextMessage() 在入口處開啟 ss 並傳入 getCategories(ss, ...) 和 appendTransaction(ss, ...)
- [x] 4.3 修改 Main.gs 的 handleFileMessage() 和 handleBankStatementText() 同理傳入 ss 物件

## 5. 帳單偵測門檻調整

- [x] 5.1 修改 Main.gs 的 isBankStatement() 函式——從關鍵字清單移除 '支出' 和 '存入'，命中門檻從 2 提高到 3。對應「帳單偵測門檻調整」設計決策

## 6. 測試驗證

- [x] 6.1 端到端測試：LINE 傳「午餐80」確認一般記帳仍正常運作
- [x] 6.2 端到端測試：LINE 貼上樂天銀行帳單文字，確認原始訊息欄為「文字匯入」而非「PDF匯入」
- [x] 6.3 端到端測試：確認短文字如「支出 存入 餘額 測試」不會誤判為帳單
