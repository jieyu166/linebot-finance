## 1. 帳戶管理工作表初始化（Config.gs）

- [x] 1.1 在 `src/Config.gs` 的 `initializeSheets()` 中新增「帳戶管理」工作表初始化邏輯（帳戶名稱作為唯一 JOIN 鍵設計、新增工作表結構）：若工作表不存在則建立，寫入 7 欄標頭（帳戶名稱、金融機構、幣別、初始餘額、初始日期、備註、是否啟用），凍結第一列，預填 13 個預設帳戶（現金→樂天，是否啟用=TRUE，初始餘額和初始日期留空）；Initialize account management worksheet 需求。驗收：在 GAS 執行 `initializeSheets()`，試算表出現「帳戶管理」工作表，第 2–14 列有 13 筆帳戶，A 欄為指定帳戶名稱，G 欄為 TRUE，D/E 欄為空白。

- [x] 1.2 確認 `initializeSheets()` 的等冪性：再次執行時不覆蓋已存在的「帳戶管理」工作表。驗收：執行第二次後，D/E 欄手動填入的值仍保留，第 14 列後無多餘資料。

## 2. 帳戶餘額計算函數（SheetService.gs）

- [x] 2.1 在 `src/SheetService.gs` 新增 `getAccounts(ss)` 函數（Read active account list 需求、新增函數介面）：讀取「帳戶管理」工作表所有列，回傳只含 `active===true` 的帳戶物件陣列，每筆含 `{ name, institution, currency, initialBalance, initialDate, note, active }`，缺少幣別時預設 "TWD"，缺少初始餘額時預設 0。驗收：手動呼叫 `getAccounts()`，Logger 顯示 13 筆物件陣列；將某一帳戶的「是否啟用」改為 FALSE 後，回傳陣列少一筆。

- [x] 2.2 在 `src/SheetService.gs` 新增 `calculateAccountBalance(accountName, ss)` 函數（Calculate account current balance 需求、初始日期邊界：嚴格大於（exclusive）設計）：呼叫 `getAccounts()` 找帳戶設定；讀取「交易紀錄」工作表 A–I 欄全部列；篩選條件為 C 欄帳戶名稱完全相符 AND H 欄幣別相符 AND 交易日期嚴格大於初始日期（initialDate 為空時不做日期篩選）；支出扣減、收入加計；回傳 `{ name, currency, initialBalance, transactionTotal, currentBalance, txCount, initialDate }` 或 null（帳戶不存在）。驗收：在帳戶管理設定 永豐大戶 initialBalance=200000、initialDate=2026/01/01，並在交易紀錄加入一筆支出 5000（2026/01/15），呼叫 `calculateAccountBalance("永豐大戶")` 回傳 currentBalance=195000；再加一筆日期 2026/01/01 的支出確認被排除。

- [x] 2.3 在 `src/SheetService.gs` 新增 `getAllAccountBalances(ss)` 函數（Calculate account current balance 需求、餘額即時計算，不快取設計）：單次讀取「交易紀錄」工作表全部列（一個 `getRange` 涵蓋所有列），對每個啟用帳戶套用相同篩選邏輯，回傳所有帳戶的餘額物件陣列。驗收：呼叫 `getAllAccountBalances()` 回傳陣列長度等於啟用帳戶數，且與逐一呼叫 `calculateAccountBalance()` 的結果一致。

## 3. OpenAI Prompt 加入帳戶清單（OpenAIService.gs）

- [x] 3.1 修改 `src/OpenAIService.gs` 的 `buildSystemPrompt()` 函數簽名為 `buildSystemPrompt(expenseCategories, incomeCategories, accountNames)`（OpenAI 帳戶名稱：從清單選擇設計），在 prompt 規則第 7 條改為：「帳戶名稱必須從以下帳戶清單中選擇最接近的名稱；若完全無法對應則填空字串：[清單用頓號串接]」；相應修改 `parseWithOpenAI()` 函數簽名為 `parseWithOpenAI(message, expenseCategories, incomeCategories, accountNames)` 並傳遞 `accountNames` 給 `buildSystemPrompt()`；Parse text messages with OpenAI 需求（已修改）。驗收：傳送「玉山信用卡 加油1500」到 LINE Bot，回覆的帳戶名稱為「玉山」而非「玉山信用卡」或其他自由文字。

