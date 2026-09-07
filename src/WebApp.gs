/**
 * WebApp.gs — 網頁 App 的 google.script.run API 入口
 * 每個 api 皆以 try/catch 包住，讓錯誤訊息（中文）能傳到前端。
 */

/**
 * 載入 HTML 部分檔內容（供 Index.html 內 <?!= include('xxx') ?> 使用）
 * @param {string} name - 檔名（不含副檔名）
 * @returns {string}
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * 判斷目前呼叫者是否有權限使用網頁 App：
 * 於「只有我自己」部署時，Session.getActiveUser() 會回傳擁有者本人的 email，
 * 與 Session.getEffectiveUser()（腳本擁有者）相同；否則（例如 LINE 用的「所有人」部署）
 * getActiveUser() 會是空字串。另外提供 Script Property WEBAPP_TOKEN 作為備援：
 * 網址加 &t=token 亦可放行（未設定 WEBAPP_TOKEN 時此路徑一律不通過）。
 * @param {string} token - 呼叫端提供的權杖（doGet 的 e.parameter.t 或 App.html 傳入的第一個參數）
 * @returns {boolean}
 */
function webAppAccessAllowed(token) {
  var activeEmail = '';
  try { activeEmail = Session.getActiveUser().getEmail(); } catch (e) { activeEmail = ''; }
  var effectiveEmail = '';
  try { effectiveEmail = Session.getEffectiveUser().getEmail(); } catch (e) { effectiveEmail = ''; }
  if (activeEmail && activeEmail === effectiveEmail) { return true; }

  var configuredToken = getConfig('WEBAPP_TOKEN');
  if (configuredToken && String(configuredToken).trim() !== '' && token === configuredToken) { return true; }

  return false;
}

/**
 * 權限檢查未通過時拋出錯誤；供每個 api* 函式在做任何事之前呼叫
 * @param {string} token - 呼叫端提供的權杖
 */
function requireWebAppAccess(token) {
  if (!webAppAccessAllowed(token)) { throw new Error('無權限使用此 App'); }
}

/**
 * 網頁 App 初始化資料：分類、帳戶、預算、今日日期
 * @param {string} auth - 權限權杖
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { expenseCategories, incomeCategories, accounts, budgets, today }
 */
