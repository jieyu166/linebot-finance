const assert = require('assert');
const { loadGs } = require('./harness');
const { fakeSheet, fakeSs } = require('./fakes');

const gs = loadGs(['SheetService.gs', 'TransferService.gs']);

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

function tx(over) {
  return Object.assign({
    date: '2026/09/01', account: '永豐大戶', type: '支出', category: '', item: '',
    description: '', currency: 'TWD', amount: 1000, source: 'PDF匯入'
  }, over);
}

// ---- isDuplicateImport ----

t('isDuplicateImport：同帳戶同金額同類型 2 天內視為重複', () => {
  const existing = tx({ id: 'e1', date: '2026/09/01' });
  const incoming = tx({ date: '2026/09/03' });
  const result = gs.isDuplicateImport(incoming, [existing]);
  assert.strictEqual(result, existing);
});

t('isDuplicateImport：日期相差 10 天不視為重複', () => {
  const existing = tx({ id: 'e1', date: '2026/09/01' });
  const incoming = tx({ date: '2026/09/11' });
  const result = gs.isDuplicateImport(incoming, [existing]);
  assert.strictEqual(result, null);
});

t('isDuplicateImport：不同帳戶不視為重複', () => {
  const existing = tx({ id: 'e1', date: '2026/09/01', account: '永豐大戶' });
  const incoming = tx({ date: '2026/09/02', account: '玉山' });
  const result = gs.isDuplicateImport(incoming, [existing]);
  assert.strictEqual(result, null);
});

t('isDuplicateImport：既有交易為手動記帳（source 非匯入來源）不視為重複', () => {
  const existing = tx({ id: 'e1', date: '2026/09/01', source: '午餐80' });
  const incoming = tx({ date: '2026/09/02' });
  const result = gs.isDuplicateImport(incoming, [existing]);
  assert.strictEqual(result, null);
});

// ---- dedupeAgainstSheet ----

function txRow(date, inst, account, type, cat, item, desc, amount, currency, id, source) {
  return [date, inst, account, type, cat, item || '', desc || '', currency || 'TWD', amount, source || '', id, ''];
}

t('dedupeAgainstSheet：證券後到改寫概括品項，同批 XSOLLA 670×2 不互相去重', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐證券', '支出', '投資', '定期買股', '', 9498, 'TWD', 'e1', 'PDF匯入')
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });

  const incoming = [
    tx({ date: '2026/09/02', account: '永豐證券', category: '投資', item: '台積電', description: '普買 台積電 4股', amount: 9498 }),
    tx({ date: '2026/09/02', account: '永豐證券', category: '投資', item: 'XSOLLA', description: '', amount: 670 }),
    tx({ date: '2026/09/02', account: '永豐證券', category: '投資', item: 'XSOLLA', description: '', amount: 670 })
  ];
  const result = gs.dedupeAgainstSheet(incoming, ss);
  assert.strictEqual(result.kept.length, 2);
  assert.strictEqual(result.skipped.length, 1);
  assert.strictEqual(result.merged, 1);
  const row = sheet.getRange(2, 6, 1, 2).getValues()[0];
  assert.strictEqual(row[0], '台積電');
  assert.strictEqual(row[1], '普買 台積電 4股');
});

t('dedupeAgainstSheet：既有品項已具體，銀行後到概括列被跳過且不改寫', () => {
  const sheet = fakeSheet([
    txRow('2026/09/01', '永豐銀行', '永豐證券', '支出', '投資', '台積電', '', 9498, 'TWD', 'e1', 'PDF匯入')
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });

  const incoming = [
    tx({ date: '2026/09/02', account: '永豐證券', category: '投資', item: '定期買股', description: '', amount: 9498 })
  ];
  const result = gs.dedupeAgainstSheet(incoming, ss);
  assert.strictEqual(result.kept.length, 0);
  assert.strictEqual(result.skipped.length, 1);
  assert.strictEqual(result.merged, 0);
  const row = sheet.getRange(2, 6, 1, 2).getValues()[0];
  assert.strictEqual(row[0], '台積電');
});

t('dedupeAgainstSheet：同批內兩筆相同新交易匹配同一既有列，第一筆改寫後第二筆保留', () => {
  const sheet = fakeSheet([
    txRow('2026/08/06', '永豐銀行', '永豐證券', '支出', '投資', '定期買股', '', 9498, 'TWD', 'e2', 'PDF匯入')
  ]);
  const ss = fakeSs({ '交易紀錄': sheet });

  const incoming = [
    tx({ date: '2026/08/06', account: '永豐證券', category: '投資', item: '台積電', description: '普買 台積電 4股', amount: 9498 }),
    tx({ date: '2026/08/06', account: '永豐證券', category: '投資', item: '台積電', description: '普買 台積電 4股', amount: 9498 })
  ];
  const result = gs.dedupeAgainstSheet(incoming, ss);
  assert.strictEqual(result.kept.length, 1);
  assert.strictEqual(result.skipped.length, 1);
  assert.strictEqual(result.merged, 1);
  const row = sheet.getRange(2, 6, 1, 2).getValues()[0];
  assert.strictEqual(row[0], '台積電');
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
