const assert = require('assert');
const { loadGs } = require('./harness');

const fetchCalls = [];
const gs = loadGs(['SheetService.gs', 'Config.gs', 'TransferService.gs', 'WebAppLogic.gs', 'OpenAIService.gs', 'LineService.gs', 'Main.gs', 'WebApp.gs'], {
  UrlFetchApp: { fetch: function(url, o) { fetchCalls.push(url); return { getResponseCode: function() { return 200; }, getContentText: function() { return ''; } }; } }
});
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
  assert.strictEqual(post({ text: 'a' }).error, '無權限');
  const r = post({ token: 'bad', text: 'a' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, '無權限');
});

t('錯 token / 壞 JSON 不 push；好 token push 一次', () => {
  const props = gs.PropertiesService.getScriptProperties();
  props.setProperty('LINE_USER_ID', 'Uabc');
  props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', 'x');
  try {
    fetchCalls.length = 0;
    post({ token: 'bad', text: 'a' });
    post('not json');
    assert.strictEqual(fetchCalls.length, 0);
    post({ token: 'tok', text: '  ' });
    assert.strictEqual(fetchCalls.length, 1);
  } finally { props.setProperty('LINE_USER_ID', ''); }
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

t('空文字 → ok:false；無交易 → ok:true empty', () => {
  const deps = { ss: {}, accounts: [], expenseCategories: [], incomeCategories: [], parse: () => ({ bank: '永豐', statementType: '複委託', transactions: [] }), importFn: () => { throw new Error('no'); } };
  assert.deepStrictEqual(gs.buildImportPostResponse({ text: '  ' }, deps), { ok: false, error: '帳單文字為空' });
  const r = gs.buildImportPostResponse({ text: 'x' }, deps);
  assert.deepStrictEqual(r, { ok: true, empty: true, written: 0, skipped: 0, paired: 0, bank: '永豐', statementType: '複委託', summary: '📄 永豐 複委託 本期無交易', receivedChars: 1, strippedChars: 1 });
});

t('diag 與 receivedChars/strippedChars 出現在 ok / empty / error 回應', () => {
  const diag = { textChars: 5, rawTransactions: 28, model: 'm', afterResolve: 0, final: 0 };
  const mk = (res) => ({ ss: {}, accounts: [], expenseCategories: [], incomeCategories: [], parse: () => res,
    importFn: (r) => ({ written: r.transactions, skipped: [], pairing: { paired: 0 } }) });
  const e = gs.buildImportPostResponse({ text: 'hello' }, mk({ bank: 'b', statementType: 's', transactions: [], diag }));
  assert.strictEqual(e.empty, true);
  assert.strictEqual(e.diag.rawTransactions, 28);
  assert.strictEqual(e.receivedChars, 5);
  assert.ok(e.summary);
  const o = gs.buildImportPostResponse({ text: 'hello' }, mk({ bank: 'b', statementType: 's', transactions: [tx({})], diag }));
  assert.strictEqual(o.ok, true);
  assert.strictEqual(o.diag.rawTransactions, 28);
  assert.strictEqual(o.receivedChars, 5);
  assert.strictEqual(o.strippedChars, 5);
  const x = gs.buildImportPostResponse({ text: 'hello' }, mk({ bank: 'b', statementType: 's', diag }));
  assert.strictEqual(x.ok, false);
  assert.strictEqual(x.diag.rawTransactions, 28);
});

t('無交易 → handleImportPost 不 push LINE', () => {
  const props = gs.PropertiesService.getScriptProperties();
  props.setProperty('LINE_USER_ID', 'Uabc');
  props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', 'x');
  try {
    fetchCalls.length = 0;
    gs.notifyImportResult({ ok: true, empty: true, summary: 's' });
    assert.strictEqual(fetchCalls.length, 0);
    gs.notifyImportResult({ ok: true, summary: 's' });
    assert.strictEqual(fetchCalls.length, 1);
  } finally { props.setProperty('LINE_USER_ID', ''); }
});

t('相依拋錯 → ok:false 不外洩例外', () => {
  const r = gs.buildImportPostResponse({ text: 'x' }, { parse: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(r, { ok: false, error: 'boom', receivedChars: 1, strippedChars: 1 });
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

t('hint 幣別不符 → 維持未對應（USD 保留）；幣別相符才指派', () => {
  const hintAccts = () => [acct('永豐大戶', '永豐銀行', 'TWD', '銀行')];
  const mk = (c) => ({ bank: '某海外券商', statementType: '證券', transactions: [tx({ item: 'Z', currency: c })] });
  const r1 = gs.resolveImportedAccounts(mk('USD'), hintAccts(), { fallbackAccount: '永豐大戶' });
  assert.strictEqual(r1.transactions[0].account, '');
  assert.strictEqual(r1.transactions[0].currency, 'USD');
  assert.strictEqual(r1.fallbackHintRows, 0);
  const r2 = gs.resolveImportedAccounts(mk('TWD'), hintAccts(), { fallbackAccount: '永豐大戶' });
  assert.strictEqual(r2.transactions[0].account, '永豐大戶');
  assert.strictEqual(r2.fallbackHintRows, 1);
});

t('inactive hint 帳戶被忽略', () => {
  const a = accounts(); a[0].active = false;
  const r = gs.resolveImportedAccounts({ bank: '某海外券商', statementType: '證券', transactions: [tx({})] }, a, { fallbackAccount: '永豐外幣' });
  assert.strictEqual(r.transactions[0].account, '');
  assert.strictEqual(r.fallbackHintRows, 0);
});

t('空白帳戶列 → blankAccountRows 與警示行', () => {
  const r = gs.buildImportPostResponse({ text: 'x' }, {
    ss: {}, accounts: [], expenseCategories: [], incomeCategories: [],
    parse: () => ({ bank: 'B', statementType: '證券', transactions: [tx({}), tx({})] }),
    importFn: () => ({ written: [tx({ account: '' }), tx({ account: '永豐外幣' })], skipped: [], merged: 0, pairing: { paired: 0 } })
  });
  assert.strictEqual(r.blankAccountRows, 1);
  assert.ok(r.summary.indexOf('⚠ 1 筆未對應帳戶（帳戶欄空白，請在 App 修正）') >= 0);
  const r0 = gs.buildImportPostResponse({ text: 'x' }, {
    ss: {}, accounts: [], expenseCategories: [], incomeCategories: [],
    parse: () => ({ bank: 'B', statementType: '證券', transactions: [tx({})] }),
    importFn: () => ({ written: [tx({ account: '永豐外幣' })], skipped: [], merged: 0, pairing: { paired: 0 } })
  });
  assert.strictEqual(r0.blankAccountRows, 0);
  assert.ok(r0.summary.indexOf('⚠') < 0);
});

t('handleImportPost postData 缺 → ok:false', () => {
  const r = JSON.parse(gs.handleImportPost({ parameter: { import: '1' } }).getContent());
  assert.strictEqual(r.ok, false);
});

if (failed > 0) { console.log(failed + ' failed'); process.exit(1); }
