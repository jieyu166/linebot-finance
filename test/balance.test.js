const assert = require('assert');
const { loadGs } = require('./harness');

const gs = loadGs(['SheetService.gs', 'Main.gs']);

function acct(over) {
  return Object.assign({ name: '永豐大戶', institution: '永豐銀行', currency: 'TWD', initialBalance: 200000, initialDate: '2026/01/01', note: '', active: true }, over);
}
// 交易列 A-I: 日期, 機構, 帳戶, 類型, 分類, 品項, 明細, 幣別, 金額
function row(date, inst, account, type, cat, amount, currency) {
  return [date, inst, account, type, cat, '', '', currency || 'TWD', amount, '', '', ''];
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

t('繳信用卡 計入（視為一般支出）', () => {
  const r = gs.calculateBalanceFromRows(acct(), [row('2026/01/15', '永豐銀行', '永豐大戶', '支出', '繳信用卡', 5000)]);
  assert.strictEqual(r.txCount, 1);
  assert.strictEqual(r.transactionTotal, -5000);
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

t('formatBalanceLine：信用卡顯示「未繳」', () => {
  const line = gs.formatBalanceLine({ name: '永豐信用卡', type: '信用卡', currency: 'TWD', currentBalance: -0 });
  assert.strictEqual(line, '永豐信用卡：未繳 $0');
});

t('formatBalanceLine：銀行帳戶一般顯示', () => {
  const line = gs.formatBalanceLine({ name: '永豐大戶', type: '銀行', currency: 'TWD', currentBalance: 0 });
  assert.strictEqual(line, '永豐大戶：$0');
});

t('formatBalanceLine：外幣顯示幣別與小數', () => {
  const line = gs.formatBalanceLine({ name: '永豐外幣', type: '銀行', currency: 'USD', currentBalance: 0 });
  assert.strictEqual(line, '永豐外幣：$1,858.62 USD');
});

t('buildAllBalancesReply：分區【資產】【信用卡】', () => {
  const balances = [
    { name: '永豐大戶', type: '銀行', currency: 'TWD', currentBalance: 0 },
    { name: '永豐信用卡', type: '信用卡', currency: 'TWD', currentBalance: -0 },
  ];
  const reply = gs.buildAllBalancesReply(balances, '2026/09/06');
  const expected = '💰 帳戶餘額一覽（2026/09/06）'
    + '\n【資產】'
    + '\n永豐大戶：$0'
    + '\n【信用卡】'
    + '\n永豐信用卡：未繳 $0'
    + '\n共 2 個帳戶';
  assert.strictEqual(reply, expected);
});

t('buildAllBalancesReply：無信用卡帳戶時省略該分區標題', () => {
  const balances = [{ name: '永豐大戶', type: '銀行', currency: 'TWD', currentBalance: 0 }];
  const reply = gs.buildAllBalancesReply(balances, '2026/09/06');
  const expected = '💰 帳戶餘額一覽（2026/09/06）'
    + '\n【資產】'
    + '\n永豐大戶：$0'
    + '\n共 1 個帳戶';
  assert.strictEqual(reply, expected);
});

// ===== listAccountTransactions / auditBalances：帳戶管理 + 交易紀錄雙工作表假物件 =====

function accountsSheet(rows) {
  const data = [['帳戶名稱','金融機構','幣別','初始餘額','初始日期','備註','是否啟用','帳戶類型','扣款帳戶','帳號識別']].concat(rows);
  return {
    _data: data, getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; })
    })
  };
}
function txSheet(rows) {
  const data = [['日期','金融機構','帳戶名稱','類型','分類','品項','明細描述','幣別','金額','來源','ID','轉帳ID']].concat(rows);
  return {
    _data: data, getLastRow: () => data.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => { const o = []; for (let i = 0; i < nc; i++) o.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return o; })
    })
  };
}
// 交易列 A-L：日期, 機構, 帳戶, 類型, 分類, 品項, 明細, 幣別, 金額, 來源, ID, 轉帳ID
function txRow(date, inst, account, type, cat, item, amount, source, transferId) {
  return [date, inst, account, type, cat, item || '', '', 'TWD', amount, source || '', '', transferId || ''];
}
function twoSheetSs(accounts, transactions) {
  const sheets = { '帳戶管理': accountsSheet(accounts), '交易紀錄': txSheet(transactions) };
  return { getSheetByName: (n) => sheets[n] };
}

