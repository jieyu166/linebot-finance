const assert = require('assert');
const { loadGs } = require('./harness');

// 純函式測試：fixDirectionByBalance / appendCounterparty / dropZeroAndRewardDeposits /
// normalizeCategories / forceCardPaymentCategory / dropSettlementBuyRows /
// detectCardAccountFromText / checkStatementTotals
const gs = loadGs(['SheetService.gs', 'TransferService.gs', 'OpenAIService.gs'], {
  getConfig: function() { return 'sk-test'; },
  UrlFetchApp: { fetch: function() { throw new Error('not used in this test file'); } }
});

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

function acct(name, institution, currency, type, hints, debitAccount, note) {
  return {
    name: name, institution: institution, currency: currency, type: type,
    initialBalance: 0, initialDate: '', note: note || '', active: true,
    debitAccount: debitAccount || '', accountNumberHints: hints || []
  };
}

function accounts() {
  return [
    acct('現金', '現金', 'TWD', '現金', []),
    acct('一銀', '第一銀行', 'TWD', '銀行', ['630']),
    acct('一銀信用卡', '第一銀行', 'TWD', '信用卡', [], '一銀', '綠活卡＋iLEO 同一帳單'),
    acct('永豐大戶', '永豐銀行', 'TWD', '銀行', ['198-01']),
    acct('永豐信用卡', '永豐銀行', 'TWD', '信用卡', [], '永豐大戶', '大戶卡＋幣倍卡＋大衛卡 同一帳單'),
    acct('永豐信用卡外幣', '永豐銀行', 'USD', '信用卡', [], '永豐大戶'),
    acct('永豐證券', '永豐銀行', 'TWD', '證券', ['042-01'], '永豐大戶', '交割戶'),
    acct('玉山', '玉山銀行', 'TWD', '銀行', ['0015977', '0381979']),
    acct('玉山信用卡', '玉山銀行', 'TWD', '信用卡', [], '玉山', 'U Bear 卡'),
    acct('台新', '台新銀行', 'TWD', '銀行', ['288810', '288815', '288818']),
    acct('台新信用卡', '台新銀行', 'TWD', '信用卡', [], '台新', 'Richart 卡'),
    acct('中信', '中國信託', 'TWD', '銀行', []),
    acct('中信信用卡', '中國信託', 'TWD', '信用卡', [], '中信', '中信 Line 卡')
  ];
}

const EXP = ['飲食', '交通', '購物', '手續費', '轉帳', '貸款', '繳信用卡', '投資', '休閒', '學習', '保險', '其他'];
const INC = ['薪資', '回饋', '利息', '股利', '投資獲利', '獎金', '其他'];

function tx(over) {
  return Object.assign({
    date: '2026/08/01', type: '支出', category: '', item: '', description: '',
    institution: '', account: '', currency: 'TWD', amount: 100, accountNumber: ''
  }, over);
}

// ---------- fixDirectionByBalance ----------

t('fixDirectionByBalance：永豐交割戶 定期買股 9,498 → 4,485 修正方向不變（原本支出正確）', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '042-01', item: '定期買股', type: '支出', amount: 9498, balance: 4485 }),
      tx({ accountNumber: '042-01', item: '手機轉帳', type: '支出', amount: 10000, balance: 14485 })
    ]
  };
  parsed.transactions[0].balance = 4485;
  // 需要一個「上一列餘額」基準；第一列用 openingBalances 或留原樣
  gs.fixDirectionByBalance(parsed);
  // 第二列：14485 - 4485 = 10000，與 amount 相符 → 應為收入
  assert.strictEqual(parsed.transactions[1].type, '收入');
});

t('fixDirectionByBalance：玉山 ATM跨行轉 20,000 餘額 17,478→37,478 修正為收入', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '0381979', item: '期初', type: '支出', amount: 1, balance: 17478 }),
      tx({ accountNumber: '0381979', item: 'ATM跨行轉', type: '支出', amount: 20000, balance: 37478 })
    ]
  };
  gs.fixDirectionByBalance(parsed);
  assert.strictEqual(parsed.transactions[1].type, '收入');
});

t('fixDirectionByBalance：中信 電匯 36,709 餘額 38,001→0 修正為收入', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '', item: '期初', type: '支出', amount: 1, balance: 38001 }),
      tx({ accountNumber: '', item: '電匯', type: '支出', amount: 36709, balance: 0 })
    ]
  };
  gs.fixDirectionByBalance(parsed);
  assert.strictEqual(parsed.transactions[1].type, '收入');
});

