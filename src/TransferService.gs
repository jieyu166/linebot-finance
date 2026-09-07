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
    if (o.category !== '轉帳' && o.category !== '') { return false; }
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
/**
 * 銀行代號 → 機構名稱對照表
 */
var BANK_CODE_MAP = { '808': '玉山銀行', '812': '台新銀行', '822': '中國信託', '013': '國泰銀行', '012': '富邦銀行',
  '007': '第一銀行', '824': 'LINE Bank', '048': '王道銀行', '810': '樂天銀行', '807': '永豐銀行', '700': '中華郵政', '006': '合作金庫' };

/**
 * 去除字串中所有非數字字元
 * @param {*} s
 * @returns {string}
 */
function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }

/**
 * 去除字串開頭的連續 0
 * @param {*} s
 * @returns {string}
 */
function stripLeadingZeros(s) { return String(s || '').replace(/^0+/, ''); }

/**
 * 判斷帳號是否符合帳號提示：兩邊去「-」與前導零後，帳號以提示為前綴
 * @param {*} number - 帳號候選字串
 * @param {*} hint - 帳戶設定中的帳號提示
 * @returns {boolean}
 */
function hintMatches(number, hint) {
  var n = stripLeadingZeros(String(number || '').replace(/[-\s]/g, ''));
  var h = stripLeadingZeros(String(hint || '').replace(/[-\s]/g, ''));
  return h !== '' && n.indexOf(h) === 0;
}

/**
 * 從文字中辨識對方帳戶：取 text 中所有 ≥8 位數字串，對所有帳戶的 accountNumberHints 做前綴比對
 * @param {string} text - 交易描述文字
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object|null} 唯一命中帳戶；無命中或命中多個帳戶時回傳 null
 */
function matchCounterpartyAccount(text, accounts) {
  var nums = String(text || '').match(/\d{8,}/g) || [];
  var hits = {};
  nums.forEach(function(d) {
    [d, d.slice(3)].forEach(function(cand) {
      accounts.forEach(function(a) {
        (a.accountNumberHints || []).forEach(function(h) { if (hintMatches(cand, h)) { hits[a.name] = a; } });
      });
    });
  });
  var names = Object.keys(hits);
  return names.length === 1 ? hits[names[0]] : null;
}

/**
 * 從文字中解析對方銀行機構名稱：取最長 ≥10 位數字串，前三碼查銀行代號
 * @param {string} text - 交易描述文字
 * @returns {string} 機構名稱；無法解析時回傳 ''
 */
function parseCounterpartyBank(text) {
  var nums = String(text || '').match(/\d{10,}/g) || [];
  if (nums.length === 0) { return ''; }
  nums.sort(function(a, b) { return b.length - a.length; });
  return BANK_CODE_MAP[nums[0].slice(0, 3)] || '';
}

/**
 * 取交易描述＋品項的正規化文字，供比對用
 * @param {Object} tx - 交易物件
 * @returns {string}
 */
function textOf(tx) { return normalizeName((tx.description || '') + ' ' + (tx.item || '')); }

/**
 * 依「換匯／外幣」提示過濾幣別候選清單；過濾後為空時回傳原清單
 * @param {Object} tx - 交易物件
 * @param {Object[]} list - 候選帳戶清單
 * @returns {Object[]}
 */
function filterByCurrencyHint(tx, list) {
  var fx = /換匯|外幣|usd/.test(textOf(tx));
  var f = list.filter(function(a) { return fx ? a.currency !== 'TWD' : a.currency === 'TWD'; });
  return f.length > 0 ? f : list;
}

/**
 * 辨識「繳信用卡」交易對應的信用卡帳戶
 * @param {Object} tx - 交易物件
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object|null}
 */