t('listAccountTransactions：只回傳 shouldIncludeTransaction 納入的列，依日期排序', () => {
  const ss = twoSheetSs(
    [['永豐大戶','永豐銀行','TWD',200000,'2026/01/01','',true,'銀行','','']],
    [
      txRow('2026/03/05', '永豐銀行', '永豐大戶', '支出', '飲食', '晚餐', 3000, 'App', ''),
      txRow('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', '午餐', 500, 'PDF匯入', ''),
      txRow('2026/01/01', '永豐銀行', '永豐大戶', '支出', '飲食', '排除：初始日當天', 100, 'App', ''), // 初始日當天，應排除
      txRow('2026/02/10', '永豐銀行', '永豐大戶', '收入', '利息', '', 2000, '自動配對', 'tf-12345678'),
      txRow('2026/01/20', '國泰銀行', '國泰', '支出', '購物', '不屬於此帳戶', 999, 'App', ''), // 不同帳戶，應排除
    ]
  );
  const list = gs.listAccountTransactions('永豐大戶', ss);
  assert.strictEqual(list.length, 3);
  assert.deepStrictEqual(list.map(t => t.date), ['2026/01/15', '2026/02/10', '2026/03/05']);
  assert.strictEqual(list[0].rowIndex, 3); // 第 3 列 = 1/15 那筆（第 2 列是 3/5）
  assert.strictEqual(list[1].transferId, 'tf-12345678');
  assert.strictEqual(list[1].category, '利息');
  assert.strictEqual(list[2].item, '晚餐');
});

t('listAccountTransactions：找不到帳戶回傳空陣列', () => {
  const ss = twoSheetSs([['永豐大戶','永豐銀行','TWD',0,'','',true,'銀行','','']], []);
  assert.deepStrictEqual(gs.listAccountTransactions('不存在的帳戶', ss), []);
});

t('auditBalances：各帳戶收支合計、來源分布、分類金額分布', () => {
  const ss = twoSheetSs(
    [
      ['永豐大戶','永豐銀行','TWD',200000,'2026/01/01','',true,'銀行','',''],
      ['永豐信用卡','永豐銀行','TWD',-5000,'','',true,'信用卡','永豐大戶','']
    ],
    [
      txRow('2026/01/15', '永豐銀行', '永豐大戶', '支出', '飲食', '午餐', 500, 'PDF匯入', ''),
      txRow('2026/02/10', '永豐銀行', '永豐大戶', '收入', '利息', '', 2000, '自動配對', ''),
      txRow('2026/03/01', '永豐銀行', '永豐大戶', '支出', '飲食', '晚餐', 300, '', ''), // 來源空白 → 手動
      txRow('2026/01/05', '永豐銀行', '永豐信用卡', '支出', '購物', 'A', 1000, 'App', ''),
      txRow('2026/01/06', '永豐銀行', '永豐信用卡', '支出', '購物', 'B', 500, 'App', ''),
    ]
  );
  const audits = gs.auditBalances(ss);
  const dahu = audits.find(a => a.name === '永豐大戶');
  assert.strictEqual(dahu.txCount, 3);
  assert.strictEqual(dahu.income, 2000);
  assert.strictEqual(dahu.expense, 800);
  assert.strictEqual(dahu.currentBalance, 200000 + 2000 - 800);
  assert.strictEqual(dahu.bySource['PDF匯入'], 1);
  assert.strictEqual(dahu.bySource['自動配對'], 1);
  assert.strictEqual(dahu.bySource['手動'], 1);
  assert.strictEqual(dahu.byCategory['飲食'], 800);

  const card = audits.find(a => a.name === '永豐信用卡');
  assert.strictEqual(card.txCount, 2);
  assert.strictEqual(card.expense, 1500);
  assert.strictEqual(card.bySource['App'], 2);
  assert.strictEqual(card.byCategory['購物'], 1500);
});

console.log(failed ? `\n${failed} 個測試失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
