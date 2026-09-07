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
    value = Utilities.formatDate(value, 'Asia/Taipei', 'yyyy/MM/dd');
  }
  var parts = String(value).trim().split(/[\/\-\.]/);
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
 * 將儲存格金額轉為數字：容許 "1,234"、"$1,234"、"NT$ 1,234" 等字串
 * @param {*} value - 試算表儲存格值
 * @returns {number} 無法解析時回傳 0
 */
function parseAmount(value) {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return isNaN(value) ? 0 : value;
  }
  var cleaned = String(value).replace(/[^0-9.\-]/g, '');
  var num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * 名稱正規化：去空白、全形轉半形、小寫，供帳戶名稱比對
 * @param {*} value
 * @returns {string}
 */
function normalizeName(value) {
  return String(value || '')
    .replace(/[\s　]/g, '')
    .replace(/[！-～]/g, function(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .toLowerCase();
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

  var values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var accounts = values
    .map(function(row) {
      var activeValue = row[6];
      var name = String(row[0] || '').trim();
      var rawType = String(row[7] || '').trim();
      return {
        name: name,
        institution: String(row[1] || '').trim(),
        currency: String(row[2] || 'TWD').trim() || 'TWD',
        initialBalance: parseAmount(row[3]),
        initialDate: normalizeDateString(row[4]),
        note: String(row[5] || '').trim(),
        active: activeValue === true || String(activeValue).toUpperCase() === 'TRUE',
        type: rawType || (name.indexOf('現金') >= 0 ? '現金' : '銀行'),
        debitAccount: String(row[8] || '').trim(),
        // J 欄若被 Google Sheets 解析成數字（帳號識別 hint 字串如 "0015977,0381979" 遭
        // 誤判為千分位數字、前導零與部分位數會遺失），視為壞資料，一律回傳空陣列，
        // 避免把已損毀的數字拆成錯誤的 hints。
        accountNumberHints: typeof row[9] === 'number' ? [] :
          String(row[9] || '').split(/[,，、]/).map(function(s) { return s.trim(); }).filter(function(s) { return s !== ''; })
      };
    })
    .filter(function(account) {
      return account.name !== '' && account.active === true;
    });

  // 同機構＋同幣別只有一個帳戶時，交易列可用機構名稱回推帳戶（舊資料相容）
  accounts.forEach(function(account) {
    var key = normalizeName(account.institution) + '|' + account.currency;
    var sameCount = accounts.filter(function(other) {
      return normalizeName(other.institution) + '|' + other.currency === key;
    }).length;
    account.institutionUnique = sameCount === 1;
  });
  return accounts;
}

/**
 * 依名稱（正規化比對）在帳戶清單中尋找帳戶
 * @param {Object[]} accounts - getAccounts() 回傳的帳戶陣列
 * @param {string} name - 要尋找的帳戶名稱
 * @returns {Object|null}
 */
function findAccountByName(accounts, name) {
  var target = normalizeName(name);
  if (target === '') { return null; }
  for (var i = 0; i < accounts.length; i++) { if (normalizeName(accounts[i].name) === target) { return accounts[i]; } }
  return null;
}

/**
 * 判斷交易列屬於哪種帳戶對應方式，不符合時回傳 null
 * 對應優先序：
 *   1. C 欄帳戶名稱 = 帳戶名稱（正規化後比對，容許空白/大小寫差異）
 *   2. C 欄帳戶名稱 = 金融機構名稱（AI 未照清單填時），且該機構＋幣別只對應一個帳戶
 *   3. C 欄空白、B 欄金融機構 = 帳戶機構，且該機構＋幣別只對應一個帳戶（舊資料）
 *   4. 現金：C 欄空白且 B 欄空白或「現金」
 * @param {Object} account - 帳戶設定
 * @param {Array} row - 交易紀錄列資料 A-I
 * @returns {string|null} 對應方式代碼
 */
function matchAccountRow(account, row) {
  var rowAccount = normalizeName(row[2]);
  var rowInstitution = normalizeName(row[1]);
  var name = normalizeName(account.name);
  var institution = normalizeName(account.institution);
  var institutionUnique = account.institutionUnique !== false;

  if (rowAccount !== '' && rowAccount === name) {
    return 'name';
  }
  if (rowAccount !== '' && institution !== '' && rowAccount === institution && institutionUnique) {
    return 'account-as-institution';
  }
  if (rowAccount === '') {
    if (name === normalizeName('現金') && (rowInstitution === '' || rowInstitution === normalizeName('現金'))) {
      return 'cash-blank';
    }
    if (institution !== '' && rowInstitution === institution && institutionUnique) {
      return 'institution';
    }
  }
  return null;
}

/**
 * 判斷交易不納入餘額的原因，納入時回傳 null
 * @param {Object} account - 帳戶設定
 * @param {Array} row - 交易紀錄列資料 A-I
 * @returns {string|null} 排除原因代碼
 */
function excludeReason(account, row) {
  var rowCurrency = String(row[7] || 'TWD').trim().toUpperCase() || 'TWD';
  if (rowCurrency !== String(account.currency || 'TWD').toUpperCase()) {
    return 'currency';
  }
  if (!matchAccountRow(account, row)) {
    return 'account';
  }
  if (!account.initialDate) {
    return null;
  }
  var txDate = parseSheetDate(row[0]);
  var initialDate = parseSheetDate(account.initialDate);
  if (!txDate || !initialDate) {
    return 'bad-date';
  }
  return txDate.getTime() > initialDate.getTime() ? null : 'before-initial-date';
}

/**
 * 判斷交易是否應納入指定帳戶餘額
 * @param {Object} account - 帳戶設定
 * @param {Array} row - 交易紀錄列資料 A-I
 * @returns {boolean}
 */
function shouldIncludeTransaction(account, row) {
  return excludeReason(account, row) === null;
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
    var amount = Math.abs(parseAmount(row[8]));
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
    type: account.type || '銀行',
    currency: account.currency,
    initialBalance: account.initialBalance,
    transactionTotal: transactionTotal,
    currentBalance: account.initialBalance + transactionTotal,
    txCount: txCount,
    initialDate: account.initialDate
  };
}

var TX_COLUMN_COUNT = 12;

/**
 * 將交易紀錄列資料轉為交易物件
 * @param {Array} row - 交易紀錄列資料 A-L
 * @param {number} rowIndex - 試算表列號
 * @returns {Object}
 */
function rowToTransaction(row, rowIndex) {
  return {
    date: normalizeDateString(row[0]),
    institution: String(row[1] || '').trim(),
    account: String(row[2] || '').trim(),
    type: String(row[3] || '').trim(),
    category: String(row[4] || '').trim(),
    item: String(row[5] || '').trim(),
    description: String(row[6] || '').trim(),
    currency: String(row[7] || 'TWD').trim().toUpperCase() || 'TWD',
    amount: Math.abs(parseAmount(row[8])),
    source: String(row[9] || '').trim(),
    id: String(row[10] || '').trim(),
    transferId: String(row[11] || '').trim(),
    rowIndex: rowIndex
  };
}

/**
 * 將交易物件轉為交易紀錄列資料（12 欄），id 空時自動產生 UUID
 * @param {Object} tx - 交易物件
 * @returns {Array} 12 元素陣列
 */
function transactionToRow(tx) {
  var institution = tx.institution || '現金';
  var account = tx.account || (institution === '現金' ? '現金' : '');
  return [tx.date, institution, account, tx.type, tx.category, tx.item || '', tx.description || '',
    tx.currency || 'TWD', Math.abs(parseAmount(tx.amount)), tx.source || '', tx.id || Utilities.getUuid(), tx.transferId || ''];
}

/**
 * 讀取交易紀錄 A-L 欄資料
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
  return sheet.getRange(2, 1, lastRow - 1, TX_COLUMN_COUNT).getValues();
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
 * 除錯用：在 GAS 編輯器手動執行，Logger 會列出指定帳戶每種排除原因的筆數與範例列
 * @param {string} accountName - 帳戶名稱，未填則用「現金」
 */
function debugAccountBalance(accountName) {
  accountName = accountName || '現金';
  var ss = getSpreadsheet();
  var accounts = getAccounts(ss);
  var account = null;
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].name === accountName) {
      account = accounts[i];
    }
  }
  if (!account) {
    Logger.log('找不到啟用帳戶：' + accountName + '；可用：' + accounts.map(function(a) { return a.name; }).join('、'));
    return;
  }
  Logger.log('帳戶設定：' + JSON.stringify(account));

  var rows = getTransactionRows(ss);
  var stats = {};
  var samples = {};
  for (var r = 0; r < rows.length; r++) {
    var reason = excludeReason(account, rows[r]) || 'included';
    stats[reason] = (stats[reason] || 0) + 1;
    if (!samples[reason]) {
      samples[reason] = '第 ' + (r + 2) + ' 列 ' + JSON.stringify(rows[r].slice(0, 9));
    }
  }
  Logger.log('交易紀錄共 ' + rows.length + ' 列，分類統計：' + JSON.stringify(stats));
  Object.keys(samples).forEach(function(key) {
    Logger.log('[' + key + '] 範例：' + samples[key]);
  });
  Logger.log('計算結果：' + JSON.stringify(calculateBalanceFromRows(account, rows)));
}