function resolveCreditCardAccount(tx, accounts) {
  var text = textOf(tx);
  var cards = accounts.filter(function(a) { return a.type === '信用卡'; });
  var byName = cards.filter(function(a) { return text.indexOf(normalizeName(a.name)) >= 0; });
  if (byName.length === 1) { return byName[0]; }
  var byInst = filterByCurrencyHint(tx, cards.filter(function(a) {
    var inst = normalizeName(a.institution), short = inst.replace(/銀行$/, '');
    return inst !== '' && (text.indexOf(inst) >= 0 || (short.length >= 2 && text.indexOf(short) >= 0));
  }));
  if (byInst.length === 1) { return byInst[0]; }
  var byDebit = filterByCurrencyHint(tx, cards.filter(function(a) { return normalizeName(a.debitAccount) === normalizeName(tx.account); }));
  return byDebit.length === 1 ? byDebit[0] : null;
}

/**
 * 辨識「轉帳」交易對應的證券（交割戶）帳戶
 * @param {Object} tx - 交易物件
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object|null}
 */
function resolveBrokerageAccount(tx, accounts) {
  var brokers = accounts.filter(function(a) { return a.type === '證券'; });
  var cp = matchCounterpartyAccount(tx.description, brokers);
  if (cp) { return cp; }
  var text = textOf(tx);
  if (!/交割|證券/.test(text)) { return null; }
  var byDebit = brokers.filter(function(a) { return normalizeName(a.debitAccount) === normalizeName(tx.account); });
  return byDebit.length === 1 ? byDebit[0] : null;
}

/**
 * 判斷交易是否為 ATM 現金提款
 * @param {Object} tx - 交易物件
 * @returns {boolean}
 */
function isCashWithdrawal(tx) { return tx.type === '支出' && /現金提|atm提款|提款|提領/.test(textOf(tx)); }

/**
 * 建立與來源交易相對應的反向交易物件（用於自動配對新增列）
 * @param {Object} tx - 來源交易
 * @param {Object} target - 目標帳戶
 * @param {number} amount - 金額
 * @param {string} item - 品項
 * @returns {Object}
 */
function buildCounterpartRow(tx, target, amount, item) {
  return { date: tx.date, institution: target.institution, account: target.name, type: tx.type === '支出' ? '收入' : '支出',
    category: '轉帳', item: item, description: '自動配對：' + (tx.item || tx.description || ''), currency: target.currency, amount: amount, source: '自動配對' };
}

/**
 * 新增一筆反向交易列並與來源交易配對
 * @param {Object} tx - 來源交易（需含 rowIndex）；配對成功後會就地設定 tx.transferId
 * @param {Object} target - 目標帳戶
 * @param {number} amount - 金額
 * @param {string} item - 品項
 * @param {Spreadsheet} ss - 試算表物件
 * @returns {Object} 新建立的對方交易物件（transferId 已設定）
 */
function pairWithNewRow(tx, target, amount, item, ss) {
  var created = appendTransactionsBatch([buildCounterpartRow(tx, target, amount, item)], '自動配對', ss)[0];
  var transferId = Utilities.getUuid();
  writeTransferCells([tx, created], transferId, null, ss);
  tx.transferId = transferId;
  created.transferId = transferId;
  return created;
}

/**
 * 對匯入的交易清單做自動配對：繳信用卡、轉帳（含交割戶／ATM 現金提款）
 * @param {Object[]} newTxs - 剛匯入的交易物件陣列（至少需含 id；跨幣別繳卡費時可含 fxAmount）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { paired, created, details[] }
 */
