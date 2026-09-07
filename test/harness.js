// 本機測試用：把 .gs 檔載入 Node，stub 掉 GAS 全域物件
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function pad(n) { return String(n).padStart(2, '0'); }

const Utilities = {
  formatDate: function(date, tz, fmt) {
    // 以 Asia/Taipei 格式化（用 Intl 模擬 GAS 行為）
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = t => parts.find(p => p.type === t).value;
    return get('year') + '/' + get('month') + '/' + get('day');
  }
};

const Logger = { log: function(m) { console.log('[Logger]', m); } };

// 用 vm.runInThisContext（而非 vm.createContext）執行 .gs 檔，讓程式碼與測試檔共用同一份
// Array/Object 等內建原型 —— 避免 createContext 產生的獨立 realm 造成
// assert.deepStrictEqual 對陣列/物件比對時「結構相同但非同一 realm」而判定失敗。
//
// 注意：.gs 內的函式彼此、以及對 Utilities/Logger 等的參照都是在呼叫當下
// 透過 global 解析的自由變數（非閉包捕捉），所以這些注入物件與載入的函式
// 必須留在 global 上才能運作。多數測試檔各自獨立 process（見 run-all.js），
// 不會互相汙染；但同一個測試檔若呼叫 loadGs 兩次（例如用不同的檔案清單），
// 前一次留下的 global 就會汙染後一次 —— 所以這裡記錄上一次呼叫加到 global 上的
// 所有 key，下一次呼叫開頭先清掉，再重新載入。
let previousKeys = [];

// .gs 檔頂層的 `var x = ...` 經 vm.runInThisContext 執行後，會變成 global 上
// 「不可設定（non-configurable）」的屬性（跟直接 script 裡宣告 var 一樣），
// delete global.x 會靜默失敗、屬性還在。所以刪不掉就退而求其次設成 undefined，
// 讓 typeof x === 'undefined' 成立，效果等同重置。
function clearGlobal(k) {
  if (delete global[k]) { return; }
  global[k] = undefined;
}

function loadGs(files, extraGlobals) {
  previousKeys.forEach(clearGlobal);

  let uuidCounter = 0;
  const utilities = Object.assign({}, Utilities, {
    getUuid: function() { uuidCounter++; return 'uuid-' + String(uuidCounter).padStart(4, '0'); }
  });
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; } }) };
  const HtmlService = {
    createTemplateFromFile: function(name) {
      return { evaluate: function() { return { setTitle: function() { return this; }, addMetaTag: function() { return this; }, _name: name }; } };
    },
    createHtmlOutputFromFile: function(name) {
      return { getContent: function() { return '<!--' + name + '-->'; } };
    }
  };
  const ContentService = { createTextOutput: function(s) { return { _text: s }; } };
  const injected = Object.assign({ Utilities: utilities, Logger, LockService, HtmlService, ContentService, SpreadsheetApp: {}, PropertiesService: {} }, extraGlobals || {});

  const injectedKeys = Object.keys(injected);
  injectedKeys.forEach(function(k) { global[k] = injected[k]; });

  const beforeNames = Object.getOwnPropertyNames(global);
  const beforeKeys = new Set(beforeNames);
  // 記錄執行前每個既有 key 的值，用來偵測「非可設定、被 clearGlobal 設成
  // undefined 而殘留」的 key 在這次執行後是否被重新賦值（見下方組回傳物件說明）。
  const beforeValues = {};
  beforeNames.forEach(function(k) { beforeValues[k] = global[k]; });

  files.forEach(function(f) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  });

  const result = {};
  Object.getOwnPropertyNames(global).forEach(function(k) {
    if (!beforeKeys.has(k)) {
      // 這次執行前不存在的 key —— 這次新增的。
      result[k] = global[k];
    } else if (beforeValues[k] === undefined && global[k] !== undefined) {
      // 這次執行前已存在但值是 undefined（.gs 頂層 var/function 宣告在
      // vm.runInThisContext 下是 global 上不可設定的屬性，前一次 loadGs 呼叫
      // 開頭的 clearGlobal 刪不掉、只能設成 undefined），這次重新載入後又
      // 被賦值了，同樣視為這次載入的產物。
      result[k] = global[k];
    }
  });
  injectedKeys.forEach(function(k) { result[k] = injected[k]; });

  previousKeys = Object.keys(result);

  return result;
}

// 載入 src/<file>（HtmlService include），取出所有 <script>…</script> 內容，
// 依序用 vm.runInThisContext 執行，讓 <script> 內對 window.CL 的賦值落在
// global 上（global.window = global），回傳 global 供測試檔取用。
function loadHtmlScript(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
  const scripts = [];
  html.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (m, body) => { scripts.push(body); return m; });
  global.window = global;
  scripts.forEach((s, i) => vm.runInThisContext(s, { filename: file + '#' + i }));
  return global;
}

module.exports = { loadGs, loadHtmlScript, Utilities };
