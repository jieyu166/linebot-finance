const assert = require('assert');
const { loadGs } = require('./harness');
const { fakeSheet, fakeSheetWithHeader, fakeSs } = require('./fakes');

const WEBAPP_FILES = ['SheetService.gs', 'Config.gs', 'TransferService.gs', 'WebAppLogic.gs', 'Main.gs', 'WebApp.gs'];
const gs = loadGs(WEBAPP_FILES);

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

const ACCOUNT_HEADER = ['帳戶名稱', '金融機構', '幣別', '初始餘額', '初始日期', '備註', '是否啟用', '帳戶類型', '扣款帳戶', '帳號識別'];
function accountRow(name, institution, currency, type, debitAccount) {
  return [name, institution, currency, '', '', '', true, type || '銀行', debitAccount || '', ''];
}
function accountsSheet(rows) { return fakeSheetWithHeader(ACCOUNT_HEADER, rows); }

function categorySheet(rows) { return fakeSheetWithHeader(['分類名稱', '圖示', '顏色'], rows); }
function budgetSheet(rows) { return fakeSheetWithHeader(['類型', '名稱', '月預算'], rows); }

function baseSs(overrides) {
  return fakeSs(Object.assign({
    '帳戶管理': accountsSheet([
      accountRow('現金', '', 'TWD', '現金'),
      accountRow('玉山', '玉山銀行', 'TWD', '銀行')
    ]),
    '支出分類': categorySheet([['飲食', '🍜', '#F5A623'], ['交通', '🚗', '#4A90D9']]),
    '收入分類': categorySheet([['薪資', '💰', '#7ED321']]),
    '預算': budgetSheet([['分類', '飲食', 8000]]),
    '交易紀錄': fakeSheet([])
  }, overrides || {}));
}

// ---- apiBootstrap ----

t('apiBootstrap 回傳分類（含圖示）、帳戶清單、預算與今日日期', () => {
  const ss = baseSs();
  const out = gs.apiBootstrap('tok', ss);
  assert.deepStrictEqual(out.expenseCategories, [{ name: '飲食', icon: '🍜', color: '#F5A623' }, { name: '交通', icon: '🚗', color: '#4A90D9' }]);
  assert.deepStrictEqual(out.incomeCategories, [{ name: '薪資', icon: '💰', color: '#7ED321' }]);
  assert.deepStrictEqual(out.accounts.map(a => a.name), ['現金', '玉山']);
  assert.strictEqual(out.accounts[1].institution, '玉山銀行');
  assert.strictEqual(out.accounts[1].currency, 'TWD');
  assert.strictEqual(out.accounts[1].type, '銀行');
  assert.deepStrictEqual(out.budgets, [{ kind: '分類', name: '飲食', budget: 8000 }]);
  assert.ok(/^\d{4}\/\d{2}\/\d{2}$/.test(out.today));
});

// ---- apiSaveTransaction ----

t('apiSaveTransaction 新增：寫 12 欄、J 欄 App、機構自動帶入', () => {
  const sheet = fakeSheet([]);
  const ss = baseSs({ '交易紀錄': sheet });
  const out = gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '玉山', type: '支出', category: '飲食', item: '午餐', amount: 120, currency: 'TWD' }, ss);
  assert.strictEqual(sheet._data.length, 2);
  const row = sheet._data[1];
  assert.strictEqual(row.length, 12);
  assert.strictEqual(row[1], '玉山銀行'); // institution auto-filled
  assert.strictEqual(row[9], 'App'); // J 欄
  assert.strictEqual(out.account, '玉山');
  assert.strictEqual(out.institution, '玉山銀行');
});

t('apiSaveTransaction 新增：帳戶不存在拋「找不到帳戶」', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '不存在', type: '支出', category: '飲食', amount: 100 }, ss), /找不到帳戶/);
});

t('apiSaveTransaction 驗證：金額必須大於 0', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '玉山', type: '支出', category: '飲食', amount: 0 }, ss), /金額必須大於 0/);
});