t('fixDirectionByBalance：金額與餘額差不符時保留原方向', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: 'A', item: '期初', type: '支出', amount: 1, balance: 1000 }),
      tx({ accountNumber: 'A', item: '不明對帳', type: '支出', amount: 500, balance: 1300 })
    ]
  };
  gs.fixDirectionByBalance(parsed);
  assert.strictEqual(parsed.transactions[1].type, '支出');
});

t('fixDirectionByBalance：非銀行帳戶類型不處理', () => {
  const parsed = {
    statementType: '信用卡',
    transactions: [tx({ item: 'x', type: '支出', amount: 100, balance: 200 })]
  };
  gs.fixDirectionByBalance(parsed);
  assert.strictEqual(parsed.transactions[0].type, '支出');
});

// ---------- appendCounterparty ----------

t('appendCounterparty：中信 行動網 + counterparty 數字附加到 description', () => {
  const parsed = { transactions: [tx({ item: '跨行轉', description: '行動網', counterparty: '0019801800104436' })] };
  gs.appendCounterparty(parsed);
  assert.ok(parsed.transactions[0].description.indexOf('0019801800104436') >= 0, parsed.transactions[0].description);
});

t('appendCounterparty：counterparty 數字已在 description 中則不重複附加', () => {
  const parsed = { transactions: [tx({ description: '手機轉帳 19801800104436', counterparty: '19801800104436' })] };
  gs.appendCounterparty(parsed);
  assert.strictEqual(parsed.transactions[0].description, '手機轉帳 19801800104436');
});

t('appendCounterparty：counterparty 為空不動作', () => {
  const parsed = { transactions: [tx({ description: '一般消費', counterparty: '' })] };
  gs.appendCounterparty(parsed);
  assert.strictEqual(parsed.transactions[0].description, '一般消費');
});

// ---------- dropZeroAndRewardDeposits ----------

t('dropZeroAndRewardDeposits：金額 0 的列丟棄並計入 skipped', () => {
  const parsed = { skipped: 0, transactions: [tx({ amount: 0 }), tx({ amount: 100 })] };
  gs.dropZeroAndRewardDeposits(parsed);
  assert.strictEqual(parsed.transactions.length, 1);
  assert.strictEqual(parsed.skipped, 1);
});

t('dropZeroAndRewardDeposits：信用卡帳單「回饋入帳戶」列丟棄', () => {
  const parsed = {
    statementType: '信用卡', skipped: 0,
    transactions: [
      tx({ item: '大戶消費回饋入帳戶_國內', description: '大戶消費回饋入帳戶_國內 139 元', amount: 0 }),
      tx({ item: '正常消費', amount: 100 })
    ]
  };
  gs.dropZeroAndRewardDeposits(parsed);
  assert.strictEqual(parsed.transactions.length, 1);
  assert.strictEqual(parsed.transactions[0].item, '正常消費');
});

// ---------- normalizeCategories ----------

t('normalizeCategories：同義詞娛樂→休閒', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '娛樂', item: 'NETFLIX' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '休閒');
});

t('normalizeCategories：關鍵字 優步- → 飲食（僅當 LLM 分類不在清單中才套用）', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '其他', item: '優步-卡雞麻韓式炸雞' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '飲食');
});

t('normalizeCategories：關鍵字 統一超商 → 交通', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '其他', item: '愛金卡自動加值金額-統一超商新奇美' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '交通');
});

t('normalizeCategories：關鍵字 momo → 購物', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '其他', item: 'momo*AIC艾卡科技' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '購物');
});

t('normalizeCategories：關鍵字 Anthropic/OpenAI → 學習', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '其他', item: 'ANTHROPIC* CLAUDE SUB' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '學習');
});

t('normalizeCategories：合法分類不變動', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '交通', item: '加油' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '交通');
});

t('normalizeCategories：支出無法對應時 fallback 其他', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '完全不存在的分類', item: '神秘消費' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '其他');
});

t('normalizeCategories：收入 投資獲利 對支出來說不合法時，若原分類為投資獲利映射到投資', () => {
  const parsed = { transactions: [tx({ type: '支出', category: '投資獲利', item: '普買 台積電' })] };
  gs.normalizeCategories(parsed, EXP, INC);
  assert.strictEqual(parsed.transactions[0].category, '投資');
});

// ---------- forceCardPaymentCategory ----------

t('forceCardPaymentCategory：台新 媒體轉帳 台新卡費 → 繳信用卡', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [tx({ type: '支出', category: '轉帳', item: '媒體轉帳', description: '台新卡費' })]
  };
  gs.forceCardPaymentCategory(parsed);
  assert.strictEqual(parsed.transactions[0].category, '繳信用卡');
});

