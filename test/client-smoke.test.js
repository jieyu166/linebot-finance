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
    'CL.evalCalc'
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

process.exit(failed ? 1 : 0);
