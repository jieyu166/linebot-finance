# webapp-transactions Specification

## Purpose

在既有 LINE Bot 記帳系統之外，提供一個手機優先的網頁 App（第二個 Web App 部署，`?ui=1`），讓使用者直接在瀏覽器操作「紀錄／預算／統計／帳戶」四個分頁：瀏覽與編輯當月交易、新增支出／收入／轉帳、手動連結轉帳配對、查看分類統計與帳戶餘額。前端透過 `google.script.run` 呼叫 `WebApp.gs` 的 `api*` 函式，所有讀寫直接落地到同一份 Google 試算表，不使用獨立資料庫或 OAuth。

## Requirements

### Requirement: Serve the web app HTML entry point

The system SHALL, in `doGet(e)`, return the web app's HTML page when `e.parameter.ui === '1'`, built via `HtmlService.createTemplateFromFile('Index').evaluate()` with title "記帳" and a `viewport` meta tag (`width=device-width, initial-scale=1, viewport-fit=cover`). When `ui` is not `'1'` (including no parameters at all), `doGet` SHALL return `ContentService.createTextOutput('OK')` unchanged, preserving the existing LINE-deployment health check.

`Index.html` SHALL assemble the page from separate HTML part-files via the server-side `include(name)` helper (`HtmlService.createHtmlOutputFromFile(name).getContent()`), including `Styles`, `ClientLogic`, and `App` in that order inside `<?!= include('xxx') ?>` template tags.

The app SHALL be deployed as a **second** Web App deployment (distinct from the LINE webhook deployment, which stays "執行身分：我／存取權：所有人"), configured with "執行身分：我" and "存取權：只有我自己"; the app is reached at that deployment's URL with `?ui=1` appended.

#### Scenario: ui=1 returns the app shell

- **WHEN** `doGet({ parameter: { ui: '1' } })` is called
- **THEN** it returns an `HtmlOutput` built from the `Index` template, titled "記帳", with the viewport meta tag set

#### Scenario: No ui parameter preserves LINE health check

- **WHEN** `doGet({ parameter: {} })` or `doGet(undefined)` is called
- **THEN** it returns `ContentService.createTextOutput('OK')`

---
### Requirement: Bootstrap initial app data

The system SHALL provide `apiBootstrap(ss)` returning `{ expenseCategories, incomeCategories, accounts, budgets, today }` where:
- `expenseCategories` / `incomeCategories` are `getCategoryRows('支出分類'|'收入分類', ss)` mapped to `{ name, icon, color }` (dropping `rowIndex`).
- `accounts` is `getAccounts(ss)` mapped to `{ name, institution, currency, type }`.
- `budgets` is `getBudgets(ss)` mapped to `{ kind, name, budget }`.
- `today` is `Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd')`.

Any error thrown while assembling this data SHALL be re-thrown as `new Error(e.message)` so the message reaches the client's `withFailureHandler`.

#### Scenario: Bootstrap returns view-shaped data

- **WHEN** `apiBootstrap(ss)` is called on a spreadsheet with 21 expense categories, 10 income categories (plus "轉帳"), 21 accounts, and 2 budgets
- **THEN** it returns an object whose `expenseCategories`/`incomeCategories` entries only carry `name`/`icon`/`color`, whose `accounts` entries only carry `name`/`institution`/`currency`/`type`, and whose `today` is today's date in `yyyy/MM/dd` format for Asia/Taipei

---
### Requirement: List a month's transactions with linked-account annotation

The system SHALL provide `apiListTransactions(yearMonth, ss)` that loads every transaction row (via `getTransactionRows` + `rowToTransaction`), filters to `yearMonth` via `filterTransactionsByMonth`, and annotates each returned transaction with a `linkedAccount` field: the `account` of its transfer-paired counterpart (found by matching `transferId` against the full unfiltered transaction set) when one exists, else `''`. `filterTransactionsByMonth` SHALL sort results by date descending, and for same-date rows by `rowIndex` descending (most recently added first).

#### Scenario: Paired transaction carries the counterpart's account name

- **WHEN** two transactions share `transferId` "tr-1" — one on 永豐大戶, one on 永豐信用卡 — and both fall in the requested month
- **THEN** `apiListTransactions` returns the 永豐大戶 row with `linkedAccount: '永豐信用卡'` and the 永豐信用卡 row with `linkedAccount: '永豐大戶'`

#### Scenario: Unpaired transaction has an empty linkedAccount

- **WHEN** a transaction has an empty `transferId`
- **THEN** its returned `linkedAccount` is `''`

---
### Requirement: Save (create or update) a transaction with validation

