## Context

此系統為 Google Apps Script 記帳 LINE Bot，目前有三個已部署的工作表：交易紀錄（10 欄）、支出分類、收入分類。所有交易的帳戶名稱（C 欄）目前由 OpenAI 從 PDF/文字解析，無固定清單約束，導致同一帳戶可能出現不同寫法（例如「永豐活期」vs「永豐大戶」）。此變更引入帳戶主檔，為後續餘額計算提供一致的 JOIN 鍵。

**受影響模組**：Config.gs、SheetService.gs、Main.gs、OpenAIService.gs

## Goals / Non-Goals

**Goals:**
- 建立「帳戶管理」工作表作為帳戶主檔，存放 13 個帳戶的初始餘額與設定
- 提供三個帳戶餘額函數：`getAccounts()`、`calculateAccountBalance()`、`getAllAccountBalances()`
- 在 LINE Bot 新增餘額查詢指令，支援全部查詢與單一帳戶查詢
- 修改 OpenAI prompt，使解析出的帳戶名稱與帳戶主檔一致

**Non-Goals:**
- 不從銀行 API 自動抓取餘額
- 不實作帳戶轉帳的雙邊自動配對
- 不提供歷史餘額曲線圖或月份報表
- 不修改現有交易紀錄欄位結構

## Decisions

### 帳戶名稱作為唯一 JOIN 鍵

帳戶名稱（帳戶管理 A 欄）同時是 LINE Bot 查詢指令的關鍵字，也是交易紀錄 C 欄的比對鍵。選擇帳戶名稱而非金融機構作為主鍵，原因是同一機構可能有多個帳戶（永豐大戶 vs 永豐外幣 vs 永豐證券），必須區分。

### 餘額即時計算，不快取

每次查詢時即時計算（初始餘額 ± 交易加減），不在工作表存快取值。原因：快取需要在每筆交易後更新，增加複雜度；GAS 讀取試算表的效能對 13 個帳戶、數百筆交易已足夠，快取為過度設計。

### 初始日期邊界：嚴格大於（exclusive）

初始日期當天的交易不計入（`rowDate > initialDate`），假設初始餘額已包含該日所有交易。這是最常見的銜接方式：使用者填入舊軟體最後一天的餘額，從次日起計算新系統交易。

### OpenAI 帳戶名稱：從清單選擇

`buildSystemPrompt()` 和 `buildPdfSystemPrompt()` 各新增第四個參數 `accountNames`，動態插入帳戶清單至 prompt。AI 被要求從清單選擇最接近的名稱，確保交易紀錄 C 欄與帳戶管理 A 欄一致，不需要使用者手動修正。

### 指令偵測放在 handleTextMessage 最前面

`detectBalanceCommand()` 在 `isBankStatement()` 之前執行，原因：「餘額」雖出現在帳單關鍵字清單中，但帳單偵測需要多行且命中 ≥3 個關鍵字，不會誤觸發；將指令偵測置前是防禦性設計，也讓路由邏輯更清晰。

## Implementation Contract

### 新增函數介面

```javascript
// SheetService.gs
function getAccounts(ss)
// 回傳: Array<{ name:string, institution:string, currency:string,
//              initialBalance:number, initialDate:string, note:string, active:boolean }>
// 只回傳 active===true 的帳戶

function calculateAccountBalance(accountName, ss)
// 回傳: { name, currency, initialBalance, transactionTotal, currentBalance, txCount, initialDate }
// 或 null（帳戶不存在）

function getAllAccountBalances(ss)
// 回傳: Array<同上結構，對所有啟用帳戶>（單次讀取交易紀錄）

// Main.gs
function detectBalanceCommand(text)
// 回傳: { isCommand:boolean, accountName:string|null }
// accountName: null=全部, '__LIST__'=清單, 其他=帳戶名稱

function handleBalanceCommand(replyToken, accountName, ss)
// void，直接呼叫 replyToLine()

function formatAmount(amount)
// 回傳: string，格式如 "$12,500" 或 "-$3,000"

// OpenAIService.gs（函數簽名變更）
function buildSystemPrompt(expenseCategories, incomeCategories, accountNames)
function buildPdfSystemPrompt(expenseCategories, incomeCategories, accountNames)
function parseWithOpenAI(message, expenseCategories, incomeCategories, accountNames)
function parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accountNames)
```

### 新增工作表結構

「帳戶管理」工作表欄位（A–G）：帳戶名稱 | 金融機構 | 幣別 | 初始餘額 | 初始日期 | 備註 | 是否啟用

### 可觀察行為（驗收條件）

1. 在 GAS 執行 `initializeSheets()` 後，試算表出現「帳戶管理」工作表，第 2–14 列有 13 個預設帳戶，D、E 欄留空
2. 在 LINE 傳送「餘額」→ 回覆以「💰 帳戶餘額一覽」開頭，列出所有啟用帳戶的金額（格式：$X,XXX）
3. 在 LINE 傳送「永豐大戶餘額」→ 回覆顯示初始餘額、交易調整筆數與金額、當前餘額
4. 在 LINE 傳送「帳戶清單」→ 回覆以「📋 帳戶清單（共 13 個）」開頭
5. 在 LINE 傳送「不存在帳戶餘額」→ 回覆列出可用帳戶名稱
6. 在 LINE 傳送「午餐80」→ 正常記帳，路由未被指令偵測攔截
7. 傳送 PDF 帳單 → 解析出的 account 欄位使用帳戶管理清單中的名稱（而非自由文字）

### 範圍邊界

**範圍內**：Config.gs（initializeSheets 擴充）、SheetService.gs（新增 3 個函數）、Main.gs（新增指令偵測與處理）、OpenAIService.gs（修改 2 個 buildPrompt 函數、修改 2 個 parse 函數簽名）

**範圍外**：交易紀錄工作表欄位結構、現有 PDF/文字匯入主流程、LINE 簽章驗證邏輯、分類工作表

## Risks / Trade-offs

- [風險] 現有交易紀錄中帳戶名稱不一致 → 更新 prompt 後新交易會使用清單名稱；舊資料需使用者自行在試算表手動修正，系統不自動修正歷史資料
- [風險] `getAllAccountBalances()` 讀取大量交易紀錄時效能下降 → 已設計為單次讀取（一個 getRange 涵蓋全部列），GAS 執行上限 6 分鐘，現階段不需要最佳化
- [取捨] 初始餘額與初始日期由使用者手動填入 → 必要的設計，系統無法自動從舊軟體匯入資料
