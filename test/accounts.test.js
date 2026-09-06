const assert = require('assert');
const { loadGs } = require('./harness');
const gs = loadGs(['SheetService.gs', 'Config.gs']);
let failed = 0;
function t(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); } }

function accountSheet(rows) {
  const data = [['帳戶名稱','金融機構','幣別','初始餘額','初始日期','備註','是否啟用','帳戶類型','扣款帳戶','帳號識別']].concat(rows);
  return {
    _data: data, getLastRow: () => data.length,
    getRange: (a, c, nr, nc) => {
      if (typeof a === 'string') {
        const col = a.charCodeAt(0) - 64, r = Number(a.slice(1));
        return { getValue: () => (data[r - 1] || [])[col - 1] || '', setValues: (v) => { for (let j = 0; j < v[0].length; j++) data[r - 1][col - 1 + j] = v[0][j]; } };
      }
      return {
        getValues: () => data.slice(a - 1, a - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; }),
        setValues: (vals) => { for (let i = 0; i < vals.length; i++) { const row = data[a - 1 + i] || (data[a - 1 + i] = []); for (let j = 0; j < vals[i].length; j++) row[c - 1 + j] = vals[i][j]; } }
      };
    }
  };
}
const ss = (sheet) => ({ getSheetByName: () => sheet });

t('getAccounts 讀 H/I/J，type 推斷，J 欄多識別', () => {
  const a = gs.getAccounts(ss(accountSheet([
    ['永豐信用卡','永豐銀行','TWD','','','',true,'信用卡','永豐大戶',''],
    ['玉山','玉山銀行','TWD','','','',true,'','','0015977, 0381979'],
    ['現金','現金','TWD','','','',true,'','','']
  ])));
  assert.strictEqual(a[0].type, '信用卡'); assert.strictEqual(a[0].debitAccount, '永豐大戶');
  assert.strictEqual(a[1].type, '銀行'); assert.deepStrictEqual(a[1].accountNumberHints, ['0015977', '0381979']);
  assert.strictEqual(a[2].type, '現金');
});
t('DEFAULT_ACCOUNTS 21 筆，含永豐信用卡外幣 USD', () => {
  assert.strictEqual(gs.DEFAULT_ACCOUNTS.length, 21);
  const r = gs.DEFAULT_ACCOUNTS.find(x => x[0] === '永豐信用卡外幣');
  assert.strictEqual(r[2], 'USD'); assert.strictEqual(r[7], '信用卡'); assert.strictEqual(r[8], '永豐大戶');
});
t('upsertDefaultAccounts 補標題與缺少帳戶，不覆蓋既有', () => {
  const sheet = accountSheet([['現金','現金','TWD',1000,'2026/01/01','',true,'','','']]);
  sheet._data[0] = sheet._data[0].slice(0, 7);
  assert.strictEqual(gs.upsertDefaultAccounts(ss(sheet)), 20);
  assert.strictEqual(sheet._data[0][7], '帳戶類型'); assert.strictEqual(sheet._data[1][3], 1000);
});
t('findAccountByName 正規化', () => {
  assert.strictEqual(gs.findAccountByName([{ name: 'LineBank' }], 'LINE Bank').name, 'LineBank');
  assert.strictEqual(gs.findAccountByName([{ name: 'LineBank' }], 'x'), null);
});
console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
