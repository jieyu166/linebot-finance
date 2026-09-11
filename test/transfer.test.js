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

t('分類非轉帳／非空白時不視為候選（避免誤配對到無關交易）', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '中信', type: '支出', amount: 5000, date: '2026/09/01', category: '轉帳' });
  const candidate = tx({ id: 'b1', account: '玉山', type: '收入', amount: 5000, date: '2026/09/02', category: '薪資' });
  const result = gs.pickTransferCandidates(source, [source, candidate], a, {});
  assert.strictEqual(result.length, 0);
});

t('分類為「轉帳」時仍視為候選', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01', category: '轉帳' });
  const candidate = tx({ id: 'b1', account: '玉山', type: '收入', amount: 1000, date: '2026/09/02', category: '轉帳' });
  const result = gs.pickTransferCandidates(source, [source, candidate], a, {});
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'b1');
});

t('分類為空白時仍視為候選（相容舊資料）', () => {
  const a = accounts();
  const source = tx({ id: 'a1', account: '永豐大戶', type: '支出', amount: 1000, date: '2026/09/01', category: '轉帳' });
  const candidate = tx({ id: 'b1', account: '玉山', type: '收入', amount: 1000, date: '2026/09/02', category: '' });
  const result = gs.pickTransferCandidates(source, [source, candidate], a, {});
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'b1');
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

t('linkTransfer：手動連結會把原分類記進明細描述，避免資訊遺失', () => {
  const sheet = fakeSheet([
    ['2026/09/01', '永豐銀行', '永豐大戶', '支出', '薪資', '', '原本備註', 'TWD', 1000, '', 'idA', ''],
    ['2026/09/01', '玉山銀行', '玉山', '收入', '其他', '', '', 'TWD', 1000, '', 'idB', ''],
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  gs.linkTransfer('idA', 'idB', ss);
  const rows = sheet.getRange(2, 1, 2, 12).getValues();
  assert.strictEqual(rows[0][4], '轉帳');
  assert.strictEqual(rows[0][6], '原本備註（原分類：薪資）');
});

t('linkTransfer：原本就是轉帳分類的列不追加原分類註記', () => {
  const sheet = fakeSheet([
    ['2026/09/01', '永豐銀行', '永豐大戶', '支出', '轉帳', '', '備註', 'TWD', 1000, '', 'idA', ''],
    ['2026/09/01', '玉山銀行', '玉山', '收入', '其他', '', '', 'TWD', 1000, '', 'idB', ''],
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });
  gs.linkTransfer('idA', 'idB', ss);
  const rows = sheet.getRange(2, 1, 2, 12).getValues();
  assert.strictEqual(rows[0][6], '備註');
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

// ---- Task 6: 對方帳戶辨識、繳卡費／交割戶／ATM 自動配對 ----

function accountRowFull(name, institution, currency, type, debitAccount, hints) {
  return [name, institution, currency, '', '', '', true, type, debitAccount || '', hints || ''];
}
function acctSheet(rows) {
  return { getLastRow: () => rows.length + 1, getRange: () => ({ getValues: () => rows }) };
}
function acctList(rows) {
  return gs.getAccounts(fakeSs({ '帳戶管理': acctSheet(rows) }));
}
function txRowFull(date, inst, account, type, cat, item, desc, amount, currency, id, transferId) {
  return [date, inst, account, type, cat, item || '', desc || '', currency || 'TWD', amount, '', id, transferId || ''];
}

const accounts2Rows = [
  accountRowFull('永豐大戶', '永豐銀行', 'TWD', '銀行', '', '198-01'),
  accountRowFull('永豐證券', '永豐銀行', 'TWD', '證券', '永豐大戶', '042-01'),
  accountRowFull('永豐外幣', '永豐銀行', 'USD', '銀行', '', '042-00'),
  accountRowFull('玉山', '玉山銀行', 'TWD', '銀行', '', '0015977,0381979'),
  accountRowFull('一銀', '第一銀行', 'TWD', '銀行', '', '630'),
  accountRowFull('台新', '台新銀行', 'TWD', '銀行', '', '288810,288815,288818')
];
function accounts2() { return acctList(accounts2Rows); }

// ---- stripLeadingZeros / hintMatches ----

t('stripLeadingZeros：去除前導零', () => {
  assert.strictEqual(gs.stripLeadingZeros('00123'), '123');
  assert.strictEqual(gs.stripLeadingZeros(''), '');
});

t('hintMatches：去槓去前導零後前綴比對', () => {
  assert.strictEqual(gs.hintMatches('0019801800104436', '198-01'), true);
  assert.strictEqual(gs.hintMatches('123456', '999'), false);
});

// ---- matchCounterpartyAccount ----

t('matchCounterpartyAccount：跨行轉帳號比對永豐大戶', () => {
  const m = gs.matchCounterpartyAccount('跨行轉 0019801800104436', accounts2());
  assert.ok(m);
  assert.strictEqual(m.name, '永豐大戶');
});

t('matchCounterpartyAccount：手機轉帳帳號比對玉山', () => {
  const m = gs.matchCounterpartyAccount('手機轉帳 8080000381979084481', accounts2());
  assert.ok(m);
  assert.strictEqual(m.name, '玉山');
});

t('matchCounterpartyAccount：跨行轉帳號比對一銀', () => {
  const m = gs.matchCounterpartyAccount('跨行轉 0000063057052425', accounts2());
  assert.ok(m);
  assert.strictEqual(m.name, '一銀');
});

t('matchCounterpartyAccount：手機轉帳帳號比對永豐證券', () => {
  const m = gs.matchCounterpartyAccount('手機轉帳 04201820006159', accounts2());
  assert.ok(m);
  assert.strictEqual(m.name, '永豐證券');
});

t('matchCounterpartyAccount：無 8 位以上數字回傳 null', () => {
  assert.strictEqual(gs.matchCounterpartyAccount('午餐分攤', accounts2()), null);
});

// ---- parseCounterpartyBank ----

t('parseCounterpartyBank：依銀行代碼解析機構名', () => {
  assert.strictEqual(gs.parseCounterpartyBank('8220000234540289458'), '中國信託');
});

t('parseCounterpartyBank：無 10 位以上數字回傳空字串', () => {
  assert.strictEqual(gs.parseCounterpartyBank('轉帳 123'), '');
});

// ---- resolveCreditCardAccount ----

t('resolveCreditCardAccount：機構簡稱比對唯一信用卡（永豐卡費）', () => {
  const a = acctList([
    accountRowFull('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('一銀信用卡', '第一銀行', 'TWD', '信用卡', '一銀', '')
  ]);
  const result = gs.resolveCreditCardAccount(tx({ account: '永豐大戶', description: '永豐卡費' }), a);
  assert.ok(result);
  assert.strictEqual(result.name, '永豐信用卡');
});

t('resolveCreditCardAccount：卡費換匯比對外幣卡', () => {
  const a = acctList([
    accountRowFull('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('永豐信用卡外幣', '永豐銀行', 'USD', '信用卡', '永豐外幣', '')
  ]);
  const result = gs.resolveCreditCardAccount(tx({ account: '永豐大戶', description: '永豐卡費換匯' }), a);
  assert.ok(result);
  assert.strictEqual(result.name, '永豐信用卡外幣');
});

t('resolveCreditCardAccount：機構全名比對第一銀行自扣', () => {
  const a = acctList([
    accountRowFull('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('一銀信用卡', '第一銀行', 'TWD', '信用卡', '一銀', '')
  ]);
  const result = gs.resolveCreditCardAccount(tx({ account: '一銀', description: '第一銀行自動扣款' }), a);
  assert.ok(result);
  assert.strictEqual(result.name, '一銀信用卡');
});

t('resolveCreditCardAccount：無提示且同扣款帳戶兩張卡回傳 null', () => {
  const a = acctList([
    accountRowFull('永豐信用卡A', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('永豐信用卡B', '永豐銀行', 'TWD', '信用卡', '永豐大戶', '')
  ]);
  const result = gs.resolveCreditCardAccount(tx({ account: '永豐大戶', description: '卡費' }), a);
  assert.strictEqual(result, null);
});

t('resolveCreditCardAccount：無提示但扣款帳戶唯一回傳一銀信用卡', () => {
  const a = acctList([
    accountRowFull('一銀信用卡', '第一銀行', 'TWD', '信用卡', '一銀', '')
  ]);
  const result = gs.resolveCreditCardAccount(tx({ account: '一銀', description: '卡費' }), a);
  assert.ok(result);
  assert.strictEqual(result.name, '一銀信用卡');
});

// ---- resolveBrokerageAccount ----

t('resolveBrokerageAccount：帳號比對唯一證券帳戶', () => {
  const result = gs.resolveBrokerageAccount(tx({ account: '永豐大戶', description: '手機轉帳 04201820006159' }), accounts2());
  assert.ok(result);
  assert.strictEqual(result.name, '永豐證券');
});

// ---- isCashWithdrawal ----

t('isCashWithdrawal：支出且含「現金提」成立', () => {
  assert.strictEqual(gs.isCashWithdrawal(tx({ type: '支出', item: '現金提', description: 'ＡＴＭ' })), true);
});

t('isCashWithdrawal：收入類型不成立', () => {
  assert.strictEqual(gs.isCashWithdrawal(tx({ type: '收入', item: '現金提' })), false);
});

// ---- buildCounterpartRow ----

t('buildCounterpartRow：反向交易物件欄位', () => {
  const target = { institution: '永豐銀行', name: '永豐信用卡', currency: 'TWD' };
  const row = gs.buildCounterpartRow(tx({ type: '支出', item: '', description: '永豐卡費' }), target, 14684, '卡費入帳');
  assert.strictEqual(row.type, '收入');
  assert.strictEqual(row.category, '轉帳');
  assert.strictEqual(row.item, '卡費入帳');
  assert.strictEqual(row.account, '永豐信用卡');
  assert.strictEqual(row.institution, '永豐銀行');
  assert.strictEqual(row.currency, 'TWD');
  assert.strictEqual(row.amount, 14684);
  assert.strictEqual(row.source, '自動配對');
});

// ---- autoPairImportedTransactions ----

t('autoPairImportedTransactions：繳卡費／轉帳唯一候選／ATM 提款 三情境', () => {
  const acctRows = [
    accountRowFull('永豐大戶', '永豐銀行', 'TWD', '銀行', '', '198-01'),
    accountRowFull('永豐證券', '永豐銀行', 'TWD', '證券', '永豐大戶', '042-01'),
    accountRowFull('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('現金', '現金', 'TWD', '現金', '', '')
  ];
  const txSheet = fakeSheet([
    txRowFull('2026/09/01', '永豐銀行', '永豐大戶', '支出', '繳信用卡', '', '永豐卡費 4637898810887000', 14684, 'TWD', 't1'),
    txRowFull('2026/09/01', '永豐銀行', '永豐大戶', '支出', '轉帳', '', '手機轉帳 04201820006159', 10000, 'TWD', 't2'),
    txRowFull('2026/09/01', '永豐銀行', '永豐證券', '收入', '', '', '', 10000, 'TWD', 'existing1'),
    txRowFull('2026/09/01', '永豐銀行', '永豐大戶', '支出', '轉帳', '現金提', 'ＡＴＭ', 5000, 'TWD', 't3')
  ]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': acctSheet(acctRows) });

  const result = gs.autoPairImportedTransactions([{ id: 't1' }, { id: 't2' }, { id: 't3' }], ss);
  assert.strictEqual(result.paired, 3);
  assert.strictEqual(result.created, 2);

  const rows = txSheet.getRange(2, 1, 6, 12).getValues();
  const row1 = rows[0]; // t1 繳信用卡
  const row2 = rows[1]; // t2 轉帳
  const row3 = rows[2]; // existing1 永豐證券收入
  const row4 = rows[3]; // t3 ATM
  const created1 = rows[4]; // 卡費入帳新列
  const created2 = rows[5]; // ATM 提款新列

  assert.strictEqual(created1[1], '永豐銀行');
  assert.strictEqual(created1[2], '永豐信用卡');
  assert.strictEqual(created1[3], '收入');
  assert.strictEqual(created1[4], '轉帳');
  assert.strictEqual(created1[5], '卡費入帳');
  assert.strictEqual(created1[7], 'TWD');
  assert.strictEqual(created1[8], 14684);
  assert.ok(row1[11]);
  assert.strictEqual(created1[11], row1[11]);

  assert.ok(row2[11]);
  assert.strictEqual(row2[11], row3[11]);
  assert.strictEqual(row3[4], '轉帳');

  assert.strictEqual(created2[1], '現金');
  assert.strictEqual(created2[2], '現金');
  assert.strictEqual(created2[3], '收入');
  assert.strictEqual(created2[4], '轉帳');
  assert.strictEqual(created2[5], 'ATM 提款');
  assert.strictEqual(created2[7], 'TWD');
  assert.strictEqual(created2[8], 5000);
  assert.ok(row4[11]);
  assert.strictEqual(created2[11], row4[11]);
});

t('autoPairImportedTransactions：全表只讀一次（兩張卡各一筆繳信用卡批次配對，不逐筆重讀整張表）', () => {
  const acctRows = [
    accountRowFull('永豐大戶', '永豐銀行', 'TWD', '銀行', '', '198-01'),
    accountRowFull('永豐信用卡', '永豐銀行', 'TWD', '信用卡', '永豐大戶', ''),
    accountRowFull('一銀', '第一銀行', 'TWD', '銀行', '', '630'),
    accountRowFull('一銀信用卡', '第一銀行', 'TWD', '信用卡', '一銀', '')
  ];
  const txSheet = fakeSheet([
    txRowFull('2026/09/01', '永豐銀行', '永豐大戶', '支出', '繳信用卡', '', '永豐卡費', 1000, 'TWD', 't1'),
    txRowFull('2026/09/01', '第一銀行', '一銀', '支出', '繳信用卡', '', '一銀卡費', 2000, 'TWD', 't2')
  ]);
  let bulkReads = 0;
  const originalGetRange = txSheet.getRange;
  txSheet.getRange = (r, c, nr, nc) => {
    if (nr > 1) { bulkReads++; }
    return originalGetRange(r, c, nr, nc);
  };
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': acctSheet(acctRows) });

  const result = gs.autoPairImportedTransactions([{ id: 't1' }, { id: 't2' }], ss);
  assert.strictEqual(result.paired, 2);
  assert.strictEqual(result.created, 2);
  assert.strictEqual(bulkReads, 1, '全表讀取（nr>1）應只發生一次，實際 ' + bulkReads + ' 次');
});

t('autoPairImportedTransactions：玉山（銀行類型帳戶）支出/投資「證券交割」列不觸發交割戶自動配對（不是轉帳，是交割本身）', () => {
  const acctRows = [
    accountRowFull('玉山', '玉山銀行', 'TWD', '銀行', '', '0015977'),
    accountRowFull('永豐證券', '永豐銀行', 'TWD', '證券', '永豐大戶', '042-01')
  ];
  const txSheet = fakeSheet([
    txRowFull('2026/09/01', '玉山銀行', '玉山', '支出', '投資', '證券交割', '', 9498, 'TWD', 't1')
  ]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': acctSheet(acctRows) });

  const result = gs.autoPairImportedTransactions([{ id: 't1' }], ss);
  assert.strictEqual(result.paired, 0);
  assert.strictEqual(result.created, 0);
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
