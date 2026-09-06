/**
 * Config.gs — Script Properties 存取與初始化
 */

/** 帳戶管理工作表標題（10 欄） */
var ACCOUNT_HEADERS = ['帳戶名稱', '金融機構', '幣別', '初始餘額', '初始日期', '備註', '是否啟用', '帳戶類型', '扣款帳戶', '帳號識別'];

/** 21 個預設帳戶：[名稱, 機構, 幣別, 初始餘額, 初始日期, 備註, 是否啟用, 類型, 扣款帳戶, 帳號識別] */
var DEFAULT_ACCOUNTS = [
  ['現金', '現金', 'TWD', '', '', '', true, '現金', '', ''],
  ['一銀', '第一銀行', 'TWD', '', '', '', true, '銀行', '', '630'],
  ['一銀信用卡', '第一銀行', 'TWD', '', '', '綠活卡＋iLEO 同一帳單', true, '信用卡', '一銀', ''],
  ['LineBank', 'LINE Bank', 'TWD', '', '', '簽帳卡走銀行明細', true, '銀行', '', ''],
  ['王道', '王道銀行', 'TWD', '', '', '簽帳卡走銀行明細', true, '銀行', '', ''],
  ['永豐大戶', '永豐銀行', 'TWD', '', '', '', true, '銀行', '', '198-01'],
  ['永豐信用卡', '永豐銀行', 'TWD', '', '', '大戶卡＋幣倍卡＋大衛卡 同一帳單', true, '信用卡', '永豐大戶', ''],
  ['永豐信用卡外幣', '永豐銀行', 'USD', '', '', '雙幣卡美元帳單', true, '信用卡', '永豐大戶', ''],
  ['永豐證券', '永豐銀行', 'TWD', '', '', '交割戶', true, '證券', '永豐大戶', '042-01'],
  ['永豐外幣', '永豐銀行', 'USD', '', '', '', true, '銀行', '', '042-00'],
  ['玉山', '玉山銀行', 'TWD', '', '', '', true, '銀行', '', '0015977,0381979'],
  ['玉山信用卡', '玉山銀行', 'TWD', '', '', 'UBear 卡', true, '信用卡', '玉山', ''],
  ['台新', '台新銀行', 'TWD', '', '', 'Richart', true, '銀行', '', '288810,288815,288818'],
  ['台新信用卡', '台新銀行', 'TWD', '', '', 'Richart 卡', true, '信用卡', '台新', ''],
  ['中信', '中國信託', 'TWD', '', '', '網頁複製文字匯入', true, '銀行', '', ''],
  ['中信信用卡', '中國信託', 'TWD', '', '', '中信 Line 卡', true, '信用卡', '中信', ''],
  ['富邦', '富邦銀行', 'TWD', '', '', '', true, '銀行', '', ''],
  ['富邦信用卡', '富邦銀行', 'TWD', '', '', 'Costco 卡', true, '信用卡', '富邦', ''],
  ['國泰', '國泰銀行', 'TWD', '', '', '', true, '銀行', '', ''],
  ['國泰信用卡', '國泰銀行', 'TWD', '', '', 'Cube 卡', true, '信用卡', '國泰', ''],
  ['樂天', '樂天銀行', 'TWD', '', '', '', true, '銀行', '', '']
];

/**
 * 取得 Script Properties 中的設定值
 * @param {string} key - 屬性名稱
 * @returns {string} 屬性值
 */
function getConfig(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * 初始化 Script Properties
 * 首次使用時手動執行一次，請先將下方值替換為實際的金鑰和 ID
 */
function initializeProperties() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'OPENAI_API_KEY': '請替換為你的 OpenAI API Key',
    'LINE_CHANNEL_SECRET': '請替換為你的 LINE Channel Secret',
    'LINE_CHANNEL_ACCESS_TOKEN': '請替換為你的 LINE Channel Access Token',
    'SHEET_ID': '請替換為你的 Google 試算表 ID'
  });
  Logger.log('Script Properties 已初始化，請確認已替換為實際值');
}

