# category-management Specification

## Purpose

在既有「支出分類」／「收入分類」工作表的分類名稱欄之外，加入圖示與顏色欄，並提供網頁 App 新增、編輯與**原子性更名**分類的 API：更名時同步更新既有交易紀錄的分類欄與預算表中以分類設定的預算項目，全程在同一把鎖內完成，避免競態下改名到一半、交易與分類表資料不一致。

## Requirements

### Requirement: Category worksheet columns — icon and color

The system SHALL, in `initializeSheets()`, add a B 圖示／C 顏色 header pair to both "支出分類" and "收入分類" (when B1 is not already `'圖示'`), on top of the existing A 分類名稱 column. `initializeSheets()` SHALL also ensure "收入分類" contains a "轉帳" row (appended if missing), needed for the transfer-pairing UI.

#### Scenario: Existing category sheet gains icon/color headers

- **WHEN** `initializeSheets()` runs on a spreadsheet whose "支出分類" sheet only has column A populated
- **THEN** B1 and C1 become "圖示" and "顏色", and existing category rows' B/C cells remain blank until edited

---
### Requirement: Read category rows with icon, color, and row index

The system SHALL provide `getCategoryRows(sheetName, ss)` (sheetName is `'支出分類'` or `'收入分類'`) reading columns A–C of all data rows and returning `{ name, icon, color, rowIndex }` for each row whose A 欄 (trimmed) is non-empty; blank-name rows are skipped.

#### Scenario: Reads name, icon, color together

- **WHEN** "支出分類" row 5 holds `['飲食', '🍜', '#FF7043']`
- **THEN** `getCategoryRows('支出分類', ss)` includes `{ name: '飲食', icon: '🍜', color: '#FF7043', rowIndex: 5 }`

---
### Requirement: Create or edit a category's icon/color without renaming

The system SHALL provide `upsertCategory(sheetName, params, ss)` where `params` is `{ name, icon, color, oldName }`. It SHALL:
1. Throw `Error('分類名稱不可空白')` when `params.name` trims to `''`.
2. Resolve the target row by normalized match against `oldName || name` (so a plain add/edit without a rename uses `name` itself as the lookup key).
3. When the target is being renamed (`oldName` present and normalizes differently from `name`) or does not yet exist, check for a name collision: throw `Error('分類「' + name + '」已存在')` when another row (not the target itself) already normalizes to `name`.
4. Under `LockService.getScriptLock()`, write `[name, icon || '', color || '']` to the target row if found, else append a new row at `sheet.getLastRow() + 1`, and return `{ rowIndex, renamed }` (`renamed` is `true` only when an actual rename occurred).