t('apiSaveTransaction 驗證：類型必須是支出或收入', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '玉山', type: '轉帳', category: '飲食', amount: 100 }, ss), /類型必須是支出或收入/);
});

t('apiSaveTransaction 驗證：請選擇分類', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '玉山', type: '支出', category: '', amount: 100 }, ss), /請選擇分類/);
});

t('apiSaveTransaction 更新：有 id 走 updateTransactionById', () => {
  const sheet = fakeSheet([['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'id1', '']]);
  const ss = baseSs({ '交易紀錄': sheet });
  const out = gs.apiSaveTransaction('tok', { id: 'id1', date: '2026/09/01', account: '玉山', type: '支出', category: '交通', item: '捷運', amount: 35 }, ss);
  assert.strictEqual(out.rowIndex, 2);
  assert.strictEqual(sheet._data[1][4], '交通');
  assert.strictEqual(sheet._data[1][1], '玉山銀行');
});

t('apiSaveTransaction 新增繳信用卡後自動配對（永豐大戶＋永豐信用卡）', () => {
  const accSheet = accountsSheet([
    accountRow('永豐大戶', '永豐銀行', 'TWD', '銀行'),
    accountRow('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶')
  ]);
  const txSheet = fakeSheet([]);
  const ss = baseSs({ '帳戶管理': accSheet, '交易紀錄': txSheet });
  const out = gs.apiSaveTransaction('tok', { date: '2026/09/01', account: '永豐大戶', type: '支出', category: '繳信用卡', item: '', description: '永豐卡費', amount: 5000, currency: 'TWD' }, ss);
  assert.strictEqual(out.autoPaired, true);
  assert.strictEqual(txSheet._data.length, 3); // 原始一筆 + 自動配對新增一筆
  const created = txSheet._data[2];
  assert.strictEqual(created[2], '永豐信用卡');
  assert.strictEqual(txSheet._data[1][11], created[11]); // 同 transferId
});

// ---- apiListTransactions ----

t('apiListTransactions 只回該月且含 linkedAccount', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '', '中信', '支出', '轉帳', '', '', 'TWD', 5000, 'App', 'a', 'T1'],
    ['2026/09/01', '', '現金', '收入', '轉帳', '', '', 'TWD', 5000, 'App', 'b', 'T1'],
    ['2026/09/02', '', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'c', ''],
    ['2026/08/15', '', '現金', '支出', '飲食', '早餐', '', 'TWD', 50, 'App', 'd', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiListTransactions('tok', '2026-09', ss);
  assert.strictEqual(out.length, 3);
  const byId = {}; out.forEach(t => byId[t.id] = t);
  assert.strictEqual(byId.a.linkedAccount, '現金');
  assert.strictEqual(byId.b.linkedAccount, '中信');
  assert.strictEqual(byId.c.linkedAccount, '');
  assert.strictEqual(byId.d, undefined);
});

// ---- apiDeleteTransaction ----

t('apiDeleteTransaction 呼叫 deleteTransactionById', () => {
  const txSheet = fakeSheet([['2026/09/01', '', '現金', '支出', '飲食', '', '', 'TWD', 80, 'App', 'x', '']]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiDeleteTransaction('tok', 'x', false, ss);
  assert.deepStrictEqual(out, { deleted: 1 });
  assert.strictEqual(txSheet._data.length, 1);
});

// ---- apiCreateTransfer / apiLinkTransfer / apiUnlinkTransfer / apiTransferCandidates ----

t('apiCreateTransfer 建立轉出轉入兩筆', () => {
  const accSheet = accountsSheet([accountRow('永豐大戶', '永豐銀行', 'TWD', '銀行'), accountRow('玉山', '玉山銀行', 'TWD', '銀行')]);
  const txSheet = fakeSheet([]);
  const ss = baseSs({ '帳戶管理': accSheet, '交易紀錄': txSheet });
  const out = gs.apiCreateTransfer('tok', { fromAccount: '永豐大戶', toAccount: '玉山', amount: 1000, date: '2026/09/01' }, ss);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(txSheet._data.length, 3);
});

t('apiLinkTransfer / apiUnlinkTransfer', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '', '中信', '支出', '', '', '', 'TWD', 1000, 'App', 'a', ''],
    ['2026/09/02', '', '玉山', '收入', '', '', '', 'TWD', 1000, 'App', 'b', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const transferId = gs.apiLinkTransfer('tok', 'a', 'b', ss);
  assert.ok(transferId);
  assert.strictEqual(txSheet._data[1][11], transferId);
  const count = gs.apiUnlinkTransfer('tok', transferId, ss);
  assert.strictEqual(count, 2);
  assert.strictEqual(txSheet._data[1][11], '');
});

t('apiTransferCandidates 回傳含 rowIndex 的候選', () => {
  const txSheet = fakeSheet([
    ['2026/08/13', '', '中信', '支出', '轉帳', '', '', 'TWD', 30000, 'App', 'a', ''],
    ['2026/08/19', '', '玉山', '收入', '其他', '', '', 'TWD', 30000, 'App', 'b', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiTransferCandidates('tok', 'a', ss);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'b');
  assert.strictEqual(out[0].rowIndex, 3);
});

// ---- apiStats / apiBudgetUsage ----

t('apiStats 串接 filterTransactionsByMonth + summarizeByCategory', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '', '現金', '支出', '飲食', '', '', 'TWD', 300, 'App', 'a', ''],
    ['2026/09/02', '', '現金', '支出', '交通', '', '', 'TWD', 100, 'App', 'b', ''],
    ['2026/08/01', '', '現金', '支出', '飲食', '', '', 'TWD', 999, 'App', 'c', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiStats('tok', '2026-09', '支出', ss);
  assert.strictEqual(out.total, 400);
  assert.deepStrictEqual(out.byCategory, [{ name: '飲食', amount: 300, ratio: 0.75 }, { name: '交通', amount: 100, ratio: 0.25 }]);
});

t('apiBudgetUsage 串接 getBudgets + summarizeBudgetUsage', () => {
  const txSheet = fakeSheet([['2026/09/01', '', '現金', '支出', '飲食', '', '', 'TWD', 8500, 'App', 'a', '']]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiBudgetUsage('tok', '2026-09', ss);
  assert.deepStrictEqual(out, [{ kind: '分類', name: '飲食', budget: 8000, used: 8500, remaining: -500, ratio: 1.063, level: 'over' }]);
});

// ---- apiSaveBudget / apiBalances / apiSaveAccount ----

t('apiSaveBudget 呼叫 upsertBudget', () => {
  const sheet = budgetSheet([]);
  const ss = baseSs({ '預算': sheet });
  const out = gs.apiSaveBudget('tok', { kind: '分類', name: '交通', amount: 2000 }, ss);
  assert.deepStrictEqual(out, { rowIndex: 2, deleted: false });
});

t('apiBalances 呼叫 getAllAccountBalances', () => {
  const accSheet = accountsSheet([accountRow('現金', '', 'TWD', '現金')]);
  const ss = baseSs({ '帳戶管理': accSheet, '交易紀錄': fakeSheet([]) });
  const out = gs.apiBalances('tok', ss);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, '現金');
});

t('apiSaveAccount 呼叫 updateAccountSettings', () => {
  const accSheet = accountsSheet([accountRow('玉山', '玉山銀行', 'TWD', '銀行')]);
  const ss = baseSs({ '帳戶管理': accSheet });
  gs.apiSaveAccount('tok', '玉山', { initialBalance: 1000, initialDate: '2026/09/01' }, ss);
  assert.strictEqual(accSheet._data[1][3], 1000);
  assert.strictEqual(accSheet._data[1][4], '2026/09/01');
});

// ---- apiSaveCategory / apiRenameCategory ----

t('apiSaveCategory 新增分類', () => {
  const sheet = categorySheet([['飲食', '🍜', '#F5A623']]);
  const ss = baseSs({ '支出分類': sheet });
  gs.apiSaveCategory('tok', { type: '支出', name: '交通', icon: '🚗', color: '#4A90D9' }, ss);
  assert.strictEqual(sheet._data[2][0], '交通');
});

t('apiSaveCategory 有 oldName 且不同時一併改交易與預算', () => {
  const catSheet = categorySheet([['飲食', '🍜', '#F5A623']]);
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', ''],
    ['2026/09/01', '現金', '現金', '收入', '飲食', '禮金', '', 'TWD', 80, 'App', 'i2', '']
  ]);
  const budSheet = budgetSheet([['分類', '飲食', 8000]]);
  const ss = baseSs({ '支出分類': catSheet, '交易紀錄': txSheet, '預算': budSheet });
  const out = gs.apiSaveCategory('tok', { type: '支出', name: '餐飲', oldName: '飲食', icon: '🍜', color: '#F5A623' }, ss);
  assert.strictEqual(catSheet._data[1][0], '餐飲');
  assert.strictEqual(txSheet._data[1][4], '餐飲'); // 支出列改名
  assert.strictEqual(txSheet._data[2][4], '飲食'); // 收入列不動
  assert.strictEqual(budSheet._data[1][1], '餐飲');
  assert.strictEqual(out.changedTransactions, 1);
  assert.strictEqual(out.changedBudgets, 1);
});

t('apiRenameCategory 改交易與預算並回傳筆數', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', ''],
    ['2026/09/02', '現金', '現金', '支出', '飲食', '晚餐', '', 'TWD', 90, 'App', 'i2', ''],
    ['2026/09/01', '現金', '現金', '收入', '飲食', '禮金', '', 'TWD', 80, 'App', 'i3', '']
  ]);
  const budSheet = budgetSheet([['分類', '飲食', 8000], ['帳戶', '飲食', 100]]);
  const ss = baseSs({ '交易紀錄': txSheet, '預算': budSheet });
  const out = gs.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss);
  assert.deepStrictEqual(out, { changedTransactions: 2, changedBudgets: 1, categoryRow: 2 });
  assert.strictEqual(txSheet._data[1][4], '餐飲');
  assert.strictEqual(txSheet._data[2][4], '餐飲');
  assert.strictEqual(txSheet._data[3][4], '飲食');
  assert.strictEqual(budSheet._data[1][1], '餐飲');
  assert.strictEqual(budSheet._data[2][1], '飲食'); // 帳戶類不改
});

