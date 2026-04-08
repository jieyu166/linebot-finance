## Context

此專案為全新建置，目前無既有程式碼。系統以 Google Apps Script（JavaScript）為執行環境，透過 LINE Messaging API Webhook 接收使用者訊息，整合 OpenAI API 進行自然語言解析，資料儲存於 Google 試算表。額外需支援銀行帳單 PDF 匯入，涉及 Google Drive OCR 文字擷取。加密 PDF 由使用者自行解密後再傳送。

技術限制：
- Google Apps Script 執行時間上限 6 分鐘（免費帳號）
- LINE 免費方案每月 200 則主動推播訊息（回覆不計）
- 所有程式碼須在 Google Apps Script 環境中執行，無法使用 npm 套件

## Goals / Non-Goals

**Goals:**

- 使用者透過 LINE 傳送文字即可完成記帳，零學習成本
- AI 自動判斷支出/收入、分類、品項、金額
- 銀行帳單 PDF 可批次匯入交易紀錄
- 分類可在試算表中動態新增，不需修改程式碼

**Non-Goals:**

- 不實作查詢/統計功能（未來擴充）
- 不實作月報表自動發送
- 不實作預算管理
- 不支援圖片辨識（僅文字和 PDF）
- 不支援多人共用（僅個人使用）
- 不實作刪除/修改交易紀錄功能
- 不處理加密 PDF（使用者須自行解密後再傳送）

## Decisions

### Google Apps Script 作為唯一後端

選擇 GAS 而非獨立伺服器（如 Cloud Functions），因為：
- 免費託管，無需管理伺服器
- 與 Google 試算表和 Drive 原生整合
- 部署為 Web App 即可作為 Webhook 端點
- 替代方案（Cloud Functions + Firebase）增加複雜度且可能產生費用

### OpenAI gpt-4o-mini 作為解析引擎

選擇 gpt-4o-mini 而非 Gemini，因為：
- 使用者指定使用 OpenAI
- gpt-4o-mini 價格低廉（輸入 $0.15/1M tokens，輸出 $0.60/1M tokens）
- 支援 JSON mode（response_format: json_object），確保回傳格式一致
- 替代方案 Gemini 免費額度更多但使用者偏好 OpenAI

### Google Drive OCR 擷取 PDF 文字

選擇 Drive OCR 而非第三方 PDF 解析 API，因為：
- GAS 原生支援 Drive API，無額外費用
- 上傳 PDF 轉 Google Doc 即可擷取文字
- 支援文字型和掃描型 PDF
- 替代方案（pdf.js、Tika）無法在 GAS 環境執行

### 程式碼模組化為 6 個 .gs 檔案

將程式碼分為 Config.gs、Main.gs、LineService.gs、OpenAIService.gs、SheetService.gs、PdfService.gs，而非單一檔案，因為：
- 職責分離，方便維護
- 各模組可獨立測試
- 替代方案（單一 Code.gs）在程式碼量增加後難以維護

### 銀行帳單 prompt 設計策略

使用單一通用 prompt 而非每家銀行獨立 prompt，因為：
- 10 家銀行格式已分析，差異主要在日期格式（民國年 vs 西元年）和欄位排版
- AI 能從文字內容辨識銀行和格式，不需硬編碼
- prompt 中列出所有銀行的共通規則和特殊處理事項
- 替代方案（每家銀行一個 prompt）維護成本高，且新銀行需改程式碼

prompt 需涵蓋的共通規則：
1. 民國年轉換：115 年 = 2026 年（第一銀行、玉山、台新、富邦使用民國年）
2. 跳過繳款/自動扣繳行（負數且含「扣繳」「繳款」等關鍵字）
3. 回饋金（負數且含「回饋」關鍵字）→ 收入/回饋
4. 國外交易服務費 → 支出/手續費
5. 證券交易：現買/買進 → 支出/投資，現賣/賣出 → 收入/投資獲利
6. 貸款利息/償還本金 → 支出/貸款
7. 過濾行銷文字、資產摘要、權益公告、分頁重複表頭
8. PDF 分頁導致的資料重複需去重
9. 中國信託 PDF 格式損壞，OCR 擷取後幾乎無法使用，需告知使用者

## Risks / Trade-offs

- [GAS 6 分鐘執行限制] → 大型 PDF（超過 50 頁）可能超時。緩解：PDF 帳單通常 1-5 頁，在正常範圍內。若超時則回覆使用者「檔案過大」。
- [OpenAI API 成本] → 每筆記帳約消耗 200-500 tokens（約 $0.0001）。PDF 批次解析約 2000-5000 tokens。月花費預估低於 $0.50。
- [AI 分類準確度] → gpt-4o-mini 可能誤判分類。緩解：temperature 設為 0 降低隨機性、提供完整分類清單和範例、回覆訊息顯示分類供使用者確認。
- [銀行帳單格式多樣] → 11 家銀行 PDF 格式各異。緩解：OCR 擷取純文字後由 AI 統一解析，不依賴固定格式解析。若 AI 無法辨識特定格式，回覆錯誤訊息。
- [Google Drive OCR 精準度] → 部分銀行 PDF 排版複雜，OCR 可能擷取不完整。緩解：AI 解析時容錯處理，無法辨識的交易跳過並在回覆中標示。
