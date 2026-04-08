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
    var json = JSON.parse(e.postData.contents);
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
    // 讀取分類清單
    var expenseCategories = getCategories('支出分類');
    var incomeCategories = getCategories('收入分類');

    // 偵測是否為銀行帳單文字（多行、含帳單關鍵字）
    if (isBankStatement(userMessage)) {
      handleBankStatementText(replyToken, userMessage, expenseCategories, incomeCategories);
      return;
    }

    // 一般文字記帳流程
    var parsed = parseWithOpenAI(userMessage, expenseCategories, incomeCategories);

    // 驗證解析結果
    if (!parsed || !parsed.amount || parsed.amount <= 0 || !parsed.category || !parsed.type) {
      replyToLine(replyToken, '抱歉，無法解析這筆記帳。請輸入如：\n「午餐80」或「飲食 午餐便當 80」');
      return;
    }

    // 寫入試算表
    var now = new Date();
    var dateStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy/MM/dd');
    appendTransaction(
      dateStr,
      parsed.institution || '現金',
      parsed.account || '',
      parsed.type,
      parsed.category,
      parsed.item,
      parsed.description || userMessage,
      parsed.currency || 'TWD',
      parsed.amount,
      userMessage
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
    replyToLine(replyToken, replyText);

  } catch (error) {
    Logger.log('handleTextMessage error: ' + error.message);
    replyToLine(replyToken, '記帳失敗，請稍後再試。\n錯誤：' + error.message);
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

    // 偵測 OCR 格式損壞（中國信託等銀行 PDF 常見問題）
    var cleanChars = text.replace(/[\s\d\.\,\/\-\+\*\(\)]/g, '');
    var totalLen = cleanChars.length;
    var garbledCount = 0;
    for (var j = 0; j < cleanChars.length; j++) {
      var code = cleanChars.charCodeAt(j);
      if (code < 0x4E00 && code > 127 && !/[a-zA-Z]/.test(cleanChars[j])) {
        garbledCount++;
      }
    }
    if (totalLen > 0 && garbledCount / totalLen > 0.3) {
      replyToLine(replyToken, '此帳單格式無法正確辨識，請嘗試其他方式提供明細。');
      return;
    }

    // 讀取分類清單
    var expenseCategories = getCategories('支出分類');
    var incomeCategories = getCategories('收入分類');

    // 呼叫 OpenAI 批次解析
    var result = parsePdfWithOpenAI(text, expenseCategories, incomeCategories);

    if (!result.transactions || result.transactions.length === 0) {
      replyToLine(replyToken, '無法從此 PDF 中解析出交易紀錄，請確認是否為銀行帳單。');
      return;
    }

    // 批次寫入試算表
    appendTransactionsBatch(result.transactions);

    // 統計摘要
    var expenseCount = 0;
    var expenseTotal = 0;
    var incomeCount = 0;
    var incomeTotal = 0;

    for (var i = 0; i < result.transactions.length; i++) {
      var tx = result.transactions[i];
      if (tx.type === '支出') {
        expenseCount++;
        expenseTotal += tx.amount;
      } else {
        incomeCount++;
        incomeTotal += tx.amount;
      }
    }

    // 組合回覆訊息
    var replyText = '📄 帳單匯入完成！\n';
    if (result.bank) {
      replyText += '銀行：' + result.bank + '\n';
    }
    replyText += '共匯入 ' + result.transactions.length + ' 筆交易\n';
    if (expenseCount > 0) {
      replyText += '  支出：' + expenseCount + ' 筆，合計 ' + expenseTotal.toLocaleString() + ' 元\n';
    }
    if (incomeCount > 0) {
      replyText += '  回饋：' + incomeCount + ' 筆，合計 ' + incomeTotal.toLocaleString() + ' 元\n';
    }
    if (result.skipped && result.skipped > 0) {
      replyText += '  （跳過 ' + result.skipped + ' 筆無法辨識的項目）';
    }

    replyToLine(replyToken, replyText.trim());

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
    '支出', '存入', '轉入', '轉出', '提出',
    '成交日', '對帳單', '結帳日', '應繳'
  ];

  var matchCount = 0;
  for (var i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) >= 0) {
      matchCount++;
    }
  }

  // 至少命中 2 個關鍵字且文字長度超過 100 才當帳單
  return matchCount >= 2 && text.length > 100;
}

/**
 * 處理貼上的銀行帳單文字（走批次解析流程）
 * @param {string} replyToken
 * @param {string} text - 帳單文字
 * @param {string[]} expenseCategories
 * @param {string[]} incomeCategories
 */
function handleBankStatementText(replyToken, text, expenseCategories, incomeCategories) {
  // 呼叫批次解析（共用 PDF 的 prompt）
  var result = parsePdfWithOpenAI(text, expenseCategories, incomeCategories);

  if (!result.transactions || result.transactions.length === 0) {
    replyToLine(replyToken, '無法從文字中解析出交易紀錄。\n請確認是否為銀行帳單明細，或嘗試傳送 PDF 檔案。');
    return;
  }

  // 批次寫入試算表
  appendTransactionsBatch(result.transactions);

  // 統計摘要
  var expenseCount = 0;
  var expenseTotal = 0;
  var incomeCount = 0;
  var incomeTotal = 0;

  for (var i = 0; i < result.transactions.length; i++) {
    var tx = result.transactions[i];
    if (tx.type === '支出') {
      expenseCount++;
      expenseTotal += tx.amount;
    } else {
      incomeCount++;
      incomeTotal += tx.amount;
    }
  }

  // 組合回覆訊息
  var replyText = '📄 帳單文字匯入完成！\n';
  if (result.bank) {
    replyText += '銀行：' + result.bank + '\n';
  }
  replyText += '共匯入 ' + result.transactions.length + ' 筆交易\n';
  if (expenseCount > 0) {
    replyText += '  支出：' + expenseCount + ' 筆，合計 ' + expenseTotal.toLocaleString() + ' 元\n';
  }
  if (incomeCount > 0) {
    replyText += '  收入：' + incomeCount + ' 筆，合計 ' + incomeTotal.toLocaleString() + ' 元\n';
  }
  if (result.skipped && result.skipped > 0) {
    replyText += '  （跳過 ' + result.skipped + ' 筆無法辨識的項目）';
  }

  replyToLine(replyToken, replyText.trim());
}