t('apiRenameCategory 直接改分類表 A 欄（不經 upsertCategory）', () => {
  const catSheet = categorySheet([['飲食', '🍜', '#F5A623']]);
  const ss = baseSs({ '支出分類': catSheet });
  const out = gs.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss);
  assert.strictEqual(out.categoryRow, 2);
  assert.strictEqual(catSheet._data[1][0], '餐飲');
  assert.strictEqual(catSheet._data[1][1], '🍜'); // icon/color 不動
});

t('apiRenameCategory 找不到 oldName 時拋「找不到分類」', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiRenameCategory('tok', '支出', '不存在的分類', '餐飲', ss), /找不到分類「不存在的分類」/);
});

t('apiRenameCategory 先取鎖才讀寫，順序為 lock → read... → write... → unlock', () => {
  const events = [];
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', '']
  ]);
  const catSheet = categorySheet([['飲食', '🍜', '#F5A623']]);
  const budSheet = budgetSheet([['分類', '飲食', 8000]]);
  [txSheet, catSheet, budSheet].forEach((sheet) => {
    const originalGetRange = sheet.getRange;
    sheet.getRange = function() {
      const range = originalGetRange.apply(sheet, arguments);
      const originalGetValues = range.getValues;
      const originalSetValue = range.setValue;
      range.getValues = function() { events.push('read'); return originalGetValues.apply(range, arguments); };
      range.setValue = function() { events.push('write'); return originalSetValue.apply(range, arguments); };
      return range;
    };
  });
  const ss = baseSs({ '交易紀錄': txSheet, '支出分類': catSheet, '預算': budSheet });
  const gsWithLock = loadGs(WEBAPP_FILES, {
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { events.push('lock'); },
        releaseLock: () => { events.push('unlock'); },
        tryLock: () => true
      })
    }
  });
  gsWithLock.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss);
  assert.strictEqual(events[0], 'lock');
  assert.strictEqual(events[events.length - 1], 'unlock');
  const firstReadIndex = events.indexOf('read');
  const firstWriteIndex = events.indexOf('write');
  assert.ok(firstReadIndex > 0, '應該有讀取事件');
  assert.ok(firstWriteIndex > firstReadIndex, '寫入應該在讀取之後');
  assert.ok(events.slice(1, firstWriteIndex).every((e) => e === 'read'), '鎖後、寫入前只應該有讀取事件');
});

