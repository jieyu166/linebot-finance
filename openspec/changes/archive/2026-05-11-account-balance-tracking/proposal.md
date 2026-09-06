## Why

使用者要將舊記帳軟體的資料銜接到此系統，需要記錄各帳戶的初始餘額，並自動計算目前餘額（初始值 ± 後續交易），以便核對補記漏記：若計算餘額與實際對帳單不符，代表有遺漏交易。

## What Changes

- 新增「帳戶管理」Google 試算表工作表，儲存 13 個帳戶的設定（帳戶名稱、金融機構、幣別、初始餘額、初始日期）
- 新增 `initializeSheets()` 初始化邏輯，預建 13 個預設帳戶（現金、一銀、LineBank、王道、永豐大戶、永豐證券、永豐外幣、玉山、台新、中信、富邦、國泰、樂天）
- 新增 `getAccounts()`、`calculateAccountBalance()`、`getAllAccountBalances()` 三個帳戶餘額計算函數
- LINE Bot 支援餘額查詢指令：`餘額`（全部帳戶）、`[帳戶名]餘額` / `餘額 [帳戶名]`（單一帳戶）、`帳戶清單`
- OpenAI prompt 加入帳戶清單，讓 AI 在解析交易時從清單選擇帳戶名稱，確保交易紀錄與帳戶管理的名稱一致

## Non-Goals

- 不自動從銀行 API 抓取最新餘額（初始值仍需使用者手動填入）
- 不支援帳戶轉帳的雙邊自動扣計（例如從永豐大戶轉入玉山，兩個帳戶各記一筆，不自動配對抵消）
- 不提供歷史餘額曲線圖或報表功能

## Capabilities

### New Capabilities

- `account-management`: 帳戶主檔工作表的初始化、帳戶清單讀取、餘額計算（初始餘額 ± 交易加減）
- `balance-query`: LINE Bot 餘額查詢指令解析與回覆格式

### Modified Capabilities

- `text-accounting`: OpenAI 文字解析 prompt 加入帳戶清單參數，使解析結果的帳戶名稱與帳戶管理清單一致
- `pdf-batch-import`: OpenAI PDF 批次解析 prompt 同樣加入帳戶清單參數

## Impact

- Affected specs: account-management（新增）、balance-query（新增）、text-accounting（修改）、pdf-batch-import（修改）
- Affected code:
  - Modified: src/Config.gs, src/SheetService.gs, src/Main.gs, src/OpenAIService.gs
