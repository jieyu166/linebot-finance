# Ahorro 風格網頁 App（第二部分）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 GAS 專案上加一個手機版單頁網頁（Android Chrome 加到主畫面），可瀏覽／新增／修改／刪除交易、設定月預算、管理分類、看統計圓餅圖與帳戶餘額、建立與連結轉帳。

**Architecture:** 後端 `src/WebApp.gs` 以 `google.script.run` 提供 API，純邏輯拆到 `src/WebAppLogic.gs` 供 Node 測試；前端拆成 `Index.html`（殼）、`Styles.html`、`ClientLogic.html`（純函式，可在 Node 測）、`App.html`（DOM 與呼叫）。試算表寫入沿用第一部分的 `LockService` 與 ID 定位。

**Tech Stack:** Google Apps Script HtmlService（ES5 於 `.gs`；前端 JS 可用 ES2015，Android Chrome 支援）、純 SVG 圓餅圖、Node 22 測試。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-09-06-ahorro-style-webapp-design.md`（後端 API 表、前端畫面、轉帳配對、錯誤處理）。第一部分已完成的函式一律重用，不改其行為。
- `.gs` 檔 ES5；`.html` 內的 JS 可用 `const`/`let`/箭頭函式/模板字串，但不可用 ES 模組、`async/await` 以外的新語法避免舊機相容問題可用 Promise。
- 交易欄位（0-based）：0 日期、1 金融機構、2 帳戶名稱、3 類型、4 分類、5 品項、6 明細描述、7 幣別、8 金額、9 原始訊息、10 ID、11 轉帳ID。帳戶管理 10 欄（A–J）。分類表：A 分類名稱、B 圖示、C 顏色。預算表：A 類型（分類／帳戶）、B 名稱、C 月預算。
- 日期一律 `yyyy/MM/dd`；月份參數 `yyyy-MM`；金額正數；App 寫入的原始訊息（J 欄）為 `App`。
- 每個任務結束 `npm test` 全綠再 commit；commit 訊息結尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；`git add` 指定檔案（`test/fixtures/` 為真實資料，禁止提交）。
- Windows 上 Bash 指令過長會失敗，大檔用 Write 工具。
- 現有可重用函式：`getSpreadsheet`、`getAccounts`、`findAccountByName`、`getTransactionRows`、`rowToTransaction`、`transactionToRow`、`appendTransactionsBatch`、`getAllAccountBalances`、`calculateBalanceFromRows`、`normalizeName`、`parseAmount`、`parseSheetDate`、`normalizeDateString`、`findTransactionsByIds`、`writeTransferCells`、`linkTransfer`、`unlinkTransfer`、`createTransfer`、`pickTransferCandidates(tx, allTx, accounts, options)`、`tryAutoPair`、`formatAmount`。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/WebAppLogic.gs`（新） | 純邏輯：月份篩選、分類彙總、預算用量、更名替換、手動配對候選 |
| `src/SheetService.gs`（修改） | 新增分類列讀寫、預算讀寫、依 ID 更新／刪除交易、帳戶初始值更新 |
| `src/WebApp.gs`（新） | `google.script.run` API、`include()`、錯誤包裝 |
| `src/Main.gs`（修改） | `doGet` 依 `ui=1` 回傳頁面 |
| `src/Index.html`、`src/Styles.html`、`src/ClientLogic.html`、`src/App.html`（新） | 前端 |
| `test/harness.js`（修改） | 新增 `loadHtmlScript(file)` 載入 `.html` 內 `<script>` 純函式 |
| `test/webapp-logic.test.js`、`test/webapp-sheet.test.js`、`test/webapp-api.test.js`、`test/client-logic.test.js` | 各任務測試 |

---

### Task 1: 後端純邏輯 `WebAppLogic.gs`

**Files:** Create `src/WebAppLogic.gs`；Test `test/webapp-logic.test.js`

**Interfaces（Produces）:**
- `monthKeyOf(dateStr)` → `'yyyy-MM'` 或 `''`
- `filterTransactionsByMonth(txs, yearMonth)` → 該月交易陣列，依日期字串降冪、同日依 rowIndex 降冪
- `summarizeByCategory(txs, type)` → `{total, byCategory:[{name, amount, ratio}]}`，排除 `transferId` 非空的列，`byCategory` 依 amount 降冪，`ratio` 四捨五入到小數 3 位
- `summarizeBudgetUsage(txs, budgets, yearMonth)` → `[{kind, name, budget, used, remaining, ratio, level}]`；`kind` 為 `分類`（統計該分類本月支出）或 `帳戶`（該帳戶本月支出，排除 transferId 非空）；`level`：ratio ≥ 1 → `over`，≥ 0.8 → `warn`，否則 `ok`
- `replaceCategoryInRows(rows, type, oldName, newName)` → `{rows, changedRowIndexes:number[]}`；只改 D 欄等於 `type` 且 E 欄等於 `oldName` 的列
- `pickManualTransferCandidates(tx, allTx, accounts)` → `pickTransferCandidates(tx, allTx, accounts, {dayWindow: 7, anyCategory: true})`

需要在 `src/TransferService.gs` 的 `pickTransferCandidates` 加 `options.anyCategory === true` 時略過分類限制（其餘不變）。

- [ ] **Step 1: 寫 `test/webapp-logic.test.js`**

