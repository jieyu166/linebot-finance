# budget Specification

## Purpose

提供每月預算主檔（依分類或依帳戶設定月預算金額）與預算使用狀況彙總，供網頁 App「預算」分頁顯示各項目的已用金額、剩餘金額與超支警示。預算計算排除已配對轉帳，只計算真正的支出。

## Requirements

### Requirement: Initialize the 預算 worksheet

The system SHALL create a worksheet named "預算" when `initializeSheets()` runs, if it does not already exist, with a 3-column header in row 1: A 類型, B 名稱, C 月預算. Existing "預算" worksheets are left untouched by `initializeSheets()`.

#### Scenario: First-time initialization creates the 預算 sheet

- **WHEN** `initializeSheets()` runs and no "預算" worksheet exists
- **THEN** the system creates it with header row `['類型', '名稱', '月預算']` and freezes row 1

---
### Requirement: Read the budget list

The system SHALL provide `getBudgets(ss)` reading all data rows (A–C) from "預算" and returning an array of `{ kind, name, budget, rowIndex }`, where `kind` is column A trimmed (`'分類'` or `'帳戶'`), `name` is column B trimmed (rows with an empty name are skipped), and `budget` is `Math.abs(parseAmount(row[2]))`.

#### Scenario: Returns one entry per non-empty row

- **WHEN** the "預算" sheet has 2 data rows, `['分類', '飲食', 5000]` and `['帳戶', '永豐大戶', 10000]`
- **THEN** `getBudgets(ss)` returns `[{ kind: '分類', name: '飲食', budget: 5000, rowIndex: 2 }, { kind: '帳戶', name: '永豐大戶', budget: 10000, rowIndex: 3 }]`

---
### Requirement: Upsert or delete a budget entry

The system SHALL provide `upsertBudget(params, ss)` where `params` is `{ kind, name, amount }`. It SHALL locate an existing budget row matching `kind` exactly and `name` by normalized comparison. When `Math.abs(parseAmount(params.amount)) <= 0`:
- If a matching row exists, delete that row (`sheet.deleteRow`) and return `{ rowIndex: <deleted row's index>, deleted: true }`.
- If no matching row exists, return `{ rowIndex: 0, deleted: true }` without modifying the sheet.

Otherwise (amount > 0), write `[kind, name, amount]` to the matching row if one exists, else append a new row at `sheet.getLastRow() + 1`, and return `{ rowIndex: <written row's index>, deleted: false }`. The write SHALL be wrapped in `LockService.getScriptLock()`.

#### Scenario: Amount of 0 deletes an existing budget

- **WHEN** `upsertBudget({ kind: '分類', name: '飲食', amount: 0 }, ss)` is called and a 飲食 budget row already exists
- **THEN** that row is deleted from "預算" and the function returns `{ rowIndex: <its former row>, deleted: true }`

#### Scenario: Amount of 0 with no existing row is a no-op

- **WHEN** `upsertBudget({ kind: '帳戶', name: '玉山', amount: 0 }, ss)` is called and no 玉山 帳戶 budget row exists
- **THEN** no row is added or removed, and the function returns `{ rowIndex: 0, deleted: true }`

#### Scenario: Positive amount creates a new budget row

- **WHEN** `upsertBudget({ kind: '分類', name: '交通', amount: 2000 }, ss)` is called and no matching row exists
- **THEN** a new row `['分類', '交通', 2000]` is appended and the function returns `{ rowIndex: <new row>, deleted: false }`

#### Scenario: Positive amount overwrites an existing budget row's amount

- **WHEN** `upsertBudget({ kind: '分類', name: '交通', amount: 3000 }, ss)` is called and a 交通 budget row already holds 2000
- **THEN** that row's C 欄 (月預算) becomes 3000 and the function returns `{ rowIndex: <same row>, deleted: false }`

---
### Requirement: Summarize monthly budget usage per category or account

The system SHALL provide `summarizeBudgetUsage(txs, budgets, yearMonth)` that, for each entry in `budgets`, computes `used` by summing `Math.abs(parseAmount(tx.amount))` over every transaction in `txs` where `tx.type === '支出'`, `!tx.transferId` (paired transfers excluded), `monthKeyOf(tx.date) === yearMonth`, and either (`kind === '分類'` and `tx.category === name`) or (`kind === '帳戶'` and `normalizeName(tx.account) === normalizeName(name)`). It returns one object per budget: `{ kind, name, budget, used, remaining: budget - used, ratio, level }`, where `ratio = used / budget` rounded to 3 decimals (0 when `budget` is 0), and `level = budgetLevel(ratio)`.

`budgetLevel(ratio)` SHALL return `'over'` when `ratio >= 1`, `'warn'` when `ratio >= 0.8` (and `< 1`), and `'ok'` otherwise (`ratio < 0.8`).

`apiBudgetUsage(yearMonth, ss)` SHALL expose this as `summarizeBudgetUsage(loadAllTransactions_(ss), getBudgets(ss), yearMonth)`.

#### Scenario: Category budget usage excludes paired transfers

- **WHEN** a 飲食 budget of 5000 exists, and the month's transactions include an unpaired 飲食 支出 of 2000 plus a paired (non-empty `transferId`) 飲食 支出 of 1000
- **THEN** `summarizeBudgetUsage` reports `used: 2000` for that budget, ignoring the paired row

#### Scenario: Account budget matches by normalized account name

- **WHEN** a 帳戶-kind budget for "永豐大戶" of 10000 exists, and a 支出 of 3000 has `account: '永豐大戶'` (possibly with differing whitespace/case)
- **THEN** that transaction's amount counts toward the budget's `used`

#### Scenario: Ratio and level thresholds

- **GIVEN** a budget of 1000
- **WHEN** `used` is 750, 800, or 1000
- **THEN** `ratio`/`level` are 0.75/`'ok'`, 0.8/`'warn'`, and 1/`'over'` respectively

#### Scenario: Zero-budget entries do not divide by zero

- **WHEN** a budget's `budget` is 0
- **THEN** `ratio` is 0 and `level` is `'ok'`

---
### Requirement: Budget tab UI — progress bars, add flow, and threshold colors

The app's 預算 tab SHALL render one row per budget returned by `apiBudgetUsage`, each with an icon (category icon/first-character or 🏦 for account budgets), a progress bar filled to `min(max(ratio, 0), 1) * 100`% colored by `CL.budgetColor(level)` (`'ok'` → `#4CAF50` green, `'warn'` → `#FF9800` orange, `'over'` → `#F44336` red), and text "已用 X / Y，剩 Z" (or "已用 X / Y，剩 超支 |Z|" when `remaining < 0`).

Tapping an existing row, or an item in the "＋ 新增預算" sheet (which first offers a 分類／帳戶 kind choice, then lists not-yet-budgeted categories or accounts), opens a `prompt()` for the monthly amount (current amount pre-filled, "0 = 刪除"); submitting calls `apiSaveBudget({ kind, name, amount }, ss)`, which upserts or deletes per the rules above, then reloads the budget list.

#### Scenario: Editing an existing budget row prompts with its current amount

- **WHEN** the user taps a budget row for "飲食" currently set to 5000
- **THEN** a prompt opens pre-filled with "5000"; entering 0 and confirming deletes the budget, any positive number updates it

#### Scenario: Add-budget sheet only lists items without a budget yet

- **WHEN** the user opens "＋ 新增預算" and picks kind "分類"
- **THEN** the picker list excludes any expense category that already has a 分類-kind budget entry
