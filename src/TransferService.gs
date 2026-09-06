/**
 * TransferService.gs — 轉帳配對核心
 */

/**
 * 計算兩個日期值的天數差絕對值
 * @param {*} a - 日期值
 * @param {*} b - 日期值
 * @returns {number} 天數差絕對值；任一無效時回傳 Infinity
 */
function dateDiffDays(a, b) {
  var da = parseSheetDate(a), db = parseSheetDate(b);
  if (!da || !db) { return Infinity; }
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}

/**
 * 判斷交易描述／品項是否含「換匯」提示
 * @param {Object} tx - 交易物件
 * @returns {boolean}
 */
function hasFxHint(tx) { return /換匯/.test((tx.description || '') + (tx.item || '')); }

/**
 * 從交易清單中挑出可能的轉帳配對候選
 * @param {Object} tx - 目標交易
 * @param {Object[]} allTx - 全部交易
 * @param {Object[]} accounts - 帳戶清單
 * @param {Object} [options] - { dayWindow, counterpartyAccount, counterpartyBank }
 * @returns {Object[]} 候選交易陣列
 */
function pickTransferCandidates(tx, allTx, accounts, options) {
  options = options || {};
  var dayWindow = options.dayWindow === undefined ? 3 : options.dayWindow;
  var cpAccount = normalizeName(options.counterpartyAccount || '');
  var cpBank = normalizeName(options.counterpartyBank || '');
  var txAccount = findAccountByName(accounts, tx.account);
  var txCurrency = txAccount ? txAccount.currency : (tx.currency || 'TWD');
  var oppositeType = tx.type === '支出' ? '收入' : '支出';
  return allTx.filter(function(o) {
    if (o.id === tx.id || o.transferId || o.type !== oppositeType) { return false; }
    if (normalizeName(o.account) === normalizeName(tx.account)) { return false; }
    var oa = findAccountByName(accounts, o.account);
    if (!oa) { return false; }
    if (cpAccount && normalizeName(oa.name) !== cpAccount) { return false; }
    if (cpBank && normalizeName(oa.institution) !== cpBank) { return false; }
    var diff = dateDiffDays(tx.date, o.date);
    if (oa.currency === txCurrency) { return diff <= dayWindow && Math.abs(o.amount - tx.amount) < 0.005; }
    return diff === 0 && (hasFxHint(tx) || hasFxHint(o));
  });
}

/**
 * 依 ID 清單從交易紀錄查出交易物件
 * @param {string[]} ids - 交易 ID 清單
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { id: 交易物件 }
 */
function findTransactionsByIds(ids, ss) {
  var rows = getTransactionRows(getSpreadsheet(ss));
  var wanted = {}; ids.forEach(function(id) { wanted[id] = true; });
  var found = {};
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][10] || '').trim();
    if (wanted[id]) { found[id] = rowToTransaction(rows[i], i + 2); }
  }
  return found;
}

/**
 * 寫入轉帳ID（L 欄）與可選分類（E 欄）到指定交易列
 * @param {Object[]} txs - 交易物件陣列（需含 rowIndex）
 * @param {string} transferId - 轉帳ID，清空時傳 ''
 * @param {string} [category] - 分類名稱，未傳則不改動 E 欄
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 */
function writeTransferCells(txs, transferId, category, ss) {
  var sheet = getSpreadsheet(ss).getSheetByName('交易紀錄');
  txs.forEach(function(tx) {
    sheet.getRange(tx.rowIndex, 12, 1, 1).setValue(transferId);
    if (category) { sheet.getRange(tx.rowIndex, 5, 1, 1).setValue(category); }
  });
}

/**
 * 將兩筆交易配對為轉帳
 * @param {string} idA - 交易 A 的 ID
 * @param {string} idB - 交易 B 的 ID
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {string} 轉帳ID
 */
function linkTransfer(idA, idB, ss) {
  ss = getSpreadsheet(ss);
  var found = findTransactionsByIds([idA, idB], ss);
  var a = found[idA], b = found[idB];
  if (!a || !b) { throw new Error('找不到要連結的交易，可能已被刪除'); }
  if (a.transferId || b.transferId) { throw new Error('其中一筆已是轉帳配對，請先解除'); }
  if (normalizeName(a.account) === normalizeName(b.account)) { throw new Error('兩筆交易屬於同一帳戶，無法配對'); }
  if (a.type === b.type) { throw new Error('兩筆交易必須一筆支出、一筆收入'); }
  if (a.currency === b.currency && Math.abs(a.amount - b.amount) >= 0.005) { throw new Error('同幣別的轉帳金額必須相同'); }
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { var id = Utilities.getUuid(); writeTransferCells([a, b], id, '轉帳', ss); return id; }
  finally { lock.releaseLock(); }
}

/**
 * 解除轉帳配對，清除所有屬於此轉帳ID的交易列
 * @param {string} transferId - 轉帳ID
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 清除的交易列數
 */
function unlinkTransfer(transferId, ss) {
  ss = getSpreadsheet(ss);
  var rows = getTransactionRows(ss), targets = [];
  for (var i = 0; i < rows.length; i++) { if (String(rows[i][11] || '').trim() === transferId) { targets.push(rowToTransaction(rows[i], i + 2)); } }
  writeTransferCells(targets, '', null, ss);
  return targets.length;
}

/**
 * 建立一組轉帳交易（轉出＋轉入兩筆）
 * @param {Object} params - { fromAccount, toAccount, amount, date, note, toAmount }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]} 兩筆交易物件
 */
function createTransfer(params, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var from = findAccountByName(accounts, params.fromAccount), to = findAccountByName(accounts, params.toAccount);
  if (!from || !to) { throw new Error('找不到帳戶：' + (from ? params.toAccount : params.fromAccount)); }
  if (from.name === to.name) { throw new Error('轉出與轉入帳戶不可相同'); }
  var amount = Math.abs(parseAmount(params.amount));
  var toAmount = (from.currency === to.currency || params.toAmount === undefined || params.toAmount === '') ? amount : Math.abs(parseAmount(params.toAmount));
  var transferId = Utilities.getUuid(), note = params.note || '';
  return appendTransactionsBatch([
    { date: params.date, institution: from.institution, account: from.name, type: '支出', category: '轉帳', item: '轉帳至' + to.name, description: note, currency: from.currency, amount: amount, transferId: transferId },
    { date: params.date, institution: to.institution, account: to.name, type: '收入', category: '轉帳', item: '來自' + from.name, description: note, currency: to.currency, amount: toAmount, transferId: transferId }
  ], 'App', ss);
}
