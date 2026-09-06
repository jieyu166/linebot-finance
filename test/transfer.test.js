const assert = require('assert');
const { loadGs } = require('./harness');
const { fakeSheet, fakeSs } = require('./fakes');

const gs = loadGs(['SheetService.gs', 'TransferService.gs']);

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

// 帳戶固定資料：永豐大戶(TWD 銀行)、永豐證券(TWD 證券)、永豐外幣(USD 銀行)、玉山(TWD 銀行)
function accountRow(name, institution, currency, type) {
  return [name, institution, currency, '', '', '', true, type, '', ''];
}

function fakeAccountsSheet() {
  const rows = [
    accountRow('永豐大戶', '永豐銀行', 'TWD', '銀行'),
    accountRow('永豐證券', '永豐銀行', 'TWD', '證券'),
    accountRow('永豐外幣', '永豐銀行', 'USD', '銀行'),
    accountRow('玉山', '玉山銀行', 'TWD', '銀行'),
  ];
  return {
    getLastRow: () => rows.length + 1,
    getRange: () => ({ getValues: () => rows })
  };
}

function accounts() {
  return gs.getAccounts(fakeSs({ '帳戶管理': fakeAccountsSheet() }));
}

function tx(over) {
  return Object.assign({
    id: 'id-1', date: '2026/09/01', account: '永豐大戶', type: '支出',
    category: '', item: '', description: '', currency: 'TWD', amount: 1000, transferId: ''
  }, over);
}

// ---- pickTransferCandidates ----

t('同幣別唯一候選', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01' });
  const candidate = tx({ id: 'b1', account: '玉山', type: '收入', amount: 1000, date: '2026/09/02' });
  const other = tx({ id: 'c1', account: '玉山', type: '收入', amount: 500, date: '2026/09/02' });
  const result = gs.pickTransferCandidates(source, [source, candidate, other], a, {});
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'b1');
});

t('已配對排除（有 transferId 的不列入候選）', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01' });
  const paired = tx({ id: 'b1', account: '玉山', type: '收入', amount: 1000, date: '2026/09/02', transferId: 'tr-1' });
  const result = gs.pickTransferCandidates(source, [source, paired], a, {});
  assert.strictEqual(result.length, 0);
});

t('跨幣別換匯同日可配', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01', description: '換匯' });
  const candidate = tx({ id: 'b1', account: '永豐外幣', type: '收入', amount: 30, date: '2026/09/01', currency: 'USD' });
  const diffDay = tx({ id: 'c1', account: '永豐外幣', type: '收入', amount: 30, date: '2026/09/02', currency: 'USD' });
  const result = gs.pickTransferCandidates(source, [source, candidate, diffDay], a, {});
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'b1');
});

t('counterpartyAccount 限定', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01' });
  const candA = tx({ id: 'b1', account: '玉山', type: '收入', amount: 1000, date: '2026/09/02' });
  const candB = tx({ id: 'b2', account: '永豐證券', type: '收入', amount: 1000, date: '2026/09/02' });
  const result = gs.pickTransferCandidates(source, [source, candA, candB], a, { counterpartyAccount: '永豐證券' });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'b2');
});

t('counterpartyBank 限定', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '玉山', type: '支出', amount: 1000, date: '2026/09/01' });
  const candA = tx({ id: 'b1', account: '永豐大戶', type: '收入', amount: 1000, date: '2026/09/02' });
  const candB = tx({ id: 'b2', account: '永豐證券', type: '收入', amount: 1000, date: '2026/09/02' });
  const result = gs.pickTransferCandidates(source, [source, candA, candB], a, { counterpartyBank: '永豐銀行' });
  assert.strictEqual(result.length, 2);
});

// ---- dateDiffDays ----

t('dateDiffDays：正常差異天數', () => {
  assert.strictEqual(gs.dateDiffDays('2026/09/01', '2026/09/04'), 3);
});

t('dateDiffDays：無效日期回傳 Infinity', () => {
  assert.strictEqual(gs.dateDiffDays('不是日期', '2026/09/04'), Infinity);
  assert.strictEqual(gs.dateDiffDays('2026/09/01', ''), Infinity);
});

// ---- linkTransfer ----

function txRow(date, inst, account, type, cat, amount, currency, id, transferId) {
  return [date, inst, account, type, cat, '', '', currency || 'TWD', amount, '', id, transferId || ''];
}

t('linkTransfer：寫入 L 欄轉帳ID 與分類「轉帳」', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA'),
    txRow('2026/09/01', '玉山銀行', '玉山', '收入', '其他', 1000, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  const transferId = gs.linkTransfer('idA', 'idB', ss);
  assert.strictEqual(typeof transferId, 'string');
  const rows = sheet.getRange(2, 1, 2, 12).getValues();
  assert.strictEqual(rows[0][11], transferId);
  assert.strictEqual(rows[1][11], transferId);
  assert.strictEqual(rows[0][4], '轉帳');
  assert.strictEqual(rows[1][4], '轉帳');
});

t('linkTransfer：同帳戶拋錯', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA'),
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '收入', '其他', 1000, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  assert.throws(() => gs.linkTransfer('idA', 'idB', ss), /同一帳戶/);
});