t('apiRenameCategory 用 LockService 包住讀寫，正常結束時 waitLock/releaseLock 各呼叫一次', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', '']
  ]);
  const budSheet = budgetSheet([['分類', '飲食', 8000]]);
  const ss = baseSs({ '交易紀錄': txSheet, '預算': budSheet });
  let waitLockCalls = 0;
  let releaseLockCalls = 0;
  const gsWithLock = loadGs(WEBAPP_FILES, {
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { waitLockCalls++; },
        releaseLock: () => { releaseLockCalls++; },
        tryLock: () => true
      })
    }
  });
  const out = gsWithLock.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss);
  assert.deepStrictEqual(out, { changedTransactions: 1, changedBudgets: 1, categoryRow: 2 });
  assert.strictEqual(waitLockCalls, 1);
  assert.strictEqual(releaseLockCalls, 1);
});

t('apiRenameCategory 寫入時拋錯，releaseLock 仍會被呼叫且錯誤會傳出', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet, '預算': budgetSheet([]) });
  // 讓交易紀錄工作表的 setValue 拋錯一次，模擬寫入失敗
  const originalGetRange = txSheet.getRange;
  txSheet.getRange = function() {
    const range = originalGetRange.apply(txSheet, arguments);
    const originalSetValue = range.setValue;
    range.setValue = function() { throw new Error('模擬寫入失敗'); };
    return range;
  };
  let waitLockCalls = 0;
  let releaseLockCalls = 0;
  const gsWithLock = loadGs(WEBAPP_FILES, {
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { waitLockCalls++; },
        releaseLock: () => { releaseLockCalls++; },
        tryLock: () => true
      })
    }
  });
  assert.throws(() => gsWithLock.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss), /模擬寫入失敗/);
  assert.strictEqual(waitLockCalls, 1);
  assert.strictEqual(releaseLockCalls, 1);
});