/**
 * 讀取分類清單（含圖示、顏色、列號）
 * @param {string} sheetName - 工作表名稱（'支出分類' 或 '收入分類'）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} { name, icon, color, rowIndex }
 */
function getCategoryRows(sheetName, ss) {
  var sheet = getSpreadsheet(ss).getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) { return []; }
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var out = [];
  values.forEach(function(row, i) {
    var name = String(row[0] || '').trim();
    if (name === '') { return; }
    out.push({ name: name, icon: String(row[1] || '').trim(), color: String(row[2] || '').trim(), rowIndex: i + 2 });
  });
  return out;
}

/**
 * 新增或更新分類（可更名）
 * @param {string} sheetName - 工作表名稱（'支出分類' 或 '收入分類'）
 * @param {Object} params - { name, icon, color, oldName }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { rowIndex, renamed }
 */
function upsertCategory(sheetName, params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName(sheetName);
  var rows = getCategoryRows(sheetName, ss);
  var name = String(params.name || '').trim();
  var oldName = String(params.oldName || '').trim();
  if (name === '') { throw new Error('分類名稱不可空白'); }
  var target = null;
  rows.forEach(function(r) {
    if (normalizeName(r.name) === normalizeName(oldName || name)) { target = r; }
  });
  var renamed = oldName !== '' && normalizeName(oldName) !== normalizeName(name);
  if (renamed || !target) {
    var dup = rows.some(function(r) { return normalizeName(r.name) === normalizeName(name) && (!target || r.rowIndex !== target.rowIndex); });
    if (dup) { throw new Error('分類「' + name + '」已存在'); }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var rowIndex = target ? target.rowIndex : sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1, 1, 3).setValues([[name, params.icon || '', params.color || '']]);
    return { rowIndex: rowIndex, renamed: renamed };
  } finally { lock.releaseLock(); }
}

