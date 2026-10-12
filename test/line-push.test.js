const assert = require('assert');
const { loadGs } = require('./harness');

const calls = [];
let fetchImpl = function() { return { getResponseCode: function() { return 200; }, getContentText: function() { return ''; } }; };
const gs = loadGs(['SheetService.gs', 'Config.gs', 'LineService.gs', 'Main.gs'], {
  UrlFetchApp: { fetch: function(url, options) { calls.push({ url: url, options: options }); return fetchImpl(url, options); } }
});
global.ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: function(s) { return { _text: s, setMimeType: function() { return this; }, getContent: function() { return s; } }; }
};
const props = gs.PropertiesService.getScriptProperties();
props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', 'tkn');

let failed = 0;
function t(name, fn) {
  try { calls.length = 0; fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

t('pushToLine 送到 push endpoint，帶 bearer 與文字', () => {
  const code = gs.pushToLine('U123', 'hello');
  assert.strictEqual(code, 200);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.line.me/v2/bot/message/push');
  assert.strictEqual(calls[0].options.headers.Authorization, 'Bearer tkn');
  assert.strictEqual(calls[0].options.muteHttpExceptions, true);
  const p = JSON.parse(calls[0].options.payload);
  assert.deepStrictEqual(p, { to: 'U123', messages: [{ type: 'text', text: 'hello' }] });
});

t('超過 4900 字截斷', () => {
  gs.pushToLine('U1', 'a'.repeat(6000));
  const p = JSON.parse(calls[0].options.payload);
  assert.strictEqual(p.messages[0].text.length, 4900);
});

t('fetch 丟例外 → 回 0 不拋', () => {
  const old = fetchImpl;
  fetchImpl = function() { throw new Error('boom'); };
  try { assert.strictEqual(gs.pushToLine('U1', 'x'), 0); } finally { fetchImpl = old; }
});

t('notifyImportResult 無 LINE_USER_ID 不呼叫 fetch', () => {
  gs.notifyImportResult({ ok: true, summary: 's' });
  assert.strictEqual(calls.length, 0);
});

t('notifyImportResult 有 LINE_USER_ID → push 摘要；失敗 → 失敗訊息', () => {
  props.setProperty('LINE_USER_ID', 'Uabc');
  gs.notifyImportResult({ ok: true, summary: '匯入完成 3 筆' });
  assert.strictEqual(calls.length, 1);
  const p = JSON.parse(calls[0].options.payload);
  assert.strictEqual(p.to, 'Uabc');
  assert.strictEqual(p.messages[0].text, '匯入完成 3 筆');
  gs.notifyImportResult({ ok: false, error: '壞了' });
  assert.strictEqual(JSON.parse(calls[1].options.payload).messages[0].text, '📄 Gmail 匯入失敗：壞了');
  props.setProperty('LINE_USER_ID', '');
});

t('doPost LINE 分支存 LAST_LINE_USER_ID', () => {
  global.handleTextMessage = function() {};
  const body = JSON.stringify({ events: [{ type: 'message', source: { userId: 'Ulast' }, replyToken: 'r', message: { type: 'text', text: 'hi' } }] });
  const out = gs.doPost({ postData: { contents: body } });
  assert.strictEqual(JSON.parse(out.getContent()).status, 'ok');
  assert.strictEqual(props.getProperty('LAST_LINE_USER_ID'), 'Ulast');
});

t('printLastLineUserId 無值時提示', () => {
  props.setProperty('LAST_LINE_USER_ID', '');
  const logs = [];
  const old = global.Logger;
  global.Logger = { log: function(m) { logs.push(m); } };
  try { gs.printLastLineUserId(); } finally { global.Logger = old; }
  assert.ok(logs[0].indexOf('尚未收到任何 LINE 訊息') >= 0);
});

process.exit(failed ? 1 : 0);