`apiSaveCategory(params, ss)` (params additionally carries `type`: `'支出'` or `'收入'`, selecting the sheet) is the app-facing entry point. When `params.oldName` is set and differs from `params.name`, it SHALL first call `apiRenameCategory(type, oldName, name, ss)` to perform the atomic rename (transactions + budgets + the category sheet's own A 欄), and only then call `upsertCategory` (passing no `oldName`, since the row has already been renamed) to write the icon/color; it merges `renameResult.changedTransactions`/`changedBudgets` onto the returned object. When there is no rename, it calls `upsertCategory` directly.

#### Scenario: Adding a brand-new category

- **WHEN** `apiSaveCategory({ type: '支出', name: '寵物', icon: '🐾', color: '#8D6E63', oldName: '' }, ss)` is called and no "寵物" row exists
- **THEN** a new row `['寵物', '🐾', '#8D6E63']` is appended to "支出分類" and the result has `renamed: false`

#### Scenario: Editing icon/color only (name unchanged) is not treated as a rename

- **WHEN** `apiSaveCategory({ type: '支出', name: '飲食', icon: '🍔', color: '#FF7043', oldName: '飲食' }, ss)` is called
- **THEN** `upsertCategory` is called directly (no `apiRenameCategory` call), the "飲食" row's B/C 欄 are overwritten, and no other sheet is touched

#### Scenario: Duplicate name is rejected

- **WHEN** `upsertCategory('支出分類', { name: '飲食', icon: '', color: '', oldName: '' }, ss)` is called and a "飲食" row already exists (and no `oldName` targets that same row)
- **THEN** the system throws an error with message "分類「飲食」已存在"

---
### Requirement: Atomic category rename across transactions, budgets, and the category sheet

The system SHALL provide `apiRenameCategory(type, oldName, newName, ss)` that performs the entire rename — reads and writes — inside one `LockService.getScriptLock()` critical section (avoiding a TOCTOU window where data read outside the lock is changed by another call before this one writes). It SHALL:
1. Acquire the lock (`lock.waitLock(10000)`).
2. Throw `Error('分類名稱不可空白')` when `newName` trims to `''`.
3. When `normalizeName(oldName) === normalizeName(newName)`, return `{ changedTransactions: 0, changedBudgets: 0, categoryRow: null }` immediately (no-op) without touching any sheet.
4. Look up the category rows for `type`'s sheet (`'支出分類'` or `'收入分類'`); throw `Error('分類「' + newName + '」已存在')` if a row already normalizes to `newName`; throw `Error('找不到分類「' + oldName + '」')` if no row normalizes to `oldName`.
5. In "交易紀錄", find every row whose D 欄 (類型) equals `type` and E 欄 (分類) equals `oldName` (exact, non-normalized match) via `replaceCategoryInRows`, and set each such row's E 欄 to `newName`.
6. In "預算", find every budget with `kind === '分類'` and `name === oldName` (exact match) and set its B 欄 to `newName`.
7. Set the category sheet's matched row's A 欄 to `newName`.
8. Release the lock in a `finally` block, and return `{ changedTransactions: <count>, changedBudgets: <count>, categoryRow: <rowIndex> }`.

Any error raised inside the locked section SHALL be re-thrown as `new Error(e.message)`.

#### Scenario: Rename updates transactions, budgets, and the category row together

- **WHEN** `apiRenameCategory('支出', '飲食', '飲食＆咖啡', ss)` is called, "交易紀錄" has 12 rows with 類型="支出"／分類="飲食", and "預算" has one 分類-kind budget named "飲食"
- **THEN** all 12 transaction rows' E 欄 become "飲食＆咖啡", the budget row's B 欄 becomes "飲食＆咖啡", the "支出分類" row's A 欄 becomes "飲食＆咖啡", and the function returns `{ changedTransactions: 12, changedBudgets: 1, categoryRow: <rowIndex> }`

#### Scenario: Renaming to a name that already exists is rejected

- **WHEN** `apiRenameCategory('支出', '飲食', '交通', ss)` is called and a "交通" category row already exists
- **THEN** the system throws an error with message "分類「交通」已存在" and no sheet is modified

#### Scenario: Renaming an unknown category is rejected

- **WHEN** `apiRenameCategory('支出', '不存在分類', '新名稱', ss)` is called
- **THEN** the system throws an error with message "找不到分類「不存在分類」"

#### Scenario: Renaming to the same (normalized) name is a no-op

- **WHEN** `apiRenameCategory('支出', '飲食', ' 飲食 ', ss)` is called (differs only by whitespace)
- **THEN** the function returns `{ changedTransactions: 0, changedBudgets: 0, categoryRow: null }` and no sheet is modified

---
### Requirement: Category management UI panel

The app's 帳戶 tab SHALL expose a ⚙ button opening a "分類管理" panel with a 支出／收入 segment control; each category renders as a row with its icon chip and name, tappable to open an edit sheet (name / icon (max 2 chars) / color picker fields) pre-filled from the tapped category, plus a "＋ 新增分類" button that opens the same sheet blank (empty `oldName`). Saving with a changed name SHALL prompt `confirm('歷史交易與預算會一併改名，繼續？')` before calling `apiSaveCategory`; declining leaves the sheet open and calls nothing. After a successful save, the panel SHALL refresh `apiBootstrap` and invalidate cached stats/budgets (`invalidateDerived()`).

#### Scenario: Renaming from the UI requires confirmation

- **WHEN** the user changes a category's name in the edit sheet and taps 儲存
- **THEN** the client shows a confirm dialog "歷史交易與預算會一併改名，繼續？"; only on confirmation does it call `apiSaveCategory` with the new name and the original name as `oldName`

#### Scenario: Editing icon/color without changing name skips the confirmation

- **WHEN** the user only changes icon or color, leaving the name unchanged, and taps 儲存
- **THEN** no confirmation dialog appears and `apiSaveCategory` is called directly
