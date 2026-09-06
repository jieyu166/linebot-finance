/**
 * Main.gs — doPost 進入點與訊息路由
 */

/**
 * GET 請求處理（部署驗證用）
 */
function doGet(e) {
  return ContentService.createTextOutput('OK');
}

/**
 * LINE Webhook 進入點
 * @param {Object} e - POST 事件物件
 * @returns {TextOutput} HTTP 回應（一律 200）
 */
function doPost(e) {
  try {
    var body = e.postData.contents;

    // LINE 簽章驗證
    var headers = e.postData.headers || {};
    var signature = headers['x-line-signature'] || headers['X-Line-Signature'];
    if (signature) {
      if (!verifyLineSignature(body, signature)) {
        Logger.log('Invalid LINE signature');
        return ContentService.createTextOutput(
          JSON.stringify({ status: 'ok' })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      Logger.log('Cannot verify LINE signature: headers not available');
    }

    var json = JSON.parse(body);
    var events = json.events;

    for (var i = 0; i < events.length; i++) {
      var event = events[i];

      if (event.type === 'message') {
        if (event.message.type === 'text') {
          handleTextMessage(event);
        } else if (event.message.type === 'file') {
          handleFileMessage(event);
        }
        // 其他訊息類型（貼圖、圖片等）不處理不回覆
      }
    }
  } catch (error) {
    Logger.log('doPost error: ' + error.message);
  }

  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok' })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 處理文字訊息 — 記帳流程
 * @param {Object} event - LINE 訊息事件
 */
function handleTextMessage(event) {
  var userMessage = event.message.text.trim();
  var replyToken = event.replyToken;

  try {
    // 開啟試算表（整個流程共用一次）
    var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));

    var balanceCommand = detectBalanceCommand(userMessage);
    if (balanceCommand.isCommand) {
      handleBalanceCommand(replyToken, balanceCommand.accountName, ss);
      return;
    }

    // 讀取分類清單
    var expenseCategories = getCategories('支出分類', ss);
    var incomeCategories = getCategories('收入分類', ss);
    var accounts = getAccounts(ss);

    // 偵測是否為銀行帳單文字（多行、含帳單關鍵字）
    if (isBankStatement(userMessage)) {
      handleBankStatementText(replyToken, userMessage, expenseCategories, incomeCategories, accounts, ss);
      return;
    }

    // 一般文字記帳流程
    var parsed = parseWithOpenAI(userMessage, expenseCategories, incomeCategories, accounts);

    // 驗證解析結果
    if (!parsed || !parsed.amount || parsed.amount <= 0 || !parsed.category || !parsed.type) {
      replyToLine(replyToken, '抱歉，無法解析這筆記帳。請輸入如：\n「午餐80」或「飲食 午餐便當 80」');
      return;
    }

    // 寫入試算表
    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy/MM/dd');
    var written = appendTransaction(
      dateStr,
      parsed.institution || '現金',
      parsed.account || '',
      parsed.type,
      parsed.category,
      parsed.item,
      parsed.description || userMessage,
      parsed.currency || 'TWD',
      parsed.amount,
      userMessage,
      ss
    );

    // 回覆確認訊息
    var emoji = parsed.type === '支出' ? '💸' : '💰';
    var replyText = emoji + ' 記帳成功！\n'
      + '類型：' + parsed.type + '\n'
      + '分類：' + parsed.category + '\n'
      + '品項：' + parsed.item + '\n'
      + '金額：' + parsed.amount + ' ' + (parsed.currency || 'TWD');
    if (parsed.institution && parsed.institution !== '現金') {
      replyText += '\n機構：' + parsed.institution;
    }

    // 繳信用卡／轉帳：嘗試自動配對對方帳戶（配對失敗不影響已寫入的記帳，仍回報成功）
    if (parsed.category === '繳信用卡' || parsed.category === '轉帳') {
      var pairing = tryAutoPair([written], ss);
      if (pairing.paired > 0) {
        replyText += '\n已自動配對對方帳戶';
      }
    }

    replyToLine(replyToken, replyText);

  } catch (error) {
    Logger.log('handleTextMessage error: ' + error.message);
    replyToLine(replyToken, '記帳失敗，請稍後再試。\n錯誤：' + error.message);
  }
}

/**
 * 嘗試自動配對對方帳戶，失敗時記錄錯誤並回傳空結果，不中斷呼叫端流程
 * @param {Object|Object[]} written - 已寫入的交易紀錄，陣列或單一物件皆可（單一物件會自動包成陣列）
 * @param {Spreadsheet} ss
 * @returns {{paired:number, created:number, details:Array}}
 */
function tryAutoPair(written, ss) {
  try {
    var newTxs = (Object.prototype.toString.call(written) === '[object Array]') ? written : [written];
    return autoPairImportedTransactions(newTxs, ss);
  } catch (e) {
    Logger.log('auto-pair error: ' + e.message);
    return { paired: 0, created: 0, details: [] };
  }
}

/**
 * 處理檔案訊息 — PDF 帳單匯入流程
 * @param {Object} event - LINE 檔案訊息事件
 */
function handleFileMessage(event) {
  var replyToken = event.replyToken;
  var fileName = event.message.fileName || '';

  try {
    // 檢查是否為 PDF
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      replyToLine(replyToken, '目前僅支援 PDF 檔案，請傳送 PDF 格式的銀行帳單。');
      return;
    }

    // 下載 PDF
    var blob = downloadContent(event.message.id);

    // OCR 擷取文字
    var text;
    try {
      text = extractTextFromPdf(blob);
    } catch (e) {
      if (e.message === 'encrypted') {
        replyToLine(replyToken, '此 PDF 已加密，請先自行解密後再傳送。');
        return;
      }
      throw e;
    }

    if (!text || text.trim().length === 0) {
      replyToLine(replyToken, '無法從此 PDF 中擷取文字，請確認檔案是否正確。');
      return;
    }

    // 逐行過濾 OCR 亂碼行（中國信託等銀行 PDF 常見問題），只在全部被濾掉時才放棄
    text = stripGarbledLines(text);
    if (!text.trim()) {
      replyToLine(replyToken, '此帳單格式無法正確辨識，請嘗試其他方式提供明細。');
      return;
    }

    // 開啟試算表並讀取分類清單
    var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));
    var expenseCategories = getCategories('支出分類', ss);
    var incomeCategories = getCategories('收入分類', ss);
    var accounts = getAccounts(ss);

    // 呼叫 OpenAI 批次解析
    var result = parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accounts);

    if (!result.transactions || result.transactions.length === 0) {
      replyToLine(replyToken, '無法從此 PDF 中解析出交易紀錄，請確認是否為銀行帳單。');
      return;
    }

    // 去重、寫入、自動配對
    var outcome = importTransactions(result, 'PDF匯入', ss);

    replyToLine(replyToken, buildImportSummary(result, 'PDF', outcome));

  } catch (error) {
    Logger.log('handleFileMessage error: ' + error.message);
    replyToLine(replyToken, 'PDF 匯入失敗，請稍後再試。\n錯誤：' + error.message);
  }
}

