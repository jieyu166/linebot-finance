# Ahorro 風格記帳網頁 App 設計

日期：2026-09-06
狀態：待使用者審閱

## 目標

在現有 GAS 專案上新增手機版網頁介面（Android Chrome「加到主畫面」當 App 用），仿 Ahorro 的操作感，直接讀寫同一份 Google 試算表。LINE Bot 的帳單匯入流程維持不變。

功能：單筆交易新增／修改／刪除、月預算（分類與帳戶）、分類更名與圖示顏色、統計圓餅圖、帳戶餘額、帳戶間轉帳配對、信用卡獨立帳戶與繳卡費自動配對。

## 不做

離線快取、電子發票掃描、多使用者、推播通知、自動轉帳配對、原生 App。

## 架構

- 新增 `src/WebApp.gs`（後端 API）與 `src/Index.html`（前端單頁，含 CSS/JS）。
- `doGet(e)`：`e.parameter.ui === '1'` 時回傳 `HtmlService.createHtmlOutputFromFile('Index')`，否則維持回傳 `OK`（LINE 部署驗證用）。
- 前端用 `google.script.run` 呼叫後端；不使用 OAuth、Sheets API 或外部後端。
- 兩個部署：LINE Webhook 部署維持「所有人」；App 用另一個部署，「執行身分：我」「存取權：只有我自己」。App 網址為該部署 URL 加 `?ui=1`。
- 所有寫入以 `LockService.getScriptLock()` 包住，避免與 LINE 同時寫入衝突。

## 試算表變更

### 交易紀錄

| 欄 | 名稱 | 說明 |
|---|---|---|
| A–J | 既有 | 不變 |
| K | ID | `Utilities.getUuid()`，每列唯一。App 修改／刪除靠 ID 定位，不靠列號 |
| L | 轉帳ID | 配對的兩列共用同一 UUID；空白表示非轉帳配對 |

- `appendTransaction` 與 `appendTransactionsBatch` 改為寫入 12 欄，K 欄產生 UUID，L 欄空白。
- 一次性函式 `backfillTransactionIds()`：K 欄空白的列補上 UUID。README 設定步驟加入執行說明。

### 帳戶管理

| 欄 | 名稱 | 說明 |
|---|---|---|
| A–G | 既有 | 不變 |
| H | 帳戶類型 | `現金`／`銀行`／`信用卡`／`證券`。空白時：名稱含「現金」視為現金，其餘視為銀行 |

- `initializeSheets()` 對既有工作表只補 H 欄標題，不改資料。
- 新增信用卡帳戶列（使用者填）：永豐信用卡（永豐銀行）、一銀信用卡（第一銀行）、玉山信用卡（玉山銀行）、台新信用卡、富邦信用卡、國泰信用卡；既有「一銀」「國泰」等純信用卡機構的帳戶改類型為 `信用卡`，或改名為 XX信用卡。
- 信用卡帳戶餘額為負數代表未繳金額；初始餘額填「上期未繳金額的負數」，初始日期填該期結帳日。

### 信用卡與銀行帳戶分離規則

1. 信用卡帳單匯入的每筆消費記在對應**信用卡帳戶**（支出，依商店分類）；回饋記收入。
2. 銀行明細中的「卡款扣繳」記在**銀行帳戶**，類型支出、分類「繳信用卡」，帳戶為銀行帳戶。
3. 寫入「繳信用卡」列後，後端呼叫 `autoPairCreditCardPayment(row)`：在同幣別的信用卡帳戶中找「同機構優先、金額相同、日期前後 10 天內、無轉帳 ID」的信用卡帳單繳款確認列，或找不到時**直接新增一列**到該信用卡帳戶：收入／轉帳、同金額、同日期、品項「卡費入帳」，並把兩列寫入同一轉帳 ID。判斷對應信用卡帳戶的順序：明細文字含卡名（如「永豐卡費」→ 永豐信用卡）→ 同機構唯一信用卡帳戶 → 無法判斷則不配對，留給 App 手動連結。
4. 餘額計算移除「排除繳信用卡」規則：繳卡費在銀行帳戶扣款、在信用卡帳戶加回，各自真實。
5. 統計排除所有有轉帳 ID 的列，因此繳卡費不算花費；消費只在信用卡帳戶記一次。

### 證券帳戶規則

- `證券` 類型帳戶代表**交割銀行帳戶的現金**，不記持股數量與市值。使用者的永豐交割戶與永豐大戶是永豐銀行兩個不同帳號，因此「永豐證券」帳戶保留、類型設為 `證券`；台新證券同理。
- 證券對帳單匯入：買進記支出／投資、賣出記收入／投資獲利，帳戶填交割戶（永豐證券／台新證券），股名寫在品項與明細。
- 銀行明細中大戶→交割戶的匯款（描述含「交割」「證券」「轉帳」且對方為自家交割戶）：記在銀行帳戶為支出／轉帳，並以與繳卡費相同的機制自動配對到交割戶（收入／轉帳），共用轉帳 ID；交割戶→大戶的回匯方向相反。判斷對象交割戶的順序：描述含「證券」「交割」→ 同機構唯一證券帳戶；無法判斷則留待 App 手動連結。
- 銀行明細若直接出現「交割扣款」（同帳號同時是交割戶）則跳過，因對帳單已記。此情況目前不適用於使用者，僅為規則完整性保留。
- 統計排除轉帳，故大戶→交割戶的匯款不算花費；買股票在交割戶記一次「投資」支出。

