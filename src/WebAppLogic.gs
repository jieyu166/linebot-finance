/**
 * WebAppLogic.gs — 網頁 App 用純邏輯（不碰試算表）
 */

/**
 * 取得日期字串所屬月份鍵值
 * @param {string} dateStr - 日期字串
 * @returns {string} 'yyyy-MM'；無法解析時回傳 ''
 */
function monthKeyOf(dateStr) {
  var d = parseSheetDate(dateStr);
  if (!d) { return ''; }
  var m = d.getMonth() + 1;
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}

/**
 * 篩出屬於指定月份的交易，依日期字串降冪，同日依 rowIndex 降冪排序
 * @param {Object[]} txs - 交易物件陣列
 * @param {string} yearMonth - 'yyyy-MM'
 * @returns {Object[]}
 */
function filterTransactionsByMonth(txs, yearMonth) {
  return txs.filter(function(tx) { return monthKeyOf(tx.date) === yearMonth; })
    .sort(function(a, b) {
      if (a.date !== b.date) { return a.date < b.date ? 1 : -1; }
      return (b.rowIndex || 0) - (a.rowIndex || 0);
    });
}

/**
 * 依分類彙總指定類型交易的金額與占比，排除已配對轉帳的列
 * @param {Object[]} txs - 交易物件陣列
 * @param {string} type - '支出' 或 '收入'
 * @returns {Object} { total, byCategory:[{name, amount, ratio}] }，byCategory 依 amount 降冪
 */
function summarizeByCategory(txs, type) {
  var totals = {};
  var total = 0;
  txs.forEach(function(tx) {
    if (tx.type !== type || tx.transferId) { return; }
    var amount = Math.abs(parseAmount(tx.amount));
    totals[tx.category] = (totals[tx.category] || 0) + amount;
    total += amount;
  });
  var byCategory = Object.keys(totals).map(function(name) {
    return { name: name, amount: totals[name], ratio: total > 0 ? Math.round(totals[name] / total * 1000) / 1000 : 0 };
  }).sort(function(a, b) { return b.amount - a.amount; });
  return { total: total, byCategory: byCategory };
}

/**
 * 依 ratio 判斷預算使用等級
 * @param {number} ratio - 使用比例
 * @returns {string} 'over' | 'warn' | 'ok'
 */
function budgetLevel(ratio) {
  if (ratio >= 1) { return 'over'; }
  if (ratio >= 0.8) { return 'warn'; }
  return 'ok';
}

/**
 * 彙總指定月份的預算使用狀況（依分類或依帳戶）
 * @param {Object[]} txs - 交易物件陣列
 * @param {Object[]} budgets - [{kind:'分類'|'帳戶', name, budget}]
 * @param {string} yearMonth - 'yyyy-MM'
 * @returns {Object[]} [{kind, name, budget, used, remaining, ratio, level}]
 */
function summarizeBudgetUsage(txs, budgets, yearMonth) {
  var monthTxs = txs.filter(function(tx) { return tx.type === '支出' && !tx.transferId && monthKeyOf(tx.date) === yearMonth; });
  return budgets.map(function(b) {
    var used = 0;
    monthTxs.forEach(function(tx) {
      if ((b.kind === '分類' && tx.category === b.name) || (b.kind === '帳戶' && normalizeName(tx.account) === normalizeName(b.name))) {
        used += Math.abs(parseAmount(tx.amount));
      }
    });
    var budget = Math.abs(parseAmount(b.budget));
    var ratio = budget > 0 ? Math.round(used / budget * 1000) / 1000 : 0;
    return { kind: b.kind, name: b.name, budget: budget, used: used, remaining: budget - used, ratio: ratio, level: budgetLevel(ratio) };
  });
}

/**
 * 將試算表原始列資料中指定類型與舊分類名稱改為新分類名稱
 * @param {Array[]} rows - 試算表原始列陣列（每列為欄位陣列，D 欄=索引3 類型，E 欄=索引4 分類）
 * @param {string} type - 類型（D 欄）
 * @param {string} oldName - 舊分類名稱（E 欄）
 * @param {string} newName - 新分類名稱
 * @returns {Object} { rows, changedRowIndexes:number[] }，changedRowIndexes 為試算表列號（從 2 起算）
 */
function replaceCategoryInRows(rows, type, oldName, newName) {
  var changed = [];
  rows.forEach(function(row, i) {
    if (String(row[3] || '').trim() === type && String(row[4] || '').trim() === oldName) {
      row[4] = newName;
      changed.push(i + 2);
    }
  });
  return { rows: rows, changedRowIndexes: changed };
}

/**
 * 手動轉帳配對候選：7 天內、不限分類
 * @param {Object} tx - 目標交易
 * @param {Object[]} allTx - 全部交易
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object[]} 候選交易陣列
 */
function pickManualTransferCandidates(tx, allTx, accounts) {
  return pickTransferCandidates(tx, allTx, accounts, { dayWindow: 7, anyCategory: true });
}
