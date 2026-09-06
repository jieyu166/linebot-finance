# Ahorro 風格記帳網頁 App 設計

日期：2026-09-06
狀態：待使用者審閱

## 目標

在現有 GAS 專案上新增手機版網頁介面（Android Chrome「加到主畫面」當 App 用），仿 Ahorro 的操作感，直接讀寫同一份 Google 試算表。LINE Bot 的帳單匯入流程維持不變。

功能：單筆交易新增／修改／刪除、月預算（分類與帳戶）、分類更名與圖示顏色、統計圓餅圖、帳戶餘額、帳戶間轉帳配對。

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
| `getBalances()` | 沿用 `getAllAccountBalances` |
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
4. **帳戶**：各帳戶當前餘額，點入可改初始餘額與初始日期；此頁顯示「餘額 = 初始 + 收入 − 支出」的說明。

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

- Node 測試（`npm test`）新增：月份篩選、預算彙總、統計彙總（排除轉帳）、分類更名替換、轉帳候選篩選。
- 部署後用瀏覽器工具做端到端：新增一筆、修改、刪除、建立轉帳、連結既有兩筆、更名分類、設定預算，並到試算表核對。

## 對現有規格的影響

- `text-accounting`、`pdf-batch-import`：交易紀錄寫入改為 12 欄（新增 ID、轉帳ID）。
- `account-management`：餘額計算不變。
- 新增規格：`webapp-transactions`、`budget`、`category-management`、`transfer-pairing`。
