# mailbot

Gmail 銀行對帳單自動匯入工具：搜尋 Gmail 帳單信 → 下載 PDF 附件（只在記憶體）→ 用 `.env` 的密碼解密（pikepdf）→ 逐頁抽版面文字（pdfplumber）→ POST 給 Apps Script `GAS_IMPORT_URL?import=1` → 依結果在 Gmail 加標籤「已記帳」或「記帳失敗」。

## 目錄約定

- 程式碼：`tools/mailbot/`（入版控）。
- 私人工作目錄：`local/mailbot/`（gitignored），放 `.env`、`rules.yaml`、`credentials.json`、`token.json`、`log/`。**一律從這個目錄執行**。

## 安裝

```bash
pip install -r tools/mailbot/requirements.txt
```

需要 Python 3.11 以上（已在 3.14 測過）。

## 設定

1. 建立工作目錄並複製範本：
   ```bash
   mkdir -p local/mailbot
   cp tools/mailbot/.env.example local/mailbot/.env
   cp tools/mailbot/rules.example.yaml local/mailbot/rules.yaml
   ```
2. 編輯 `local/mailbot/.env`：填 `GAS_IMPORT_URL`（LINE Bot 部署的 `/exec` 網址）、`WEBAPP_TOKEN`、各銀行 `PDF_PW_*`。密碼只放這裡，不要寫進程式或對話。
3. Gmail OAuth（只需一次）：
   1. Google Cloud Console → 建立或選專案 → 啟用 **Gmail API**。
   2. 「OAuth 同意畫面」設為外部／測試，把自己的 Gmail 加為測試使用者；範圍加 `gmail.readonly`、`gmail.modify`。
   3. 「憑證」→ 建立 OAuth 用戶端 ID → 類型「電腦版應用程式」→ 下載 JSON，存成 `local/mailbot/credentials.json`。
   4. 第一次執行時會開瀏覽器授權，完成後自動寫入 `local/mailbot/token.json`（之後自動更新）。

## 使用

```bash
cd local/mailbot
python ../../tools/mailbot/run.py --dry-run            # 只列出會處理的信與抽出文字長度；不 POST、不加標籤
python ../../tools/mailbot/run.py --message-id <id>    # 只處理單封
python ../../tools/mailbot/run.py                      # 正式執行
```

其他參數：`--rules`（預設 `rules.yaml`）、`--env`（預設 `.env`）、`--log-dir`（預設 `log`）。

- 搜尋條件：`newer_than:{LOOKBACK_DAYS}d has:attachment filename:pdf -label:已記帳 -label:記帳失敗`。
- 結果：`done` 加「已記帳」、`fail` 加「記帳失敗」、`skip`（無對應規則或無 PDF）不加標籤。要重跑失敗的信，先在 Gmail 移除「記帳失敗」標籤。
- 結束時印出摘要表；有任何 `fail` 時結束碼為 1。
- Log：`log/YYYY-MM-DD.log`，每封一行（時間、訊息 ID、狀態、筆數、銀行、主旨、錯誤類型），不含帳單內容與密碼。

## 測試

```bash
python -m pytest tools/mailbot -q
```

測試不連網：Gmail 用假 service、`requests.post` 用 monkeypatch、加密 PDF 由 pikepdf 在測試中產生。