/**
 * 偵測文字是否為銀行帳單明細
 * @param {string} text - 使用者輸入文字
 * @returns {boolean}
 */
function isBankStatement(text) {
  // 行數太少不可能是帳單
  var lines = text.split('\n');
  if (lines.length < 3) return false;

  // 帳單關鍵字偵測
  var keywords = [
    '交易日期', '交易明細', '帳單', '帳戶', '帳號',
    '餘額', '明細', '入帳', '消費日', '摘要',
    '轉入', '轉出', '提出',
    '成交日', '對帳單', '結帳日', '應繳'
  ];

  var matchCount = 0;
  for (var i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) >= 0) {
      matchCount++;
    }
  }

  // 至少命中 3 個關鍵字且文字長度超過 100 才當帳單
  return matchCount >= 3 && text.length > 100;
}

/**
 * 偵測是否為餘額查詢指令
 * @param {string} text - 使用者輸入文字
 * @returns {{isCommand:boolean, accountName:string|null}}
 */
function detectBalanceCommand(text) {
  text = String(text || '').trim();
  var allCommands = ['餘額', '查餘額', '所有餘額', '帳戶餘額'];
  if (allCommands.indexOf(text) >= 0) {
    return { isCommand: true, accountName: null };
  }

  var listCommands = ['帳戶清單', '帳戶列表'];
  if (listCommands.indexOf(text) >= 0) {
    return { isCommand: true, accountName: '__LIST__' };
  }

  if (text.length > 2 && text.slice(-2) === '餘額') {
    var suffixAccount = text.slice(0, -2).trim();
    if (suffixAccount !== '') {
      return { isCommand: true, accountName: suffixAccount };
    }
  }

  if (text.indexOf('餘額 ') === 0) {
    var prefixAccount = text.slice(3).trim();
    if (prefixAccount !== '') {
      return { isCommand: true, accountName: prefixAccount };
    }
  }

  return { isCommand: false, accountName: null };
}

/**
 * 格式化金額
 * @param {number} amount - 金額
 * @returns {string}
 */