function autoPairImportedTransactions(newTxs, ss) {
  ss = getSpreadsheet(ss);
  var accounts = getAccounts(ss);
  var result = { paired: 0, created: 0, details: [] };
  var all = getTransactionRows(ss).map(function(r, idx) { return rowToTransaction(r, idx + 2); });
  for (var i = 0; i < newTxs.length; i++) {
    var tx = null;
    for (var j = 0; j < all.length; j++) { if (all[j].id === newTxs[i].id) { tx = all[j]; } }
    if (!tx || tx.transferId) { continue; }
    var label = tx.category + ' ' + tx.date + ' ' + tx.account + ' ' + tx.amount;
    if (tx.category === '繳信用卡') {
      var card = resolveCreditCardAccount(tx, accounts);
      if (!card) { result.details.push(label + '：無法判斷信用卡帳戶，請在 App 手動連結'); continue; }
      var amt = tx.amount;
      if (card.currency !== tx.currency) {
        if (!newTxs[i].fxAmount) { result.details.push(label + '：外幣卡費金額不明，請在 App 手動連結'); continue; }
        amt = newTxs[i].fxAmount;
      }
      all.push(pairWithNewRow(tx, card, amt, '卡費入帳', ss)); result.created++; result.paired++;
      continue;
    }
    if (tx.category !== '轉帳') { continue; }
    var cp = matchCounterpartyAccount(tx.description, accounts);
    var candidates = pickTransferCandidates(tx, all, accounts, { counterpartyAccount: cp ? cp.name : '', counterpartyBank: cp ? '' : parseCounterpartyBank(tx.description) });
    if (candidates.length === 1) {
      var transferId = Utilities.getUuid();
      writeTransferCells([tx, candidates[0]], transferId, '轉帳', ss);
      tx.transferId = transferId;
      candidates[0].transferId = transferId;
      result.paired++; continue;
    }
    if (candidates.length > 1) { result.details.push(label + '：多個候選，請在 App 手動連結'); continue; }
    if (tx.type !== '支出') { continue; }
    if (isCashWithdrawal(tx)) {
      var cash = accounts.filter(function(a) { return a.type === '現金' && a.currency === tx.currency; })[0];
      if (cash) { all.push(pairWithNewRow(tx, cash, tx.amount, 'ATM 提款', ss)); result.created++; result.paired++; }
      continue;
    }
    var broker = resolveBrokerageAccount(tx, accounts);
    if (broker && broker.currency === tx.currency) { all.push(pairWithNewRow(tx, broker, tx.amount, '交割戶入帳', ss)); result.created++; result.paired++; }
  }
  return result;
}

/**
 * 匯入交易的來源標記集合（視為「已匯入」而非手動記帳）
 */
var IMPORT_SOURCES = { 'PDF匯入': true, '文字匯入': true, '自動配對': true };

/**
 * 證券概括品項（尚未寫入具體股名）的判斷樣式
 */
var GENERIC_STOCK_ITEMS = /定期買股|交割|證券|股票/;

/**
 * 判斷交易是否與既有匯入交易重複
 * @param {Object} tx - 待檢查交易
 * @param {Object[]} existingTxs - 既有交易清單
 * @param {Object} [options] - { dayWindow }，預設 2 天
 * @returns {Object|null} 重複的既有交易；無重複回傳 null
 */
function isDuplicateImport(tx, existingTxs, options) {
  var dayWindow = (options && options.dayWindow !== undefined) ? options.dayWindow : 2;
  var amount = Math.abs(parseAmount(tx.amount));
  for (var i = 0; i < existingTxs.length; i++) {
    var e = existingTxs[i];
    if (!IMPORT_SOURCES[e.source] || e.type !== tx.type) { continue; }
    if (normalizeName(e.account) !== normalizeName(tx.account) || (e.currency || 'TWD') !== (tx.currency || 'TWD')) { continue; }
    if (Math.abs(e.amount - amount) >= 0.005 || dateDiffDays(e.date, tx.date) > dayWindow) { continue; }
    return e;
  }
  return null;
}

/**
 * 將匯入交易清單與試算表既有交易去重，重複時視情況合併股名到既有列
 * @param {Object[]} transactions - 匯入的交易清單
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { kept, skipped, merged }
 */
function dedupeAgainstSheet(transactions, ss) {
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var existing = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); });
  var used = {}, result = { kept: [], skipped: [], merged: 0 };
  transactions.forEach(function(tx) {
    var dup = isDuplicateImport(tx, existing.filter(function(e) { return !used[e.id]; }));
    if (!dup) { result.kept.push(tx); return; }
    used[dup.id] = true;
    var newHasStock = (tx.category === '投資' || tx.category === '投資獲利') && tx.item && !GENERIC_STOCK_ITEMS.test(tx.item);
    if (newHasStock && GENERIC_STOCK_ITEMS.test(dup.item || '')) {
      sheet.getRange(dup.rowIndex, 6, 1, 2).setValues([[tx.item, tx.description || '']]);
      result.merged++;
    }
    result.skipped.push(tx);
  });
  return result;
}

