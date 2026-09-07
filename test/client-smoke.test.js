const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

function readSrc(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
}

function extractScriptBody(html) {
  var match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return match ? match[1] : '';
}

t('App.html script body 語法檢查（不拋錯）', () => {
  var body = extractScriptBody(readSrc('App.html'));
  assert.ok(body.length > 0, 'App.html 應含 <script> 內容');
  assert.doesNotThrow(function () { new Function(body); });
});

t('App.html 含必要字串：apiBootstrap、apiListTransactions、renderRecords、__mockApi、data-action', () => {
  var body = extractScriptBody(readSrc('App.html'));
  ['apiBootstrap', 'apiListTransactions', 'renderRecords', '__mockApi', 'data-action'].forEach(function (needle) {
    assert.ok(body.indexOf(needle) !== -1, '缺少字串: ' + needle);
  });
});

t('App.html 含新增／編輯頁必要字串：openEditor、closeEditor、四個交易 API、鍵盤、evalCalc', () => {
  var body = extractScriptBody(readSrc('App.html'));
  [
    'openEditor',
    'closeEditor',
    'apiSaveTransaction',
    'apiCreateTransfer',
    'apiDeleteTransaction',
    'apiUnlinkTransfer',
    'data-action="key"',
    'CL.evalCalc',
    'applyKey',
    'justCalculated'
  ].forEach(function (needle) {
    assert.ok(body.indexOf(needle) !== -1, '缺少字串: ' + needle);
  });
});

t('App.html 含預算分頁必要字串：renderBudget、budget API、新增/編輯 action、budgetColor', () => {
  var body = extractScriptBody(readSrc('App.html'));
  [
    'renderBudget',
    'apiBudgetUsage',
    'apiSaveBudget',
    'budget-add',
    'budget-edit',
    'CL.budgetColor'
  ].forEach(function (needle) {
    assert.ok(body.indexOf(needle) !== -1, '缺少字串: ' + needle);
  });
});

t('App.html 含統計分頁必要字串：renderStats、apiStats、pieSlices、stats-pick、stats-type、CL.percent', () => {
  var body = extractScriptBody(readSrc('App.html'));
  [
    'renderStats',
    'apiStats',
    'pieSlices',
    'stats-pick',
    'stats-type',
    'CL.percent'
  ].forEach(function (needle) {
    assert.ok(body.indexOf(needle) !== -1, '缺少字串: ' + needle);
  });
});

t('Index.html 包含三個 include 與 #app', () => {
  var html = readSrc('Index.html');
  assert.ok(html.indexOf("include('Styles')") !== -1, '缺少 include(\'Styles\')');
  assert.ok(html.indexOf("include('ClientLogic')") !== -1, '缺少 include(\'ClientLogic\')');
  assert.ok(html.indexOf("include('App')") !== -1, '缺少 include(\'App\')');
  assert.ok(html.indexOf('<div id="app">') !== -1, '缺少 <div id="app">');
});

t('App.html 含帳戶分頁必要字串：renderAccounts、帳戶/分類/轉帳 API、cats-open、link-pick', () => {
  var body = extractScriptBody(readSrc('App.html'));
  [
    'renderAccounts',
    'apiBalances',
    'apiSaveAccount',
    'apiSaveCategory',
    'apiTransferCandidates',
    'apiLinkTransfer',
    'apiUnlinkTransfer',
    'invalidateDerived',
    'cats-open',
    'link-pick'
  ].forEach(function (needle) {
    assert.ok(body.indexOf(needle) !== -1, '缺少字串: ' + needle);
  });
});

process.exit(failed ? 1 : 0);