function formatAmount(amount) {
  amount = Number(amount) || 0;
  var abs = Math.abs(amount);
  var hasCents = Math.round(abs * 100) % 100 !== 0;
  return (amount < 0 ? '-' : '') + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

/**
 * 格式化餘額金額，可附加非 TWD 幣別
 * @param {number} amount - 金額
 * @param {string} currency - 幣別
 * @returns {string}
 */
function formatBalanceAmount(amount, currency) {
  var formatted = formatAmount(amount);
  if (currency && currency !== 'TWD') {
    formatted += ' ' + currency;
  }
  return formatted;
}

/**
 * 格式化單一帳戶餘額一行文字：信用卡顯示「未繳」金額，其餘顯示原始餘額
 * @param {Object} balance - calculateBalanceFromRows() 回傳物件（需含 name、type、currency、currentBalance）
 * @returns {string}
 */
function formatBalanceLine(balance) {
  if (balance.type === '信用卡') {
    return balance.name + '：未繳 ' + formatBalanceAmount(-balance.currentBalance, balance.currency);
  }
  return balance.name + '：' + formatBalanceAmount(balance.currentBalance, balance.currency);
}

/**
 * 建構全帳戶餘額一覽回覆訊息：分「【資產】」（非信用卡）與「【信用卡】」兩區
 * @param {Object[]} balances - calculateBalanceFromRows() 回傳物件陣列
 * @param {string} today - yyyy/MM/dd 格式日期字串
 * @returns {string}
 */
function buildAllBalancesReply(balances, today) {
  var assets = balances.filter(function(b) { return b.type !== '信用卡'; });
  var creditCards = balances.filter(function(b) { return b.type === '信用卡'; });

  var reply = '💰 帳戶餘額一覽（' + today + '）';
  if (assets.length > 0) {
    reply += '\n【資產】';
    for (var i = 0; i < assets.length; i++) {
      reply += '\n' + formatBalanceLine(assets[i]);
    }
  }
  if (creditCards.length > 0) {
    reply += '\n【信用卡】';
    for (var j = 0; j < creditCards.length; j++) {
      reply += '\n' + formatBalanceLine(creditCards[j]);
    }
  }
  reply += '\n共 ' + balances.length + ' 個帳戶';
  return reply;
}

/**
 * 處理餘額查詢指令
 * @param {string} replyToken
 * @param {string|null} accountName
 * @param {Spreadsheet} ss
 */
function handleBalanceCommand(replyToken, accountName, ss) {
  if (accountName === null) {
    var balances = getAllAccountBalances(ss);
    if (balances.length === 0) {
      replyToLine(replyToken, '尚未設定任何帳戶，請先在試算表「帳戶管理」工作表填入資料。');
      return;
    }

    var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd');
    replyToLine(replyToken, buildAllBalancesReply(balances, today));
    return;
  }

  var accounts = getAccounts(ss);
  if (accountName === '__LIST__') {
    var listReply = '📋 帳戶清單（共 ' + accounts.length + ' 個）';
    for (var j = 0; j < accounts.length; j++) {
      listReply += '\n' + accounts[j].name + '（' + accounts[j].currency + '）';
    }
    replyToLine(replyToken, listReply);
    return;
  }

  var balance = calculateAccountBalance(accountName, ss);
  if (!balance) {
    var names = accounts.map(function(account) { return account.name; });
    replyToLine(replyToken, '找不到帳戶「' + accountName + '」。\n可用帳戶：' + names.join('、'));
    return;
  }

  var adjustment = formatAmount(balance.transactionTotal);
  if (balance.transactionTotal > 0) {
    adjustment = '+' + adjustment;
  }

  var initialLine = '初始餘額：' + formatBalanceAmount(balance.initialBalance, balance.currency);
  if (balance.initialDate) {
    initialLine += '（' + balance.initialDate + ' 起算）';
  }

  var replyText = '💰 ' + balance.name + ' 餘額\n\n'
    + '幣別：' + balance.currency + '\n'
    + initialLine + '\n'
    + '交易調整：' + adjustment + '（共 ' + balance.txCount + ' 筆）\n'
    + '當前餘額：' + formatBalanceAmount(balance.currentBalance, balance.currency);
  replyToLine(replyToken, replyText);
}

/**
 * 處理貼上的銀行帳單文字（走批次解析流程）
 * @param {string} replyToken
 * @param {string} text - 帳單文字
 * @param {string[]} expenseCategories
 * @param {string[]} incomeCategories
 * @param {Object[]} accounts - 帳戶物件陣列
 */
function handleBankStatementText(replyToken, text, expenseCategories, incomeCategories, accounts, ss) {
  // 呼叫批次解析（共用 PDF 的 prompt）
  var result = parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accounts);

  if (!result.transactions || result.transactions.length === 0) {
    replyToLine(replyToken, '無法從文字中解析出交易紀錄。\n請確認是否為銀行帳單明細，或嘗試傳送 PDF 檔案。');
    return;
  }

  // 去重、寫入、自動配對
  var outcome = importTransactions(result, '文字匯入', ss);

  replyToLine(replyToken, buildImportSummary(result, '文字', outcome));
}

