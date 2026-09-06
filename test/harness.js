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

function loadGs(files, extraGlobals) {
  let uuidCounter = 0;
  const utilities = Object.assign({}, Utilities, {
    getUuid: function() { uuidCounter++; return 'uuid-' + String(uuidCounter).padStart(4, '0'); }
  });
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; } }) };
  const ctx = Object.assign({ Utilities: utilities, Logger, LockService, console, SpreadsheetApp: {}, PropertiesService: {} }, extraGlobals || {});
  vm.createContext(ctx);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

module.exports = { loadGs, Utilities };
