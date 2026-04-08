/**
 * Config.gs — Script Properties 存取與初始化
 */

/**
 * 取得 Script Properties 中的設定值
 * @param {string} key - 屬性名稱
 * @returns {string} 屬性值
 */
function getConfig(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * 初始化 Script Properties
 * 首次使用時手動執行一次，請先將下方值替換為實際的金鑰和 ID
 */
function initializeProperties() {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'OPENAI_API_KEY': '請替換為你的 OpenAI API Key',
    'LINE_CHANNEL_SECRET': '請替換為你的 LINE Channel Secret',
    'LINE_CHANNEL_ACCESS_TOKEN': '請替換為你的 LINE Channel Access Token',
    'SHEET_ID': '請替換為你的 Google 試算表 ID'
  });
  Logger.log('Script Properties 已初始化，請確認已替換為實際值');
}

/**
 * 初始化試算表結構
 * 首次使用時手動執行一次，建立所有需要的工作表
 */
function initializeSheets() {
  var ss = SpreadsheetApp.openById(getConfig('SHEET_ID'));

  // 建立「交易紀錄」工作表
  var txSheet = ss.getSheetByName('交易紀錄');
  if (!txSheet) {
    txSheet = ss.insertSheet('交易紀錄');
    txSheet.getRange('A1:J1').setValues([['日期', '金融機構', '帳戶名稱', '類型', '分類', '品項', '明細描述', '幣別', '金額', '原始訊息']]);
    txSheet.setFrozenRows(1);
  }

  // 建立「支出分類」工作表
  var expSheet = ss.getSheetByName('支出分類');
  if (!expSheet) {
    expSheet = ss.insertSheet('支出分類');
    expSheet.getRange('A1').setValue('分類名稱');
    var expCategories = [
      ['飲食'], ['服飾'], ['家庭'], ['交通'], ['學習'],
      ['休閒'], ['購物'], ['醫療'], ['其他'], ['保險'],
      ['手續費'], ['稅金'], ['工作'], ['父母'], ['老婆'],
      ['買房'], ['紅包'], ['投資'], ['轉帳'], ['貸款']
    ];
    expSheet.getRange(2, 1, expCategories.length, 1).setValues(expCategories);
    expSheet.setFrozenRows(1);
  }

  // 建立「收入分類」工作表
  var incSheet = ss.getSheetByName('收入分類');
  if (!incSheet) {
    incSheet = ss.insertSheet('收入分類');
    incSheet.getRange('A1').setValue('分類名稱');
    var incCategories = [
      ['薪資'], ['利息'], ['兼職'], ['獎金'], ['回饋'],
      ['投資獲利'], ['股利'], ['家人給'], ['保險'], ['其他']
    ];
    incSheet.getRange(2, 1, incCategories.length, 1).setValues(incCategories);
    incSheet.setFrozenRows(1);
  }

  Logger.log('試算表結構已初始化');
}