/**
 * 串接匯入流程：去重 → 批次寫入 → 自動配對
 * @param {Object} result - parsePdfWithOpenAI 結果（含 transactions）
 * @param {string} source - 來源標記（'PDF匯入' 或 '文字匯入'）
 * @param {Spreadsheet} [ss] - 可選的試算表物件
 * @returns {Object} { written, skipped, merged, pairing }
 */
function importTransactions(result, source, ss) {
  var dedupe = dedupeAgainstSheet(result.transactions, ss);
  var written = appendTransactionsBatch(dedupe.kept, source, ss);
  for (var i = 0; i < written.length; i++) {
    if (dedupe.kept[i] && dedupe.kept[i].fxAmount !== undefined) {
      written[i].fxAmount = dedupe.kept[i].fxAmount;
    }
  }
  var pairing = autoPairImportedTransactions(written, ss);
  return { written: written, skipped: dedupe.skipped, merged: dedupe.merged, pairing: pairing };
}

/**
 * 建構匯入摘要回覆訊息（共用）
 * @param {Object} result - parsePdfWithOpenAI 結果
 * @param {string} source - 來源（'PDF' 或 '文字'）
 * @param {Object} [outcome] - importTransactions 回傳的結果
 * @returns {string} 格式化的回覆訊息
 */
function buildImportSummary(result, source, outcome) {
  var expenseCount = 0;
  var expenseTotal = 0;
  var incomeCount = 0;
  var incomeTotal = 0;

  var txList = outcome ? outcome.written : result.transactions;
  for (var i = 0; i < txList.length; i++) {
    var tx = txList[i];
    if (tx.type === '支出') {
      expenseCount++;
      expenseTotal += tx.amount;
    } else {
      incomeCount++;
      incomeTotal += tx.amount;
    }
  }

  var label = source === 'PDF' ? '帳單匯入完成！' : '帳單文字匯入完成！';
  var replyText = '📄 ' + label + '\n';
  if (result.bank) {
    replyText += '銀行：' + result.bank + '\n';
  }
  if (result.statementType) {
    replyText += '帳單類型：' + result.statementType + '\n';
  }
  replyText += '共匯入 ' + txList.length + ' 筆交易\n';
  if (expenseCount > 0) {
    replyText += '  支出：' + expenseCount + ' 筆，合計 ' + expenseTotal.toLocaleString() + ' 元\n';
  }
  if (incomeCount > 0) {
    replyText += '  收入：' + incomeCount + ' 筆，合計 ' + incomeTotal.toLocaleString() + ' 元\n';
  }
  if (result.skipped && result.skipped > 0) {
    replyText += '  （跳過 ' + result.skipped + ' 筆無法辨識的項目）\n';
  }

  if (outcome) {
    if (outcome.skipped && outcome.skipped.length > 0) {
      replyText += '  跳過與既有紀錄重複 ' + outcome.skipped.length + ' 筆';
      if (outcome.merged > 0) {
        replyText += '（更新 ' + outcome.merged + ' 筆股名）';
      }
      replyText += '\n';
    }
    if (outcome.pairing && outcome.pairing.paired > 0) {
      replyText += '  已自動配對 ' + outcome.pairing.paired + ' 筆';
      if (outcome.pairing.created > 0) {
        replyText += '（新增 ' + outcome.pairing.created + ' 筆對方帳戶紀錄）';
      }
      replyText += '\n';
    }
    if (outcome.pairing && outcome.pairing.details) {
      for (var d = 0; d < outcome.pairing.details.length; d++) {
        replyText += '  ⚠ ' + outcome.pairing.details[d] + '\n';
      }
    }
  }

  if (result.unmatchedAccountNumbers && result.unmatchedAccountNumbers.length > 0) {
    replyText += '  未對應帳號：' + result.unmatchedAccountNumbers.join('、') + '（請在帳戶管理 J 欄填帳號識別）\n';
  }
  if (result.intraAccountSkipped && result.intraAccountSkipped.length > 0) {
    replyText += '  同帳戶內轉已跳過 ' + result.intraAccountSkipped.length + ' 筆\n';
  }
  if (result.fxWarnings && result.fxWarnings.length > 0) {
    for (var w = 0; w < result.fxWarnings.length; w++) {
      replyText += '  ⚠ ' + result.fxWarnings[w] + '\n';
    }
  }

  return replyText.trim();
}