t('apiRenameCategory newName 空白時拋「分類名稱不可空白」', () => {
  const ss = baseSs();
  assert.throws(() => gs.apiRenameCategory('tok', '支出', '飲食', '   ', ss), /分類名稱不可空白/);
});

t('apiRenameCategory oldName 等於 newName 時為 no-op', () => {
  const txSheet = fakeSheet([
    ['2026/09/01', '現金', '現金', '支出', '飲食', '午餐', '', 'TWD', 80, 'App', 'i1', '']
  ]);
  const ss = baseSs({ '交易紀錄': txSheet });
  const out = gs.apiRenameCategory('tok', '支出', '飲食', '飲食', ss);
  assert.deepStrictEqual(out, { changedTransactions: 0, changedBudgets: 0, categoryRow: null });
  assert.strictEqual(txSheet._data[1][4], '飲食'); // 未被改動
});

t('apiRenameCategory newName 已是另一個既存分類時拋「分類「X」已存在」', () => {
  const catSheet = categorySheet([['飲食', '🍜', '#F5A623'], ['餐飲', '🍚', '#F5A623']]);
  const ss = baseSs({ '支出分類': catSheet });
  assert.throws(() => gs.apiRenameCategory('tok', '支出', '飲食', '餐飲', ss), /分類「餐飲」已存在/);
});

