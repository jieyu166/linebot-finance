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