The system SHALL provide `apiSaveTransaction(tx, ss)` that validates, in order:
1. `amount = parseAmount(tx.amount)` must be `> 0`, else throw `Error('金額必須大於 0')`.
2. `tx.type` must be exactly `'支出'` or `'收入'`, else throw `Error('類型必須是支出或收入')`.
3. `tx.category` must be non-empty after trimming, else throw `Error('請選擇分類')`.
4. `tx.account` must resolve via `findAccountByName(getAccounts(ss), tx.account)`, else throw `Error('找不到帳戶「' + tx.account + '」')`.

On success, the function copies `tx` into a payload, overwrites `institution` with the resolved account's `institution` and `amount` with the parsed numeric amount. When `tx.id` is absent (create), it sets `source = 'App'` and appends the row via `appendTransactionsBatch([payload], 'App', ss)`; when the saved category is `繳信用卡` or `轉帳`, it additionally calls `tryAutoPair([written], ss)` and sets `written.autoPaired = pairing.paired > 0` on the returned object. When `tx.id` is present (update), it calls `updateTransactionById(payload, ss)` instead, and no auto-pairing is attempted.

#### Scenario: New expense fails validation with a non-positive amount

- **WHEN** `apiSaveTransaction({ amount: 0, type: '支出', category: '飲食', account: '現金' }, ss)` is called
- **THEN** the system throws an error with message "金額必須大於 0" and no row is written

#### Scenario: New transaction with unknown account is rejected

- **WHEN** `apiSaveTransaction({ amount: 100, type: '支出', category: '飲食', account: '不存在帳戶' }, ss)` is called
- **THEN** the system throws an error with message "找不到帳戶「不存在帳戶」"

#### Scenario: New 繳信用卡 transaction attempts auto-pairing and flags the result

- **WHEN** a new (no `id`) transaction with category "繳信用卡" is saved and `tryAutoPair` successfully pairs it to a card account
- **THEN** the returned object has `autoPaired: true`

#### Scenario: Updating an existing transaction does not attempt auto-pairing

- **WHEN** `apiSaveTransaction({ id: 'existing-id', amount: 200, type: '支出', category: '飲食', account: '現金' }, ss)` is called
- **THEN** `updateTransactionById` is used to update the row in place and the returned object has no `autoPaired` field

---
### Requirement: Delete a transaction, optionally including its transfer counterpart

