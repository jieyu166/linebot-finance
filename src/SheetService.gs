/**
 * SheetService.gs — Google 試算表讀寫操作
 */

/**
 * 從指定工作表讀取分類清單
 * @param {string} sheetName - 工作表名稱（'支出分類' 或 '收入分類'）
 * @returns {string[]} 分類名稱陣列
 */
function getCategories(sheetName) {
  var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));
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
 */
function appendTransaction(date, institution, account, type, category, item, description, currency, amount, originalMessage) {
  var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));
  var sheet = ss.getSheetByName('交易紀錄');
  sheet.appendRow([date, institution, account, type, category, item, description, currency, amount, originalMessage]);
}

/**
 * 批次寫入多筆交易紀錄（PDF 匯入用）
 * @param {Object[]} transactions - 交易陣列
 */
function appendTransactionsBatch(transactions) {
  if (transactions.length === 0) {
    return;
  }

  var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));
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
      'PDF匯入'
    ];
  });

  sheet.getRange(lastRow + 1, 1, rows.length, 10).setValues(rows);
}
