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
