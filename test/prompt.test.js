const assert = require('assert');
const { loadGs } = require('./harness');

// parsePdfWithOpenAI 需要 getConfig / UrlFetchApp；用 extraGlobals 注入（不載入 Config.gs）
let fakeResponseBody = '{}';
const gs = loadGs(['SheetService.gs', 'TransferService.gs', 'OpenAIService.gs'], {
  getConfig: function() { return 'sk-test'; },
  UrlFetchApp: {
    fetch: function() {
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() { return JSON.stringify({ choices: [{ message: { content: fakeResponseBody } }] }); }
      };
    }
  }
});

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

function acct(name, institution, currency, type, hints, debitAccount) {
  return {
    name: name, institution: institution, currency: currency, type: type,
    initialBalance: 0, initialDate: '', note: '', active: true,
    debitAccount: debitAccount || '', accountNumberHints: hints || []
  };
}

function accounts() {
  return [
    acct('現金', '現金', 'TWD', '現金', []),
    acct('一銀', '第一銀行', 'TWD', '銀行', ['630']),
    acct('一銀信用卡', '第一銀行', 'TWD', '信用卡', [], '一銀'),
    acct('永豐大戶', '永豐銀行', 'TWD', '銀行', ['198-01']),
    acct('永豐信用卡', '永豐銀行', 'TWD', '信用卡', [], '永豐大戶'),
    acct('永豐信用卡外幣', '永豐銀行', 'USD', '信用卡', [], '永豐大戶'),
    acct('永豐證券', '永豐銀行', 'TWD', '證券', ['042-01'], '永豐大戶'),
    acct('永豐外幣', '永豐銀行', 'USD', '銀行', ['042-00']),
    acct('玉山', '玉山銀行', 'TWD', '銀行', ['0015977', '0381979']),
    acct('玉山信用卡', '玉山銀行', 'TWD', '信用卡', [], '玉山')
  ];
}

const EXP = ['飲食', '交通', '購物', '手續費', '轉帳', '貸款', '繳信用卡', '投資'];
const INC = ['薪資', '回饋', '利息', '股利', '投資獲利', '獎金', '其他'];

// ---------- describeAccounts ----------

t('describeAccounts 產生「名稱（機構，幣別，類型，帳號 hint）」頓號串', () => {
  const s = gs.describeAccounts(accounts());
  assert.ok(s.indexOf('永豐證券（永豐銀行，TWD，證券，帳號 042-01）') >= 0, s);
  assert.ok(s.indexOf('玉山（玉山銀行，TWD，銀行，帳號 0015977/0381979）') >= 0, s);
  assert.ok(s.indexOf('現金（現金，TWD，現金）') >= 0, s);
  assert.ok(s.indexOf('、') >= 0, s);
});

// ---------- buildSystemPrompt ----------

t('buildSystemPrompt 第四參數吃帳戶物件陣列並列出帳戶描述', () => {
  const p = gs.buildSystemPrompt(EXP, INC, accounts());
  assert.ok(p.indexOf('永豐證券（永豐銀行，TWD，證券，帳號 042-01）') >= 0);
  assert.ok(p.indexOf('現金') >= 0);
});

// ---------- buildPdfSystemPrompt ----------

t('buildPdfSystemPrompt 含帳單類型、帳戶描述、回饋入帳戶、餘額差與 tab 規則', () => {
  const p = gs.buildPdfSystemPrompt(EXP, INC, accounts());
  assert.ok(p.indexOf('statementType') >= 0, '缺 statementType');
  assert.ok(p.indexOf('永豐證券（永豐銀行，TWD，證券，帳號 042-01）') >= 0, '缺帳戶描述');
  assert.ok(p.indexOf('回饋入帳戶') >= 0, '缺回饋入帳戶跳過規則');
  assert.ok(p.indexOf('餘額') >= 0, '缺餘額差方向判斷');
  assert.ok(p.indexOf('tab') >= 0, '缺 tab 分隔說明');
  assert.ok(p.indexOf('accountNumber') >= 0, '缺 accountNumber 欄位');
  assert.ok(p.indexOf('"statementType":"信用卡"') >= 0, '範例 1 缺 statementType');
  assert.ok(p.indexOf('198-01*-**10443-*') >= 0, '範例 2 缺 accountNumber');
  assert.ok(p.indexOf('中信') >= 0, '缺中信 tab 格式範例');
});