### OpenAI prompt 調整

- 帳戶清單改為傳入 `{name, institution, type}`；prompt 說明「信用卡帳單 → account 選 type=信用卡 的帳戶；銀行帳戶明細 → 選 type=銀行；證券對帳單 → 選 type=證券」。
- 輸出 JSON 新增 `statementType`：`信用卡`／`銀行帳戶`／`證券`。後端以此驗證：信用卡帳單的每筆 account 必須是信用卡帳戶，否則依機構自動改成該機構的信用卡帳戶。
- 信用卡帳單中的「自動扣繳／已入帳」確認行維持跳過（銀行端會產生配對列）。
- 範例 1（第一銀行信用卡）account 改為「一銀信用卡」；範例 2（永豐帳戶明細）「永豐卡費」列 account 維持「永豐大戶」、分類「繳信用卡」。
- `statementType` 增加 `證券`；證券對帳單每筆 account 必須是 `證券` 類型帳戶，否則依機構自動改正。
- 銀行明細範例加入「大戶→交割戶匯款」列：type 支出、category 轉帳、account 永豐大戶、description 保留原文以利配對判斷。
- 匯入回覆訊息加一行「帳單類型：信用卡／銀行帳戶／證券」，以及「已自動配對 N 筆（繳卡費 / 交割戶匯款）」。

### 舊資料搬移

一次性函式 `migrateCreditCardRows()`（在 GAS 編輯器手動執行，先 Logger 預覽再寫入）：
- 條件：J 欄原始訊息為「PDF匯入」或「文字匯入」，分類不是「繳信用卡」，且帳戶為 `信用卡` 類型機構對應的銀行帳戶（依對照表：永豐大戶→永豐信用卡 僅限信用卡帳單來源）。
- 因舊資料無法從列本身分辨帳單來源，函式改以「執行時傳入日期區間與來源帳戶→目標卡帳戶」的方式手動指定，例如 `migrateCreditCardRows('永豐大戶', '永豐信用卡', '2026/03/01', '2026/03/31')`，並先以 `dryRun=true` 印出將搬移的列。
- 搬移後對既有「繳信用卡」列執行 `autoPairCreditCardPayment` 補配對。

### 支出分類、收入分類

| 欄 | 名稱 | 說明 |
|---|---|---|
| A | 分類名稱 | 既有 |
| B | 圖示 | 單一 emoji，空白時前端顯示分類名第一字 |
| C | 顏色 | hex 如 `#F5A623`，空白時前端依索引配預設色 |

`getCategories()` 仍只讀 A 欄。`initializeSheets()` 對既有分類表不動；收入分類若無「轉帳」則追加一列。

### 預算（新工作表）

| 欄 | 名稱 | 說明 |
|---|---|---|
| A | 類型 | `分類` 或 `帳戶` |
| B | 名稱 | 分類名稱或帳戶名稱 |
| C | 月預算 | 數字 |

同類型同名稱只保留一列，`saveBudget` 以 upsert 方式處理。預算為每月固定金額，不分月份。

## 後端 API（WebApp.gs）

| 函式 | 說明 |
|---|---|
| `getBootstrap()` | 回傳 `{expenseCategories:[{name,icon,color}], incomeCategories:[...], accounts:[...], budgets:[...]}` |
| `listTransactions(yearMonth)` | 回傳該月交易陣列 `{id, date, institution, account, type, category, item, description, currency, amount, transferId, rowIndex}`，依日期倒序 |
| `saveTransaction(tx)` | `tx.id` 存在則更新該列，否則新增。回傳存檔後的物件 |
| `deleteTransaction(id, alsoLinked)` | 刪除該列；`alsoLinked` 為 true 且有轉帳 ID 時一併刪配對列 |
| `createTransfer({fromAccount, toAccount, amount, date, note})` | 寫入兩列，共用新轉帳 ID。轉出列：支出／轉帳；轉入列：收入／轉帳。幣別取轉出帳戶幣別 |
| `linkTransfer(idA, idB)` | 兩列寫入同一轉帳 ID，分類改為「轉帳」。兩列帳戶相同或已有轉帳 ID 時拋錯 |
| `unlinkTransfer(transferId)` | 清除該轉帳 ID 的所有列 L 欄 |
| `findTransferCandidates(id)` | 回傳其他帳戶、金額相同、日期前後 7 天內、無轉帳 ID 的交易 |
| `getStats(yearMonth, type)` | 回傳 `{total, byCategory:[{name, amount, ratio}]}`，排除有轉帳 ID 的列 |
| `getBalances()` | 沿用 `getAllAccountBalances`，回傳時附帳戶類型，前端分「資產」「信用卡」兩區 |
| `autoPairCreditCardPayment(row)` | 見「信用卡與銀行帳戶分離規則」第 3 點；LINE 匯入與 App 新增「繳信用卡」時皆呼叫 |
| `autoPairBrokerageTransfer(row)` | 銀行↔交割戶匯款配對，規則見「證券帳戶規則」；與上者共用 `autoPairTransfer(row, targetType, direction)` 核心 |
| `migrateCreditCardRows(fromAccount, toAccount, startDate, endDate, dryRun)` | 舊資料搬移，見上 |
| `saveAccount(account)` | 更新帳戶管理列的初始餘額、初始日期 |
| `saveBudget({kind, name, amount})` | upsert；amount 為 0 或空則刪除該列 |
| `saveCategory({type, name, icon, color, oldName})` | 新增或更新分類列；`oldName` 存在且不同時執行更名 |
| `renameCategory(type, oldName, newName)` | 分類表更名，並把交易紀錄 E 欄與預算表 B 欄的舊名全部替換為新名。回傳替換筆數 |