/**
 * 初始化試算表結構
 * 首次使用時手動執行一次，建立所有需要的工作表
 */
function initializeSheets() {
  var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));

  // 建立「交易紀錄」工作表
  var txSheet = ss.getSheetByName('交易紀錄');
  if (!txSheet) {
    txSheet = ss.insertSheet('交易紀錄');
    txSheet.getRange('A1:L1').setValues([['日期', '金融機構', '帳戶名稱', '類型', '分類', '品項', '明細描述', '幣別', '金額', '原始訊息', 'ID', '轉帳ID']]);
    txSheet.setFrozenRows(1);
  } else if (txSheet.getRange('K1').getValue() !== 'ID') {
    txSheet.getRange('K1:L1').setValues([['ID', '轉帳ID']]);
  }

  // 建立「支出分類」工作表
  var expSheet = ss.getSheetByName('支出分類');
  if (!expSheet) {
    expSheet = ss.insertSheet('支出分類');
    expSheet.getRange('A1').setValue('分類名稱');
    var expCategories = [
      ['飲食'], ['服飾'], ['家庭'], ['交通'], ['學習'],
      ['休閒'], ['購物'], ['醫療'], ['其他'], ['保險'],
      ['手續費'], ['稅金'], ['工作'], ['父母'], ['老婆'],
      ['買房'], ['紅包'], ['投資'], ['轉帳'], ['貸款'],
      ['繳信用卡']
    ];
    expSheet.getRange(2, 1, expCategories.length, 1).setValues(expCategories);
    expSheet.setFrozenRows(1);
  }

  // 建立「收入分類」工作表
  var incSheet = ss.getSheetByName('收入分類');
  if (!incSheet) {
    incSheet = ss.insertSheet('收入分類');
    incSheet.getRange('A1').setValue('分類名稱');
    var incCategories = [
      ['薪資'], ['利息'], ['兼職'], ['獎金'], ['回饋'],
      ['投資獲利'], ['股利'], ['家人給'], ['保險'], ['其他']
    ];
    incSheet.getRange(2, 1, incCategories.length, 1).setValues(incCategories);
    incSheet.setFrozenRows(1);
  }

  // 分類表補「圖示」「顏色」欄與收入分類「轉帳」項目
  if (expSheet && String(expSheet.getRange('B1').getValue()) !== '圖示') {
    expSheet.getRange('B1:C1').setValues([['圖示', '顏色']]);
  }
  if (incSheet && String(incSheet.getRange('B1').getValue()) !== '圖示') {
    incSheet.getRange('B1:C1').setValues([['圖示', '顏色']]);
  }
  if (incSheet) {
    var incLastRow = incSheet.getLastRow();
    var hasTransfer = false;
    if (incLastRow >= 2) {
      var incNames = incSheet.getRange(2, 1, incLastRow - 1, 1).getValues();
      for (var ii = 0; ii < incNames.length; ii++) {
        if (String(incNames[ii][0] || '').trim() === '轉帳') { hasTransfer = true; break; }
      }
    }
    if (!hasTransfer) { incSheet.appendRow(['轉帳']); }
  }

  // 建立「帳戶管理」工作表（已存在時不覆蓋使用者填入的初始餘額）
  var accountSheet = ss.getSheetByName('帳戶管理');
  if (!accountSheet) {
    accountSheet = ss.insertSheet('帳戶管理');
    accountSheet.getRange(1, 1, 1, ACCOUNT_HEADERS.length).setValues([ACCOUNT_HEADERS]);
    accountSheet.getRange(2, 1, DEFAULT_ACCOUNTS.length, ACCOUNT_HEADERS.length).setValues(DEFAULT_ACCOUNTS);
    accountSheet.setFrozenRows(1);
  } else {
    upsertDefaultAccounts(ss);
  }

  // 建立「預算」工作表
  var budgetSheet = ss.getSheetByName('預算');
  if (!budgetSheet) {
    budgetSheet = ss.insertSheet('預算');
    budgetSheet.getRange('A1:C1').setValues([['類型', '名稱', '月預算']]);
    budgetSheet.setFrozenRows(1);
  }

  Logger.log('試算表結構已初始化');
}

