const assert = require('assert');
const { loadGs } = require('./harness');
const { fakeSheet, fakeSs } = require('./fakes');
const gs = loadGs(['SheetService.gs', 'Config.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

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