```js
const assert = require('assert');
const { loadGs } = require('./harness');
const gs = loadGs(['SheetService.gs', 'TransferService.gs', 'WebAppLogic.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }
const tx = (o) => Object.assign({ institution: '', account: '現金', type: '支出', category: '飲食', item: '', description: '', currency: 'TWD', amount: 0, source: 'App', id: Math.random().toString(36).slice(2), transferId: '', rowIndex: 2 }, o);

t('monthKeyOf', () => {
  assert.strictEqual(gs.monthKeyOf('2026/08/03'), '2026-08');
  assert.strictEqual(gs.monthKeyOf(''), '');
});
t('filterTransactionsByMonth 依月份且日期降冪', () => {
  const out = gs.filterTransactionsByMonth([
    tx({ date: '2026/08/01', rowIndex: 2 }), tx({ date: '2026/07/31', rowIndex: 3 }), tx({ date: '2026/08/15', rowIndex: 4 }), tx({ date: '2026/08/15', rowIndex: 5 })
  ], '2026-08');
  assert.deepStrictEqual(out.map(x => x.rowIndex), [5, 4, 2]);
});
t('summarizeByCategory 排除轉帳配對並算比例', () => {
  const r = gs.summarizeByCategory([
    tx({ date: '2026/08/01', category: '飲食', amount: 300 }), tx({ date: '2026/08/02', category: '交通', amount: 100 }),
    tx({ date: '2026/08/03', category: '轉帳', amount: 5000, transferId: 'x' }), tx({ date: '2026/08/04', type: '收入', category: '薪資', amount: 999 })
  ], '支出');
  assert.strictEqual(r.total, 400);
  assert.deepStrictEqual(r.byCategory, [{ name: '飲食', amount: 300, ratio: 0.75 }, { name: '交通', amount: 100, ratio: 0.25 }]);
});
t('summarizeBudgetUsage 分類與帳戶', () => {
  const r = gs.summarizeBudgetUsage([
    tx({ date: '2026/08/01', category: '飲食', amount: 850, account: '玉山' }), tx({ date: '2026/08/02', category: '飲食', amount: 200, account: '現金' }),
    tx({ date: '2026/08/03', category: '轉帳', amount: 9000, account: '玉山', transferId: 'p' })
  ], [{ kind: '分類', name: '飲食', budget: 1000 }, { kind: '帳戶', name: '玉山', budget: 500 }], '2026-08');
  assert.deepStrictEqual(r[0], { kind: '分類', name: '飲食', budget: 1000, used: 1050, remaining: -50, ratio: 1.05, level: 'over' });
  assert.deepStrictEqual(r[1], { kind: '帳戶', name: '玉山', budget: 500, used: 850, remaining: -350, ratio: 1.7, level: 'over' });
});
t('summarizeBudgetUsage level 門檻', () => {
  const r = gs.summarizeBudgetUsage([tx({ date: '2026/08/01', category: '飲食', amount: 80 })], [{ kind: '分類', name: '飲食', budget: 100 }], '2026-08');
  assert.strictEqual(r[0].level, 'warn');
});
t('replaceCategoryInRows 只改指定類型與名稱', () => {
  const rows = [
    ['2026/08/01', '現金', '現金', '支出', '飲食', 'a', '', 'TWD', 1, 'App', 'i1', ''],
    ['2026/08/01', '現金', '現金', '收入', '飲食', 'b', '', 'TWD', 1, 'App', 'i2', ''],
    ['2026/08/01', '現金', '現金', '支出', '交通', 'c', '', 'TWD', 1, 'App', 'i3', '']
  ];
  const r = gs.replaceCategoryInRows(rows, '支出', '飲食', '餐飲');
  assert.deepStrictEqual(r.changedRowIndexes, [2]);
  assert.strictEqual(r.rows[0][4], '餐飲'); assert.strictEqual(r.rows[1][4], '飲食');
});
t('pickManualTransferCandidates 7 天內任意分類', () => {
  const accounts = [{ name: '玉山', institution: '玉山銀行', currency: 'TWD', type: '銀行' }, { name: '中信', institution: '中國信託', currency: 'TWD', type: '銀行' }];
  const me = tx({ date: '2026/08/13', account: '中信', type: '支出', category: '轉帳', amount: 30000 });
  const other = tx({ date: '2026/08/19', account: '玉山', type: '收入', category: '其他', amount: 30000 });
  assert.strictEqual(gs.pickManualTransferCandidates(me, [other], accounts).length, 1);
  assert.strictEqual(gs.pickTransferCandidates(me, [other], accounts).length, 0, '自動配對仍限 3 天且限轉帳分類');
});
console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 跑 `node test/webapp-logic.test.js`，預期 FAIL（檔案不存在）**
- [ ] **Step 3: 實作 `src/WebAppLogic.gs`**

```js
/**
 * WebAppLogic.gs — 網頁 App 用純邏輯（不碰試算表）
 */
function monthKeyOf(dateStr) {
  var d = parseSheetDate(dateStr);
  if (!d) { return ''; }
  var m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}

function filterTransactionsByMonth(txs, yearMonth) {
  return txs.filter(function(tx) { return monthKeyOf(tx.date) === yearMonth; })
    .sort(function(a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.rowIndex || 0) - (a.rowIndex || 0);
    });
}

function summarizeByCategory(txs, type) {
  var totals = {};
  var total = 0;
  txs.forEach(function(tx) {
    if (tx.type !== type || tx.transferId) { return; }
    var amount = Math.abs(parseAmount(tx.amount));
    totals[tx.category] = (totals[tx.category] || 0) + amount;
    total += amount;
  });
  var byCategory = Object.keys(totals).map(function(name) {
    return { name: name, amount: totals[name], ratio: total > 0 ? Math.round(totals[name] / total * 1000) / 1000 : 0 };
  }).sort(function(a, b) { return b.amount - a.amount; });
  return { total: total, byCategory: byCategory };
}

