# mailbot

Gmail 銀行對帳單自動匯入工具。

## 架構

搜尋 Gmail 帳單信 → 依 `rules.yaml` 比對主旨／寄件者 → 下載 PDF 附件（只在記憶體）→ 用 `.env` 的密碼解密（pikepdf）→ 逐頁抽版面文字（pdfplumber）→ POST 給 Apps Script `GAS_IMPORT_URL?import=1`（帶 `WEBAPP_TOKEN`）→ 後端解析並寫入試算表、LINE push 摘要 → 依結果在 Gmail 加標籤「已記帳」或「記帳失敗」。由 Windows 工作排程器在登入後延遲 10 分鐘執行。

目錄約定：
- 程式碼：`tools/mailbot/`（入版控）。
- 私人工作目錄：`local/mailbot/`（gitignored），放 `.env`、`rules.yaml`、`credentials.json`、`token.json`、`log/`。**一律從這個目錄執行**。

## 一次性設定

### (a) 安裝套件

```bash
pip install -r tools/mailbot/requirements.txt
```

需要 Python 3.11 以上。

### (b) Google Cloud Console 取得 OAuth 憑證

1. 建立（或選用）一個專案。
2. 啟用 **Gmail API**。
3. OAuth 同意畫面：使用者類型選「外部」，在「測試使用者」加入自己的 Gmail。
4. 憑證 → 建立 OAuth 用戶端 ID → 應用程式類型選「桌面應用程式」。
5. 下載 JSON，存為 `local\mailbot\credentials.json`。

### (c) 建立 `.env`

```bat
mkdir local\mailbot
copy tools\mailbot\.env.example local\mailbot\.env
```

編輯 `local\mailbot\.env`：
- `GAS_IMPORT_URL`：LINE 部署的 `/exec` 網址。
- `WEBAPP_TOKEN`：與 Apps Script Script Property 的 `WEBAPP_TOKEN` 相同。
- 各 `PDF_PW_*`：各銀行 PDF 密碼。**密碼只放這裡**，不要寫進程式或對話。
- 選填：`LOOKBACK_DAYS`（預設 45，須為正整數）、`LABEL_DONE`、`LABEL_FAIL`。

### (d) 建立規則檔

```bat
copy tools\mailbot\rules.example.yaml local\mailbot\rules.yaml
```

依自己收到的信調整主旨比對（`rules.yaml` 不入版控）。規則由上而下，第一條命中者生效。

### (e) 首次執行與驗證

```bat
cd local\mailbot
python ..\..\tools\mailbot\run.py --dry-run
```

首次會開瀏覽器要求授權 Gmail（唯讀＋標籤），完成後寫入 `token.json`，之後自動續用。

驗證：dry-run 表格會顯示每封信命中的規則（銀行）與抽出的文字字數；不 POST、不加標籤。確認無誤後可先單封實跑：

```bat
python ..\..\tools\mailbot\run.py --message-id <Gmail 訊息 ID>
```

### (f) 安裝排程

```bat
powershell -ExecutionPolicy Bypass -File tools\mailbot\install_task.ps1
```

建立工作排程器任務「linebot-finance mailbot」：登入後延遲 10 分鐘執行、僅在使用者登入時執行、一般權限。立即執行：`Start-ScheduledTask -TaskName 'linebot-finance mailbot'`。移除：`powershell -File tools\mailbot\uninstall_task.ps1`。

## 日常使用

- 看 Gmail 標籤「已記帳」／「記帳失敗」，以及 LINE 收到的 push 摘要。
- 要重跑失敗的信：先在 Gmail 移除「記帳失敗」標籤。`skip`（無對應規則或無 PDF）不加標籤。
- 手動執行：

  ```bat
  cd local\mailbot
  python ..\..\tools\mailbot\run.py            :: 正式執行
  python ..\..\tools\mailbot\run.py --dry-run  :: 只列出，不 POST、不加標籤
  ```

  其他參數：`--rules`（預設 `rules.yaml`）、`--env`（預設 `.env`）、`--log-dir`（預設 `log`）。
- 搜尋條件：`newer_than:{LOOKBACK_DAYS}d has:attachment filename:pdf -label:已記帳 -label:記帳失敗`。有任何失敗時結束碼為 1。
- `log/YYYY-MM-DD.log` 只記主旨與狀態（時間、訊息 ID、狀態、筆數、銀行、主旨、錯誤類型），不含帳單內容與密碼。

## 安全注意

- `token.json`、`credentials.json`、`.env`（含 PDF 密碼與 `WEBAPP_TOKEN`）、`rules.yaml` 都在 `local/mailbot/`，不進版控。
- 若 `WEBAPP_TOKEN` 外洩：在 Apps Script 編輯器執行 `rotateWebAppToken()`，並更新 `local\mailbot\.env`。
- Gmail 授權範圍僅含唯讀與標籤修改，不會寄信或刪信。

## 測試

```bash
python -m pytest tools/mailbot -q
```

測試不連網：Gmail 用假 service、`requests.post` 用 monkeypatch、加密 PDF 由 pikepdf 在測試中產生。