- [x] 3.2 修改 `src/OpenAIService.gs` 的 `buildPdfSystemPrompt()` 函數簽名為 `buildPdfSystemPrompt(expenseCategories, incomeCategories, accountNames)`，在輸出格式說明中補充 `"account"` 必須從帳戶清單選擇的指示；相應修改 `parsePdfWithOpenAI()` 函數簽名加入 `accountNames` 第四參數；Batch parse bank statement text with OpenAI 需求（已修改）。驗收：傳送永豐銀行帳戶明細 PDF 後，交易紀錄的帳戶名稱欄位為「永豐大戶」。

## 4. LINE Bot 指令偵測與查詢處理（Main.gs）

- [x] 4.1 在 `src/Main.gs` 新增 `detectBalanceCommand(text)` 函數（Detect balance query commands 需求、指令偵測放在 handleTextMessage 最前面設計）：依序匹配：精確指令（餘額/查餘額/所有餘額/帳戶餘額）→ accountName=null；帳戶清單指令（帳戶清單/帳戶列表）→ accountName='__LIST__'；後綴格式（X餘額）→ accountName=X；前綴格式（餘額 X）→ accountName=X；其他 → isCommand=false。驗收：在 GAS Logger 測試各輸入，「餘額」回傳 `{isCommand:true,accountName:null}`；「永豐大戶餘額」回傳 `{isCommand:true,accountName:'永豐大戶'}`；「午餐80」回傳 `{isCommand:false,accountName:null}`。

- [x] 4.2 在 `src/Main.gs` 新增 `formatAmount(amount)` 輔助函數：正數回傳 `"x2,500"`，負數回傳 `"-$3,000"`，使用絕對值加千分位格式。驗收：`formatAmount(12500)` 回傳 `"x2,500"`；`formatAmount(-3000)` 回傳 `"-$3,000"`；`formatAmount(0)` 回傳 `"$0"`。

- [x] 4.3 在 `src/Main.gs` 新增 `handleBalanceCommand(replyToken, accountName, ss)` 函數（Reply with all account balances、Reply with single account balance、Reply with account list 需求）：

- [x] 4.4 修改 `src/Main.gs` 的 `handleTextMessage()` 函數，在最前面（`isBankStatement()` 之前）插入指令偵測邏輯（指令偵測放在 handleTextMessage 最前面設計）：呼叫 `detectBalanceCommand(userMessage)`，若 `isCommand===true` 則呼叫 `handleBalanceCommand()` 並 return，不繼續後續記帳流程。驗收：傳送「餘額」觸發餘額查詢回覆；傳送「午餐80」正常記帳且無干擾。

## 5. Main.gs 呼叫端更新（傳遞 accountNames）

- [x] 5.1 修改 `src/Main.gs` 的 `handleTextMessage()` 函數：在讀取分類清單後新增 `var accounts = getAccounts(ss); var accountNames = accounts.map(function(a){ return a.name; });`，將 `accountNames` 傳入 `parseWithOpenAI()` 呼叫（第四參數）。驗收：傳送「玉山信用卡 加油1500」後，交易紀錄 C 欄為「玉山」而非其他名稱。

- [x] 5.2 修改 `src/Main.gs` 的 `handleFileMessage()` 和 `handleBankStatementText()` 函數：同樣讀取 `accountNames` 並傳入 `parsePdfWithOpenAI()` 呼叫（第四參數）。驗收：傳送 PDF 帳單後，交易紀錄 C 欄帳戶名稱符合帳戶管理清單中的名稱（例如「永豐大戶」）。

## 6. 端到端驗證

- [x] 6.1 執行 `initializeSheets()`，手動在「帳戶管理」D 欄填入一個帳戶的初始餘額（例如 永豐大戶：200000）、E 欄填入 2026/01/01，然後在 LINE 傳送「永豐大戶餘額」確認回覆包含正確的初始餘額與當前計算餘額；驗收對應可觀察行為（驗收條件）第 1–7 點。

- [x] 6.2 在 LINE 傳送「帳戶清單」確認回覆「📋 帳戶清單（共 13 個）」並列出所有帳戶名稱；傳送「所有餘額」確認全覽格式正確；傳送「聯邦餘額」確認回覆列出可用帳戶名稱；確認範圍邊界中列出的範圍外項目（自動餘額更新、帳戶轉帳配對等）均未被實作。
