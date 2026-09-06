const assert = require('assert');
const { loadGs } = require('./harness');
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

loadGs(['SheetService.gs', 'Config.gs']);
const gs2 = loadGs(['SheetService.gs']);

t('loadGs 兩次呼叫，第二次 Utilities.getUuid 重新從 0001 起算', () => {
  assert.strictEqual(gs2.Utilities.getUuid(), 'uuid-0001');
});
t('loadGs 第二次未載入 Config.gs，DEFAULT_ACCOUNTS 不殘留在 global', () => {
  assert.strictEqual(typeof DEFAULT_ACCOUNTS, 'undefined');
});
t('loadGs 第二次仍正確載入 SheetService.gs 的 getAccounts', () => {
  assert.strictEqual(typeof getAccounts, 'function');
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