function apiBootstrap(auth, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    var toCategoryView = function(c) { return { name: c.name, icon: c.icon, color: c.color }; };
    var toAccountView = function(a) { return { name: a.name, institution: a.institution, currency: a.currency, type: a.type }; };
    var toBudgetView = function(b) { return { kind: b.kind, name: b.name, budget: b.budget }; };
    return {
      expenseCategories: getCategoryRows('支出分類', ss).map(toCategoryView),
      incomeCategories: getCategoryRows('收入分類', ss).map(toCategoryView),
      accounts: getAccounts(ss).map(toAccountView),
      budgets: getBudgets(ss).map(toBudgetView),
      today: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd')
    };
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 讀取所有交易紀錄並轉為交易物件（內部共用）
 * @param {Spreadsheet} ss - 試算表物件
 * @returns {Object[]}
 */
function loadAllTransactions_(ss) {
  return getTransactionRows(ss).map(function(row, i) { return rowToTransaction(row, i + 2); });
}

/**
 * 依月份取得交易清單，每筆加上 linkedAccount（配對對方帳戶名或空字串）
 * @param {string} auth - 權限權杖
 * @param {string} yearMonth - 'yyyy-MM'
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function apiListTransactions(auth, yearMonth, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    var all = loadAllTransactions_(ss);
    var byTransfer = {};
    all.forEach(function(t) {
      if (!t.transferId) { return; }
      if (!byTransfer[t.transferId]) { byTransfer[t.transferId] = []; }
      byTransfer[t.transferId].push(t);
    });
    return filterTransactionsByMonth(all, yearMonth).map(function(t) {
      var copy = {};
      for (var k in t) { copy[k] = t[k]; }
      copy.linkedAccount = '';
      if (t.transferId && byTransfer[t.transferId]) {
        var other = byTransfer[t.transferId].filter(function(o) { return o.id !== t.id; })[0];
        if (other) { copy.linkedAccount = other.account; }
      }
      return copy;
    });
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 新增或更新一筆交易；驗證金額、類型、分類、帳戶，機構自動帶入；
 * 新增列若分類為 繳信用卡／轉帳，會嘗試自動配對對方帳戶
 * @param {string} auth - 權限權杖
 * @param {Object} tx - 交易物件（有 id 則更新，否則新增）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} 儲存後的交易物件
 */
function apiSaveTransaction(auth, tx, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    var amount = parseAmount(tx.amount);
    if (!(amount > 0)) { throw new Error('金額必須大於 0'); }
    if (tx.type !== '支出' && tx.type !== '收入') { throw new Error('類型必須是支出或收入'); }
    if (!tx.category || String(tx.category).trim() === '') { throw new Error('請選擇分類'); }
    var account = findAccountByName(getAccounts(ss), tx.account);
    if (!account) { throw new Error('找不到帳戶「' + tx.account + '」'); }

    var payload = {};
    for (var k in tx) { payload[k] = tx[k]; }
    payload.institution = account.institution;
    payload.amount = amount;
    payload.currency = account.currency;

    var written;
    if (!payload.id) {
      payload.source = 'App';
      written = appendTransactionsBatch([payload], 'App', ss)[0];
      if (payload.category === '繳信用卡' || payload.category === '轉帳') {
        var pairing = tryAutoPair([written], ss);
        written.autoPaired = pairing.paired > 0;
      }
    } else {
      written = updateTransactionById(payload, ss);
    }
    return written;
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 刪除一筆交易
 * @param {string} auth - 權限權杖
 * @param {string} id - 交易 ID
 * @param {boolean} alsoLinked - 是否一併刪除配對的轉帳交易
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { deleted: number }
 */
function apiDeleteTransaction(auth, id, alsoLinked, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return deleteTransactionById(id, alsoLinked, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 建立一組轉帳交易（轉出＋轉入）
 * @param {string} auth - 權限權杖
 * @param {Object} params - { fromAccount, toAccount, amount, date, note, toAmount }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function apiCreateTransfer(auth, params, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return createTransfer(params, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 手動連結兩筆交易為轉帳
 * @param {string} auth - 權限權杖
 * @param {string} idA
 * @param {string} idB
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {string} 轉帳ID
 */
function apiLinkTransfer(auth, idA, idB, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return linkTransfer(idA, idB, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 解除轉帳配對
 * @param {string} auth - 權限權杖
 * @param {string} transferId
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 清除的交易列數
 */
function apiUnlinkTransfer(auth, transferId, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return unlinkTransfer(transferId, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 取得手動轉帳配對候選（7 天內、不限分類，含 rowIndex）
 * @param {string} auth - 權限權杖
 * @param {string} id - 目標交易 ID
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function apiTransferCandidates(auth, id, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    var accounts = getAccounts(ss);
    var all = loadAllTransactions_(ss);
    var target = null;
    all.forEach(function(t) { if (t.id === id) { target = t; } });
    if (!target) { throw new Error('找不到這筆交易，可能已被刪除'); }
    return pickManualTransferCandidates(target, all, accounts);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 依月份、類型彙總分類金額與占比
 * @param {string} auth - 權限權杖
 * @param {string} yearMonth - 'yyyy-MM'
 * @param {string} type - '支出' 或 '收入'
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { total, byCategory }
 */
function apiStats(auth, yearMonth, type, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return summarizeByCategory(filterTransactionsByMonth(loadAllTransactions_(ss), yearMonth), type);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 依月份彙總預算使用狀況
 * @param {string} auth - 權限權杖
 * @param {string} yearMonth - 'yyyy-MM'
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function apiBudgetUsage(auth, yearMonth, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return summarizeBudgetUsage(loadAllTransactions_(ss), getBudgets(ss), yearMonth);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 新增、更新或刪除預算
 * @param {string} auth - 權限權杖
 * @param {Object} params - { kind, name, amount }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { rowIndex, deleted }
 */
function apiSaveBudget(auth, params, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return upsertBudget(params, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 取得所有啟用帳戶目前餘額
 * @param {string} auth - 權限權杖
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object[]}
 */
function apiBalances(auth, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return getAllAccountBalances(ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 更新帳戶設定
 * @param {string} auth - 權限權杖
 * @param {string} name - 帳戶名稱
 * @param {Object} params - { initialBalance, initialDate, type }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {number} 更新的列號
 */
function apiSaveAccount(auth, name, params, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    return updateAccountSettings(name, params, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 新增或更新分類（可更名）；更名時一併更新既有交易與預算的分類名稱
 * @param {string} auth - 權限權杖
 * @param {Object} params - { type, name, icon, color, oldName }
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { rowIndex, renamed, changedTransactions?, changedBudgets? }
 */
function apiSaveCategory(auth, params, ss) {
  try {
    requireWebAppAccess(auth);
    ss = getSpreadsheet(ss);
    var sheetName = params.type === '支出' ? '支出分類' : '收入分類';
    var oldName = String(params.oldName || '').trim();
    var name = String(params.name || '').trim();
    if (oldName !== '' && oldName !== name) {
      // 先透過 apiRenameCategory 做「唯一一次」原子改名（本身自帶鎖）：
      // 交易／預算改名，以及分類表本身該列的 A 欄改名，皆在同一把鎖內完成。
      var renameResult = apiRenameCategory(auth, params.type, oldName, name, ss);
      // 分類表該列已改名為 name，這裡不再傳 oldName，只用來更新 icon/color，
      // 不會誤判成「重複」（目標列就是剛剛被改名的那一列）。
      var upsertParams = { name: params.name, icon: params.icon, color: params.color };
      var result = upsertCategory(sheetName, upsertParams, ss);
      result.changedTransactions = renameResult.changedTransactions;
      result.changedBudgets = renameResult.changedBudgets;
      return result;
    }
    return upsertCategory(sheetName, params, ss);
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  }
}

/**
 * 將指定類型的分類名稱原子性改名：同步更新交易紀錄 E 欄、預算表（kind='分類'）B 欄，
 * 以及分類表本身該列的 A 欄。全程（讀＋寫）都在同一把 LockService 鎖內完成，避免
 * TOCTOU（鎖外讀到的資料在鎖內寫入前被其他呼叫改動）。
 * @param {string} auth - 權限權杖
 * @param {string} type - '支出' 或 '收入'（交易紀錄 D 欄／分類表）
 * @param {string} oldName - 舊分類名稱
 * @param {string} newName - 新分類名稱
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { changedTransactions, changedBudgets, categoryRow }
 */
function apiRenameCategory(auth, type, oldName, newName, ss) {
  requireWebAppAccess(auth);
  ss = getSpreadsheet(ss);
  var trimmedOldName = String(oldName || '').trim();
  var trimmedNewName = String(newName || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (trimmedNewName === '') { throw new Error('分類名稱不可空白'); }
    if (normalizeName(trimmedOldName) === normalizeName(trimmedNewName)) {
      return { changedTransactions: 0, changedBudgets: 0, categoryRow: null };
    }

    var categorySheetName = type === '支出' ? '支出分類' : '收入分類';
    var categorySheet = ss.getSheetByName(categorySheetName);
    var categoryRows = getCategoryRows(categorySheetName, ss);
    var oldRow = null;
    var hasNewName = false;
    categoryRows.forEach(function(r) {
      if (normalizeName(r.name) === normalizeName(trimmedOldName)) { oldRow = r; }
      if (normalizeName(r.name) === normalizeName(trimmedNewName)) { hasNewName = true; }
    });
    if (hasNewName) { throw new Error('分類「' + trimmedNewName + '」已存在'); }
    if (!oldRow) { throw new Error('找不到分類「' + trimmedOldName + '」'); }

    var sheet = ss.getSheetByName('交易紀錄');
    var rows = getTransactionRows(ss);
    var replaced = replaceCategoryInRows(rows, type, trimmedOldName, trimmedNewName);

    var budgetSheet = ss.getSheetByName('預算');
    var budgetsToChange = getBudgets(ss).filter(function(b) {
      return b.kind === '分類' && normalizeName(b.name) === normalizeName(trimmedOldName);
    });

    replaced.changedRowIndexes.forEach(function(rowIndex) {
      sheet.getRange(rowIndex, 5, 1, 1).setValue(trimmedNewName);
    });
    budgetsToChange.forEach(function(b) {
      budgetSheet.getRange(b.rowIndex, 2, 1, 1).setValue(trimmedNewName);
    });
    categorySheet.getRange(oldRow.rowIndex, 1, 1, 1).setValue(trimmedNewName);

    return {
      changedTransactions: replaced.changedRowIndexes.length,
      changedBudgets: budgetsToChange.length,
      categoryRow: oldRow.rowIndex
    };
  } catch (e) {
    throw new Error(e && e.message ? e.message : String(e));
  } finally {
    lock.releaseLock();
  }
}
