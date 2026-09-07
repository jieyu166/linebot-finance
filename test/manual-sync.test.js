// test/manual-sync.test.js — 偵測 test/manual/stats-preview.html 是否跟 src/*.html 走鐘
//
// stats-preview.html 是給人手動預覽統計頁用的獨立頁面，內嵌了 Styles.html 的 <style>、
// ClientLogic.html 與 App.html 的 <script> 內容「逐字複製」（非轉譯），方便離線開啟不必透過
// google.script.run。若之後修改了這三個來源檔卻忘了同步這份 preview，畫面就會跟實際
// App 行為不一致而不自知。這裡直接比對逐字內容，一旦不同就會測試失敗提醒重新同步。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

// 統一去掉 CRLF（Windows 簽出／編輯器可能把換行轉成 \r\n），只比對實際內容，
// 避免因換行符號差異誤判走鐘。
function normalizeNewlines(s) {
  return s.replace(/\r\n/g, '\n');
}

function readSrc(file) {
  return normalizeNewlines(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'));
}

function readPreview() {
  return normalizeNewlines(fs.readFileSync(path.join(__dirname, 'manual', 'stats-preview.html'), 'utf8'));
}

function extractStyleBody(html) {
  var m = /<style>([\s\S]*?)<\/style>/.exec(html);
  return m ? m[1] : null;
}

function extractScriptBodies(html) {
  var out = [];
  html.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, function (whole, body) { out.push(body); return whole; });
  return out;
}

t('stats-preview.html 的 <style> 與 src/Styles.html 逐字相同', () => {
  var srcStyle = extractStyleBody(readSrc('Styles.html'));
  var previewStyle = extractStyleBody(readPreview());
  assert.ok(srcStyle, '找不到 src/Styles.html 的 <style>');
  assert.ok(previewStyle, '找不到 stats-preview.html 的 <style>');
  assert.strictEqual(previewStyle, srcStyle, 'stats-preview.html 的 <style> 內容跟 src/Styles.html 不同步，請重新複製更新');
});

t('stats-preview.html 內嵌的 ClientLogic <script> 與 src/ClientLogic.html 逐字相同', () => {
  var srcScript = extractScriptBodies(readSrc('ClientLogic.html'))[0];
  var previewScripts = extractScriptBodies(readPreview());
  assert.ok(srcScript, '找不到 src/ClientLogic.html 的 <script>');
  // stats-preview.html 依序內嵌：__mockData/__mockApi、ClientLogic、App 三段 <script>
  assert.ok(previewScripts.length >= 3, 'stats-preview.html 應至少含 3 個 <script> 區塊');
  assert.strictEqual(previewScripts[1], srcScript, 'stats-preview.html 內嵌的 ClientLogic 內容跟 src/ClientLogic.html 不同步，請重新複製更新');
});

t('stats-preview.html 內嵌的 App <script> 與 src/App.html 逐字相同', () => {
  var srcScript = extractScriptBodies(readSrc('App.html'))[0];
  var previewScripts = extractScriptBodies(readPreview());
  assert.ok(srcScript, '找不到 src/App.html 的 <script>');
  assert.ok(previewScripts.length >= 3, 'stats-preview.html 應至少含 3 個 <script> 區塊');
  assert.strictEqual(previewScripts[2], srcScript, 'stats-preview.html 內嵌的 App 內容跟 src/App.html 不同步，請重新複製更新');
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