The system SHALL provide `apiDeleteTransaction(id, alsoLinked, ss)` delegating to `deleteTransactionById(id, alsoLinked, ss)`, which:
1. Throws `Error('找不到這筆交易，可能已被刪除')` when `id` matches no row.
2. When the target has a non-empty `transferId`, identifies its linked partner row(s) (same `transferId`, different `id`).
3. When `alsoLinked` is truthy, deletes the target row and all linked partner rows.
4. When `alsoLinked` is falsy, deletes only the target row and clears column L (轉帳ID) on each linked partner row (leaving the partner's category untouched).
5. Deletes rows in descending `rowIndex` order (to avoid row-shift bugs when multiple rows are removed) and returns `{ deleted: <count> }`.

#### Scenario: Deleting an unpaired transaction removes just that row

- **WHEN** `apiDeleteTransaction('id-1', false, ss)` is called for a transaction with an empty `transferId`
- **THEN** only that row is deleted and the function returns `{ deleted: 1 }`

#### Scenario: Deleting one side of a pair without alsoLinked clears the partner's transfer ID

- **WHEN** `apiDeleteTransaction('id-1', false, ss)` is called for a transaction paired with `id-2` via `transferId` "tr-1"
- **THEN** row `id-1` is deleted, row `id-2`'s L 欄 (轉帳ID) becomes empty, and its E 欄 (分類) is left unchanged; the function returns `{ deleted: 1 }`

#### Scenario: Deleting with alsoLinked removes both paired rows

- **WHEN** `apiDeleteTransaction('id-1', true, ss)` is called for a transaction paired with `id-2`
- **THEN** both rows are deleted and the function returns `{ deleted: 2 }`

---
### Requirement: Create a manual transfer between two accounts from the app

The system SHALL provide `apiCreateTransfer(params, ss)` delegating directly to `createTransfer(params, ss)` (see transfer-pairing spec), used by the app's 轉帳 editor mode to write a matched pair of 支出／收入 rows sharing one transfer ID.

#### Scenario: App creates a same-currency transfer

- **WHEN** the app calls `apiCreateTransfer({ fromAccount: '永豐大戶', toAccount: '玉山', amount: 500, date: '2026/09/07', note: '' }, ss)`
- **THEN** two new rows are appended sharing one transfer ID, per the `createTransfer` behavior in the transfer-pairing spec

---
### Requirement: List manual transfer-link candidates for a transaction

The system SHALL provide `apiTransferCandidates(id, ss)` that looks up the transaction matching `id` among all loaded transactions, throws `Error('找不到這筆交易，可能已被刪除')` if none matches, and otherwise returns `pickManualTransferCandidates(target, all, accounts)` — a 7-day window, any-category search (see transfer-pairing spec's manual-linking requirement) — including each candidate's `rowIndex`.

#### Scenario: Candidates omit the target transaction itself and paired rows

- **WHEN** `apiTransferCandidates('id-1', ss)` is called
- **THEN** the returned list never includes the row with id "id-1", nor any row that already carries a non-empty 轉帳ID

#### Scenario: Unknown id throws

- **WHEN** `apiTransferCandidates('missing-id', ss)` is called and no transaction has that id
- **THEN** the system throws an error with message "找不到這筆交易，可能已被刪除"

---
### Requirement: Manually link and unlink transfer pairs from the app

The system SHALL provide `apiLinkTransfer(idA, idB, ss)` delegating to `linkTransfer(idA, idB, ss)`, and `apiUnlinkTransfer(transferId, ss)` delegating to `unlinkTransfer(transferId, ss)` (both defined in the transfer-pairing spec). The app's editor exposes "連結為轉帳" (opens the candidate sheet, then calls `apiLinkTransfer`) when a transaction is unpaired, and "解除連結" (calls `apiUnlinkTransfer`) when it is already paired.

#### Scenario: Linking two candidates from the app

- **WHEN** the user picks a candidate in the app's link sheet and confirms
- **THEN** `apiLinkTransfer(idA, idB, ss)` is called and, per `linkTransfer`'s validation rules, either succeeds (both rows share a new transfer ID) or throws one of `linkTransfer`'s error messages, which the app surfaces via a toast

---
### Requirement: Category statistics for a month, excluding paired transfers

The system SHALL provide `apiStats(yearMonth, type, ss)` returning `summarizeByCategory(filterTransactionsByMonth(all, yearMonth), type)`, i.e. `{ total, byCategory: [{ name, amount, ratio }] }` for the given `type` ('支出' or '收入'). `summarizeByCategory` SHALL skip any transaction whose `type` does not match the requested `type`, and SHALL also skip any transaction with a non-empty `transferId` (paired transfers do not count as spending/income for statistics purposes). `byCategory` entries are sorted by `amount` descending; `ratio` is `amount / total` rounded to 3 decimal places (0 when `total` is 0).

#### Scenario: Paired transfer rows are excluded from stats

- **WHEN** a month's transactions include a 支出 row on 永豐大戶 and its paired 收入 row on 永豐信用卡 sharing a `transferId` (a 繳信用卡 auto-pair), alongside an unpaired 飲食 支出 row
- **THEN** `apiStats(yearMonth, '支出', ss).byCategory` reflects only the unpaired 飲食 row; the paired 繳信用卡 row does not contribute to `total`

#### Scenario: byCategory sorted by amount descending with rounded ratio

- **WHEN** a month has 支出 totals of 3000 (飲食) and 1000 (交通), both unpaired
- **THEN** `apiStats` returns `total: 4000` and `byCategory` `[{ name: '飲食', amount: 3000, ratio: 0.75 }, { name: '交通', amount: 1000, ratio: 0.25 }]`

---
### Requirement: Update account settings from the app

The system SHALL provide `apiSaveAccount(name, params, ss)` delegating to `updateAccountSettings(name, params, ss)`, which locates the "帳戶管理" row by normalized name match, throws `Error('找不到帳戶「' + name + '」')` if none matches, and otherwise updates only the fields present in `params`: `initialBalance` (D 欄, when `params.initialBalance !== undefined`), `initialDate` (E 欄, when `params.initialDate !== undefined`), and `type` (H 欄, when `params.type` is a non-empty string). It returns the updated row's index.

#### Scenario: Saving updates only the provided fields

- **WHEN** `apiSaveAccount('永豐大戶', { initialBalance: 200000, initialDate: '2026/01/01', type: '銀行' }, ss)` is called
- **THEN** the 帳戶管理 row's D、E、H 欄 are updated to those values and the row index is returned

#### Scenario: Unknown account name throws

- **WHEN** `apiSaveAccount('不存在帳戶', {}, ss)` is called
- **THEN** the system throws an error with message "找不到帳戶「不存在帳戶」"

---
### Requirement: Report all active account balances

The system SHALL provide `apiBalances(ss)` delegating to `getAllAccountBalances(ss)` (see account-management spec), used by the app's 帳戶 tab to render 【資產】 and 【信用卡】 sections; the app shows credit-card balances as "未繳 $X" (negative `currentBalance`) via the same `creditCardLabel` formatting used elsewhere, and other accounts as their raw `currentBalance`.

#### Scenario: Accounts tab separates assets from credit cards

- **WHEN** the app's 帳戶 tab loads and `apiBalances(ss)` returns a mix of `type` "銀行"／"現金"／"證券" and "信用卡" accounts
- **THEN** the client renders non-信用卡 accounts under 【資產】 and 信用卡 accounts under 【信用卡】, each row showing name and formatted balance