t('forceCardPaymentCategory：純換匯不含卡費/卡款/信用卡字樣不強制', () => {
  const parsed = {
    statementType: '銀行帳戶',
    transactions: [tx({ type: '支出', category: '轉帳', item: '手機換匯', description: '手機換匯 04200800116943(USD)' })]
  };
  gs.forceCardPaymentCategory(parsed);
  assert.strictEqual(parsed.transactions[0].category, '轉帳');
});

// ---------- dropSettlementBuyRows ----------

t('dropSettlementBuyRows：證券帳戶上「定期買股」列丟棄並記錄 notes', () => {
  const parsed = {
    notes: [],
    transactions: [
      tx({ account: '永豐證券', category: '投資', item: '定期買股', amount: 9498 }),
      tx({ account: '永豐證券', category: '投資', item: '台積電', amount: 9461 })
    ]
  };
  gs.dropSettlementBuyRows(parsed, accounts());
  assert.strictEqual(parsed.transactions.length, 1);
  assert.strictEqual(parsed.transactions[0].item, '台積電');
  assert.ok(parsed.notes.some(function(n) { return /交割戶買股扣款 1 筆已略過/.test(n); }), parsed.notes.join('|'));
});

t('dropSettlementBuyRows：即使 LLM 把該列分類誤標成非「投資」（如「轉帳」）仍依品項樣式丟棄', () => {
  const parsed = {
    notes: [],
    transactions: [tx({ account: '永豐證券', type: '支出', category: '轉帳', item: '定期買股', amount: 9498 })]
  };
  gs.dropSettlementBuyRows(parsed, accounts());
  assert.strictEqual(parsed.transactions.length, 0);
});

// ---------- resolveImportedAccounts：證券帳號忽略 accountNumber ----------

t('resolveImportedAccounts：證券帳單忽略 accountNumber，一律以類型/機構解析且不記未對應', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '證券',
    transactions: [tx({ accountNumber: '9A9*-03**25-0', account: '', item: '台積電', category: '投資' })]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.strictEqual(r.transactions.length, 1);
  assert.strictEqual(r.transactions[0].account, '永豐證券');
  assert.deepStrictEqual(r.unmatchedAccountNumbers, []);
});

// ---------- detectCardAccountFromText ----------

t('detectCardAccountFromText：玉山 U Bear卡 + 玉山銀行001597XXXX221 命中玉山信用卡', () => {
  const text = 'U Bear卡\n玉山銀行001597XXXX221\n消費明細...';
  const a = gs.detectCardAccountFromText(text, accounts(), 'TWD');
  assert.ok(a, 'expected a match');
  assert.strictEqual(a.name, '玉山信用卡');
});

t('detectCardAccountFromText：永豐 幣倍卡 命中永豐信用卡', () => {
  const text = '幣倍卡消費明細\n本期應繳總金額';
  const a = gs.detectCardAccountFromText(text, accounts(), 'TWD');
  assert.ok(a, 'expected a match');
  assert.strictEqual(a.name, '永豐信用卡');
});

t('detectCardAccountFromText：無任何命中回傳 null', () => {
  const a = gs.detectCardAccountFromText('完全無關的文字', accounts(), 'TWD');
  assert.strictEqual(a, null);
});

// ---------- checkStatementTotals ----------

t('checkStatementTotals：合計不符時記錄 notes', () => {
  const parsed = {
    statementType: '信用卡', notes: [],
    statementTotals: [{ currency: 'TWD', newCharges: 0 }],
    transactions: [
      tx({ type: '支出', currency: 'TWD', amount: 100 }),
      tx({ type: '支出', currency: 'TWD', amount: 200 })
    ]
  };
  gs.checkStatementTotals(parsed);
  assert.ok(parsed.notes.some(function(n) { return /不符/.test(n); }), parsed.notes.join('|'));
});

t('checkStatementTotals：合計相符（差 < 1）不記錄 notes', () => {
  const parsed = {
    statementType: '信用卡', notes: [],
    statementTotals: [{ currency: 'TWD', newCharges: 300 }],
    transactions: [
      tx({ type: '支出', currency: 'TWD', amount: 100 }),
      tx({ type: '支出', currency: 'TWD', amount: 200 })
    ]
  };
  gs.checkStatementTotals(parsed);
  assert.strictEqual(parsed.notes.length, 0);
});

process.exit(failed === 0 ? 0 : 1);