// ---------- stripGarbledLines ----------

t('stripGarbledLines 去掉亂碼行、保留正常行與空行', () => {
  const good1 = '07/20 感謝您本行自動扣繳已收到 -6,142';
  const good2 = '07/01 07/07 行動支付-國營臺灣鐵路公司網路購票 191 7142';
  const bad1 = '¬¦¡¦§Ú¡¥¤£¦¡¦¬¤¡¦';
  const bad2 = '¡¦§A¦n¡A¬¡¤£¡¥¦¬¤';
  const out = gs.stripGarbledLines([good1, bad1, '', good2, bad2].join('\n')).split('\n');
  assert.deepStrictEqual(out, [good1, '', good2]);
});

t('stripGarbledLines 對空輸入回傳空字串', () => {
  assert.strictEqual(gs.stripGarbledLines(''), '');
  assert.strictEqual(gs.stripGarbledLines(null), '');
});

// ---------- findAccountByNumber / findAccountByTypeAndBank ----------

t('findAccountByNumber 以 accountNumberHints 前綴唯一命中', () => {
  const a = accounts();
  assert.strictEqual(gs.findAccountByNumber(a, '042-01*-**00615-*').name, '永豐證券');
  assert.strictEqual(gs.findAccountByNumber(a, '198-01*-**10443-*').name, '永豐大戶');
  assert.strictEqual(gs.findAccountByNumber(a, '198-00*-**10443-*'), null);
});

t('findAccountByTypeAndBank 依類型／機構／幣別唯一命中', () => {
  const a = accounts();
  assert.strictEqual(gs.findAccountByTypeAndBank(a, '信用卡', '永豐銀行', 'TWD').name, '永豐信用卡');
  assert.strictEqual(gs.findAccountByTypeAndBank(a, '信用卡', '永豐銀行', 'USD').name, '永豐信用卡外幣');
  assert.strictEqual(gs.findAccountByTypeAndBank(a, '證券', '永豐', 'TWD').name, '永豐證券');
  assert.strictEqual(gs.findAccountByTypeAndBank(a, '信用卡', '未知銀行', 'TWD'), null);
});

// ---------- resolveImportedAccounts ----------

function tx(over) {
  return Object.assign({
    date: '2026/08/01', type: '支出', category: '轉帳', item: '', description: '',
    institution: '', account: '', currency: 'TWD', amount: 100
  }, over);
}

t('resolveImportedAccounts 依 accountNumber 分流到正確帳戶', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '042-01*-**00615-*', item: '交割款', account: '' }),
      tx({ accountNumber: '198-01*-**10443-*', item: '大戶回饋', account: '' })
    ]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.deepStrictEqual(r.transactions.map(x => x.account), ['永豐證券', '永豐大戶']);
  assert.deepStrictEqual(r.transactions.map(x => x.institution), ['永豐銀行', '永豐銀行']);
  assert.deepStrictEqual(r.unmatchedAccountNumbers, []);
});

t('resolveImportedAccounts 對應不到的 accountNumber 丟棄並記錄', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '198-00*-**10443-*', item: '卡費' }),
      tx({ accountNumber: '198-01*-**10443-*', item: '大戶回饋' })
    ]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.strictEqual(r.transactions.length, 1);
  assert.strictEqual(r.transactions[0].account, '永豐大戶');
  assert.deepStrictEqual(r.unmatchedAccountNumbers, ['198-00*-**10443-*']);
});

t('resolveImportedAccounts 信用卡帳單強制對應信用卡帳戶並依幣別分流', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '信用卡',
    transactions: [
      tx({ account: '永豐大戶', currency: 'TWD', item: '全聯' }),
      tx({ account: '永豐信用卡', currency: 'USD', item: 'AMAZON' })
    ]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.deepStrictEqual(r.transactions.map(x => x.account), ['永豐信用卡', '永豐信用卡外幣']);
  assert.deepStrictEqual(r.transactions.map(x => x.currency), ['TWD', 'USD']);
});