t('linkTransfer：找不到交易拋錯', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  assert.throws(() => gs.linkTransfer('idA', 'idB', ss), /找不到要連結的交易/);
});

t('linkTransfer：已是轉帳配對拋錯', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA', 'existing-transfer'),
    txRow('2026/09/01', '玉山銀行', '玉山', '收入', '其他', 1000, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  assert.throws(() => gs.linkTransfer('idA', 'idB', ss), /已是轉帳配對/);
});

t('linkTransfer：類型必須一支出一收入', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA'),
    txRow('2026/09/01', '玉山銀行', '玉山', '支出', '其他', 1000, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  assert.throws(() => gs.linkTransfer('idA', 'idB', ss), /一筆支出、一筆收入/);
});

t('linkTransfer：同幣別金額不同拋錯', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '其他', 1000, 'TWD', 'idA'),
    txRow('2026/09/01', '玉山銀行', '玉山', '收入', '其他', 999, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  assert.throws(() => gs.linkTransfer('idA', 'idB', ss), /金額必須相同/);
});

// ---- unlinkTransfer ----

t('unlinkTransfer：回傳 2 並清空轉帳ID', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '轉帳', 1000, 'TWD', 'idA', 'tr-1'),
    txRow('2026/09/01', '玉山銀行', '玉山', '收入', '轉帳', 1000, 'TWD', 'idB', 'tr-1'),
    txRow('2026/09/01', '玉山銀行', '玉山', '支出', '飲食', 100, 'TWD', 'idC'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  const count = gs.unlinkTransfer('tr-1', ss);
  assert.strictEqual(count, 2);
  const rows = sheet.getRange(2, 1, 3, 12).getValues();
  assert.strictEqual(rows[0][11], '');
  assert.strictEqual(rows[1][11], '');
  assert.strictEqual(rows[2][11], '');
});

// ---- createTransfer ----

t('createTransfer：兩列同 transferId、類型支出／收入、source App', () => {
  const txSheet = fakeSheet([]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': fakeAccountsSheet() });
  const result = gs.createTransfer({ fromAccount: '永豐大戶', toAccount: '玉山', amount: 1000, date: '2026/09/01', note: '' }, ss);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].transferId, result[1].transferId);
  assert.strictEqual(result[0].type, '支出');
  assert.strictEqual(result[1].type, '收入');
  assert.strictEqual(result[0].source, 'App');
  assert.strictEqual(result[1].source, 'App');
  assert.strictEqual(result[0].item, '轉帳至玉山');
  assert.strictEqual(result[1].item, '來自永豐大戶');
});

t('createTransfer：跨幣別 toAmount 指定', () => {
  const txSheet = fakeSheet([]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': fakeAccountsSheet() });
  const result = gs.createTransfer({ fromAccount: '永豐大戶', toAccount: '永豐外幣', amount: 161325, toAmount: 5000, date: '2026/09/01', note: '' }, ss);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].transferId, result[1].transferId);
  assert.strictEqual(result[0].amount, 161325);
  assert.strictEqual(result[0].currency, 'TWD');
  assert.strictEqual(result[1].amount, 5000);
  assert.strictEqual(result[1].currency, 'USD');
});

t('createTransfer：跨幣別 toAmount 未指定時金額相同', () => {
  const txSheet = fakeSheet([]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': fakeAccountsSheet() });
  const result = gs.createTransfer({ fromAccount: '永豐大戶', toAccount: '永豐外幣', amount: 161325, date: '2026/09/01', note: '' }, ss);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].transferId, result[1].transferId);
  assert.strictEqual(result[0].amount, 161325);
  assert.strictEqual(result[0].currency, 'TWD');
  assert.strictEqual(result[1].amount, 161325);
  assert.strictEqual(result[1].currency, 'USD');
});

t('createTransfer：找不到帳戶拋錯', () => {
  const txSheet = fakeSheet([]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': fakeAccountsSheet() });
  assert.throws(() => gs.createTransfer({ fromAccount: '不存在帳戶', toAccount: '玉山', amount: 1000, date: '2026/09/01', note: '' }, ss), /找不到帳戶/);
});

t('createTransfer：轉出轉入帳戶不可相同', () => {
  const txSheet = fakeSheet([]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': fakeAccountsSheet() });
  assert.throws(() => gs.createTransfer({ fromAccount: '永豐大戶', toAccount: '永豐大戶', amount: 1000, date: '2026/09/01', note: '' }, ss), /不可相同/);
});

// ---- unlinkTransfer edge cases ----

t('unlinkTransfer：找不到該轉帳ID回傳 0', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐大戶', '支出', '飲食', 100, 'TWD', 'idA'),
    txRow('2026/09/01', '玉山銀行', '玉山', '收入', '飲食', 100, 'TWD', 'idB'),
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  const count = gs.unlinkTransfer('no-such-id', ss);
  assert.strictEqual(count, 0);
  const rows = sheet.getRange(2, 1, 2, 12).getValues();
  assert.strictEqual(rows[0][11], '');
  assert.strictEqual(rows[1][11], '');
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