/**
 * 讀取預算清單
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} { kind, name, budget, rowIndex }
 */
function getBudgets(ss) {
  var sheet = getSpreadsheet(ss).getSheetByName('預算');
  if (!sheet || sheet.getLastRow() < 2) { return []; }
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  var out = [];
  values.forEach(function(row, i) {
    var name = String(row[1] || '').trim();
    if (name === '') { return; }
    out.push({ kind: String(row[0] || '').trim(), name: name, budget: Math.abs(parseAmount(row[2])), rowIndex: i + 2 });
  });
  return out;
}

/**
 * 新增、更新或刪除預算（金額 ≤ 0 或空時刪除）
 * @param {Object} params - { kind, name, amount }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { rowIndex, deleted }
 */
function upsertBudget(params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('預算');
  var amount = Math.abs(parseAmount(params.amount));
  var existing = null;
  getBudgets(ss).forEach(function(b) {
    if (b.kind === params.kind && normalizeName(b.name) === normalizeName(params.name)) { existing = b; }
  });
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (amount <= 0) {
      if (existing) { sheet.deleteRow(existing.rowIndex); return { rowIndex: existing.rowIndex, deleted: true }; }
      return { rowIndex: 0, deleted: true };
    }
    var rowIndex = existing ? existing.rowIndex : sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1, 1, 3).setValues([[params.kind, params.name, amount]]);
    return { rowIndex: rowIndex, deleted: false };
  } finally { lock.releaseLock(); }
}

/**
 * 依 ID 更新一筆交易（只寫 A–I 欄，保留 J 原始訊息、K ID、L 轉帳ID）
 * @param {Object} tx - 交易物件（需含 id；其餘欄位未提供則沿用原值）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} 更新後的交易物件
 */
function updateTransactionById(tx, ss) {
  ss = getSpreadsheet(ss);
  var found = findTransactionsByIds([tx.id], ss)[tx.id];
  if (!found) { throw new Error('找不到這筆交易，可能已被刪除'); }
  var merged = {};
  for (var k in found) { merged[k] = found[k]; }
  for (var j in tx) { if (tx[j] !== undefined) { merged[j] = tx[j]; } }
  var row = transactionToRow(merged);
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    ss.getSheetByName('交易紀錄').getRange(found.rowIndex, 1, 1, 9).setValues([row.slice(0, 9)]);
    return rowToTransaction(row.slice(0, 9).concat([found.source, found.id, found.transferId]), found.rowIndex);
  } finally { lock.releaseLock(); }
}