t('resolveImportedAccounts 證券帳單強制對應證券帳戶', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '證券',
    transactions: [tx({ account: '永豐大戶', item: '台積電', category: '投資' })]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.strictEqual(r.transactions[0].account, '永豐證券');
});

t('resolveImportedAccounts 同帳戶內轉丟棄（對方帳號等於本列帳戶）', () => {
  const parsed = {
    bank: '玉山銀行', statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '0381979***481', item: '轉出', description: '網路非約轉帳 8080000015977221' }),
      tx({ accountNumber: '0381979***481', item: '悠遊卡加值', description: '悠遊卡自動加值', category: '交通' })
    ]
  };
  const r = gs.resolveImportedAccounts(parsed, accounts());
  assert.strictEqual(r.transactions.length, 1);
  assert.strictEqual(r.transactions[0].item, '悠遊卡加值');
});

// ---------- extractFxCardPayment ----------

t('extractFxCardPayment：過渡戶卡費合計寫入 fxAmount、回饋轉 USD 卡、過渡戶列丟棄', () => {
  const parsed = {
    bank: '永豐銀行', statementType: '銀行帳戶',
    transactions: [
      tx({ accountNumber: '198-01*-**10443-*', account: '永豐大戶', type: '支出',
        category: '繳信用卡', item: '卡費換匯', description: '卡費換匯扣款', amount: 15000 }),
      tx({ accountNumber: '198-00*-**00615-*', type: '支出', category: '繳信用卡',
        item: '卡費', description: '幣倍卡費', amount: 500 }),
      tx({ accountNumber: '198-00*-**00615-*', type: '支出', category: '繳信用卡',
        item: '卡費', description: '大戶卡費', amount: 9.66 }),
      tx({ accountNumber: '198-00*-**00615-*', type: '收入', category: '回饋',
        item: '回饋', description: '幣倍卡國外消費回饋', amount: 12.34 })
    ]
  };
  const out = gs.extractFxCardPayment(parsed, accounts());
  assert.strictEqual(out.transactions.length, 2);

  const fx = out.transactions[0];
  assert.strictEqual(fx.account, '永豐大戶');
  assert.strictEqual(fx.fxAmount, 509.66);

  const reward = out.transactions[1];
  assert.strictEqual(reward.account, '永豐信用卡外幣');
  assert.strictEqual(reward.institution, '永豐銀行');
  assert.strictEqual(reward.currency, 'USD');
  assert.strictEqual(reward.type, '收入');
  assert.strictEqual(reward.category, '回饋');
  assert.strictEqual(reward.accountNumber, '');
  assert.strictEqual(reward.amount, 12.34);
});

t('extractFxCardPayment：沒有過渡戶列時原樣回傳', () => {
  const parsed = { bank: '永豐銀行', transactions: [tx({ accountNumber: '198-01*-**10443-*' })] };
  const out = gs.extractFxCardPayment(parsed, accounts());
  assert.strictEqual(out.transactions.length, 1);
  assert.strictEqual(out.transactions[0].fxAmount, undefined);
});

// ---------- parsePdfWithOpenAI 串接後處理 ----------

t('parsePdfWithOpenAI 回傳經過帳號分流的交易與 unmatchedAccountNumbers', () => {
  fakeResponseBody = JSON.stringify({
    bank: '永豐銀行', statementType: '銀行帳戶', skipped: 3,
    transactions: [
      { date: '2026/08/01', type: '收入', category: '回饋', item: '大戶回饋', description: '大戶回饋',
        institution: '', account: '', currency: 'TWD', amount: '607', accountNumber: '198-01*-**10443-*' },
      { date: '2026/08/02', type: '支出', category: '轉帳', item: '轉出', description: '轉出',
        institution: '', account: '', currency: 'TWD', amount: '1000', accountNumber: '999-99*-**99999-*' }
    ]
  });
  const r = gs.parsePdfWithOpenAI('帳單文字', EXP, INC, accounts());
  assert.strictEqual(r.transactions.length, 1);
  assert.strictEqual(r.transactions[0].account, '永豐大戶');
  assert.strictEqual(r.transactions[0].amount, 607);
  assert.deepStrictEqual(r.unmatchedAccountNumbers, ['999-99*-**99999-*']);
});

process.exit(failed === 0 ? 0 : 1);
