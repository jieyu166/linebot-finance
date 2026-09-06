const assert = require('assert');
const { loadGs } = require('./harness');

const gs = loadGs(['SheetService.gs', 'Main.gs']);

function acct(over) {
  return Object.assign({ name: '永豐大戶', institution: '永豐銀行', currency: 'TWD', initialBalance: 200000, initialDate: '2026/01/01', note: '', active: true }, over);
}
// 交易列 A-I: 日期, 機構, 帳戶, 類型, 分類, 品項, 明細, 幣別, 金額
function row(date, inst, account, type, cat, amount, currency) {
  return [date, inst, account, type, cat, '', '', currency || 'TWD', amount];
}

let failed = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n   ', e.message); }
}

t('規格範例：初始 200000 + 3 筆', () => {
  const r = gs.calculateBalanceFromRows(acct(), [
    row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', 5000),
    row('2026/02/10', '永豐銀行', '永豐大戶', '收入', '利息', 2000),
    row('2026/03/05', '永豐銀行', '永豐大戶', '支出', '飲食', 3000),
  ]);
  assert.strictEqual(r.currentBalance, 194000);
  assert.strictEqual(r.txCount, 3);
});

t('初始日期當天排除', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/01', '永豐銀行', '永豐大戶', '支出', '飲食', 1000)]);
  assert.strictEqual(r.txCount, 0);
});

t('舊資料：帳戶欄空白但機構=永豐銀行 應計入（機構唯一對應）', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/15', '永豐銀行', '', '支出', '飲食', 5000)]);
  assert.strictEqual(r.txCount, 1);
});

t('帳戶欄填機構全名（OpenAI 未照清單）應計入', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/15', '永豐銀行', '永豐銀行', '支出', '飲食', 5000)]);
  assert.strictEqual(r.txCount, 1);
});

t('LineBank vs LINE Bank 大小寫空白差異應計入', () => {
  const a = acct({ name: 'LineBank', institution: 'LINE Bank', initialBalance: 0, initialDate: '' });
  const r = gs.calculateBalanceFromRows(a, [row('2026/01/15', 'LINE Bank', 'LINE Bank', '支出', '飲食', 100)]);
  assert.strictEqual(r.txCount, 1);
});

t('金額為含逗號字串 "1,234" 應解析為 1234', () => {
  const r = gs.calculateBalanceFromRows(acct({ initialDate: '' }), [row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', '1,234')]);
  assert.strictEqual(r.transactionTotal, -1234);
});

t('金額為負數的支出（帳單匯入負號）取絕對值', () => {
  const r = gs.calculateBalanceFromRows(acct({ initialDate: '' }), [row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', -500)]);
  assert.strictEqual(r.transactionTotal, -500);
});

t('日期為 Date 物件（試算表自動轉換）且腳本時區為非台北時仍正確比較', () => {
  // Windows Node 不吃 TZ 環境變數，改用 monkeypatch 模擬 GAS 腳本時區 = America/Los_Angeles：
  // 2026/01/01 00:00 台北 = 2025/12/31 08:00 洛杉磯 → 本地 getter 會少一天
  function laDate(utcMs) {
    const d = new Date(utcMs);
    const la = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const get = t => Number(la.find(p => p.type === t).value);
    d.getFullYear = () => get('year');
    d.getMonth = () => get('month') - 1;
    d.getDate = () => get('day');
    return d;
  }
  const sameDay = laDate(Date.UTC(2025, 11, 31, 16)); // 2026/01/01 台北（=初始日，應排除）
  const nextDay = laDate(Date.UTC(2026, 0, 1, 16));   // 2026/01/02 台北（應計入）
  const r = gs.calculateBalanceFromRows(acct(), [
    row(sameDay, '永豐銀行', '永豐大戶', '支出', '飲食', 100),
    row(nextDay, '永豐銀行', '永豐大戶', '支出', '飲食', 200),
  ]);
  assert.strictEqual(r.transactionTotal, -200, 'total=' + r.transactionTotal);
});

t('幣別不同不計入', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', 5000, 'USD')]);
  assert.strictEqual(r.txCount, 0);
});

t('繳信用卡 排除', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '繳信用卡', 5000)]);
  assert.strictEqual(r.txCount, 0);
});

t('現金：帳戶空白且機構空白視為現金', () => {
  const a = acct({ name: '現金', institution: '現金', initialBalance: 1000, initialDate: '' });
  const r = gs.calculateBalanceFromRows(a, [row('2026/01/15', '', '', '支出', '飲食', 80)]);
  assert.strictEqual(r.currentBalance, 920);
});

t('detectBalanceCommand 基本', () => {
  assert.strictEqual(JSON.stringify(gs.detectBalanceCommand('餘額')), JSON.stringify({ isCommand: true, accountName: null }));
  assert.strictEqual(JSON.stringify(gs.detectBalanceCommand('永豐大戶餘額')), JSON.stringify({ isCommand: true, accountName: '永豐大戶' }));
  assert.strictEqual(JSON.stringify(gs.detectBalanceCommand('餘額 玉山')), JSON.stringify({ isCommand: true, accountName: '玉山' }));
  assert.strictEqual(JSON.stringify(gs.detectBalanceCommand('午餐80')), JSON.stringify({ isCommand: false, accountName: null }));
});

t('getAccounts：初始餘額為 "200,000" 字串應解析', () => {
  const sheet = { getLastRow: () => 2, getRange: () => ({ getValues: () => [['永豐大戶', '永豐銀行', 'TWD', '200,000', '2026/01/01', '', true]] }) };
  const ss = { getSheetByName: () => sheet };
  const a = gs.getAccounts(ss);
  assert.strictEqual(a[0].initialBalance, 200000);
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