function budgetLevel(ratio) {
  if (ratio >= 1) { return 'over'; }
  if (ratio >= 0.8) { return 'warn'; }
  return 'ok';
}

function summarizeBudgetUsage(txs, budgets, yearMonth) {
  var monthTxs = txs.filter(function(tx) { return tx.type === '支出' && !tx.transferId && monthKeyOf(tx.date) === yearMonth; });
  return budgets.map(function(b) {
    var used = 0;
    monthTxs.forEach(function(tx) {
      if ((b.kind === '分類' && tx.category === b.name) || (b.kind === '帳戶' && normalizeName(tx.account) === normalizeName(b.name))) {
        used += Math.abs(parseAmount(tx.amount));
      }
    });
    var budget = Math.abs(parseAmount(b.budget));
    var ratio = budget > 0 ? Math.round(used / budget * 1000) / 1000 : 0;
    return { kind: b.kind, name: b.name, budget: budget, used: used, remaining: budget - used, ratio: ratio, level: budgetLevel(ratio) };
  });
}

function replaceCategoryInRows(rows, type, oldName, newName) {
  var changed = [];
  rows.forEach(function(row, i) {
    if (String(row[3] || '').trim() === type && String(row[4] || '').trim() === oldName) {
      row[4] = newName;
      changed.push(i + 2);
    }
  });
  return { rows: rows, changedRowIndexes: changed };
}

