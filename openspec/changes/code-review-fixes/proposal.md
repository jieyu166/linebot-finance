## Summary

根據 code review 發現的 5 個問題進行重構：LINE Webhook 簽章驗證、重複邏輯抽取、試算表存取優化、帳單偵測誤判修正、批次匯入來源標記修正。

## Motivation

程式碼已上線運作，但存在安全風險（無 Webhook 簽章驗證，任何人知道 URL 可偽造請求）、重複程式碼（統計摘要邏輯寫了兩次）、效能浪費（每次請求重複開啟試算表）、誤判風險（帳單偵測關鍵字門檻過低）、標記錯誤（文字貼上帳單標為 'PDF匯入'）。

## Proposed Solution

1. **LINE 簽章驗證**：在 doPost() 加入 HMAC-SHA256 驗證，使用 LINE_CHANNEL_SECRET 比對 x-line-signature header，驗證失敗回傳 200 但不處理
2. **抽取共用統計摘要函式**：將 handleFileMessage() 和 handleBankStatementText() 中重複的統計+回覆邏輯抽取為 buildImportSummary(result, source) 函式
3. **試算表存取優化**：將 SpreadsheetApp.openById() 集中在 handleTextMessage/handleFileMessage 入口處呼叫一次，透過參數傳遞 ss 物件
4. **帳單偵測門檻調整**：isBankStatement() 關鍵字命中門檻從 2 提高到 3，排除 '支出'、'存入' 等過於常見的詞彙
5. **批次匯入來源標記**：appendTransactionsBatch() 新增 source 參數，區分 'PDF匯入' 和 '文字匯入'

## Non-Goals

- 不重構 OpenAI prompt（已在上一輪優化）
- 不新增功能（純修正和重構）
- 不修改試算表結構

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `text-accounting`: 新增 LINE Webhook 簽章驗證、帳單偵測門檻調整
- `pdf-batch-import`: 抽取共用統計摘要函式、批次匯入來源標記修正、試算表存取優化

## Impact

- 修改檔案：src/Main.gs（簽章驗證、共用函式、帳單偵測、試算表傳遞）、src/SheetService.gs（appendTransactionsBatch 加 source 參數、接受 ss 物件）、src/OpenAIService.gs（接受 ss 物件傳遞）、src/LineService.gs（新增 verifySignature 函式）
- 影響 specs：text-accounting、pdf-batch-import
