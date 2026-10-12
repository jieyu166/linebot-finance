const assert = require('assert');
const { loadGs } = require('./harness');

const gs = loadGs(['SheetService.gs', 'Config.gs', 'TransferService.gs', 'WebAppLogic.gs', 'OpenAIService.gs', 'Main.gs', 'WebApp.gs']);
gs.PropertiesService.getScriptProperties().setProperty('WEBAPP_TOKEN', 'tok');
global.Session = { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) };
global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: function(s) { return { _text: s, setMimeType: function() { return this; }, getContent: function() { return s; } }; }
};

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

function acct(name, institution, currency, type) {
  return { name, institution, currency, type, initialBalance: 0, initialDate: '', note: '', active: true, debitAccount: '', accountNumberHints: [] };
}
const accounts = () => [acct('永豐外幣', '永豐銀行', 'USD', '銀行'), acct('現金', '現金', 'TWD', '現金')];
function tx(o) { return Object.assign({ date: '2026/10/01', type: '支出', category: '投資', item: 'X', description: '', amount: 10, currency: 'USD', account: '', accountNumber: '' }, o); }
function post(obj) { return JSON.parse(gs.handleImportPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).getContent()); }

t('缺 token / 錯 token → 無權限', () => {
  assert.strictEqual(post({ text: 'a' }).error, '無權限使用此 App');
  const r = post({ token: 'bad', text: 'a' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, '無權限使用此 App');
});

t('非 JSON body → ok:false', () => {
  const r = post('not json');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, '無法解析請求');
});

t('buildImportPostResponse 正常流程', () => {
  let src = null, opts = null;
  const r = gs.buildImportPostResponse({ text: '帳單內容', hint: '永豐外幣' }, {
    ss: {}, accounts: accounts(), expenseCategories: [], incomeCategories: [],
    parse: (text, e, i, a, o) => { opts = o; return { bank: '永豐銀行', statementType: '銀行帳戶', transactions: [tx({ item: 'a' }), tx({ item: 'b', type: '收入' })] }; },
    importFn: (result, source) => { src = source; return { written: result.transactions, skipped: [], merged: 0, pairing: { paired: 0 } }; }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.written, 2);
  assert.ok(r.summary.indexOf('帳單文字匯入完成') >= 0);
  assert.strictEqual(src, 'Gmail匯入');
  assert.strictEqual(opts.fallbackAccount, '永豐外幣');
  assert.strictEqual(r.bank, '永豐銀行');
});

t('空文字 → ok:false；無交易 → ok:false', () => {
  const deps = { ss: {}, accounts: [], expenseCategories: [], incomeCategories: [], parse: () => ({ transactions: [] }), importFn: () => { throw new Error('no'); } };
  assert.deepStrictEqual(gs.buildImportPostResponse({ text: '  ' }, deps), { ok: false, error: '帳單文字為空' });
  const r = gs.buildImportPostResponse({ text: 'x' }, deps);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('無法從此帳單解析出交易紀錄') >= 0);
});

t('相依拋錯 → ok:false 不外洩例外', () => {
  const r = gs.buildImportPostResponse({ text: 'x' }, { parse: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(r, { ok: false, error: 'boom' });
});

t('fallbackAccount：證券列未知銀行 → 歸入 hint 帳戶；無 option → 不指派帳戶', () => {
  const mk = () => ({ bank: '某海外券商', statementType: '證券', transactions: [tx({ item: 'AAPL' })] });
  const r1 = gs.resolveImportedAccounts(mk(), accounts(), { fallbackAccount: '永豐外幣' });
  assert.strictEqual(r1.transactions.length, 1);
  assert.strictEqual(r1.transactions[0].account, '永豐外幣');
  assert.strictEqual(r1.transactions[0].currency, 'USD');
  assert.strictEqual(r1.fallbackHintRows, 1);
  const p = mk();
  gs.resolveImportedAccounts(p, accounts(), { fallbackAccount: '永豐外幣' });
  assert.strictEqual(p.fallbackHintRows, 1);
  const r2 = gs.resolveImportedAccounts(mk(), accounts());
  // 既有行為不變：無 option 時該列不會被指派到任何帳戶
  assert.strictEqual(r2.transactions.length, 1);
  assert.strictEqual(r2.transactions[0].account, '');
  assert.strictEqual(r2.fallbackHintRows, 0);
});

t('doPost import=1：空 body 回 ok:false JSON', () => {
  const out = gs.doPost({ parameter: { import: '1' }, postData: { contents: '{}' } });
  assert.strictEqual(JSON.parse(out.getContent()).ok, false);
});

if (failed > 0) { console.log(failed + ' failed'); process.exit(1); }
