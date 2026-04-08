/**
 * SheetService.gs — Google 試算表讀寫操作
 */

/**
 * 取得試算表物件（若未傳入則自行開啟）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Spreadsheet}
 */
function getSpreadsheet(ss) {
  return ss || SpreadsheetApp.openById(getConfig('SHEET_ID'));
}

/**
 * 從指定工作表讀取分類清單
 * @param {string} sheetName - 工作表名稱（'支出分類' 或 '收入分類'）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {string[]} 分類名稱陣列
 */
function getCategories(sheetName, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  return values
    .map(function(row) { return row[0]; })
    .filter(function(v) { return v !== ''; });
}

/**
 * 寫入一筆交易紀錄
 * @param {string} date - 日期
 * @param {string} institution - 金融機構
 * @param {string} account - 帳戶名稱
 * @param {string} type - 類型（支出/收入）
 * @param {string} category - 分類
 * @param {string} item - 品項
 * @param {string} description - 明細描述
 * @param {string} currency - 幣別
 * @param {number} amount - 金額
 * @param {string} originalMessage - 原始訊息
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 */
function appendTransaction(date, institution, account, type, category, item, description, currency, amount, originalMessage, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  sheet.appendRow([date, institution, account, type, category, item, description, currency, amount, originalMessage]);
}

/**
 * 批次寫入多筆交易紀錄
 * @param {Object[]} transactions - 交易陣列
 * @param {string} [source] - 來源標記（'PDF匯入' 或 '文字匯入'）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 */
function appendTransactionsBatch(transactions, source, ss) {
  if (transactions.length === 0) {
    return;
  }

  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var lastRow = sheet.getLastRow();

  var rows = transactions.map(function(tx) {
    return [
      tx.date,
      tx.institution || '現金',
      tx.account || '',
      tx.type,
      tx.category,
      tx.item,
      tx.description || '',
      tx.currency || 'TWD',
      tx.amount,
      source || 'PDF匯入'
    ];
  });

  sheet.getRange(lastRow + 1, 1, rows.length, 10).setValues(rows);
}