/**
 * 補齊帳戶管理工作表的 H/I/J 欄標題與缺少的預設帳戶，不覆蓋既有資料
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 新增的帳戶筆數
 */
function upsertDefaultAccounts(ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('帳戶管理');
  if (String(sheet.getRange('H1').getValue()) !== '帳戶類型') {
    sheet.getRange(1, 8, 1, 3).setValues([['帳戶類型', '扣款帳戶', '帳號識別']]);
  }
  var lastRow = sheet.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(row) { existing[normalizeName(row[0])] = true; });
  }
  var missing = DEFAULT_ACCOUNTS.filter(function(row) { return !existing[normalizeName(row[0])]; });
  if (missing.length > 0) { sheet.getRange(lastRow + 1, 1, missing.length, ACCOUNT_HEADERS.length).setValues(missing); }
  Logger.log('帳戶管理新增 ' + missing.length + ' 筆');
  return missing.length;
}

/**
 * 為交易紀錄中缺少 ID 的既有列補上 UUID
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 補上的筆數
 */
function backfillTransactionIds(ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { return 0; }
  var range = sheet.getRange(2, 11, lastRow - 1, 1);
  var values = range.getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === '') { values[i][0] = Utilities.getUuid(); count++; }
  }
  if (count > 0) { range.setValues(values); }
  Logger.log('已補 ' + count + ' 筆交易 ID');
  return count;
}

// ===== 舊資料搬移：在編輯器直接執行，不需參數 =====

/** 信用卡舊資料搬移對照表：from 為目前誤記帳戶，to 為應搬移到的信用卡帳戶 */
var MIGRATIONS = [
  { name: '一銀',   from: '一銀',     to: '一銀信用卡',   start: '', end: '' },
  { name: '國泰',   from: '國泰',     to: '國泰信用卡',   start: '', end: '' },
  { name: '永豐',   from: '永豐大戶', to: '永豐信用卡',   start: '2026/01/01', end: '2026/12/31' }  // 依實際信用卡消費區間調整
];

/**
 * 依 MIGRATIONS 逐一預覽搬移結果（不寫入），可直接在編輯器點選執行
 * @param {Spreadsheet} [ss] - 可選的試算表物件（供測試注入）
 * @returns {Array<Object>} 每筆設定的 { name, matched, moved }
 */
function previewMigrations(ss) {
  var results = [];
  MIGRATIONS.forEach(function(m) {
    var r = migrateCreditCardRows(m.from, m.to, m.start, m.end, true, ss);
    Logger.log('【' + m.name + '】符合 ' + r.matched + ' 筆');
    results.push({ name: m.name, matched: r.matched, moved: r.moved });
  });
  return results;
}

/**
 * 依 MIGRATIONS 逐一正式搬移（寫入試算表），可直接在編輯器點選執行
 * @param {Spreadsheet} [ss] - 可選的試算表物件（供測試注入）
 * @returns {Array<Object>} 每筆設定的 { name, matched, moved }
 */
function runMigrations(ss) {
  var results = [];
  MIGRATIONS.forEach(function(m) {
    var r = migrateCreditCardRows(m.from, m.to, m.start, m.end, false, ss);
    Logger.log('【' + m.name + '】已搬移 ' + r.moved + ' 筆');
    results.push({ name: m.name, matched: r.matched, moved: r.moved });
  });
  return results;
}

/**
 * 預覽既有「繳信用卡」未配對列，可直接在編輯器點選執行
 * @returns {Object} { paired, created, details[] }
 */
function previewCreditCardPairing() {
  return pairExistingCreditCardPayments(true);
}

/**
 * 正式對既有「繳信用卡」未配對列補跑自動配對，可直接在編輯器點選執行
 * @returns {Object} { paired, created, details[] }
 */
function runCreditCardPairing() {
  var result = pairExistingCreditCardPayments(false);
  Logger.log('paired: ' + result.paired + '，created: ' + result.created);
  (result.details || []).forEach(function(d) { Logger.log(d); });
  return result;
}