日期一律以 `yyyy/MM/dd` 字串交換；金額為正數；月份參數格式 `yyyy-MM`。

純邏輯抽成不碰試算表的函式（例如 `filterRowsByMonth`、`summarizeByCategory`、`summarizeBudgetUsage`、`replaceCategoryInRows`、`pickTransferCandidates`），供 Node 測試。

## 前端畫面（Index.html）

淺色底、單一強調色、圓形分類圖示，底部四個分頁。

1. **紀錄**：頂部月份切換（‹ 2026/09 ›），下方依日期分組，每筆顯示分類圖示（分類顏色底）、品項、帳戶、金額（支出紅、收入綠）。已配對轉帳顯示 ⇄ 與對方帳戶名。右下角「+」浮動按鈕。點一筆進編輯頁。
2. **預算**：本月各分類、各帳戶的已用／預算進度條與剩餘金額；≥80% 橘色、≥100% 紅色。點一列可改金額。頂部按鈕可新增預算項目。
3. **統計**：本月支出（可切收入）分類圓餅圖（純 SVG，不載入圖表庫），下方各分類金額與比例列表，點分類跳到紀錄頁並套篩選。排除已配對轉帳。
4. **帳戶**：分「資產」（現金／銀行／證券）與「信用卡」兩區；信用卡帳戶顯示「未繳 $X」。點入可改初始餘額、初始日期、帳戶類型。

**新增／編輯頁**：頂部三段切換「支出／收入／轉帳」。支出、收入模式：上半部金額顯示與數字鍵盤（支援 + − × ÷ 與 =），下半部分類圖示格、帳戶選單、日期、品項、備註。編輯既有交易時多「刪除」與「連結為轉帳」按鈕。轉帳模式：轉出帳戶、轉入帳戶、金額鍵盤、日期、備註。

**連結為轉帳**：顯示候選清單（`findTransferCandidates`），選一筆後確認。已配對的交易顯示「解除連結」。

**分類管理**（右上角齒輪）：支出／收入兩個列表，每列可改名稱、圖示、顏色，可新增。更名時提示「歷史交易與預算會一併改名」。

**共用行為**：每次後端呼叫顯示載入指示；失敗顯示 toast 並保留表單內容；成功寫入後重新載入該月資料。

## 錯誤處理

- 後端函式一律 `try/catch` 後 `throw new Error(中文訊息)`，前端 `withFailureHandler` 顯示。
- `saveTransaction` 找不到 ID 時回傳錯誤「找不到這筆交易，可能已被刪除」。
- `linkTransfer` 驗證：兩筆帳戶不同、幣別相同、皆無轉帳 ID。
- 分類更名時新名稱已存在則拒絕。

## 測試

- Node 測試（`npm test`）新增：月份篩選、預算彙總、統計彙總（排除轉帳）、分類更名替換、轉帳候選篩選、繳卡費自動配對的信用卡帳戶判斷、餘額計算不再排除繳信用卡。
- Prompt 測試：使用者提供的信用卡帳單與銀行明細 PDF／文字各至少一份，驗證 `statementType` 與 account 對應正確，以及繳卡費配對成功。
- 部署後用瀏覽器工具做端到端：新增一筆、修改、刪除、建立轉帳、連結既有兩筆、更名分類、設定預算，並到試算表核對。

## 對現有規格的影響

- `text-accounting`、`pdf-batch-import`：交易紀錄寫入改為 12 欄（新增 ID、轉帳ID）。
- `account-management`：新增帳戶類型欄；餘額計算移除「排除繳信用卡」規則。
- 新增規格：`webapp-transactions`、`budget`、`category-management`、`transfer-pairing`、`credit-card-accounts`。