function pickManualTransferCandidates(tx, allTx, accounts) {
  return pickTransferCandidates(tx, allTx, accounts, { dayWindow: 7, anyCategory: true });
}
```

在 `pickTransferCandidates` 的分類判斷前加 `if (!options.anyCategory && ...)`（既有條件改為受 `anyCategory` 控制）。

- [ ] **Step 4: `npm test` 全綠；Commit** `feat: WebAppLogic 純邏輯（月份、分類彙總、預算、更名、手動配對候選）`

---

### Task 2: 試算表讀寫擴充（分類列、預算、依 ID 更新／刪除、帳戶初始值）

**Files:** Modify `src/SheetService.gs`；Test `test/webapp-sheet.test.js`（用 `test/fakes.js`；需為 `fakeSheet` 加 `deleteRow(r)` 與可自訂標題的 `fakeSheetWithHeader(header, rows)`）

**Interfaces（Produces）:**
- `getCategoryRows(sheetName, ss)` → `[{name, icon, color, rowIndex}]`（A–C，跳過名稱空白）
- `upsertCategory(sheetName, {name, icon, color, oldName}, ss)` → `{rowIndex, renamed:boolean}`；`oldName` 有值且不同 → 改該列 A 欄；名稱重複（正規化）→ throw `分類「X」已存在`
- `getBudgets(ss)` → `[{kind, name, budget, rowIndex}]`
- `upsertBudget({kind, name, amount}, ss)` → `{rowIndex, deleted:boolean}`；`amount` ≤ 0 或空 → 刪該列（若存在）
- `updateTransactionById(tx, ss)` → 更新後的交易物件；找不到 → throw `找不到這筆交易，可能已被刪除`；只寫 A–I 欄（不動 J 原始訊息、K、L）
- `deleteTransactionById(id, alsoLinked, ss)` → `{deleted:number}`；`alsoLinked` 且有 transferId → 一併刪配對列；否則配對列的 L 欄清空。刪列時由大 rowIndex 往小刪
- `updateAccountSettings(name, {initialBalance, initialDate, type}, ss)` → 更新 D、E、H 欄（只更新有提供的欄位）；找不到 → throw `找不到帳戶「X」`

- [ ] **Step 1: 擴充 `test/fakes.js`**：`fakeSheet` 增加 `deleteRow(r)`（`data.splice(r - 1, 1)`）；新增 `fakeSheetWithHeader(header, rows)`（同 `fakeSheet` 但標題可指定）。
- [ ] **Step 2: 寫 `test/webapp-sheet.test.js`**（每個介面至少一個成功案例與一個錯誤／邊界案例，斷言具體儲存格值）：

```js
const assert = require('assert');
const { loadGs } = require('./harness');
const { fakeSheet, fakeSheetWithHeader, fakeSs } = require('./fakes');
const gs = loadGs(['SheetService.gs', 'TransferService.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

t('getCategoryRows 讀 A–C 並跳過空白', () => {
  const sheet = fakeSheetWithHeader(['分類名稱', '圖示', '顏色'], [['飲食', '🍜', '#F5A623'], ['', '', ''], ['交通', '', '']]);
  assert.deepStrictEqual(gs.getCategoryRows('支出分類', fakeSs({ '支出分類': sheet })), [
    { name: '飲食', icon: '🍜', color: '#F5A623', rowIndex: 2 }, { name: '交通', icon: '', color: '', rowIndex: 4 }]);
});
t('upsertCategory 新增、更名、重複拒絕', () => {
  const sheet = fakeSheetWithHeader(['分類名稱', '圖示', '顏色'], [['飲食', '', '']]);
  const ss = fakeSs({ '支出分類': sheet });
  assert.deepStrictEqual(gs.upsertCategory('支出分類', { name: '交通', icon: '🚗', color: '#123456' }, ss), { rowIndex: 3, renamed: false });
  assert.strictEqual(sheet._data[2][0], '交通');
  assert.deepStrictEqual(gs.upsertCategory('支出分類', { name: '餐飲', oldName: '飲食', icon: '🍜', color: '' }, ss), { rowIndex: 2, renamed: true });
  assert.strictEqual(sheet._data[1][0], '餐飲');
  assert.throws(() => gs.upsertCategory('支出分類', { name: '交通', oldName: '餐飲' }, ss), /已存在/);
});
t('getBudgets / upsertBudget 新增、更新、刪除', () => {
  const sheet = fakeSheetWithHeader(['類型', '名稱', '月預算'], [['分類', '飲食', 8000]]);
  const ss = fakeSs({ '預算': sheet });
  assert.deepStrictEqual(gs.getBudgets(ss), [{ kind: '分類', name: '飲食', budget: 8000, rowIndex: 2 }]);
  assert.deepStrictEqual(gs.upsertBudget({ kind: '帳戶', name: '玉山', amount: 5000 }, ss), { rowIndex: 3, deleted: false });
  assert.deepStrictEqual(gs.upsertBudget({ kind: '分類', name: '飲食', amount: 9000 }, ss), { rowIndex: 2, deleted: false });
  assert.strictEqual(sheet._data[1][2], 9000);
  assert.deepStrictEqual(gs.upsertBudget({ kind: '分類', name: '飲食', amount: 0 }, ss), { rowIndex: 2, deleted: true });
  assert.strictEqual(sheet._data.length, 2);
});
t('updateTransactionById 只寫 A–I，保留 J–L', () => {
  const sheet = fakeSheet([['2026/08/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, '午餐80', 'id1', 'x']]);
  const out = gs.updateTransactionById({ id: 'id1', date: '2026/08/02', institution: '玉山銀行', account: '玉山', type: '支出', category: '交通', item: '捷運', description: '', currency: 'TWD', amount: 35 }, fakeSs({ '交易紀錄': sheet }));
  assert.strictEqual(out.rowIndex, 2);
  assert.deepStrictEqual(sheet._data[1].slice(0, 12), ['2026/08/02', '玉山銀行', '玉山', '支出', '交通', '捷運', '', 'TWD', 35, '午餐80', 'id1', 'x']);
  assert.throws(() => gs.updateTransactionById({ id: 'nope', amount: 1 }, fakeSs({ '交易紀錄': sheet })), /找不到這筆交易/);
});
t('deleteTransactionById 單刪清對方 L 欄；alsoLinked 一併刪', () => {
  const rows = () => [['2026/08/01', '', '中信', '支出', '轉帳', '', '', 'TWD', 5000, 'App', 'a', 'T'], ['2026/08/01', '', '現金', '收入', '轉帳', '', '', 'TWD', 5000, 'App', 'b', 'T'], ['2026/08/02', '', '現金', '支出', '飲食', '', '', 'TWD', 80, 'App', 'c', '']];
  let sheet = fakeSheet(rows());
  assert.deepStrictEqual(gs.deleteTransactionById('a', false, fakeSs({ '交易紀錄': sheet })), { deleted: 1 });
  assert.strictEqual(sheet._data.length, 3); assert.strictEqual(sheet._data[1][10], 'b'); assert.strictEqual(sheet._data[1][11], '');
  sheet = fakeSheet(rows());
  assert.deepStrictEqual(gs.deleteTransactionById('a', true, fakeSs({ '交易紀錄': sheet })), { deleted: 2 });
  assert.strictEqual(sheet._data.length, 2); assert.strictEqual(sheet._data[1][10], 'c');
});
t('updateAccountSettings 只更新提供的欄位', () => {
  const header = ['帳戶名稱', '金融機構', '幣別', '初始餘額', '初始日期', '備註', '是否啟用', '帳戶類型', '扣款帳戶', '帳號識別'];
  const sheet = fakeSheetWithHeader(header, [['玉山', '玉山銀行', 'TWD', '', '', '', true, '銀行', '', '']]);
  gs.updateAccountSettings('玉山', { initialBalance: 2823, initialDate: '2026/07/31' }, fakeSs({ '帳戶管理': sheet }));
  assert.strictEqual(sheet._data[1][3], 2823); assert.strictEqual(sheet._data[1][4], '2026/07/31'); assert.strictEqual(sheet._data[1][7], '銀行');
  assert.throws(() => gs.updateAccountSettings('不存在', {}, fakeSs({ '帳戶管理': sheet })), /找不到帳戶/);
});
console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: 跑測試，預期 FAIL**
- [ ] **Step 4: 實作（追加到 `src/SheetService.gs`）**

```js
function getCategoryRows(sheetName, ss) {
  var sheet = getSpreadsheet(ss).getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) { return []; }
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var out = [];
  values.forEach(function(row, i) {
    var name = String(row[0] || '').trim();
    if (name === '') { return; }
    out.push({ name: name, icon: String(row[1] || '').trim(), color: String(row[2] || '').trim(), rowIndex: i + 2 });
  });
  return out;
}

function upsertCategory(sheetName, params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName(sheetName);
  var rows = getCategoryRows(sheetName, ss);
  var name = String(params.name || '').trim();
  var oldName = String(params.oldName || '').trim();
  if (name === '') { throw new Error('分類名稱不可空白'); }
  var target = null;
  rows.forEach(function(r) {
    if (normalizeName(r.name) === normalizeName(oldName || name)) { target = r; }
  });
  var renamed = oldName !== '' && normalizeName(oldName) !== normalizeName(name);
  if (renamed || !target) {
    var dup = rows.some(function(r) { return normalizeName(r.name) === normalizeName(name) && (!target || r.rowIndex !== target.rowIndex); });
    if (dup) { throw new Error('分類「' + name + '」已存在'); }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var rowIndex = target ? target.rowIndex : sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1, 1, 3).setValues([[name, params.icon || '', params.color || '']]);
    return { rowIndex: rowIndex, renamed: renamed };
  } finally { lock.releaseLock(); }
}

function getBudgets(ss) {
  var sheet = getSpreadsheet(ss).getSheetByName('預算');
  if (!sheet || sheet.getLastRow() < 2) { return []; }
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var out = [];
  values.forEach(function(row, i) {
    var name = String(row[1] || '').trim();
    if (name === '') { return; }
    out.push({ kind: String(row[0] || '').trim(), name: name, budget: Math.abs(parseAmount(row[2])), rowIndex: i + 2 });
  });
  return out;
}

function upsertBudget(params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('預算');
  var amount = Math.abs(parseAmount(params.amount));
  var existing = null;
  getBudgets(ss).forEach(function(b) {
    if (b.kind === params.kind && normalizeName(b.name) === normalizeName(params.name)) { existing = b; }
  });
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (amount <= 0) {
      if (existing) { sheet.deleteRow(existing.rowIndex); return { rowIndex: existing.rowIndex, deleted: true }; }
      return { rowIndex: 0, deleted: true };
    }
    var rowIndex = existing ? existing.rowIndex : sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1, 1, 3).setValues([[params.kind, params.name, amount]]);
    return { rowIndex: rowIndex, deleted: false };
  } finally { lock.releaseLock(); }
}

function updateTransactionById(tx, ss) {
  ss = getSpreadsheet(ss);
  var found = findTransactionsByIds([tx.id], ss)[tx.id];
  if (!found) { throw new Error('找不到這筆交易，可能已被刪除'); }
  var merged = {};
  for (var k in found) { merged[k] = found[k]; }
  for (var j in tx) { if (tx[j] !== undefined) { merged[j] = tx[j]; } }
  var row = transactionToRow(merged);
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    ss.getSheetByName('交易紀錄').getRange(found.rowIndex, 1, 1, 9).setValues([row.slice(0, 9)]);
    return rowToTransaction(row.slice(0, 9).concat([found.source, found.id, found.transferId]), found.rowIndex);
  } finally { lock.releaseLock(); }
}

function deleteTransactionById(id, alsoLinked, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var all = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); });
  var target = null;
  all.forEach(function(t) { if (t.id === id) { target = t; } });
  if (!target) { throw new Error('找不到這筆交易，可能已被刪除'); }
  var toDelete = [target];
  var linked = target.transferId ? all.filter(function(t) { return t.transferId === target.transferId && t.id !== id; }) : [];
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (alsoLinked) { toDelete = toDelete.concat(linked); }
    else { linked.forEach(function(t) { sheet.getRange(t.rowIndex, 12, 1, 1).setValue(''); }); }
    toDelete.sort(function(a, b) { return b.rowIndex - a.rowIndex; }).forEach(function(t) { sheet.deleteRow(t.rowIndex); });
    return { deleted: toDelete.length };
  } finally { lock.releaseLock(); }
}

function updateAccountSettings(name, params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('帳戶管理');
  var values = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var rowIndex = 0;
  values.forEach(function(row, i) { if (normalizeName(row[0]) === normalizeName(name)) { rowIndex = i + 2; } });
  if (!rowIndex) { throw new Error('找不到帳戶「' + name + '」'); }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (params.initialBalance !== undefined) { sheet.getRange(rowIndex, 4, 1, 1).setValue(parseAmount(params.initialBalance)); }
    if (params.initialDate !== undefined) { sheet.getRange(rowIndex, 5, 1, 1).setValue(params.initialDate); }
    if (params.type !== undefined && params.type !== '') { sheet.getRange(rowIndex, 8, 1, 1).setValue(params.type); }
    return rowIndex;
  } finally { lock.releaseLock(); }
}
```

（`fakeSheet.getRange(...).setValue` 已存在；`deleteRow` 由 Step 1 補。`updateTransactionById` 對 `updateAccountSettings` 的 `getRange(2,1,n,1)` 需 fake 支援 `nr` 為 1 時的讀取，現有 fake 已支援。）

- [ ] **Step 5: `npm test` 全綠；Commit** `feat: 分類/預算讀寫、依 ID 更新刪除交易、帳戶初始值更新`

---

### Task 3: `WebApp.gs` API 與 `doGet`

**Files:** Create `src/WebApp.gs`；Modify `src/Main.gs`（`doGet`）；Test `test/webapp-api.test.js`

**Interfaces（Produces，皆為 `google.script.run` 可呼叫的頂層函式；所有寫入以 try/catch 轉成 `throw new Error(中文)`；每個函式接受可選 `ss` 供測試）:**
- `include(name)` → `HtmlService.createHtmlOutputFromFile(name).getContent()`
- `apiBootstrap(ss)` → `{expenseCategories:[{name,icon,color}], incomeCategories:[...], accounts:[{name,institution,currency,type}], budgets:[{kind,name,budget}], today:'yyyy/MM/dd'}`
- `apiListTransactions(yearMonth, ss)` → 交易物件陣列（`filterTransactionsByMonth`），每筆加 `linkedAccount`（配對對方帳戶名或 `''`）
- `apiSaveTransaction(tx, ss)` → 儲存後物件；`tx.id` 空 → `appendTransactionsBatch([tx], 'App', ss)[0]` 後對 繳信用卡／轉帳 呼叫 `tryAutoPair`；有 id → `updateTransactionById`。驗證：`amount > 0`、`type ∈ {支出,收入}`、`category` 非空、`account` 存在於 `getAccounts`（機構自動帶入）
- `apiDeleteTransaction(id, alsoLinked, ss)` → `deleteTransactionById`
- `apiCreateTransfer(params, ss)` → `createTransfer`
- `apiLinkTransfer(idA, idB, ss)` → `linkTransfer`；`apiUnlinkTransfer(transferId, ss)` → `unlinkTransfer`
- `apiTransferCandidates(id, ss)` → `pickManualTransferCandidates` 結果（含 rowIndex）
- `apiStats(yearMonth, type, ss)` → `summarizeByCategory(filterTransactionsByMonth(all, yearMonth), type)`
- `apiBudgetUsage(yearMonth, ss)` → `summarizeBudgetUsage(all, getBudgets(ss), yearMonth)`
- `apiSaveBudget({kind,name,amount}, ss)` → `upsertBudget`
- `apiBalances(ss)` → `getAllAccountBalances(ss)`
- `apiSaveAccount(name, params, ss)` → `updateAccountSettings`
- `apiSaveCategory({type, name, icon, color, oldName}, ss)` → `upsertCategory(type === '支出' ? '支出分類' : '收入分類', …)`；`oldName` 且不同 → 同時 `apiRenameCategory`
- `apiRenameCategory(type, oldName, newName, ss)` → `{changedTransactions:number, changedBudgets:number}`：`replaceCategoryInRows` 後一次 `setValues` 寫回 E 欄；預算表 B 欄同名（kind 分類）改名
- `doGet(e)`：`e && e.parameter && e.parameter.ui === '1'` → `HtmlService.createTemplateFromFile('Index').evaluate().setTitle('記帳').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')`；否則維持 `OK`

- [ ] **Step 1: 寫 `test/webapp-api.test.js`**（載入 `['SheetService.gs','TransferService.gs','WebAppLogic.gs','Main.gs','WebApp.gs']`；harness 需注入 `HtmlService` stub：`createTemplateFromFile(name)` 回傳 `{evaluate: () => ({ setTitle: function(){ return this; }, addMetaTag: function(){ return this; }, _name: name })}`、`createHtmlOutputFromFile(name)` 回傳 `{getContent: () => '<!--' + name + '-->'}`；`ContentService` stub：`createTextOutput(s)` 回傳 `{_text: s}`）。案例：`apiBootstrap` 回傳分類含圖示與帳戶清單；`apiSaveTransaction` 新增（寫 12 欄、J 欄 `App`、帳戶不存在拋 `找不到帳戶`）與更新；`apiSaveTransaction` 新增繳信用卡後自動配對（沿用 Task 6 的 fixture：永豐大戶＋永豐信用卡）；`apiListTransactions` 只回該月且含 `linkedAccount`；`apiRenameCategory` 改交易與預算並回傳筆數；`apiStats`、`apiBudgetUsage` 串接正確；`doGet({parameter:{ui:'1'}})` 回傳 `_name === 'Index'`，`doGet({})._text === 'OK'`。
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作 `src/WebApp.gs`**（每個 api 以 `try { … } catch (e) { throw new Error(e.message); }` 包住以確保訊息傳到前端；`apiSaveTransaction` 驗證訊息：`金額必須大於 0`、`類型必須是支出或收入`、`請選擇分類`、`找不到帳戶「X」`）。`apiListTransactions` 的 `linkedAccount`：先建 `transferId → [tx]` 對照，對方帳戶取同 transferId 中 id 不同者的 account。
- [ ] **Step 4: `Main.gs` `doGet` 改寫；harness `loadGs` 預設注入上述 `HtmlService`、`ContentService` stub（可被 extraGlobals 覆寫）**
- [ ] **Step 5: `npm test` 全綠；Commit** `feat: WebApp API 與 doGet 頁面路由`

---

### Task 4: 前端純邏輯 `ClientLogic.html` 與 harness 支援

**Files:** Create `src/ClientLogic.html`；Modify `test/harness.js`（新增 `loadHtmlScript(file)`：讀檔、取出所有 `<script>…</script>` 內容、`vm.runInThisContext`，回傳 global）；Test `test/client-logic.test.js`

**Interfaces（Produces，掛在 `window.CL` 物件；Node 測試以 `global.CL` 取用）:**
- `CL.evalCalc(expr)` → 數字或 `NaN`；支援 `+ - × ÷`（也接受 `* /`），先乘除後加減，最多兩位小數四捨五入
- `CL.groupByDate(txs)` → `[{date, items:[tx], expense, income}]`，保持輸入順序
- `CL.formatMoney(n, currency)` → `'$1,234'`／`'$1,858.62 USD'`（小數只在有分時顯示）
- `CL.pieSlices(items, cx, cy, r)` → `[{name, d, color}]`；`items` 為 `[{name, amount, color}]`；單一項目回傳整圓 `d`；金額 0 的略過
- `CL.budgetColor(level)` → `ok:'#4CAF50'`、`warn:'#FF9800'`、`over:'#F44336'`
- `CL.defaultColor(index)` → 8 色循環調色盤
- `CL.yearMonthShift(yearMonth, delta)` → `'2026-08'` ±1 月
- `CL.inferYearMonthLabel(yearMonth)` → `'2026/08'`

- [ ] **Step 1: harness 加 `loadHtmlScript`**

```js
function loadHtmlScript(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const scripts = [];
  html.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (m, body) => { scripts.push(body); return m; });
  global.window = global;
  scripts.forEach((s, i) => vm.runInThisContext(s, { filename: file + '#' + i }));
  return global;
}
module.exports = { loadGs, loadHtmlScript, Utilities };
```

- [ ] **Step 2: 寫 `test/client-logic.test.js`**（斷言：`evalCalc('12+3×2')` → 18、`evalCalc('100÷3')` → 33.33、`evalCalc('1+')` → NaN；`groupByDate` 兩天各自合計；`formatMoney(0,'USD')` → `$1,858.62 USD`、`formatMoney(-3000,'TWD')` → `-$3,000`；`pieSlices` 兩項各半時第一片 `d` 含 `A 50 50 0 0 1`、單一項目 `d` 為整圓；`yearMonthShift('2026-01',-1)` → `2025-12`）。
- [ ] **Step 3: 跑測試 FAIL**
- [ ] **Step 4: 實作 `src/ClientLogic.html`**（`<script>` 內定義 `window.CL = {...}`；`evalCalc` 以 tokenizer 分數字與運算子，兩趟：先處理 × ÷ 再 + −；`pieSlices` 用 `Math.cos/sin` 算弧端點，`largeArc = ratio > 0.5 ? 1 : 0`，`ratio >= 0.9999` 時回傳兩個半圓組成的整圓路徑）。
- [ ] **Step 5: `npm test` 全綠；Commit** `feat: 前端純邏輯 ClientLogic 與 harness loadHtmlScript`

---

### Task 5: 頁面殼、樣式、紀錄分頁（含月份切換與交易列表）

**Files:** Create `src/Index.html`、`src/Styles.html`、`src/App.html`

**Interfaces:**
- `Index.html`：`<!DOCTYPE html><html><head><base target="_top"><?!= include('Styles') ?></head><body><div id="app"></div><?!= include('ClientLogic') ?><?!= include('App') ?></body></html>`
- `App.html` 全域：`state = {tab:'records', yearMonth, bootstrap, transactions:[], stats, budgets, balances, editing:null}`；`api(name, ...args)` 回傳 Promise 包 `google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[name](...args)`；`toast(msg, isError)`；`render()` 依 `state.tab` 呼叫 `renderRecords()`／`renderBudget()`／`renderStats()`／`renderAccounts()`；底部 `nav` 四鈕；右下角 `+` 浮動按鈕（`openEditor(null)`，Task 6 實作）。
- 紀錄分頁：頂部 `‹ 2026/08 ›`；列表以 `CL.groupByDate`，每日標頭顯示日期與當日支出／收入；每筆：圓形圖示（分類 icon 或首字，背景 = 分類 color 或 `CL.defaultColor`）、品項、帳戶（配對時顯示 `⇄ 對方帳戶`）、金額（支出紅 `#E53935`、收入綠 `#43A047`）；點擊 → `openEditor(tx)`。
- 載入流程：`init()` → `api('apiBootstrap')` → `state.yearMonth = 今天所在月` → `loadMonth()`（`apiListTransactions`）→ `render()`。

- [ ] **Step 1: 寫三個檔案**（`Styles.html`：CSS 變數 `--accent:#3F7CFF; --bg:#F7F8FA; --card:#fff; --text:#222; --muted:#888;`；固定底部導覽列高 56px、內容區 `padding-bottom: 72px`；`.fab` 圓形 56px；`.row` flex；`.chip` 圓形 36px；`.toast` 底部彈出 2.5 秒）。
- [ ] **Step 2: 本機煙霧測試**：把 `App.html` 的 `api()` 加一個 `window.__mockApi` 掛鉤（存在時改呼叫 mock），寫 `test/client-smoke.test.js` 用 `jsdom` 不可（無依賴）；改為：以 Node 載入 `ClientLogic.html` 後，對 `App.html` 只做語法檢查（`new Function(scriptBody)` 不拋錯）並斷言含 `apiBootstrap`、`apiListTransactions`、`renderRecords` 字串。
- [ ] **Step 3: `npm test` 全綠；Commit** `feat: 網頁殼、樣式與紀錄分頁`
- [ ] **Step 4: 部署驗證（使用者操作）**：建立第二個部署（執行身分：我；存取：只有我自己），開 `<部署網址>?ui=1`，確認可看到本月交易列表。

---

### Task 6: 新增／編輯頁（數字鍵盤、分類格、帳戶、刪除、轉帳模式）

**Files:** Modify `src/App.html`

**Interfaces:**
- `openEditor(tx|null)` → `state.editing = {mode:'expense'|'income'|'transfer', id, date, account, category, item, description, amount:'', expr:'', fromAccount, toAccount, transferId}`，全螢幕覆蓋層 `.editor`
- 上半部：金額顯示（`state.editing.expr`，空時 `0`）＋ 4×4 鍵盤：`7 8 9 ÷ / 4 5 6 × / 1 2 3 − / . 0 ⌫ +` 與底部 `=`／`儲存`；按 `=` 或 `儲存` 時 `CL.evalCalc(expr)`，`NaN` 或 ≤ 0 → toast `金額不正確`
- 中段：三段切換 `支出｜收入｜轉帳`；支出／收入顯示分類格（`bootstrap.expenseCategories`／`incomeCategories`，選中加框）、帳戶 `<select>`、日期 `<input type=date>`（顯示轉成 `yyyy/MM/dd`）、品項、備註；轉帳顯示轉出／轉入 `<select>`、日期、備註、跨幣別時多一個「轉入金額」欄
- 儲存：支出／收入 → `api('apiSaveTransaction', payload)`；轉帳（新） → `api('apiCreateTransfer', {fromAccount,toAccount,amount,toAmount,date,note})`；成功 → 關閉、`loadMonth()`、toast `已儲存`
- 編輯既有：底部 `刪除`（有 transferId 時 `confirm('此筆為轉帳配對，要一併刪除對方那筆嗎？')` → `alsoLinked`）與 `連結為轉帳`（Task 9）、有配對時 `解除連結`
- 失敗：toast 錯誤訊息，表單保留

- [ ] **Step 1: 實作**（所有 DOM 以字串模板產生後 `innerHTML`，事件用 `addEventListener` 於 `#app` 委派：`data-action` 屬性 `key`、`set-mode`、`pick-cat`、`save`、`delete`、`close`）
- [ ] **Step 2: 語法檢查測試擴充（`test/client-smoke.test.js` 斷言含 `openEditor`、`apiCreateTransfer`、`apiDeleteTransaction`）；`npm test` 全綠；Commit** `feat: 新增/編輯頁與轉帳模式`
- [ ] **Step 3: 部署驗證（使用者）**：新增一筆「飲食 午餐 80」、修改金額、刪除；建立一筆現金→玉山 1,000 轉帳，回試算表核對兩列共用轉帳ID。

---

### Task 7: 預算分頁

**Files:** Modify `src/App.html`

**Interfaces:** `renderBudget()`：`api('apiBudgetUsage', state.yearMonth)` → 每列：名稱（分類前加圖示、帳戶前加 🏦）、進度條（寬 = `min(ratio,1)*100%`，色 `CL.budgetColor(level)`）、`已用 $X / $Y，剩 $Z`；點列 → `prompt('月預算金額', budget)` → `api('apiSaveBudget', {kind,name,amount})`；頂部「＋ 新增預算」→ 先選類型（分類／帳戶）再從清單選名稱再輸入金額。

- [ ] **Step 1: 實作**；`test/client-smoke.test.js` 斷言含 `apiBudgetUsage`、`apiSaveBudget`。
- [ ] **Step 2: `npm test`；Commit** `feat: 預算分頁`
- [ ] **Step 3: 部署驗證（使用者）**：設「飲食 8000」，新增一筆飲食後進度條變化；改為 0 後該列消失。

---

### Task 8: 統計分頁（SVG 圓餅）

**Files:** Modify `src/App.html`

**Interfaces:** `renderStats()`：頂部月份切換（共用 `state.yearMonth`）與 `支出｜收入` 切換；`api('apiStats', yearMonth, type)` → 以 `CL.pieSlices(items, 100, 100, 90)` 產生 `<svg viewBox="0 0 200 200">` 路徑（顏色取分類 color 或 `CL.defaultColor(i)`），中央顯示總額；下方列表：色點、名稱、金額、百分比；點列 → 切到紀錄分頁並以該分類篩選（`state.filterCategory`，紀錄分頁頂部顯示「篩選：X ✕」）。

- [ ] **Step 1: 實作**；smoke 測試斷言含 `apiStats`、`pieSlices`。
- [ ] **Step 2: `npm test`；Commit** `feat: 統計分頁圓餅圖`
- [ ] **Step 3: 部署驗證（使用者）**：看 8 月支出圓餅，點「飲食」跳到紀錄篩選。

---

### Task 9: 帳戶分頁、分類管理、轉帳連結

**Files:** Modify `src/App.html`

**Interfaces:**
- `renderAccounts()`：`api('apiBalances')` → 【資產】（非信用卡）與【信用卡】（顯示 `未繳 $X`）；點列 → 小表單（初始餘額、初始日期、帳戶類型 select）→ `api('apiSaveAccount', name, params)`；說明文字「餘額 = 初始餘額 + 收入 − 支出」
- 分類管理（右上齒輪 → 覆蓋層）：支出／收入兩頁籤；每列：圖示、名稱、色塊；點列 → 表單（名稱、圖示 emoji、顏色 `<input type=color>`）→ `api('apiSaveCategory', {type,name,icon,color,oldName})`；更名時 `confirm('歷史交易與預算會一併改名，繼續？')`；「＋ 新增分類」
- 轉帳連結（編輯頁按鈕）：`api('apiTransferCandidates', id)` → 清單（日期、帳戶、品項、金額）→ 選一筆 `confirm` → `api('apiLinkTransfer', idA, idB)`；已配對顯示「解除連結」→ `api('apiUnlinkTransfer', transferId)`；完成後重載該月

- [ ] **Step 1: 實作**；smoke 測試斷言含 `apiBalances`、`apiSaveAccount`、`apiSaveCategory`、`apiRenameCategory` 或 `apiTransferCandidates`、`apiLinkTransfer`、`apiUnlinkTransfer`。
- [ ] **Step 2: `npm test`；Commit** `feat: 帳戶分頁、分類管理與轉帳連結`
- [ ] **Step 3: 部署驗證（使用者）**：改玉山初始餘額；把「飲食」改名「餐飲」後檢查試算表 E 欄與預算表；把中信 08/13 轉出 30,000 與玉山（若已匯入）轉入連結。

---

### Task 10: 規格、README 與端到端驗證

**Files:** Create `openspec/specs/webapp-transactions/spec.md`、`openspec/specs/budget/spec.md`、`openspec/specs/category-management/spec.md`；Modify `README.md`、`openspec/specs/transfer-pairing/spec.md`（手動連結 7 天任意分類）

- [ ] **Step 1: 三份新規格**（Purpose、Requirements、Scenario 取自 Task 1–3 測試案例與 Task 5–9 介面）。
- [ ] **Step 2: README**：新增「手機 App（網頁版）」章節：第二個部署設定（執行身分我、存取只有我自己）、網址加 `?ui=1`、Android Chrome「加到主畫面」、四分頁功能概述、分類圖示／顏色欄用法、預算表說明。檔案結構加四個 html 與 WebApp.gs、WebAppLogic.gs。
- [ ] **Step 3: 端到端**：使用者部署後，用瀏覽器工具開啟網址（需登入使用者 Google 帳號，故由使用者操作並回報，或使用者提供截圖），逐項核對 Task 5–9 的部署驗證清單；不符則依 systematic-debugging 處理。
- [ ] **Step 4: `npm test` 全綠；Commit 並 push** `docs: 網頁 App 規格與 README`