t('apiSaveCategory 更名為既存分類時仍會拋「已存在」錯誤', () => {
  const catSheet = categorySheet([['飲食', '🍜', '#F5A623'], ['餐飲', '🍚', '#F5A623']]);
  const ss = baseSs({ '支出分類': catSheet });
  assert.throws(() => gs.apiSaveCategory('tok', { type: '支出', name: '餐飲', oldName: '飲食', icon: '🍜', color: '#F5A623' }, ss), /分類「餐飲」已存在/);
});

t('apiSaveTransaction 接受字串金額並轉為數字儲存', () => {
  const sheet = fakeSheet([]);
  const ss = baseSs({ '交易紀錄': sheet });
  const out = gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '玉山', type: '支出', category: '飲食', item: '午餐', amount: '80', currency: 'TWD' }, ss);
  assert.strictEqual(sheet._data[1][8], 80);
  assert.strictEqual(out.amount, 80);
});

t('apiSaveTransaction 忽略客戶端傳入的幣別，一律以帳戶幣別為準（永豐外幣 USD）', () => {
  const accSheet = accountsSheet([accountRow('永豐外幣', '永豐銀行', 'USD', '銀行')]);
  const sheet = fakeSheet([]);
  const ss = baseSs({ '帳戶管理': accSheet, '交易紀錄': sheet });
  const out = gs.apiSaveTransaction('tok', { date: '2026/09/07', account: '永豐外幣', type: '支出', category: '飲食', item: '午餐', amount: 10 }, ss);
  assert.strictEqual(sheet._data[1][7], 'USD'); // H 欄幣別
  assert.strictEqual(out.currency, 'USD');
});

// ---- include / doGet ----

t('include 回傳 HtmlService.createHtmlOutputFromFile 內容', () => {
  assert.strictEqual(gs.include('Foo'), '<!--Foo-->');
});

t("doGet({parameter:{ui:'1'}}) 回傳模板頁", () => {
  const out = gs.doGet({ parameter: { ui: '1' } });
  assert.strictEqual(out._name, 'Index');
});

t("doGet({}) 回傳 'OK'", () => {
  const out = gs.doGet({});
  assert.strictEqual(out._text, 'OK');
});

// ---- 權限檢查（webAppAccessAllowed / requireWebAppAccess） ----

function anonymousSession() {
  return {
    getActiveUser: () => ({ getEmail: () => '' }),
    getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
  };
}

function propsWithToken(token) {
  return {
    getScriptProperties: () => ({
      getProperty: (key) => (key === 'WEBAPP_TOKEN' ? (token || null) : null)
    })
  };
}

t('匿名（非擁有者、無 token）時 apiBootstrap 拋「無權限使用此 App」', () => {
  const anonGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: propsWithToken(null) });
  const ss = baseSs();
  assert.throws(() => anonGs.apiBootstrap('', ss), /無權限使用此 App/);
});

t('匿名（非擁有者、無 token）時 apiSaveTransaction 拋「無權限使用此 App」', () => {
  const anonGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: propsWithToken(null) });
  const ss = baseSs();
  assert.throws(() => anonGs.apiSaveTransaction('', { date: '2026/09/07', account: '玉山', type: '支出', category: '飲食', amount: 100 }, ss), /無權限使用此 App/);
});

t('匿名時 doGet({parameter:{ui:"1"}}) 一律回傳 OK（不透露原因）', () => {
  const anonGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: propsWithToken(null) });
  const out = anonGs.doGet({ parameter: { ui: '1' } });
  assert.strictEqual(out._text, 'OK');
});

t('匿名但帶正確 WEBAPP_TOKEN 時：doGet 回模板頁、api 可正常呼叫', () => {
  const tokenGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: propsWithToken('s3cret') });
  const out = tokenGs.doGet({ parameter: { ui: '1', t: 's3cret' } });
  assert.strictEqual(out._name, 'Index');
  const ss = baseSs();
  assert.doesNotThrow(() => tokenGs.apiBootstrap('s3cret', ss));
});

t('匿名帶錯誤 WEBAPP_TOKEN 時：doGet 仍回 OK、api 仍拋「無權限」', () => {
  const tokenGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: propsWithToken('s3cret') });
  const out = tokenGs.doGet({ parameter: { ui: '1', t: 'wrong' } });
  assert.strictEqual(out._text, 'OK');
  const ss = baseSs();
  assert.throws(() => tokenGs.apiBootstrap('wrong', ss), /無權限使用此 App/);
});