/**
 * 依 ID 刪除一筆交易；alsoLinked 時一併刪除配對的轉帳列，否則清空對方的 L 欄
 * @param {string} id - 交易 ID
 * @param {boolean} alsoLinked - 是否一併刪除配對的轉帳交易
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { deleted: number }
 */
function deleteTransactionById(id, alsoLinked, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var all = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); });
  var target = null;
  all.forEach(function(t) { if (t.id === id) { target = t; } });
  if (!target) { throw new Error('找不到這筆交易，可能已被刪除'); }
  var toDelete = [target];
  var linked = target.transferId ? all.filter(function(t) { return t.transferId === target.transferId && t.id !== id; }) : [];
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (alsoLinked) { toDelete = toDelete.concat(linked); }
    else { linked.forEach(function(t) { sheet.getRange(t.rowIndex, 12, 1, 1).setValue(''); }); }
    toDelete.sort(function(a, b) { return b.rowIndex - a.rowIndex; }).forEach(function(t) { sheet.deleteRow(t.rowIndex); });
    return { deleted: toDelete.length };
  } finally { lock.releaseLock(); }
}

/**
 * 更新帳戶設定（初始餘額、初始日期、帳戶類型），只更新有提供的欄位
 * @param {string} name - 帳戶名稱
 * @param {Object} params - { initialBalance, initialDate, type }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 更新的列號
 */
function updateAccountSettings(name, params, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('帳戶管理');
  var values = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
  var rowIndex = 0;
  values.forEach(function(row, i) { if (normalizeName(row[0]) === normalizeName(name)) { rowIndex = i + 2; } });
  if (!rowIndex) { throw new Error('找不到帳戶「' + name + '」'); }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (params.initialBalance !== undefined) { sheet.getRange(rowIndex, 4, 1, 1).setValue(parseAmount(params.initialBalance)); }
    if (params.initialDate !== undefined) { sheet.getRange(rowIndex, 5, 1, 1).setValue(params.initialDate); }
    if (params.type !== undefined && params.type !== '') { sheet.getRange(rowIndex, 8, 1, 1).setValue(params.type); }
    return rowIndex;
  } finally { lock.releaseLock(); }
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
 * @returns {Object} 交易物件（含 id、rowIndex）
 */
function appendTransaction(date, institution, account, type, category, item, description, currency, amount, originalMessage, ss) {
  return appendTransactionsBatch([{ date: date, institution: institution, account: account, type: type, category: category,
    item: item, description: description, currency: currency, amount: amount }], originalMessage, ss)[0];
}

/**
 * 批次寫入多筆交易紀錄
 * @param {Object[]} transactions - 交易陣列
 * @param {string} [source] - 來源標記（'PDF匯入' 或 '文字匯入'）；tx.source 有值時優先
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} 交易物件陣列（含 id、rowIndex）
 */
function appendTransactionsBatch(transactions, source, ss) {
  if (!transactions || transactions.length === 0) { return []; }
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var lastRow = sheet.getLastRow();
    var rows = transactions.map(function(tx) {
      var copy = {};
      for (var k in tx) { copy[k] = tx[k]; }
      copy.source = tx.source || source || 'PDF匯入';
      return transactionToRow(copy);
    });
    sheet.getRange(lastRow + 1, 1, rows.length, TX_COLUMN_COUNT).setValues(rows);
    return rows.map(function(row, i) { return rowToTransaction(row, lastRow + 1 + i); });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 列出指定帳戶會被計入餘額的所有交易列，依日期由舊到新排序
 * @param {string} accountName - 帳戶名稱
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} { rowIndex, date, type, category, item, amount, currency, source, transferId }
 */
function listAccountTransactions(accountName, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var account = findAccountByName(accounts, accountName);
  if (!account) { return []; }

  var rows = getTransactionRows(ss);
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!shouldIncludeTransaction(account, row)) { continue; }
    var tx = rowToTransaction(row, i + 2);
    list.push({
      rowIndex: tx.rowIndex,
      date: tx.date,
      type: tx.type,
      category: tx.category,
      item: tx.item,
      amount: tx.amount,
      currency: tx.currency,
      source: tx.source,
      transferId: tx.transferId
    });
  }
  list.sort(function(a, b) {
    var da = parseSheetDate(a.date);
    var db = parseSheetDate(b.date);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    if (ta !== tb) { return ta - tb; }
    return a.rowIndex - b.rowIndex;
  });
  return list;
}