/** 舊資料搬移預設排除分類：這些分類本身就不該搬到信用卡帳戶（轉帳／利息／薪資收入等） */
var MIGRATION_DEFAULT_EXCLUDE_CATEGORIES = ['繳信用卡', '轉帳', '利息', '回饋', '薪資', '股利', '貸款', '投資', '投資獲利', '兼職', '獎金', '家人給'];

/** 舊資料搬移預設排除的品項/描述關鍵字（連結帳戶轉入轉出、卡費繳款、換匯、證券款項等非信用卡消費列） */
var MIGRATION_DEFAULT_EXCLUDE_ITEM_PATTERN = /連結帳戶|利息|回饋|轉帳|換匯|卡費|還本|存入|薪資|股息|ACH|定期買股|交割|提款|現金提|股票款|申購|折讓|股利|退還/;

/**
 * 將舊資料中誤記在扣款帳戶下的信用卡消費列搬移到信用卡帳戶。
 * 為避免誤搬轉帳／繳款／利息等非信用卡消費列，預設會排除
 * MIGRATION_DEFAULT_EXCLUDE_CATEGORIES 分類與符合 MIGRATION_DEFAULT_EXCLUDE_ITEM_PATTERN
 * 的品項/描述（可用 options 覆寫），被排除的列計入 result.excluded，不計入 matched/moved
 * @param {string} fromAccount - 目前誤記的帳戶名稱（C 欄）
 * @param {string} toAccount - 應搬移到的信用卡帳戶名稱
 * @param {string} [startDate] - 起始日期（含），未填不限制
 * @param {string} [endDate] - 結束日期（含），未填不限制
 * @param {boolean} [dryRun] - 預設 true，只記錄不寫入；傳 false 才正式搬移
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @param {Object} [options] - { excludeCategories: string[], excludeItemPattern: RegExp }
 * @returns {Object} { matched, moved, excluded, rows[] }
 */
function migrateCreditCardRows(fromAccount, toAccount, startDate, endDate, dryRun, ss, options) {
  if (!toAccount) { throw new Error('請用 previewMigrations() / runMigrations() 執行，或傳入 fromAccount、toAccount 參數'); }
  dryRun = dryRun !== false;
  ss = getSpreadsheet(ss);
  options = options || {};
  var excludeCategorySet = {};
  (options.excludeCategories || MIGRATION_DEFAULT_EXCLUDE_CATEGORIES).forEach(function(c) { excludeCategorySet[c] = true; });
  var excludeItemPattern = options.excludeItemPattern || MIGRATION_DEFAULT_EXCLUDE_ITEM_PATTERN;
  var target = findAccountByName(getAccounts(ss), toAccount);
  if (!target) { throw new Error('找不到目標帳戶：' + toAccount); }
  var sheet = ss.getSheetByName('交易紀錄');
  var rows = getTransactionRows(ss);
  var start = startDate ? parseSheetDate(startDate) : null, end = endDate ? parseSheetDate(endDate) : null;
  var result = { matched: 0, moved: 0, excluded: 0, rows: [] };
  for (var i = 0; i < rows.length; i++) {
    var tx = rowToTransaction(rows[i], i + 2);
    if (normalizeName(tx.account) !== normalizeName(fromAccount)) { continue; }
    if (!IMPORT_SOURCES[tx.source]) { continue; }
    var d = parseSheetDate(tx.date);
    if ((start && (!d || d < start)) || (end && (!d || d > end))) { continue; }
    var text = (tx.item || '') + (tx.description || '');
    if (excludeCategorySet[tx.category] || excludeItemPattern.test(text)) {
      result.excluded++;
      Logger.log('[排除] 第 ' + tx.rowIndex + ' 列 ' + tx.date + ' ' + tx.item + ' ' + tx.amount);
      continue;
    }
    result.matched++; result.rows.push(tx.rowIndex);
    Logger.log((dryRun ? '[預覽] ' : '[搬移] ') + '第 ' + tx.rowIndex + ' 列 ' + tx.date + ' ' + tx.item + ' ' + tx.amount);
    if (!dryRun) { sheet.getRange(tx.rowIndex, 2, 1, 2).setValues([[target.institution, target.name]]); result.moved++; }
  }
  Logger.log('符合 ' + result.matched + ' 筆，排除 ' + result.excluded + ' 筆，已搬移 ' + result.moved + ' 筆' + (dryRun ? '（預覽，未寫入；正式執行傳 dryRun=false）' : ''));
  return result;
}

