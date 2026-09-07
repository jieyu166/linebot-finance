const assert = require('assert');
const { loadHtmlScript } = require('./harness');
const g = loadHtmlScript('ClientLogic.html');
const CL = g.CL;
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

t('evalCalc 先乘除後加減', () => {
  assert.strictEqual(CL.evalCalc('12+3×2'), 18);
});
t('evalCalc 除法四捨五入到小數兩位', () => {
  assert.strictEqual(CL.evalCalc('100÷3'), 33.33);
});
t('evalCalc 尾端運算子回傳 NaN', () => {
  assert.ok(Number.isNaN(CL.evalCalc('1+')));
});

t('applyKey 剛算完結果後按數字：整個換成新輸入', () => {
  assert.deepStrictEqual(CL.applyKey('80', '5', true), { expr: '5', justCalculated: false });
});
t('applyKey 剛算完結果後按運算子：接在結果後面延續計算', () => {
  assert.deepStrictEqual(CL.applyKey('80', '+', true), { expr: '80+', justCalculated: false });
});
t('applyKey ⌫ 正常刪除最後一個字元', () => {
  assert.deepStrictEqual(CL.applyKey('12', '⌫', false), { expr: '1', justCalculated: false });
});
t('applyKey 開頭不可為運算子', () => {
  assert.deepStrictEqual(CL.applyKey('', '−', false), { expr: '', justCalculated: false });
});
t('applyKey 不可連續運算子', () => {
  assert.deepStrictEqual(CL.applyKey('1+', '+', false), { expr: '1+', justCalculated: false });
});

t('groupByDate 兩天各自合計，保持輸入順序', () => {
  const txs = [
    { date: '2026-09-01', amount: -100, type: 'expense' },
    { date: '2026-09-02', amount: 500, type: 'income' },
    { date: '2026-09-01', amount: -50, type: 'expense' },
    { date: '2026-09-02', amount: -20, type: 'expense' }
  ];
  const groups = CL.groupByDate(txs);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].date, '2026-09-01');
  assert.strictEqual(groups[0].items.length, 2);
  assert.strictEqual(groups[0].expense, 150);
  assert.strictEqual(groups[0].income, 0);
  assert.strictEqual(groups[1].date, '2026-09-02');
  assert.strictEqual(groups[1].items.length, 2);
  assert.strictEqual(groups[1].expense, 20);
  assert.strictEqual(groups[1].income, 500);
});

t('formatMoney USD 有分時顯示兩位小數並附幣別', () => {
  assert.strictEqual(CL.formatMoney(0, 'USD'), '$1,858.62 USD');
});
t('formatMoney TWD 負數整數無小數', () => {
  assert.strictEqual(CL.formatMoney(-3000, 'TWD'), '-$3,000');
});

t('pieSlices 兩項各半時第一片為半圓弧', () => {
  const slices = CL.pieSlices([
    { name: 'A', amount: 100 },
    { name: 'B', amount: 100 }
  ], 50, 50, 50);
  assert.strictEqual(slices.length, 2);
  assert.ok(slices[0].d.includes('A 50 50 0 0 1'), slices[0].d);
});
t('pieSlices 單一項目回傳整圓路徑', () => {
  const slices = CL.pieSlices([
    { name: 'A', amount: 100 },
    { name: 'B', amount: 0 }
  ], 50, 50, 50);
  assert.strictEqual(slices.length, 1);
  assert.strictEqual(slices[0].name, 'A');
  const arcCount = (slices[0].d.match(/A /g) || []).length;
  assert.strictEqual(arcCount, 2);
});
t('pieSlices 略過金額小於等於 0 的項目', () => {
  const slices = CL.pieSlices([
    { name: 'A', amount: -5 },
    { name: 'B', amount: 0 },
    { name: 'C', amount: 10 }
  ], 50, 50, 50);
  assert.strictEqual(slices.length, 1);
  assert.strictEqual(slices[0].name, 'C');
});
t('pieSlices 未指定 color 時使用 defaultColor', () => {
  const slices = CL.pieSlices([
    { name: 'A', amount: 10 },
    { name: 'B', amount: 10 }
  ], 50, 50, 50);
  assert.strictEqual(slices[0].color, CL.defaultColor(0));
  assert.strictEqual(slices[1].color, CL.defaultColor(1));
});

t('budgetColor 三種等級', () => {
  assert.strictEqual(CL.budgetColor('ok'), '#4CAF50');
  assert.strictEqual(CL.budgetColor('warn'), '#FF9800');
  assert.strictEqual(CL.budgetColor('over'), '#F44336');
});

t('parseAmountInput 允許千分位逗號', () => {
  assert.strictEqual(CL.parseAmountInput('8,000'), 8000);
  assert.strictEqual(CL.parseAmountInput('1,234.5'), 1234.5);
  assert.strictEqual(CL.parseAmountInput('8,000.5'), 8000.5);
});
t('parseAmountInput 純數字與 0', () => {
  assert.strictEqual(CL.parseAmountInput('0'), 0);
  assert.strictEqual(CL.parseAmountInput('  500  '), 500);
});
t('parseAmountInput 無法解析回傳 NaN', () => {
  assert.ok(Number.isNaN(CL.parseAmountInput('abc')));
  assert.ok(Number.isNaN(CL.parseAmountInput('')));
  assert.ok(Number.isNaN(CL.parseAmountInput(null)));
  assert.ok(Number.isNaN(CL.parseAmountInput('1.2.3')));
  assert.ok(Number.isNaN(CL.parseAmountInput('12abc')));
});
t('parseAmountInput 負數回傳 NaN', () => {
  assert.ok(Number.isNaN(CL.parseAmountInput('-5')));
  assert.ok(Number.isNaN(CL.parseAmountInput('-1000.5')));
  assert.ok(Number.isNaN(CL.parseAmountInput('-8,000')));
});
t('parseAmountInput 0 保持有效', () => {
  assert.strictEqual(CL.parseAmountInput('0'), 0);
});

t('defaultColor 8 色循環', () => {
  assert.strictEqual(CL.defaultColor(0), '#3F7CFF');
  assert.strictEqual(CL.defaultColor(7), '#6D4C41');
  assert.strictEqual(CL.defaultColor(8), CL.defaultColor(0));
});

t('yearMonthShift 跨年界', () => {
  assert.strictEqual(CL.yearMonthShift('2026-01', -1), '2025-12');
  assert.strictEqual(CL.yearMonthShift('2025-12', 1), '2026-01');
});

t('inferYearMonthLabel 格式化', () => {
  assert.strictEqual(CL.inferYearMonthLabel('2026-08'), '2026/08');
});

t('toIsoDate 轉為 <input type=date> 格式', () => {
  assert.strictEqual(CL.toIsoDate('2026/08/03'), '2026-08-03');
  assert.strictEqual(CL.toIsoDate(''), '');
});

t('fromIsoDate 轉回後端格式', () => {
  assert.strictEqual(CL.fromIsoDate('2026-08-03'), '2026/08/03');
  assert.strictEqual(CL.fromIsoDate(''), '');
});

process.exit(failed ? 1 : 0);
