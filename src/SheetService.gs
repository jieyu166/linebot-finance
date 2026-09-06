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
 * 將試算表日期值標準化為 yyyy/MM/dd 字串
 * @param {*} value - 試算表儲存格值
 * @returns {string}
 */
function normalizeDateString(value) {
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Taipei', 'yyyy/MM/dd');
  }
  return String(value).trim();
}

/**
 * 將試算表日期值轉為 Date，無效時回傳 null
 * @param {*} value - 試算表儲存格值
 * @returns {Date|null}
 */
function parseSheetDate(value) {
  if (!value) {
    return null;
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var parts = String(value).trim().split(/[\/\-]/);
  if (parts.length !== 3) {
    return null;
  }
  var year = Number(parts[0]);
  var month = Number(parts[1]);
  var day = Number(parts[2]);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

/**
 * 取得啟用中的帳戶清單
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} 帳戶物件陣列
 */
function getAccounts(ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('帳戶管理');
  if (!sheet) {
    return [];
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  return values
    .map(function(row) {
      var activeValue = row[6];
      return {
        name: String(row[0] || '').trim(),
        institution: String(row[1] || '').trim(),
        currency: String(row[2] || 'TWD').trim() || 'TWD',
        initialBalance: row[3] === '' || row[3] === null ? 0 : Number(row[3]) || 0,
        initialDate: normalizeDateString(row[4]),
        note: String(row[5] || '').trim(),
        active: activeValue === true || String(activeValue).toUpperCase() === 'TRUE'
      };
    })
    .filter(function(account) {
      return account.name !== '' && account.active === true;
    });
}

/**
 * 判斷交易是否應納入指定帳戶餘額
 * @param {Object} account - 帳戶設定
 * @param {Array} row - 交易紀錄列資料 A-I
 * @returns {boolean}
 */
function shouldIncludeTransaction(account, row) {
  var rowAccount = String(row[2] || '').trim();
  var rowInstitution = String(row[1] || '').trim();
  var rowCategory = String(row[4] || '').trim();
  var rowCurrency = String(row[7] || 'TWD').trim() || 'TWD';
  if (rowCategory === '繳信用卡') {
    return false;
  }
  if (account.name === '現金' && rowAccount === '' && (rowInstitution === '' || rowInstitution === '現金')) {
    rowAccount = '現金';
  }
  if (rowAccount !== account.name || rowCurrency !== account.currency) {
    return false;
  }

  if (!account.initialDate) {
    return true;
  }

  var txDate = parseSheetDate(row[0]);
  var initialDate = parseSheetDate(account.initialDate);
  if (!txDate || !initialDate) {
    return false;
  }
  return txDate.getTime() > initialDate.getTime();
}

/**
 * 依交易列計算帳戶餘額
 * @param {Object} account - 帳戶設定
 * @param {Array[]} transactionRows - 交易紀錄 A-I 資料
 * @returns {Object}
 */
function calculateBalanceFromRows(account, transactionRows) {
  var transactionTotal = 0;
  var txCount = 0;

  for (var i = 0; i < transactionRows.length; i++) {
    var row = transactionRows[i];
    if (!shouldIncludeTransaction(account, row)) {
      continue;
    }

    var type = String(row[3] || '').trim();
    var amount = Number(row[8]) || 0;
    if (type === '支出') {
      transactionTotal -= amount;
      txCount++;
    } else if (type === '收入') {
      transactionTotal += amount;
      txCount++;
    }
  }

  return {
    name: account.name,
    currency: account.currency,
    initialBalance: account.initialBalance,
    transactionTotal: transactionTotal,
    currentBalance: account.initialBalance + transactionTotal,
    txCount: txCount,
    initialDate: account.initialDate
  };
}

/**
 * 讀取交易紀錄 A-I 欄資料
 * @param {Spreadsheet} ss - 試算表物件
 * @returns {Array[]}
 */
function getTransactionRows(ss) {
  var sheet = ss.getSheetByName('交易紀錄');
  if (!sheet) {
    return [];
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  return sheet.getRange(2, 1, lastRow - 1, 9).getValues();
}

/**
 * 計算單一帳戶目前餘額
 * @param {string} accountName - 帳戶名稱
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object|null}
 */
function calculateAccountBalance(accountName, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var account = null;
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].name === accountName) {
      account = accounts[i];
      break;
    }
  }
  if (!account) {
    return null;
  }

  return calculateBalanceFromRows(account, getTransactionRows(ss));
}

/**
 * 計算所有啟用帳戶目前餘額
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function getAllAccountBalances(ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var transactionRows = getTransactionRows(ss);
  return accounts.map(function(account) {
    return calculateBalanceFromRows(account, transactionRows);
  });
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
  institution = institution || '現金';
  account = account || (institution === '現金' ? '現金' : '');
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
    var institution = tx.institution || '現金';
    var account = tx.account || (institution === '現金' ? '現金' : '');
    return [
      tx.date,
      institution,
      account,
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
