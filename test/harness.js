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
function loadGs(files, extraGlobals) {
  let uuidCounter = 0;
  const utilities = Object.assign({}, Utilities, {
    getUuid: function() { uuidCounter++; return 'uuid-' + String(uuidCounter).padStart(4, '0'); }
  });
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; } }) };
  const injected = Object.assign({ Utilities: utilities, Logger, LockService, SpreadsheetApp: {}, PropertiesService: {} }, extraGlobals || {});

  // 注意：.gs 內的函式彼此、以及對 Utilities/Logger 等的參照都是在呼叫當下
  // 透過 global 解析的自由變數（非閉包捕捉），所以這裡刻意「不」在回傳前清除
  // global 上的注入物件與載入的函式 —— 每個測試檔各自獨立 process（見 run-all.js），
  // 留在 global 上不會互相汙染。
  const injectedKeys = Object.keys(injected);
  injectedKeys.forEach(function(k) { global[k] = injected[k]; });

  const beforeKeys = new Set(Object.getOwnPropertyNames(global));

  files.forEach(function(f) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    vm.runInThisContext(code, { filename: f });
  });

  const result = {};
  Object.getOwnPropertyNames(global).forEach(function(k) {
    if (!beforeKeys.has(k)) { result[k] = global[k]; }
  });
  injectedKeys.forEach(function(k) { result[k] = injected[k]; });

  return result;
}

module.exports = { loadGs, Utilities };