/**
 * 除錯用：在 GAS 編輯器手動執行，依日期列出指定帳戶每筆計入餘額的交易明細
 * @param {string} [accountName] - 帳戶名稱，未填則用「永豐信用卡」
 */
function printAccountTransactions(accountName) {
  accountName = accountName || '永豐信用卡';
  var ss = getSpreadsheet();
  var accounts = getAccounts(ss);
  var account = findAccountByName(accounts, accountName);
  if (!account) {
    Logger.log('找不到啟用帳戶：' + accountName + '；可用：' + accounts.map(function(a) { return a.name; }).join('、'));
    return;
  }

  var list = listAccountTransactions(accountName, ss);
  var income = 0;
  var expense = 0;
  list.forEach(function(tx) {
    Logger.log('第 ' + tx.rowIndex + ' 列 | ' + tx.date + ' | ' + tx.type + ' | ' + tx.category + ' | ' + tx.item + ' | ' +
      tx.amount + ' | ' + tx.source + ' | ' + String(tx.transferId || '').slice(0, 8));
    if (tx.type === '收入') { income += tx.amount; }
    else if (tx.type === '支出') { expense += tx.amount; }
  });
  var balance = account.initialBalance + income - expense;
  Logger.log('共 ' + list.length + ' 筆，收入合計 ' + income + '，支出合計 ' + expense + '，初始 ' + account.initialBalance + '，餘額 ' + balance);
}

/** 交易「來源」欄視為自動化匯入的固定值；其餘一律歸類為「手動」 */
var KNOWN_TX_SOURCES = ['PDF匯入', '文字匯入', '自動配對', 'App'];

/**
 * 稽核所有啟用帳戶的餘額組成：收支合計、來源分布、分類金額分布
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} { name, type, initialBalance, initialDate, txCount, income, expense, currentBalance, bySource, byCategory }
 */
function auditBalances(ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var rows = getTransactionRows(ss);
  return accounts.map(function(account) {
    var income = 0;
    var expense = 0;
    var txCount = 0;
    var bySource = {};
    var byCategory = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!shouldIncludeTransaction(account, row)) { continue; }
      var tx = rowToTransaction(row, i + 2);
      txCount++;
      if (tx.type === '收入') { income += tx.amount; }
      else if (tx.type === '支出') { expense += tx.amount; }
      var sourceKey = KNOWN_TX_SOURCES.indexOf(tx.source) >= 0 ? tx.source : '手動';
      bySource[sourceKey] = (bySource[sourceKey] || 0) + 1;
      var catKey = tx.category || '(無分類)';
      byCategory[catKey] = (byCategory[catKey] || 0) + tx.amount;
    }
    return {
      name: account.name,
      type: account.type || '銀行',
      initialBalance: account.initialBalance,
      initialDate: account.initialDate,
      txCount: txCount,
      income: income,
      expense: expense,
      currentBalance: account.initialBalance + income - expense,
      bySource: bySource,
      byCategory: byCategory
    };
  });
}

/**
 * 除錯用：在 GAS 編輯器手動執行，Logger 會列出全帳戶的餘額組成總覽
 * @returns {Object[]} auditBalances() 的結果
 */
function printBalanceAudit() {
  var ss = getSpreadsheet();
  var audits = auditBalances(ss);
  audits.forEach(function(a) {
    var sourceParts = KNOWN_TX_SOURCES.concat(['手動']).map(function(k) {
      return k + ':' + (a.bySource[k] || 0);
    });
    var topCategories = Object.keys(a.byCategory)
      .sort(function(x, y) { return a.byCategory[y] - a.byCategory[x]; })
      .slice(0, 3)
      .map(function(k) { return k + ':' + a.byCategory[k]; });
    Logger.log(a.name + ' | ' + a.type + ' | 初始 ' + a.initialBalance + ' (' + (a.initialDate || '無') + ') | 筆數 ' + a.txCount +
      ' | 收入 ' + a.income + ' | 支出 ' + a.expense + ' | 餘額 ' + a.currentBalance +
      ' | 來源 {' + sourceParts.join(', ') + '} | 最大分類 {' + topCategories.join(', ') + '}');
  });
  return audits;
}
