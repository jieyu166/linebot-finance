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

// ---- buildImportSummary / importTransactions（共用同一次 loadGs，見 harness 對重複載入同檔案集合的限制） ----

{
  const gs2 = loadGs(['SheetService.gs', 'TransferService.gs', 'Main.gs']);

  const result = {
    bank: '永豐銀行',
    statementType: '銀行帳戶',
    transactions: [{ type: '支出', amount: 100 }, { type: '收入', amount: 50 }],
    skipped: 3,
    unmatchedAccountNumbers: ['198-00*-**10443-*']
  };
  const outcome = {
    written: [{ type: '支出', amount: 100 }, { type: '收入', amount: 50 }],
    skipped: [{}],
    merged: 1,
    pairing: { paired: 2, created: 1, details: ['轉帳 2026/08/04 50000：多個候選，請在 App 手動連結'] }
  };

  t('buildImportSummary：含 outcome 時列出帳單類型、重複、配對、未對應、details', () => {
    const text = gs2.buildImportSummary(result, 'PDF', outcome);
    assert.ok(text.startsWith('📄 帳單匯入完成！'), text);
    assert.ok(text.includes('帳單類型：銀行帳戶'), text);
    assert.ok(text.includes('共匯入 2 筆交易'), text);
    assert.ok(text.includes('重複 1 筆'), text);
    assert.ok(text.includes('更新 1 筆股名'), text);
    assert.ok(text.includes('自動配對 2 筆'), text);
    assert.ok(text.includes('新增 1 筆對方帳戶紀錄'), text);
    assert.ok(text.includes('未對應帳號：198-00*-**10443-*'), text);
    assert.ok(text.includes('多個候選'), text);
  });

  t('buildImportSummary：無 outcome 時沿用舊行為（以 result.transactions 計算，無重複/配對行）', () => {
    const text = gs2.buildImportSummary(result, 'PDF');
    assert.ok(text.startsWith('📄 帳單匯入完成！'), text);
    assert.ok(text.includes('共匯入 2 筆交易'), text);
    assert.ok(!text.includes('重複'), text);
    assert.ok(!text.includes('自動配對'), text);
  });

  // ---- importTransactions（端對端，沿用 gs2） ----

  function acctRow(name, institution, type, debitAccount, hints) {
    return [name, institution, 'TWD', 0, '', '', true, type || '', debitAccount || '', hints || ''];
  }

  const txSheet = fakeSheet([
    txRow('2026/08/06', '永豐銀行', '永豐證券', '支出', '投資', '定期買股', '', 9498, 'TWD', 'e1', 'PDF匯入')
  ]);
  const acctSheet = fakeSheet([
    acctRow('永豐大戶', '永豐銀行', '', '', '198-01'),
    acctRow('永豐證券', '永豐銀行', '證券', '永豐大戶', '042-01'),
    acctRow('永豐信用卡', '永豐銀行', '信用卡', '永豐大戶', '')
  ]);
  const ss = fakeSs({ '交易紀錄': txSheet, '帳戶管理': acctSheet });

  const incoming = [
    tx({ date: '2026/08/06', account: '永豐證券', category: '投資', item: '台積電', description: '普買 台積電 4股', amount: 9498 }),
    tx({ date: '2026/08/06', account: '永豐大戶', category: '繳信用卡', description: '永豐卡費 4637898810887000', amount: 14684 })
  ];

  const importOutcome = gs2.importTransactions({ transactions: incoming }, 'PDF匯入', ss);

  t('importTransactions：去重＋寫入＋自動配對串接', () => {
    assert.strictEqual(importOutcome.skipped.length, 1);
    assert.strictEqual(importOutcome.merged, 1);
    assert.strictEqual(importOutcome.written.length, 1);
    assert.strictEqual(importOutcome.pairing.paired, 1);
    assert.strictEqual(importOutcome.pairing.created, 1);

    const rows = txSheet.getRange(2, 1, txSheet.getLastRow() - 1, 12).getValues();
    const cardIncome = rows.filter(r => r[2] === '永豐信用卡' && r[3] === '收入')[0];
    const cardBill = rows.filter(r => r[2] === '永豐大戶' && r[4] === '繳信用卡')[0];
    assert.ok(cardIncome, 'expected 永豐信用卡 收入 row');
    assert.ok(cardBill, 'expected 繳信用卡 row');
    assert.strictEqual(cardIncome[11], cardBill[11]);
    assert.ok(cardBill[11], 'transferId should be set');
  });
}

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
