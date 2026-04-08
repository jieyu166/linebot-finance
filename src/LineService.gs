/**
 * LineService.gs — LINE Messaging API 互動
 */

/**
 * 回覆 LINE 訊息
 * @param {string} replyToken - LINE 回覆 token
 * @param {string} messageText - 回覆文字內容
 */
function replyToLine(replyToken, messageText) {
  var url = 'https://api.line.me/v2/bot/message/reply';
  var token = getConfig('LINE_CHANNEL_ACCESS_TOKEN');

  var payload = {
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: messageText
    }]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    Logger.log('LINE reply error: ' + response.getContentText());
  }
}

/**
 * 從 LINE Content API 下載檔案
 * @param {string} messageId - LINE 訊息 ID
 * @returns {Blob} 檔案 Blob
 */
function downloadContent(messageId) {
  var url = 'https://api-data.line.me/v2/bot/message/' + messageId + '/content';
  var token = getConfig('LINE_CHANNEL_ACCESS_TOKEN');

  var options = {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) {
    throw new Error('LINE Content API 錯誤: ' + response.getContentText());
  }

  return response.getBlob();
}
