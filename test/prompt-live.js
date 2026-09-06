// 實打 OpenAI API 的手動驗證腳本（不在 npm test 中執行）
//
//   node test/prompt-live.js sinopac-bank-2026-08
//
// 讀專案根目錄 .env 的 OPENAI_API_KEY；沒有就略過不跑。
// 以 curl（child_process.execSync）實作 UrlFetchApp.fetch stub，
// 對 test/fixtures/<name>.txt 跑 parsePdfWithOpenAI，印出每筆交易與
// 依「帳戶／幣別」的筆數與合計，供人工對照 <name>.expected.md。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { loadGs } = require('./harness');

const ROOT = path.join(__dirname, '..');

function readEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) { return {}; }
  const env = {};
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(function(line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) { env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
  });
  return env;
}

const apiKey = readEnv().OPENAI_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.log('略過：找不到 OPENAI_API_KEY（請在專案根目錄 .env 設定）');
  process.exit(0);
}

const name = (process.argv[2] || '').replace(/\.txt$/, '');
if (!name) {
  console.log('用法：node test/prompt-live.js <fixture 名稱，如 sinopac-bank-2026-08>');
  process.exit(1);
}
const fixturePath = path.join(__dirname, 'fixtures', name + '.txt');
if (!fs.existsSync(fixturePath)) {
  console.log('找不到 fixture：' + fixturePath);
  process.exit(1);
}

// --- UrlFetchApp stub：走 curl，金鑰放在 curl config 檔而非命令列參數 ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-live-'));
function fwd(p) { return p.replace(/\\/g, '/'); }

function curlFetch(url, options) {
  const payloadFile = path.join(tmpDir, 'payload.json');
  const outFile = path.join(tmpDir, 'response.json');
  const cfgFile = path.join(tmpDir, 'curl.cfg');
  fs.writeFileSync(payloadFile, options.payload, 'utf8');
  fs.writeFileSync(cfgFile, [
    'url = "' + url + '"',
    'request = "POST"',
    'header = "Authorization: Bearer ' + apiKey + '"',
    'header = "Content-Type: application/json"',
    'data-binary = "@' + fwd(payloadFile) + '"',
    'output = "' + fwd(outFile) + '"',
    'silent',
    'show-error'
  ].join('\n'), 'utf8');

  let code;
  try {
    code = execSync('curl -K "' + fwd(cfgFile) + '" -w "%{http_code}"', { encoding: 'utf8' }).trim();
  } finally {
    fs.unlinkSync(cfgFile); // config 內含金鑰，用完立刻刪除
  }
  const body = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  return {
    getResponseCode: function() { return Number(code); },
    getContentText: function() { return body; }
  };
}

const gs = loadGs(['SheetService.gs', 'TransferService.gs', 'Config.gs', 'OpenAIService.gs'], {
  PropertiesService: { getScriptProperties: function() { return { getProperty: function() { return apiKey; } }; } },
  UrlFetchApp: { fetch: curlFetch }
});

// --- 帳戶清單：由 DEFAULT_ACCOUNTS 轉成 getAccounts() 產出的物件形狀 ---
const accounts = gs.DEFAULT_ACCOUNTS.map(function(row) {
  return {
    name: String(row[0] || '').trim(),
    institution: String(row[1] || '').trim(),
    currency: String(row[2] || 'TWD').trim() || 'TWD',
    initialBalance: 0,
    initialDate: '',
    note: String(row[5] || '').trim(),
    active: row[6] === true,
    type: String(row[7] || '').trim(),
    debitAccount: String(row[8] || '').trim(),
    accountNumberHints: String(row[9] || '').split(/[,，、]/)
      .map(function(s) { return s.trim(); })
      .filter(function(s) { return s !== ''; })
  };
});

const EXPENSE = ['飲食', '交通', '購物', '娛樂', '醫療', '學習', '居家', '手續費', '轉帳', '貸款', '繳信用卡', '投資', '父母', '其他'];
const INCOME = ['薪資', '獎金', '回饋', '利息', '股利', '投資獲利', '轉帳', '其他'];

const text = gs.stripGarbledLines(fs.readFileSync(fixturePath, 'utf8'));
console.log('=== fixture: ' + name + '（過濾後 ' + text.split('\n').length + ' 行）===');

const result = gs.parsePdfWithOpenAI(text, EXPENSE, INCOME, accounts);

console.log('bank: ' + result.bank + ' / statementType: ' + result.statementType + ' / skipped: ' + result.skipped);
if ((result.unmatchedAccountNumbers || []).length > 0) {
  console.log('未對應帳號: ' + result.unmatchedAccountNumbers.join(', '));
}
console.log('');

const txs = result.transactions || [];
txs.forEach(function(tx, i) {
  console.log([
    String(i + 1).padStart(3, ' '),
    tx.date,
    tx.type,
    tx.category,
    tx.account + '(' + tx.currency + ')',
    String(tx.amount) + (tx.fxAmount ? ' [fx ' + tx.fxAmount + ']' : ''),
    tx.item,
    tx.description
  ].join(' | '));
});

console.log('\n--- 依帳戶／幣別統計 ---');
const groups = {};
txs.forEach(function(tx) {
  const key = (tx.account || '(未對應)') + ' / ' + tx.currency;
  if (!groups[key]) { groups[key] = { count: 0, income: 0, expense: 0 }; }
  groups[key].count++;
  if (tx.type === '收入') { groups[key].income += Number(tx.amount) || 0; }
  else { groups[key].expense += Number(tx.amount) || 0; }
});
Object.keys(groups).sort().forEach(function(k) {
  const g = groups[k];
  console.log(k + '：' + g.count + ' 筆，支出合計 ' + Math.round(g.expense * 100) / 100 + '，收入合計 ' + Math.round(g.income * 100) / 100);
});
console.log('總計 ' + txs.length + ' 筆');
