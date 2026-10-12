# Gmail 帳單自動匯入設計

日期：2026-10-12　狀態：使用者已核准架構

## 目標
每天自動從 Gmail 抓銀行帳單 PDF（加密），本機解密抽文字，交給既有的 Apps Script 匯入流程寫入試算表，並以 LINE push 回報摘要。取代目前手動把帳單貼到 LINE。

## 不做
連結型帳單（富邦信用卡、國泰綜合對帳單）仍手動；不存解密後 PDF；不改既有解析規則。

## 元件
### 1. 本機 `local/mailbot/`（Python 3.11+，gitignored；範本放 `tools/mailbot/`）
- `rules.yaml`：每條 `{bank, account_hint, subject_regex, from_regex?, pw_env, kind}`，kind ∈ 信用卡/銀行帳戶/證券。涵蓋使用者列的 16 條 PDF 規則；永豐複委託 → 帳戶提示「永豐外幣」。
- `.env`：`GAS_IMPORT_URL`（LINE 部署 /exec）、`WEBAPP_TOKEN`、各 `PDF_PW_*`、`LOOKBACK_DAYS=45`。
- Gmail API scope：`gmail.readonly` + `gmail.modify`（只用來加標籤）。OAuth 桌面用戶端 `credentials.json`、`token.json` 皆在 `local/mailbot/`。
- 流程：搜尋 `newer_than:{LOOKBACK}d has:attachment filename:pdf -label:已記帳 -label:記帳失敗` → 逐信比對規則 → 下載附件到記憶體 → `pikepdf` 用對應密碼開啟（無密碼也試）→ `pdfplumber` 逐頁 `extract_text(layout=True)` → 組成文字（前綴一行 `[mailbot] bank=X kind=Y hint=Z`）→ POST JSON `{token, text, source:'Gmail匯入', bank, kind, hint, messageId}` 到 `GAS_IMPORT_URL?import=1` → 2xx 且 `ok` → 加標籤「已記帳」；否則加「記帳失敗」並寫 `local/mailbot/log/YYYY-MM-DD.log`。
- 同一封信多個 PDF 各自處理；同一 messageId 已處理（標籤）即跳過。
- 冪等：GAS 端 `dedupeAgainstSheet` 已擋重複。
- 排程：`tools/mailbot/install_task.ps1` 建立工作排程器任務「linebot-finance mailbot」，觸發「登入後延遲 10 分鐘」，動作 `python run.py`。
- `run.py --dry-run` 只列出會處理的信與抽出文字長度，不 POST、不加標籤；`--message-id X` 只跑一封。

### 2. Apps Script
- `Main.gs` `doPost(e)`：若 `e.parameter.import === '1'` → `handleImportPost(e)`；否則維持 LINE 流程。
- `handleImportPost`：解析 JSON；`requireWebAppAccess(body.token)`（沿用 token 機制）；`stripGarbledLines`；若 `isBankStatement` 為假仍照批次解析（來源明確）；呼叫 `parsePdfWithOpenAI` → `importTransactions(result, 'Gmail匯入', ss)` → `buildImportSummary`；回 JSON `{ok:true, summary, written, skipped}`；錯誤回 `{ok:false, error}` 並 HTTP 200（GAS 限制）。`IMPORT_SOURCES` 加 `Gmail匯入`。
- hint 處理：`body.hint` 非空時傳入解析後處理，當 `resolveImportedAccounts` 找不到帳戶時以 hint 的帳戶為備援（新參數 `fallbackAccount`）。
- LINE push：`LineService.gs` 新增 `pushToLine(userId, text)`（Messaging API push）；Script Property `LINE_USER_ID`；`handleImportPost` 結束後若有設定就 push 摘要（含銀行、筆數、跳過、配對、錯誤）。新增編輯器函式 `printLastLineUserId()`：從最近一次 webhook 事件暫存（`doPost` 的 LINE 分支把 `events[0].source.userId` 存到 Script Property `LAST_LINE_USER_ID`）印出。

### 3. 安全
- token 必填；錯誤不回原因細節。帳單文字只經 Gmail API → 本機 → GAS → OpenAI，與現行 LINE 路徑相同。
- 密碼只在 `.env`；log 不含密碼、不含帳單內容（只記主旨、筆數、錯誤類型）。

## 測試
- Python：`pytest` 測規則比對、檔名／主旨篩選、文字前綴、POST payload 組裝（mock requests）、標籤決策；解密用測試時產生的加密 PDF。
- GAS：Node 測試 `handleImportPost` 的 token 拒絕、成功路徑（stub `parsePdfWithOpenAI`）、hint 備援、push 呼叫（stub `UrlFetchApp`）。
- 實測：`--dry-run` 看 16 條規則各命中哪封；再以 `--message-id` 單封實跑 永豐綜合對帳單，對照試算表。