/**
 * 對既有「繳信用卡」但尚未配對轉帳的交易列補跑自動配對
 * @param {boolean} [dryRun] - 預設 true，只列出未配對清單；傳 false 才正式配對
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { paired, created, details[] }
 */
function pairExistingCreditCardPayments(dryRun, ss) {
  dryRun = dryRun !== false;
  ss = getSpreadsheet(ss);
  var targets = getTransactionRows(ss).map(function(r, i) { return rowToTransaction(r, i + 2); })
    .filter(function(tx) { return tx.category === '繳信用卡' && !tx.transferId; });
  Logger.log('未配對的繳信用卡列：' + targets.length + ' 筆');
  if (dryRun) { return { paired: 0, created: 0, details: targets.map(function(t) { return t.date + ' ' + t.account + ' ' + t.amount; }) }; }
  return autoPairImportedTransactions(targets, ss);
}

/**
 * 刪除指定帳戶、日期區間內由匯入產生的交易列（原始訊息為 PDF匯入／文字匯入／自動配對）。
 * 用於清掉舊版匯入邏輯寫壞的錯誤列，之後可重新貼帳單匯入；手動記帳列與區間外的列不受影響。
 * 正式執行前，若目標列已與其他帳戶配對轉帳（轉帳ID 非空），會先清空對方列的轉帳ID，避免
 * 對方半連結；接著依列號由高到低刪除，避免刪除過程中列號位移影響尚未處理的列。
 * @param {string} accountName - 帳戶名稱（正規化後比對）
 * @param {string} [startDate] - 起始日期（含），未填不限制
 * @param {string} [endDate] - 結束日期（含），未填不限制
 * @param {boolean} [dryRun] - 預設 true，只記錄不刪除；傳 false 才正式刪除
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { matched, deleted, rows[] }
 */
function deleteImportedRows(accountName, startDate, endDate, dryRun, ss) {
  if (!accountName) { throw new Error('請傳入帳戶名稱'); }
  dryRun = dryRun !== false;
  ss = getSpreadsheet(ss);
  var sheet = ss.getSheetByName('交易紀錄');
  var rows = getTransactionRows(ss);
  var start = startDate ? parseSheetDate(startDate) : null, end = endDate ? parseSheetDate(endDate) : null;
  var result = { matched: 0, deleted: 0, rows: [] };
  var targets = [];
  for (var i = 0; i < rows.length; i++) {
    var tx = rowToTransaction(rows[i], i + 2);
    if (normalizeName(tx.account) !== normalizeName(accountName)) { continue; }
    if (!IMPORT_SOURCES[tx.source]) { continue; }
    var d = parseSheetDate(tx.date);
    if ((start && (!d || d < start)) || (end && (!d || d > end))) { continue; }
    result.matched++;
    targets.push(tx);
    result.rows.push(tx.rowIndex);
    Logger.log('[預覽] 第 ' + tx.rowIndex + ' 列 ' + tx.date + ' ' + tx.item + ' ' + tx.amount);
  }
  Logger.log('符合 ' + result.matched + ' 筆' + (dryRun ? '（預覽，未刪除；正式執行傳 dryRun=false）' : ''));
  if (dryRun) { return result; }

  targets.forEach(function(t) {
    if (!t.transferId) { return; }
    for (var j = 0; j < rows.length; j++) {
      var rowIndex = j + 2;
      if (rowIndex === t.rowIndex) { continue; }
      if (String(rows[j][11] || '').trim() === t.transferId) {
        sheet.getRange(rowIndex, 12, 1, 1).setValue('');
      }
    }
  });

  targets.sort(function(a, b) { return b.rowIndex - a.rowIndex; });
  targets.forEach(function(t) { sheet.deleteRow(t.rowIndex); result.deleted++; });
  Logger.log('已刪除 ' + result.deleted + ' 筆');
  return result;
}

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