// ---- setupWebAppToken / rotateWebAppToken ----

function mapPropertiesService(initial) {
  var store = Object.assign({}, initial || {});
  return {
    getScriptProperties: () => ({
      getProperty: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setProperty: (key, value) => { store[key] = value; },
      setProperties: (obj) => { Object.assign(store, obj); }
    }),
    _store: store
  };
}

function scriptAppWithUrl(url) {
  return { getService: () => ({ getUrl: () => url }) };
}

function realUuidUtilities() {
  const { Utilities: base } = require('./harness');
  var n = 0;
  return Object.assign({}, base, {
    getUuid: () => { n++; return '12345678-1234-1234-1234-' + String(n).padStart(12, '0'); }
  });
}

t('setupWebAppToken 未設定時產生 32 碼 token 並存起來，重複呼叫回傳同一個', () => {
  const props = mapPropertiesService();
  const cfgGs = loadGs(WEBAPP_FILES, { PropertiesService: props, ScriptApp: scriptAppWithUrl('https://script.google.com/macros/s/X/exec'), Utilities: realUuidUtilities() });
  const token1 = cfgGs.setupWebAppToken();
  assert.strictEqual(typeof token1, 'string');
  assert.strictEqual(token1.length, 32);
  const token2 = cfgGs.setupWebAppToken();
  assert.strictEqual(token2, token1);
  assert.strictEqual(props._store.WEBAPP_TOKEN, token1);
});

t('rotateWebAppToken 一律換新 token', () => {
  const props = mapPropertiesService({ WEBAPP_TOKEN: 'old-token' });
  const cfgGs = loadGs(WEBAPP_FILES, { PropertiesService: props, ScriptApp: scriptAppWithUrl('https://script.google.com/macros/s/X/exec') });
  const rotated = cfgGs.rotateWebAppToken();
  assert.notStrictEqual(rotated, 'old-token');
  assert.strictEqual(props._store.WEBAPP_TOKEN, rotated);
});

t('setupWebAppToken 印出的網址含 ?ui=1&t=', () => {
  const props = mapPropertiesService();
  const logs = [];
  const cfgGs = loadGs(WEBAPP_FILES, {
    PropertiesService: props,
    ScriptApp: scriptAppWithUrl('https://script.google.com/macros/s/X/exec'),
    Logger: { log: (m) => logs.push(m) }
  });
  const token = cfgGs.setupWebAppToken();
  const found = logs.some((m) => m.indexOf('?ui=1&t=' + token) !== -1);
  assert.ok(found, '執行記錄應印出含 ?ui=1&t=' + token + ' 的網址，實際：' + logs.join(' | '));
});

t('setupWebAppToken 尚未部署時（getUrl 回傳空字串）印出提示訊息', () => {
  const props = mapPropertiesService();
  const logs = [];
  const cfgGs = loadGs(WEBAPP_FILES, {
    PropertiesService: props,
    ScriptApp: scriptAppWithUrl(''),
    Logger: { log: (m) => logs.push(m) }
  });
  cfgGs.setupWebAppToken();
  const found = logs.some((m) => m.indexOf('尚未建立網頁應用程式部署') !== -1);
  assert.ok(found, '應印出尚未部署提示，實際：' + logs.join(' | '));
});

t('webAppAccessAllowed：token 不對回傳 false，token 正確回傳 true（匿名 Session）', () => {
  const props = mapPropertiesService({ WEBAPP_TOKEN: 'right-token' });
  const anonGs = loadGs(WEBAPP_FILES, { Session: anonymousSession(), PropertiesService: props, ScriptApp: scriptAppWithUrl('https://script.google.com/macros/s/X/exec') });
  assert.strictEqual(anonGs.webAppAccessAllowed('bad'), false);
  assert.strictEqual(anonGs.webAppAccessAllowed('right-token'), true);
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
