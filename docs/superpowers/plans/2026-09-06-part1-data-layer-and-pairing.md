# 資料層與匯入規則（第一部分）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓試算表資料層支援交易 ID、轉帳配對、帳戶類型（信用卡／證券獨立帳戶），並讓 LINE 匯入流程自動配對繳卡費、交割戶匯款、ATM 提款與跨行自有帳戶轉帳，去除重複，餘額不再排除「繳信用卡」。

**Architecture:** 全部在既有 Google Apps Script 專案內。純邏輯函式（不碰 SpreadsheetApp）集中在新檔 `src/TransferService.gs` 與既有 `SheetService.gs`、`OpenAIService.gs`，由 `test/harness.js` 載入到 Node 測試。試算表寫入一律以 `LockService` 包住。

**Tech Stack:** Google Apps Script（ES5 語法）、Node 22（`node:assert`，`npm test`）、OpenAI gpt-4o-mini JSON mode。

## Global Constraints

- 規格：`docs/superpowers/specs/2026-09-06-ahorro-style-webapp-design.md`（含「依真實帳單修正的匯入規則」「依玉山／台新／中信／一銀帳單補充的規則」兩節）。
- `.gs` 只用 ES5 語法（`var`、`function`），與既有程式碼一致。
- 交易紀錄欄位（0-based）：0 日期、1 金融機構、2 帳戶名稱、3 類型、4 分類、5 品項、6 明細描述、7 幣別、8 金額、9 原始訊息、10 ID、11 轉帳ID。標題：`日期, 金融機構, 帳戶名稱, 類型, 分類, 品項, 明細描述, 幣別, 金額, 原始訊息, ID, 轉帳ID`。
- 帳戶管理欄位（0-based）：0 帳戶名稱、1 金融機構、2 幣別、3 初始餘額、4 初始日期、5 備註、6 是否啟用、7 帳戶類型、8 扣款帳戶、9 帳號識別（逗號分隔多個）。
- 日期 `yyyy/MM/dd` 字串；金額正數；帳戶類型：`現金`、`銀行`、`信用卡`、`證券`。
- 每個任務結束 `npm test` 全綠再 commit；commit 訊息結尾 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- `test/fixtures/` 是真實帳單，已在 `.gitignore`，不可 commit。
- Windows 上 Bash 指令過長會失敗（ENAMETOOLONG），寫大檔用 Write 工具。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/SheetService.gs` | 試算表讀寫、帳戶清單、餘額計算、交易列⇄物件 |
| `src/TransferService.gs`（新） | 配對候選、連結／解除／建立、對方帳戶辨識、自動配對、去重、搬移 |
| `src/Config.gs` | 工作表初始化、`DEFAULT_ACCOUNTS`、`upsertDefaultAccounts`、`backfillTransactionIds` |
| `src/OpenAIService.gs` | prompt、帳戶分流後處理、亂碼行過濾 |
| `src/Main.gs` | LINE 路由、匯入串接、餘額回覆分區 |
| `test/harness.js`、`test/run-all.js` | 測試基礎 |
| `test/*.test.js` | 各任務測試；`test/prompt-live.js` 真實帳單測試（需 API key，不在 npm test） |

---

### Task 1: 測試執行器與 harness stub

**Files:** Create `test/run-all.js`；Modify `test/harness.js`、`package.json`

**Interfaces:** `loadGs(files, extraGlobals)` 的 context 含 `Utilities.getUuid()`（回傳 `uuid-0001` 遞增）、`LockService.getScriptLock()`（`waitLock`／`releaseLock`／`tryLock` 空實作）。

- [ ] **Step 1: 寫 `test/run-all.js`**

```js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} 個測試檔失敗` : '\n所有測試檔通過');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: `test/harness.js` 的 `loadGs` 改為**

```js
function loadGs(files, extraGlobals) {
  let uuidCounter = 0;
  const utilities = Object.assign({}, Utilities, {
    getUuid: function() { uuidCounter++; return 'uuid-' + String(uuidCounter).padStart(4, '0'); }
  });
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; } }) };
  const ctx = Object.assign({ Utilities: utilities, Logger, LockService, console, SpreadsheetApp: {}, PropertiesService: {} }, extraGlobals || {});
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
```

- [ ] **Step 3: `package.json` 的 `test` 改為 `node test/run-all.js`**
- [ ] **Step 4: `npm test`，預期 balance.test.js 全通過**
- [ ] **Step 5: Commit** `test: run-all 執行器與 harness stub`

---

### Task 2: 交易紀錄 12 欄、ID、列⇄物件轉換、backfill

**Files:** Modify `src/SheetService.gs`、`src/Config.gs`；Test `test/transactions.test.js`

**Interfaces:**
- `TX_COLUMN_COUNT = 12`
- `rowToTransaction(row, rowIndex)` → `{date, institution, account, type, category, item, description, currency, amount, source, id, transferId, rowIndex}`；`rowIndex` 為試算表列號（資料第 i 筆 = i+2）
- `transactionToRow(tx)` → 12 元素陣列；`id` 空時 `Utilities.getUuid()`
- `getTransactionRows(ss)` 讀 A–L
- `appendTransactionsBatch(transactions, source, ss)` 回傳交易物件陣列（含 id、rowIndex）；`tx.source` 有值優先於參數 `source`
- `appendTransaction(date, institution, account, type, category, item, description, currency, amount, originalMessage, ss)` 回傳單一交易物件
- `backfillTransactionIds(ss)` 回傳補上的筆數

- [ ] **Step 1: 寫 `test/transactions.test.js`**

```js
const assert = require('assert');
const { loadGs } = require('./harness');
const gs = loadGs(['SheetService.gs', 'Config.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

function fakeSheet(rows) {
  const data = [['日期','金融機構','帳戶名稱','類型','分類','品項','明細描述','幣別','金額','原始訊息','ID','轉帳ID']].concat(rows);
  return {
    _data: data,
    getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; }),
      setValues: (vals) => { for (let i = 0; i < vals.length; i++) { const row = data[r - 1 + i] || (data[r - 1 + i] = []); for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j]; } },
      setValue: (v) => { data[r - 1][c - 1] = v; }
    })
  };
}
const fakeSs = (sheets) => ({ getSheetByName: (n) => sheets[n] });
module.exports = { fakeSheet, fakeSs };

t('transactionToRow 12 欄並補 UUID', () => {
  const row = gs.transactionToRow({ date: '2026/08/03', institution: '永豐銀行', account: '永豐大戶', type: '支出', category: '繳信用卡', item: '永豐卡費', currency: 'TWD', amount: 14684, source: 'PDF匯入' });
  assert.strictEqual(row.length, 12); assert.strictEqual(row[10], 'uuid-0001'); assert.strictEqual(row[11], '');
});
t('rowToTransaction 對應欄位與 rowIndex', () => {
  const tx = gs.rowToTransaction(['2026/08/03','永豐銀行','永豐大戶','支出','繳信用卡','永豐卡費','','TWD','14,684','PDF匯入','abc','x1'], 5);
  assert.strictEqual(tx.id, 'abc'); assert.strictEqual(tx.transferId, 'x1'); assert.strictEqual(tx.rowIndex, 5); assert.strictEqual(tx.amount, 14684);
});
t('appendTransactionsBatch 寫 12 欄並回傳 id/rowIndex', () => {
  const sheet = fakeSheet([]);
  const out = gs.appendTransactionsBatch([{ date: '2026/08/06', institution: '永豐銀行', account: '永豐證券', type: '支出', category: '投資', item: '台積電', amount: 9498 }], 'PDF匯入', fakeSs({ '交易紀錄': sheet }));
  assert.strictEqual(out[0].rowIndex, 2); assert.ok(out[0].id); assert.strictEqual(sheet._data[1][10], out[0].id); assert.strictEqual(sheet._data[1][9], 'PDF匯入');
});
t('appendTransaction 回傳物件', () => {
  const sheet = fakeSheet([]);
  const tx = gs.appendTransaction('2026/08/07', '現金', '現金', '支出', '飲食', '午餐', '午餐80', 'TWD', 80, '午餐80', fakeSs({ '交易紀錄': sheet }));
  assert.strictEqual(tx.rowIndex, 2); assert.strictEqual(sheet._data[1][9], '午餐80');
});
t('getTransactionRows 讀 12 欄', () => {
  const rows = gs.getTransactionRows(fakeSs({ '交易紀錄': fakeSheet([['2026/08/06','永豐銀行','永豐證券','支出','投資','台積電','','TWD',9498,'PDF匯入','id1','']]) }));
  assert.strictEqual(rows[0].length, 12);
});
t('backfillTransactionIds 只補空白', () => {
  const sheet = fakeSheet([
    ['2026/08/06','永豐銀行','永豐證券','支出','投資','台積電','','TWD',9498,'PDF匯入','',''],
    ['2026/08/07','現金','現金','支出','飲食','午餐','','TWD',80,'午餐80','keep','']
  ]);
  assert.strictEqual(gs.backfillTransactionIds(fakeSs({ '交易紀錄': sheet })), 1);
  assert.ok(sheet._data[1][10]); assert.strictEqual(sheet._data[2][10], 'keep');
});
console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
```

（`module.exports` 讓其他測試檔可 `require('./transactions.test.js')` 取 `fakeSheet`／`fakeSs`；但 require 會執行測試，故改抽到 `test/fakes.js`：把 `fakeSheet`、`fakeSs` 放進 `test/fakes.js` 並在各測試 `require('./fakes')`。）

- [ ] **Step 2: 跑測試，預期 FAIL**
- [ ] **Step 3: 實作 `SheetService.gs`**

在 `getTransactionRows` 前加：

```js
var TX_COLUMN_COUNT = 12;

function rowToTransaction(row, rowIndex) {
  return {
    date: normalizeDateString(row[0]),
    institution: String(row[1] || '').trim(),
    account: String(row[2] || '').trim(),
    type: String(row[3] || '').trim(),
    category: String(row[4] || '').trim(),
    item: String(row[5] || '').trim(),
    description: String(row[6] || '').trim(),
    currency: String(row[7] || 'TWD').trim().toUpperCase() || 'TWD',
    amount: Math.abs(parseAmount(row[8])),
    source: String(row[9] || '').trim(),
    id: String(row[10] || '').trim(),
    transferId: String(row[11] || '').trim(),
    rowIndex: rowIndex
  };
}

function transactionToRow(tx) {
  var institution = tx.institution || '現金';
  var account = tx.account || (institution === '現金' ? '現金' : '');
  return [tx.date, institution, account, tx.type, tx.category, tx.item || '', tx.description || '',
    tx.currency || 'TWD', Math.abs(parseAmount(tx.amount)), tx.source || '', tx.id || Utilities.getUuid(), tx.transferId || ''];
}
```

`getTransactionRows` 改讀 `TX_COLUMN_COUNT` 欄。`appendTransaction`／`appendTransactionsBatch` 改為：

```js
function appendTransaction(date, institution, account, type, category, item, description, currency, amount, originalMessage, ss) {
  return appendTransactionsBatch([{ date: date, institution: institution, account: account, type: type, category: category,
    item: item, description: description, currency: currency, amount: amount }], originalMessage, ss)[0];
}

function appendTransactionsBatch(transactions, source, ss) {
  if (!transactions || transactions.length === 0) { return []; }
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var lastRow = sheet.getLastRow();
    var rows = transactions.map(function(tx) {
      var copy = {};
      for (var k in tx) { copy[k] = tx[k]; }
      copy.source = tx.source || source || 'PDF匯入';
      return transactionToRow(copy);
    });
    sheet.getRange(lastRow + 1, 1, rows.length, TX_COLUMN_COUNT).setValues(rows);
    return rows.map(function(row, i) { return rowToTransaction(row, lastRow + 1 + i); });
  } finally {
    lock.releaseLock();
  }
}
```

- [ ] **Step 4: `Config.gs`**：交易紀錄標題改 `A1:L1` 12 欄；已存在且 `K1 !== 'ID'` 時寫 `K1:L1 = ['ID','轉帳ID']`。新增：

```js
function backfillTransactionIds(ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return 0; }
  var range = sheet.getRange(2, 11, lastRow - 1, 1);
  var values = range.getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === '') { values[i][0] = Utilities.getUuid(); count++; }
  }
  if (count > 0) { range.setValues(values); }
  Logger.log('已補 ' + count + ' 筆交易 ID');
  return count;
}
```

- [ ] **Step 5: `npm test` 全綠（balance.test.js 的 `row()` 改產 12 欄）**
- [ ] **Step 6: Commit** `feat: 交易紀錄 ID/轉帳ID 欄、列物件轉換、backfillTransactionIds`

---

### Task 3: 帳戶管理 H/I/J 欄、21 個預設帳戶、upsertDefaultAccounts、預算表

**Files:** Modify `src/SheetService.gs`、`src/Config.gs`；Test `test/accounts.test.js`

**Interfaces:**
- `getAccounts(ss)` 每筆多 `type`（空白→名稱含「現金」為現金，否則銀行）、`debitAccount`、`accountNumberHints`（J 欄以逗號／頓號分割、去空白的陣列）、`institutionUnique`
- `findAccountByName(accounts, name)` → 物件或 null
- `ACCOUNT_HEADERS`（10 欄）、`DEFAULT_ACCOUNTS`（21 筆）
- `upsertDefaultAccounts(ss)` → 新增筆數

- [ ] **Step 1: 寫 `test/accounts.test.js`**

```js
const assert = require('assert');
const { loadGs } = require('./harness');
const gs = loadGs(['SheetService.gs', 'Config.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

function accountSheet(rows) {
  const data = [['帳戶名稱','金融機構','幣別','初始餘額','初始日期','備註','是否啟用','帳戶類型','扣款帳戶','帳號識別']].concat(rows);
  return {
    _data: data, getLastRow: () => data.length,
    getRange: (a, c, nr, nc) => {
      if (typeof a === 'string') {
        const col = a.charCodeAt(0) - 64, r = Number(a.slice(1));
        return { getValue: () => (data[r - 1] || [])[col - 1] || '', setValues: (v) => { for (let j = 0; j < v[0].length; j++) data[r - 1][col - 1 + j] = v[0][j]; } };
      }
      return {
        getValues: () => data.slice(a - 1, a - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; }),
        setValues: (vals) => { for (let i = 0; i < vals.length; i++) { const row = data[a - 1 + i] || (data[a - 1 + i] = []); for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j]; } }
      };
    }
  };
}
const ss = (sheet) => ({ getSheetByName: () => sheet });

t('getAccounts 讀 H/I/J，type 推斷，J 欄多識別', () => {
  const a = gs.getAccounts(ss(accountSheet([
    ['永豐信用卡','永豐銀行','TWD','','','',true,'信用卡','永豐大戶',''],
    ['玉山','玉山銀行','TWD','','','',true,'','','0015977, 0381979'],
    ['現金','現金','TWD','','','',true,'','','']
  ])));
  assert.strictEqual(a[0].type, '信用卡'); assert.strictEqual(a[0].debitAccount, '永豐大戶');
  assert.strictEqual(a[1].type, '銀行'); assert.deepStrictEqual(a[1].accountNumberHints, ['0015977', '0381979']);
  assert.strictEqual(a[2].type, '現金');
});
t('DEFAULT_ACCOUNTS 21 筆，含永豐信用卡外幣 USD', () => {
  assert.strictEqual(gs.DEFAULT_ACCOUNTS.length, 21);
  const r = gs.DEFAULT_ACCOUNTS.find(x => x[0] === '永豐信用卡外幣');
  assert.strictEqual(r[2], 'USD'); assert.strictEqual(r[7], '信用卡'); assert.strictEqual(r[8], '永豐大戶');
});
t('upsertDefaultAccounts 補標題與缺少帳戶，不覆蓋既有', () => {
  const sheet = accountSheet([['現金','現金','TWD',1000,'2026/01/01','',true,'','','']]);
  sheet._data[0] = sheet._data[0].slice(0, 7);
  assert.strictEqual(gs.upsertDefaultAccounts(ss(sheet)), 20);
  assert.strictEqual(sheet._data[0][7], '帳戶類型'); assert.strictEqual(sheet._data[1][3], 1000);
});
t('findAccountByName 正規化', () => {
  assert.strictEqual(gs.findAccountByName([{ name: 'LineBank' }], 'LINE Bank').name, 'LineBank');
  assert.strictEqual(gs.findAccountByName([{ name: 'LineBank' }], 'x'), null);
});
console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 跑測試，預期 FAIL**
- [ ] **Step 3: `SheetService.gs`**：`getAccounts` 讀 10 欄，map 內加

```js
      var name = String(row[0] || '').trim();
      var rawType = String(row[7] || '').trim();
      // ...既有欄位...
        type: rawType || (name.indexOf('現金') >= 0 ? '現金' : '銀行'),
        debitAccount: String(row[8] || '').trim(),
        accountNumberHints: String(row[9] || '').split(/[,，、]/).map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; })
```

並加 `findAccountByName`：

```js
function findAccountByName(accounts, name) {
  var target = normalizeName(name);
  if (target === '') { return null; }
  for (var i = 0; i < accounts.length; i++) { if (normalizeName(accounts[i].name) === target) { return accounts[i]; } }
  return null;
}
```

- [ ] **Step 4: `Config.gs`**：頂部加 `ACCOUNT_HEADERS` 與 `DEFAULT_ACCOUNTS`（21 筆，欄位 `[名稱, 機構, 幣別, '', '', 備註, true, 類型, 扣款帳戶, 帳號識別]`）：

```
現金/現金/TWD/現金 ｜ 一銀/第一銀行/TWD/銀行/J=630 ｜ 一銀信用卡/第一銀行/TWD/信用卡/扣=一銀/備註 綠活卡＋iLEO ｜
LineBank/LINE Bank/TWD/銀行 ｜ 王道/王道銀行/TWD/銀行 ｜ 永豐大戶/永豐銀行/TWD/銀行/J=198-01 ｜
永豐信用卡/永豐銀行/TWD/信用卡/扣=永豐大戶/備註 大戶卡＋幣倍卡＋大衛卡 ｜ 永豐信用卡外幣/永豐銀行/USD/信用卡/扣=永豐大戶 ｜
永豐證券/永豐銀行/TWD/證券/扣=永豐大戶/J=042-01 ｜ 永豐外幣/永豐銀行/USD/銀行/J=042-00 ｜
玉山/玉山銀行/TWD/銀行/J=0015977,0381979 ｜ 玉山信用卡/玉山銀行/TWD/信用卡/扣=玉山/備註 UBear ｜
台新/台新銀行/TWD/銀行/J=288810,288815,288818 ｜ 台新信用卡/台新銀行/TWD/信用卡/扣=台新 ｜
中信/中國信託/TWD/銀行 ｜ 中信信用卡/中國信託/TWD/信用卡/扣=中信/備註 Line 卡 ｜
富邦/富邦銀行/TWD/銀行 ｜ 富邦信用卡/富邦銀行/TWD/信用卡/扣=富邦/備註 Costco 卡 ｜
國泰/國泰銀行/TWD/銀行 ｜ 國泰信用卡/國泰銀行/TWD/信用卡/扣=國泰/備註 Cube 卡 ｜ 樂天/樂天銀行/TWD/銀行
```

`initializeSheets` 帳戶管理段：不存在→建 10 欄標題＋21 筆；存在→`upsertDefaultAccounts(ss)`。另補：分類表 `B1:C1 = ['圖示','顏色']`（`B1 !== '圖示'` 時）；收入分類無「轉帳」則 `appendRow(['轉帳'])`；建「預算」表 `A1:C1 = ['類型','名稱','月預算']`。

```js
function upsertDefaultAccounts(ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('帳戶管理');
  if (String(sheet.getRange('H1').getValue()) !== '帳戶類型') {
    sheet.getRange('H1:J1').setValues([['帳戶類型', '扣款帳戶', '帳號識別']]);
  }
  var lastRow = sheet.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) { existing[normalizeName(row[0])] = true; });
  }
  var missing = DEFAULT_ACCOUNTS.filter(function(row) { return !existing[normalizeName(row[0])]; });
  if (missing.length > 0) { sheet.getRange(lastRow + 1, 1, missing.length, ACCOUNT_HEADERS.length).setValues(missing); }
  Logger.log('帳戶管理新增 ' + missing.length + ' 筆');
  return missing.length;
}
```

- [ ] **Step 5: `npm test` 全綠**
- [ ] **Step 6: Commit** `feat: 帳戶類型/扣款帳戶/帳號識別欄、21 預設帳戶、預算表`

---

### Task 4: 餘額規則與 LINE 餘額回覆分區

**Files:** Modify `src/SheetService.gs`（`excludeReason`、`calculateBalanceFromRows`）、`src/Main.gs`（`formatAmount`、新 `formatBalanceLine`、`handleBalanceCommand`）；Modify `test/balance.test.js`；Modify `openspec/specs/account-management/spec.md`、`balance-query/spec.md`

**Interfaces:** `calculateBalanceFromRows` 回傳多 `type`；`formatBalanceLine(balance)`：信用卡 → `名稱：未繳 $X`，其他 `名稱：$X[ USD]`；`formatAmount` 有小數時保留兩位。

- [ ] **Step 1: 測試**：把「繳信用卡 排除」改為計入（txCount 1、total −5000）；新增 `formatBalanceLine` 三個斷言：`{name:'永豐信用卡',type:'信用卡',currency:'TWD',currentBalance:-0}` → `永豐信用卡：未繳 $0`；銀行 0 → `永豐大戶：$0`；USD 0 → `永豐外幣：$1,858.62 USD`。
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**：`excludeReason` 刪除 `credit-card-payment` 分支；`calculateBalanceFromRows` 回傳加 `type: account.type || '銀行'`。`Main.gs`：

```js
function formatAmount(amount) {
  amount = Number(amount) || 0;
  var abs = Math.abs(amount);
  var hasCents = Math.round(abs * 100) % 100 !== 0;
  return (amount < 0 ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}
function formatBalanceLine(balance) {
  if (balance.type === '信用卡') { return balance.name + '：未繳 ' + formatBalanceAmount(-balance.currentBalance, balance.currency); }
  return balance.name + '：' + formatBalanceAmount(balance.currentBalance, balance.currency);
}
```

`handleBalanceCommand` 全覽：先列「【資產】」非信用卡帳戶，再「【信用卡】」，每行 `formatBalanceLine`，最後「共 N 個帳戶」。

- [ ] **Step 4: 規格**：account-management 刪「繳信用卡排除」需求與 Scenario，改為「信用卡帳戶餘額為負表示未繳」；balance-query 全覽格式加分區。
- [ ] **Step 5: `npm test` 全綠；Commit** `feat: 餘額計入繳信用卡；餘額一覽分資產/信用卡`

---

### Task 5: 轉帳配對核心

**Files:** Create `src/TransferService.gs`；Test `test/transfer.test.js`（用 `test/fakes.js`）

**Interfaces（純邏輯）:**
- `dateDiffDays(a, b)` → 天數差絕對值；無效 → Infinity
- `pickTransferCandidates(tx, allTx, accounts, options)`：不同帳戶、無 transferId、類型相反、`options.counterpartyAccount`（帳戶名）有值時只留該帳戶、`options.counterpartyBank` 有值時只留該機構；同幣別：日期差 ≤ `dayWindow`（預設 3）且金額相等；跨幣別：同日且任一方描述／品項含「換匯」
- **試算表：** `findTransactionsByIds(ids, ss)` → `{id: tx}`；`writeTransferCells(txs, transferId, category, ss)`；`linkTransfer(idA, idB, ss)` → transferId（驗證：皆存在、皆無 transferId、不同帳戶、類型相反、同幣別金額相等）；`unlinkTransfer(transferId, ss)` → 清除列數；`createTransfer({fromAccount, toAccount, amount, date, note, toAmount}, ss)` → 兩個交易物件（source `App`，品項「轉帳至X」／「來自X」，跨幣別用 `toAmount`）

- [ ] **Step 1: 寫 `test/transfer.test.js`**（案例：同幣別唯一候選；已配對排除；跨幣別換匯同日可配；`counterpartyAccount` 限定；`counterpartyBank` 限定；`dateDiffDays`；`linkTransfer` 寫 L 欄與分類「轉帳」；同帳戶拋 `/同一帳戶/`；`unlinkTransfer` 回傳 2 並清空；`createTransfer` 兩列同 transferId、類型支出／收入、source `App`）。帳戶固定資料：永豐大戶(TWD 銀行)、永豐證券(TWD 證券)、永豐外幣(USD 銀行)、玉山(TWD 銀行)。
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**

```js
function dateDiffDays(a, b) {
  var da = parseSheetDate(a), db = parseSheetDate(b);
  if (!da || !db) { return Infinity; }
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}

function hasFxHint(tx) { return /換匯/.test((tx.description || '') + (tx.item || '')); }

function pickTransferCandidates(tx, allTx, accounts, options) {
  options = options || {};
  var dayWindow = options.dayWindow === undefined ? 3 : options.dayWindow;
  var cpAccount = normalizeName(options.counterpartyAccount || '');
  var cpBank = normalizeName(options.counterpartyBank || '');
  var txAccount = findAccountByName(accounts, tx.account);
  var txCurrency = txAccount ? txAccount.currency : (tx.currency || 'TWD');
  var oppositeType = tx.type === '支出' ? '收入' : '支出';
  return allTx.filter(function(o) {
    if (o.id === tx.id || o.transferId || o.type !== oppositeType) { return false; }
    if (normalizeName(o.account) === normalizeName(tx.account)) { return false; }
    var oa = findAccountByName(accounts, o.account);
    if (!oa) { return false; }
    if (cpAccount && normalizeName(oa.name) !== cpAccount) { return false; }
    if (cpBank && normalizeName(oa.institution) !== cpBank) { return false; }
    var diff = dateDiffDays(tx.date, o.date);
    if (oa.currency === txCurrency) { return diff <= dayWindow && Math.abs(o.amount - tx.amount) < 0.005; }
    return diff === 0 && (hasFxHint(tx) || hasFxHint(o));
  });
}

function findTransactionsByIds(ids, ss) {
  var rows = getTransactionRows(getSpreadsheet(ss));
  var wanted = {}; ids.forEach(function(id) { wanted[id] = true; });
  var found = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][10] || '').trim();
    if (wanted[id]) { found[id] = rowToTransaction(rows[i], i + 2); }
  }
  return found;
}

function writeTransferCells(txs, transferId, category, ss) {
  var sheet = getSpreadsheet(ss).getSheetByName('交易紀錄');
  txs.forEach(function(tx) {
    sheet.getRange(tx.rowIndex, 12, 1, 1).setValue(transferId);
    if (category) { sheet.getRange(tx.rowIndex, 5, 1, 1).setValue(category); }
  });
}

function linkTransfer(idA, idB, ss) {
  ss = getSpreadsheet(ss);
  var found = findTransactionsByIds([idA, idB], ss);
  var a = found[idA], b = found[idB];
  if (!a || !b) { throw new Error('找不到要連結的交易，可能已被刪除'); }
  if (a.transferId || b.transferId) { throw new Error('其中一筆已是轉帳配對，請先解除'); }
  if (normalizeName(a.account) === normalizeName(b.account)) { throw new Error('兩筆交易屬於同一帳戶，無法配對'); }
  if (a.type === b.type) { throw new Error('兩筆交易必須一筆支出、一筆收入'); }
  if (a.currency === b.currency && Math.abs(a.amount - b.amount) >= 0.005) { throw new Error('同幣別的轉帳金額必須相同'); }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { var id = Utilities.getUuid(); writeTransferCells([a, b], id, '轉帳', ss); return id; }
  finally { lock.releaseLock(); }
}

function unlinkTransfer(transferId, ss) {
  ss = getSpreadsheet(ss);
  var rows = getTransactionRows(ss), targets = [];
  for (var i = 0; i < rows.length; i++) { if (String(rows[i][11] || '').trim() === transferId) { targets.push(rowToTransaction(rows[i], i + 2)); } }
  writeTransferCells(targets, '', null, ss);
  return targets.length;
}

function createTransfer(params, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var from = findAccountByName(accounts, params.fromAccount), to = findAccountByName(accounts, params.toAccount);
  if (!from || !to) { throw new Error('找不到帳戶：' + (from ? params.toAccount : params.fromAccount)); }
  if (from.name === to.name) { throw new Error('轉出與轉入帳戶不可相同'); }
  var amount = Math.abs(parseAmount(params.amount));
  var toAmount = (from.currency === to.currency || params.toAmount === undefined || params.toAmount === '') ? amount : Math.abs(parseAmount(params.toAmount));
  var transferId = Utilities.getUuid(), note = params.note || '';
  return appendTransactionsBatch([
    { date: params.date, institution: from.institution, account: from.name, type: '支出', category: '轉帳', item: '轉帳至' + to.name, description: note, currency: from.currency, amount: amount, transferId: transferId },
    { date: params.date, institution: to.institution, account: to.name, type: '收入', category: '轉帳', item: '來自' + from.name, description: note, currency: to.currency, amount: toAmount, transferId: transferId }
  ], 'App', ss);
}
```

- [ ] **Step 4: `npm test` 全綠；Commit** `feat: 轉帳配對核心`

---

### Task 6: 對方帳戶辨識、繳卡費／交割戶／ATM 自動配對

**Files:** Modify `src/TransferService.gs`；Test 追加 `test/transfer.test.js`

**Interfaces（純邏輯）:**
- `BANK_CODE_MAP`：`808 玉山銀行、812 台新銀行、822 中國信託、013 國泰銀行、012 富邦銀行、007 第一銀行、824 LINE Bank、048 王道銀行、810 樂天銀行、807 永豐銀行、700 中華郵政、006 合作金庫`
- `digitsOnly(s)`、`stripLeadingZeros(s)`
- `hintMatches(number, hint)`：兩邊去 `-`、去前導零後，number 以 hint 為前綴
- `matchCounterpartyAccount(text, accounts)` → 帳戶或 null：取 text 中所有 ≥ 8 位數字串，每串候選 `[d, d.slice(3)]`，對所有帳戶的 `accountNumberHints` 做 `hintMatches`；命中帳戶唯一 → 回傳
- `parseCounterpartyBank(text)` → 機構名或 ''：最長 ≥ 10 位數字串前三碼查 `BANK_CODE_MAP`
- `resolveCreditCardAccount(tx, accounts)`：信用卡帳戶中 (1) 描述含帳戶名 (2) 描述含機構名或去「銀行」簡稱，經幣別提示過濾（描述含「換匯」「外幣」「usd」→ 非 TWD 卡，否則 TWD 卡）(3) `debitAccount` 等於 `tx.account` 經幣別過濾；每階段唯一才回傳
- `resolveBrokerageAccount(tx, accounts)`：證券帳戶中 (1) `matchCounterpartyAccount` 命中證券帳戶 (2) 描述含「交割」「證券」且 `debitAccount` 等於 `tx.account` 唯一
- `isCashWithdrawal(tx)`：`/現金提|ATM提款|提款|提領/` 且 type 支出
- `buildCounterpartRow(tx, targetAccount, amount, item)` → 反向交易物件（分類轉帳、source `自動配對`）
- **試算表：** `autoPairImportedTransactions(newTxs, ss)` → `{paired, created, details[]}`：
  - 分類「繳信用卡」：`resolveCreditCardAccount`；同幣別金額 `tx.amount`，跨幣別用 `tx.fxAmount`（無則 details 記「外幣卡費金額不明」）；新增「卡費入帳」列並配對
  - 分類「轉帳」：`cp = matchCounterpartyAccount(description)`；`pickTransferCandidates(tx, existing, accounts, {counterpartyAccount: cp && cp.name, counterpartyBank: !cp && parseCounterpartyBank(description)})`；唯一→配對；多個→details；零個且支出：`isCashWithdrawal` → 新增「現金」收入列配對；否則 `resolveBrokerageAccount` → 新增「交割戶入帳」列配對；否則不動

- [ ] **Step 1: 追加測試**（案例：`matchCounterpartyAccount('跨行轉 0019801800104436', accounts)` → 永豐大戶（J `198-01`）；`'手機轉帳 8080000381979084481'` → 玉山（J `0015977,0381979`）；`'0000063057052425'` → 一銀（J `630`）；`parseCounterpartyBank('8220000234540289458')` → 中國信託；`resolveCreditCardAccount` 四例（永豐卡費→永豐信用卡；卡費換匯→永豐信用卡外幣；第一銀行自扣→一銀信用卡；「卡費」無提示且永豐大戶兩張卡→null、一銀→一銀信用卡）；`resolveBrokerageAccount('手機轉帳 04201820006159')` → 永豐證券；`autoPairImportedTransactions` 三情境：繳卡費建列＋配對、轉帳唯一候選配對、現金提 5,000 建「現金」列配對）
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**

```js
var BANK_CODE_MAP = { '808': '玉山銀行', '812': '台新銀行', '822': '中國信託', '013': '國泰銀行', '012': '富邦銀行',
  '007': '第一銀行', '824': 'LINE Bank', '048': '王道銀行', '810': '樂天銀行', '807': '永豐銀行', '700': '中華郵政', '006': '合作金庫' };

function stripLeadingZeros(s) { return String(s || '').replace(/^0+/, ''); }
function hintMatches(number, hint) {
  var n = stripLeadingZeros(String(number || '').replace(/[-\s]/g, ''));
  var h = stripLeadingZeros(String(hint || '').replace(/[-\s]/g, ''));
  return h !== '' && n.indexOf(h) === 0;
}
function matchCounterpartyAccount(text, accounts) {
  var nums = String(text || '').match(/\d{8,}/g) || [];
  var hits = {};
  nums.forEach(function(d) {
    [d, d.slice(3)].forEach(function(cand) {
      accounts.forEach(function(a) {
        (a.accountNumberHints || []).forEach(function(h) { if (hintMatches(cand, h)) { hits[a.name] = a; } });
      });
    });
  });
  var names = Object.keys(hits);
  return names.length === 1 ? hits[names[0]] : null;
}
function parseCounterpartyBank(text) {
  var nums = String(text || '').match(/\d{10,}/g) || [];
  if (nums.length === 0) { return ''; }
  nums.sort(function(a, b) { return b.length - a.length; });
  return BANK_CODE_MAP[nums[0].slice(0, 3)] || '';
}
function textOf(tx) { return normalizeName((tx.description || '') + ' ' + (tx.item || '')); }
function filterByCurrencyHint(tx, list) {
  var fx = /換匯|外幣|usd/.test(textOf(tx));
  var f = list.filter(function(a) { return fx ? a.currency !== 'TWD' : a.currency === 'TWD'; });
  return f.length > 0 ? f : list;
}
function resolveCreditCardAccount(tx, accounts) {
  var text = textOf(tx);
  var cards = accounts.filter(function(a) { return a.type === '信用卡'; });
  var byName = cards.filter(function(a) { return text.indexOf(normalizeName(a.name)) >= 0; });
  if (byName.length === 1) { return byName[0]; }
  var byInst = filterByCurrencyHint(tx, cards.filter(function(a) {
    var inst = normalizeName(a.institution), short = inst.replace(/銀行$/, '');
    return inst !== '' && (text.indexOf(inst) >= 0 || (short.length >= 2 && text.indexOf(short) >= 0));
  }));
  if (byInst.length === 1) { return byInst[0]; }
  var byDebit = filterByCurrencyHint(tx, cards.filter(function(a) { return normalizeName(a.debitAccount) === normalizeName(tx.account); }));
  return byDebit.length === 1 ? byDebit[0] : null;
}
function resolveBrokerageAccount(tx, accounts) {
  var brokers = accounts.filter(function(a) { return a.type === '證券'; });
  var cp = matchCounterpartyAccount(tx.description, brokers);
  if (cp) { return cp; }
  var text = textOf(tx);
  if (!/交割|證券/.test(text)) { return null; }
  var byDebit = brokers.filter(function(a) { return normalizeName(a.debitAccount) === normalizeName(tx.account); });
  return byDebit.length === 1 ? byDebit[0] : null;
}
function isCashWithdrawal(tx) { return tx.type === '支出' && /現金提|atm提款|提款|提領/.test(textOf(tx)); }
function buildCounterpartRow(tx, target, amount, item) {
  return { date: tx.date, institution: target.institution, account: target.name, type: tx.type === '支出' ? '收入' : '支出',
    category: '轉帳', item: item, description: '自動配對：' + (tx.item || tx.description || ''), currency: target.currency, amount: amount, source: '自動配對' };
}
function pairWithNewRow(tx, target, amount, item, ss) {
  var created = appendTransactionsBatch([buildCounterpartRow(tx, target, amount, item)], '自動配對', ss)[0];
  writeTransferCells([tx, created], Utilities.getUuid(), null, ss);
}
function autoPairImportedTransactions(newTxs, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var result = { paired: 0, created: 0, details: [] };
  for (var i = 0; i < newTxs.length; i++) {
    var all = getTransactionRows(ss).map(function(r, idx) { return rowToTransaction(r, idx + 2); });
    var tx = null;
    for (var j = 0; j < all.length; j++) { if (all[j].id === newTxs[i].id) { tx = all[j]; } }
    if (!tx || tx.transferId) { continue; }
    var label = tx.category + ' ' + tx.date + ' ' + tx.account + ' ' + tx.amount;
    if (tx.category === '繳信用卡') {
      var card = resolveCreditCardAccount(tx, accounts);
      if (!card) { result.details.push(label + '：無法判斷信用卡帳戶，請在 App 手動連結'); continue; }
      var amt = tx.amount;
      if (card.currency !== tx.currency) {
        if (!newTxs[i].fxAmount) { result.details.push(label + '：外幣卡費金額不明，請在 App 手動連結'); continue; }
        amt = newTxs[i].fxAmount;
      }
      pairWithNewRow(tx, card, amt, '卡費入帳', ss); result.created++; result.paired++;
      continue;
    }
    if (tx.category !== '轉帳') { continue; }
    var cp = matchCounterpartyAccount(tx.description, accounts);
    var candidates = pickTransferCandidates(tx, all, accounts, { counterpartyAccount: cp ? cp.name : '', counterpartyBank: cp ? '' : parseCounterpartyBank(tx.description) });
    if (candidates.length === 1) { writeTransferCells([tx, candidates[0]], Utilities.getUuid(), '轉帳', ss); result.paired++; continue; }
    if (candidates.length > 1) { result.details.push(label + '：多個候選，請在 App 手動連結'); continue; }
    if (tx.type !== '支出') { continue; }
    if (isCashWithdrawal(tx)) {
      var cash = accounts.filter(function(a) { return a.type === '現金' && a.currency === tx.currency; })[0];
      if (cash) { pairWithNewRow(tx, cash, tx.amount, 'ATM 提款', ss); result.created++; result.paired++; }
      continue;
    }
    var broker = resolveBrokerageAccount(tx, accounts);
    if (broker && broker.currency === tx.currency) { pairWithNewRow(tx, broker, tx.amount, '交割戶入帳', ss); result.created++; result.paired++; }
  }
  return result;
}
```

- [ ] **Step 4: `npm test` 全綠；Commit** `feat: 對方帳戶辨識與繳卡費/交割戶/ATM 自動配對`

---

### Task 7: 匯入去重

**Files:** Modify `src/TransferService.gs`；Test `test/import.test.js`

**Interfaces:**
- `IMPORT_SOURCES = {'PDF匯入','文字匯入','自動配對'}`；`GENERIC_STOCK_ITEMS = /定期買股|交割|證券|股票/`
- `isDuplicateImport(tx, existingTxs, options)` → 既有交易或 null：既有 source 為匯入、同帳戶、同幣別、同類型、金額相等、日期差 ≤ `dayWindow`（預設 2）
- `dedupeAgainstSheet(transactions, ss)` → `{kept, skipped, merged}`：同批不互相去重；重複且新筆為投資類且有股名、既有品項為概括詞 → 改寫既有列 F/G 欄（merged++）；重複皆 skip

- [ ] **Step 1: 寫 `test/import.test.js`**（案例：2 天內重複／10 天不重複／不同帳戶不重複；既有為手動記帳不算重複；證券後到改寫品項且 XSOLLA 670×2 同批不去重；銀行後到概括列被跳過）
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**

```js
var IMPORT_SOURCES = { 'PDF匯入': true, '文字匯入': true, '自動配對': true };
var GENERIC_STOCK_ITEMS = /定期買股|交割|證券|股票/;
function isDuplicateImport(tx, existingTxs, options) {
  var dayWindow = (options && options.dayWindow !== undefined) ? options.dayWindow : 2;
  var amount = Math.abs(parseAmount(tx.amount));
  for (var i = 0; i < existingTxs.length; i++) {
    var e = existingTxs[i];
    if (!IMPORT_SOURCES[e.source] || e.type !== tx.type) { continue; }
    if (normalizeName(e.account) !== normalizeName(tx.account) || (e.currency || 'TWD') !== (tx.currency || 'TWD')) { continue; }
    if (Math.abs(e.amount - amount) >= 0.005 || dateDiffDays(e.date, tx.date) > dayWindow) { continue; }
    return e;
  }
  return null;
}
function dedupeAgainstSheet(transactions, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var existing = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); });
  var used = {}, result = { kept: [], skipped: [], merged: 0 };
  transactions.forEach(function(tx) {
    var dup = isDuplicateImport(tx, existing.filter(function(e) { return !used[e.id]; }));
    if (!dup) { result.kept.push(tx); return; }
    used[dup.id] = true;
    var newHasStock = (tx.category === '投資' || tx.category === '投資獲利') && tx.item && !GENERIC_STOCK_ITEMS.test(tx.item);
    if (newHasStock && GENERIC_STOCK_ITEMS.test(dup.item || '')) {
      sheet.getRange(dup.rowIndex, 6, 1, 2).setValues([[tx.item, tx.description || '']]);
      result.merged++;
    }
    result.skipped.push(tx);
  });
  return result;
}
```

- [ ] **Step 4: `npm test` 全綠；Commit** `feat: 匯入去重`

---

### Task 8: prompt 調整、亂碼逐行過濾、帳戶分流後處理

**Files:** Modify `src/OpenAIService.gs`、`src/Main.gs`（亂碼判斷）；Test `test/prompt.test.js`；Create `test/prompt-live.js`

**Interfaces:**
- `describeAccounts(accounts)` → `名稱（機構，幣別，類型，帳號 hint1/hint2）` 頓號串
- `buildSystemPrompt(exp, inc, accounts)`、`buildPdfSystemPrompt(exp, inc, accounts)`、`parseWithOpenAI(msg, exp, inc, accounts)`、`parsePdfWithOpenAI(text, exp, inc, accounts)`：第四參數改為帳戶物件陣列
- 輸出 JSON：`{"bank","statementType":"信用卡|銀行帳戶|證券","transactions":[{...,"accountNumber","currency"}],"skipped"}`
- `stripGarbledLines(text)` → 過濾非中英數標點字元比例 > 50% 的行（取代 Main.gs 整份拒收）
- `findAccountByNumber(accounts, accountNumber)`（用 `hintMatches` 對 `accountNumberHints`，唯一命中）
- `findAccountByTypeAndBank(accounts, type, bank, currency)`
- `resolveImportedAccounts(parsed, accounts)` → `{transactions, unmatchedAccountNumbers}`：`accountNumber` 有值→帳號分流（找不到→丟棄並記錄）；信用卡／證券帳單強制對應類型帳戶；同帳戶內轉（`matchCounterpartyAccount(description)` 等於本列帳戶）→ 丟棄
- `extractFxCardPayment(parsed, accounts)`：永豐 198-00 過渡戶處理（卡費合計寫入 TWD「卡費換匯」`fxAmount`；「回饋」列改 USD 卡收入／回饋；其餘丟棄）

- [ ] **Step 1: 寫 `test/prompt.test.js`**（斷言：prompt 含 `永豐證券（永豐銀行，TWD，證券，帳號 042-01）`、`statementType`、`回饋入帳戶`、`餘額`、`tab`；`stripGarbledLines` 去掉一銀亂碼行、保留正常行；`resolveImportedAccounts` 帳號分流、未對應記錄、信用卡強制卡帳戶並依幣別分流、玉山同帳戶內轉兩列丟棄；`extractFxCardPayment` fxAmount 509.66 與回饋轉 USD 卡）
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: prompt 內容**（`buildPdfSystemPrompt`）：
  - 新段「帳單類型判斷（statementType）」：信用卡（結帳日、應繳總額、卡號末四碼）／銀行帳戶（帳號、摘要、支出存入餘額）／證券（成交日期、交易別、股數、客戶應收付）。
  - 帳戶清單改 `describeAccounts`；account 規則：信用卡帳單→同機構信用卡帳戶且幣別相符（雙幣帳單美元區塊→USD 卡）；銀行明細→依「帳號」行填 `accountNumber` 原文；證券→證券帳戶。
  - 「方向判斷」：欄位黏在一起時以餘額差決定；tab 分隔文字直接依支出／存入欄；對方帳號原文保留在 description。
  - 跳過規則追加：9 信用卡帳單「回饋入帳戶」列；10 交割戶「定期買股／交割／證券買賣」列；11 證券庫存段；12 同帳戶內轉（對方帳號為自己另一帳號，需列出但系統會丟棄——prompt 仍要求輸出，由後處理判斷）；13 金額 0 的 INTEREST／利息。
  - 分類規則追加：回饋非「入帳戶」且負數→收入／回饋記卡帳戶；「大戶回饋」「幣倍回饋」「折讓款」→收入／回饋；「ACH股息」→收入／股利；「卡費換匯」→支出／繳信用卡；「手機換匯」→轉帳；「現金提」「ATM提款」→支出／轉帳；「薪資」「電匯 醫療財團法人」→收入／薪資；「媒體轉帳 台新卡費」「玉山卡款扣繳」「中信卡」→支出／繳信用卡；愛金卡／一卡通／悠遊卡加值→交通；優步-餐廳→飲食。
  - 日期：民國年 1XX/MM/DD；信用卡帳單只有 MM/DD 時以結帳日年份推算，消費月 > 結帳月為前一年；同一帳單多張卡同一帳戶，卡號末四碼寫入 description。
  - 範例 1（一銀信用卡）改 `"account":"一銀信用卡"`、加 `"statementType":"信用卡"`、回饋列 `-58` 改為 `type:收入, category:回饋`；範例 2 加 `"statementType":"銀行帳戶"` 與 `"accountNumber":"198-01*-**10443-*"`；範例 3 加 `"statementType":"證券"`；新增範例 4（中信 tab 格式：薪資、現金提、中信卡、跨行轉）。
- [ ] **Step 4: 實作後處理函式**（`stripGarbledLines`、`findAccountByNumber`、`findAccountByTypeAndBank`、`resolveImportedAccounts`、`extractFxCardPayment`），`parsePdfWithOpenAI` 結尾依序呼叫 `extractFxCardPayment` → `resolveImportedAccounts`，並把 `unmatchedAccountNumbers` 放進回傳。`Main.gs` `handleFileMessage` 的亂碼段改為 `text = stripGarbledLines(text)`，若過濾後為空才回覆無法辨識。

```js
function stripGarbledLines(text) {
  return String(text || '').split('\n').filter(function(line) {
    var s = line.trim();
    if (s === '') { return true; }
    var bad = (s.match(/[^一-鿿　-〿＀-￯A-Za-z0-9\s,.\/\-\+\*\(\)\[\]:：;；%$＄'"「」『』、。，！？!?_#&@=~]/g) || []).length;
    return bad / s.length <= 0.5;
  }).join('\n');
}
function findAccountByNumber(accounts, accountNumber) {
  var hits = accounts.filter(function(a) { return (a.accountNumberHints || []).some(function(h) { return hintMatches(accountNumber, h); }); });
  return hits.length === 1 ? hits[0] : null;
}
function findAccountByTypeAndBank(accounts, type, bank, currency) {
  var b = normalizeName(bank || '').replace(/銀行$/, '');
  var hits = accounts.filter(function(a) {
    var inst = normalizeName(a.institution).replace(/銀行$/, '');
    return a.type === type && (a.currency || 'TWD') === (currency || 'TWD') && (b === '' || inst.indexOf(b) >= 0 || b.indexOf(inst) >= 0);
  });
  return hits.length === 1 ? hits[0] : null;
}
function resolveImportedAccounts(parsed, accounts) {
  var out = [], unmatched = {}, st = parsed.statementType || '';
  (parsed.transactions || []).forEach(function(tx) {
    var currency = String(tx.currency || 'TWD').toUpperCase();
    var acct = null;
    if (tx.accountNumber) {
      acct = findAccountByNumber(accounts, tx.accountNumber);
      if (!acct) { unmatched[tx.accountNumber] = true; return; }
      var cp = matchCounterpartyAccount(tx.description, accounts);
      if (cp && cp.name === acct.name) { return; } // 同帳戶內轉
    } else {
      acct = findAccountByName(accounts, tx.account);
      if (st === '信用卡' && (!acct || acct.type !== '信用卡' || acct.currency !== currency)) { acct = findAccountByTypeAndBank(accounts, '信用卡', parsed.bank || tx.institution, currency) || acct; }
      else if (st === '證券' && (!acct || acct.type !== '證券')) { acct = findAccountByTypeAndBank(accounts, '證券', parsed.bank || tx.institution, currency) || acct; }
    }
    if (acct) { tx.account = acct.name; tx.institution = acct.institution; tx.currency = acct.currency; } else { tx.currency = currency; }
    out.push(tx);
  });
  return { transactions: out, unmatchedAccountNumbers: Object.keys(unmatched) };
}
function extractFxCardPayment(parsed, accounts) {
  var txs = parsed.transactions || [];
  var isTransit = function(tx) { return String(tx.accountNumber || '').replace(/-/g, '').indexOf('19800') === 0; };
  var transit = txs.filter(isTransit);
  if (transit.length === 0) { return parsed; }
  var fxTotal = 0, rewards = [];
  transit.forEach(function(tx) {
    var text = (tx.item || '') + ' ' + (tx.description || '');
    if (tx.type === '支出' && /卡費/.test(text)) { fxTotal += Number(tx.amount) || 0; }
    if (tx.type === '收入' && /回饋/.test(text)) { rewards.push(tx); }
  });
  var usdCard = findAccountByTypeAndBank(accounts, '信用卡', parsed.bank, 'USD');
  var kept = txs.filter(function(tx) { return !isTransit(tx); });
  kept.forEach(function(tx) { if (tx.category === '繳信用卡' && /換匯/.test((tx.item || '') + (tx.description || '')) && fxTotal > 0) { tx.fxAmount = Math.round(fxTotal * 100) / 100; } });
  if (usdCard) { rewards.forEach(function(tx) { tx.accountNumber = ''; tx.account = usdCard.name; tx.institution = usdCard.institution; tx.currency = 'USD'; tx.category = '回饋'; tx.type = '收入'; kept.push(tx); }); }
  parsed.transactions = kept;
  return parsed;
}
```

（`hintMatches`、`matchCounterpartyAccount` 定義在 TransferService.gs；GAS 全域可見，Node 測試 `loadGs` 需同時載入 `TransferService.gs`。）

- [ ] **Step 5: `Main.gs` 呼叫端改傳 `accounts` 物件陣列**
- [ ] **Step 6: 寫 `test/prompt-live.js`**：讀 `.env` 的 `OPENAI_API_KEY`（缺則略過），以 `curl` 實作 `UrlFetchApp.fetch` stub，載入 `SheetService.gs, TransferService.gs, Config.gs, OpenAIService.gs`，帳戶取 `DEFAULT_ACCOUNTS` 轉物件（含 `accountNumberHints`），對 `process.argv[2]` 指定的 fixture 跑 `parsePdfWithOpenAI`，印出每筆與依帳戶／幣別的筆數與合計。逐一跑八份 fixture，對照各 `*.expected.md` 的斷言（卡帳單合計、去重、fxAmount、回饋型態、同帳戶內轉丟棄、中信 tab 格式）。不符修 prompt，最多兩輪。
- [ ] **Step 7: `npm test` 全綠；Commit** `feat: prompt 帳單類型/帳號分流/回饋與交割規則，亂碼逐行過濾`

---

### Task 9: 匯入流程串接與回覆摘要

**Files:** Modify `src/Main.gs`；Test 追加 `test/import.test.js`

**Interfaces:**
- `importTransactions(result, source, ss)` → `{written, skipped, merged, pairing}`：`dedupeAgainstSheet` → `appendTransactionsBatch`（保留 `fxAmount` 到回傳物件：寫入後把 `kept[i].fxAmount` 複製到 `written[i].fxAmount`）→ `autoPairImportedTransactions`
- `buildImportSummary(result, source, outcome)`：加「帳單類型：X」「跳過與既有紀錄重複 N 筆（更新 M 筆股名）」「已自動配對 N 筆（新增 M 筆對方帳戶紀錄）」「⚠ details」「未對應帳號：…（請在帳戶管理 J 欄填帳號識別）」
- `handleTextMessage` 單筆寫入後：分類為繳信用卡或轉帳 → `autoPairImportedTransactions([written], ss)`，成功時回覆加「已自動配對對方帳戶」

- [ ] **Step 1: 追加 `buildImportSummary` 測試**（含帳單類型、重複、配對、未對應、details 各關鍵字）
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**（`importTransactions`、`buildImportSummary` 依介面；`handleFileMessage`／`handleBankStatementText` 改呼叫 `importTransactions` 並以 `buildImportSummary(result, 'PDF'|'文字', outcome)` 回覆）
- [ ] **Step 4: `npm test` 全綠；Commit** `feat: 匯入流程串接去重、自動配對、摘要`

---

### Task 10: 舊資料搬移

**Files:** Modify `src/TransferService.gs`；Test 追加 `test/import.test.js`

**Interfaces:**
- `migrateCreditCardRows(fromAccount, toAccount, startDate, endDate, dryRun, ss)` → `{matched, moved, rows[]}`：C 欄 = fromAccount、分類非繳信用卡／轉帳、來源為匯入、日期在區間；`dryRun` 預設 true 只 Logger；正式時改 B/C 欄為目標帳戶機構與名稱
- `pairExistingCreditCardPayments(dryRun, ss)`：所有繳信用卡且無轉帳 ID 的列跑 `autoPairImportedTransactions`

- [ ] **Step 1: 追加測試**（dryRun 不寫入且 matched 1；正式執行 moved 1、繳信用卡列不動、手動記帳列不動）
- [ ] **Step 2: 跑測試 FAIL**
- [ ] **Step 3: 實作**

```js
function migrateCreditCardRows(fromAccount, toAccount, startDate, endDate, dryRun, ss) {
  dryRun = dryRun !== false;
  ss = getSpreadsheet(ss);
  var target = findAccountByName(getAccounts(ss), toAccount);
  if (!target) { throw new Error('找不到目標帳戶：' + toAccount); }
  var sheet = ss.getSheetByName('交易紀錄');
  var rows = getTransactionRows(ss);
  var start = startDate ? parseSheetDate(startDate) : null, end = endDate ? parseSheetDate(endDate) : null;
  var result = { matched: 0, moved: 0, rows: [] };
  for (var i = 0; i < rows.length; i++) {
    var tx = rowToTransaction(rows[i], i + 2);
    if (normalizeName(tx.account) !== normalizeName(fromAccount)) { continue; }
    if (tx.category === '繳信用卡' || tx.category === '轉帳' || !IMPORT_SOURCES[tx.source]) { continue; }
    var d = parseSheetDate(tx.date);
    if ((start && (!d || d < start)) || (end && (!d || d > end))) { continue; }
    result.matched++; result.rows.push(tx.rowIndex);
    Logger.log((dryRun ? '[預覽] ' : '[搬移] ') + '第 ' + tx.rowIndex + ' 列 ' + tx.date + ' ' + tx.item + ' ' + tx.amount);
    if (!dryRun) { sheet.getRange(tx.rowIndex, 2, 1, 2).setValues([[target.institution, target.name]]); result.moved++; }
  }
  Logger.log('符合 ' + result.matched + ' 筆，已搬移 ' + result.moved + ' 筆' + (dryRun ? '（預覽，未寫入；正式執行傳 dryRun=false）' : ''));
  return result;
}
function pairExistingCreditCardPayments(dryRun, ss) {
  dryRun = dryRun !== false;
  ss = getSpreadsheet(ss);
  var targets = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); })
    .filter(function(tx) { return tx.category === '繳信用卡' && !tx.transferId; });
  Logger.log('未配對的繳信用卡列：' + targets.length + ' 筆');
  if (dryRun) { return { paired: 0, created: 0, details: targets.map(function(t) { return t.date + ' ' + t.account + ' ' + t.amount; }) }; }
  return autoPairImportedTransactions(targets, ss);
}
```

- [ ] **Step 4: `npm test` 全綠；Commit** `feat: 舊資料搬移與既有繳卡費補配對`

---

### Task 11: 規格、README、升級指引

**Files:** Create `openspec/specs/transfer-pairing/spec.md`、`openspec/specs/credit-card-accounts/spec.md`；Modify `openspec/specs/pdf-batch-import/spec.md`、`text-accounting/spec.md`、`account-management/spec.md`；Modify `README.md`

- [ ] **Step 1: 兩份新規格**（Purpose、Requirements、Scenario 取自 Task 5–8 測試案例）
- [ ] **Step 2: 更新三份既有規格**（12 欄、帳戶 10 欄、statementType、去重、自動配對、亂碼逐行過濾）
- [ ] **Step 3: README**：工作表結構更新；新增「升級既有試算表」：

```
1. 貼上最新 src/*.gs（含新檔 TransferService.gs）
2. 執行 initializeSheets()（補標題、預算表、收入分類「轉帳」、缺少的帳戶）
3. 執行 backfillTransactionIds()
4. 帳戶管理填帳戶類型、扣款帳戶、帳號識別、初始餘額（信用卡填上期未繳的負數，初始日期填該期結帳日）
5. migrateCreditCardRows('一銀','一銀信用卡','','',true) 預覽 → dryRun=false 執行；國泰同理；永豐信用卡依月份區間
6. pairExistingCreditCardPayments(false)
7. LINE 傳「餘額」核對
```

- [ ] **Step 4: `npm test` 全綠；Commit 並 push** `docs: 轉帳配對與信用卡帳戶規格、README 升級指引`

---

### Task 12: 部署與真實驗證

- [ ] **Step 1:** 使用者貼上 7 個 `.gs` 檔到 Apps Script，依 README 升級指引執行 1–4。
- [ ] **Step 2:** 依序用 LINE 貼上 fixture 文字：永豐信用卡 8 月 → 永豐證券 8 月 → 永豐銀行 8 月 → 中信 8 月 → 一銀信用卡 7 月 → 玉山信用卡 7 月 → 玉山銀行 7 月 → 台新 7 月。每次把回覆貼回。
- [ ] **Step 3:** 核對各 `*.expected.md`：筆數、合計、跳過、配對（含中信→永豐大戶 100,000 跨檔配對）。
- [ ] **Step 4:** 傳「餘額」核對規格驗收值（永豐大戶 0、永豐證券 0、永豐外幣 USD 1,858.62、永豐信用卡未繳 0、永豐信用卡外幣未繳 0）。
- [ ] **Step 5:** 不符則貼回 Logger／回覆，用 systematic-debugging 處理；符合則開始第二部分（WebApp）計畫。
