/**
 * OpenAIService.gs — OpenAI API 呼叫與 Prompt 設計
 */

/**
 * 建構文字記帳用 System Prompt
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {string[]} accountNames - 帳戶名稱清單
 * @returns {string} system prompt
 */
function buildSystemPrompt(expenseCategories, incomeCategories, accountNames) {
  accountNames = accountNames || [];
  return '你是一個記帳助手。使用者會傳送記帳訊息，你必須解析並回傳 JSON。\n\n'
    + '## 規則\n'
    + '1. 判斷是「支出」還是「收入」。預設為「支出」，除非訊息明確提到收入相關的詞彙（如：薪水、收到、入帳、獎金、股利、利息、回饋等）。\n'
    + '2. 從對應的分類清單中選擇最適合的分類。\n'
    + '3. 提取品項（簡短名稱）。\n'
    + '4. 提取明細描述（原始訊息內容或補充說明）。\n'
    + '5. 提取金額（正整數）。\n'
    + '6. 金融機構預設為「現金」，除非使用者明確提到銀行、信用卡等。\n'
    + '7. 帳戶名稱必須從以下帳戶清單中選擇最接近的名稱；一般現金交易請填「現金」；若完全無法對應且也不是現金交易，則填空字串：' + accountNames.join('、') + '\n'
    + '8. 幣別預設為「TWD」，除非使用者提到外幣（如美金、日幣等）。\n\n'
    + '## 支出分類清單\n'
    + expenseCategories.join('、') + '\n\n'
    + '## 收入分類清單\n'
    + incomeCategories.join('、') + '\n\n'
    + '## 輸入格式\n'
    + '使用者可能使用以下兩種格式：\n'
    + '- 自然語言：「午餐80」「搭捷運35」「收到薪水50000」\n'
    + '- 指定格式：「分類 品項 金額」如「飲食 午餐便當 80」\n\n'
    + '無論哪種格式，都請正確解析。\n\n'
    + '## 輸出格式（嚴格 JSON）\n'
    + '{"type":"支出或收入","category":"分類名稱","item":"品項","description":"明細描述","institution":"金融機構","account":"帳戶名稱","currency":"幣別","amount":金額數字}\n\n'
    + '## 範例\n'
    + '輸入：午餐80\n輸出：{"type":"支出","category":"飲食","item":"午餐","description":"午餐80","institution":"現金","account":"現金","currency":"TWD","amount":80}\n\n'
    + '輸入：玉山信用卡 加油1500\n輸出：{"type":"支出","category":"交通","item":"加油","description":"玉山信用卡加油","institution":"玉山銀行","account":"玉山","currency":"TWD","amount":1500}\n\n'
    + '輸入：飲食 午餐便當 80\n輸出：{"type":"支出","category":"飲食","item":"午餐便當","description":"午餐便當","institution":"現金","account":"現金","currency":"TWD","amount":80}\n\n'
    + '輸入：收到薪水50000\n輸出：{"type":"收入","category":"薪資","item":"薪水","description":"收到薪水","institution":"現金","account":"現金","currency":"TWD","amount":50000}\n\n'
    + '輸入：給爸媽生活費10000\n輸出：{"type":"支出","category":"父母","item":"生活費","description":"給爸媽生活費","institution":"現金","account":"現金","currency":"TWD","amount":10000}\n\n'
    + '輸入：日本旅遊買藥妝3000日幣\n輸出：{"type":"支出","category":"購物","item":"藥妝","description":"日本旅遊買藥妝","institution":"現金","account":"現金","currency":"JPY","amount":3000}\n\n'
    + '只回傳 JSON，不要有任何其他文字。';
}

/**
 * 呼叫 OpenAI API 解析文字記帳訊息
 * @param {string} message - 使用者輸入的原文
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {string[]} accountNames - 帳戶名稱清單
 * @returns {Object} { type, category, item, description, institution, account, currency, amount }
 */
function parseWithOpenAI(message, expenseCategories, incomeCategories, accountNames) {
  var apiKey = getConfig('OPENAI_API_KEY');
  var url = 'https://api.openai.com/v1/chat/completions';

  var systemPrompt = buildSystemPrompt(expenseCategories, incomeCategories, accountNames);

  var payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var resCode = response.getResponseCode();

  if (resCode !== 200) {
    throw new Error('OpenAI API 錯誤 (' + resCode + '): ' + response.getContentText());
  }

  var resJson = JSON.parse(response.getContentText());
  var content = resJson.choices[0].message.content;
  var parsed = JSON.parse(content);

  parsed.amount = Number(parsed.amount);

  return parsed;
}

/**
 * 建構 PDF 帳單批次解析用 System Prompt
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {string[]} accountNames - 帳戶名稱清單
 * @returns {string} system prompt
 */
function buildPdfSystemPrompt(expenseCategories, incomeCategories, accountNames) {
  accountNames = accountNames || [];
  return '你是一個台灣銀行帳單解析助手。使用者會提供從銀行帳單 PDF 擷取的文字內容，你必須批次解析所有交易並回傳 JSON。\n\n'

    + '## 支援的銀行與帳單類型\n'
    + '信用卡帳單：第一銀行、永豐銀行、玉山銀行、台新銀行、富邦銀行、國泰銀行\n'
    + '銀行帳戶明細：永豐銀行、LINE Bank、王道銀行、玉山銀行、台新銀行(Richart)、富邦銀行、樂天銀行\n'
    + '證券對帳單：永豐證券（國內+復委託）、台新證券\n\n'

    + '## 民國年轉換規則（重要）\n'
    + '台灣部分銀行使用民國年（ROC year）。轉換方式：民國年 + 1911 = 西元年。\n'
    + '例如：115/03/07 → 2026/03/07，114/12/25 → 2025/12/25。\n'
    + '使用民國年的銀行：第一銀行、玉山銀行、台新銀行、富邦銀行。\n'
    + '判斷依據：日期格式為 1XX/MM/DD（三位數年份）即為民國年。\n'
    + '其他銀行使用西元年（2026/MM/DD）或僅有 MM/DD（需從帳單上下文推斷年份）。\n\n'

    + '## 必須跳過的行（不計入交易）\n'
    + '1. 信用卡帳單中的繳款/自動扣繳確認行：含「自動扣繳」「自扣已入帳」「繳款」「感謝您」且金額為負數，通常代表信用卡帳單已付款確認，應跳過。\n'
    + '   但銀行帳戶明細或網銀明細中的實際扣款交易不可跳過，需依交易內容分類，例如卡款扣繳分類為「繳信用卡」。\n'
    + '2. 帳單摘要行：「上期應繳總額」「本期應繳總額」「小計」「合計」「TOTAL」。\n'
    + '3. 行銷文字：權益公告、防詐宣導、額度資訊、利率資訊、點數資訊。\n'
    + '4. 資產摘要：存款總計、貸款總計、投資組合、資產配置。\n'
    + '5. 庫存明細：證券庫存、持股明細（只記交易明細，不記庫存）。\n'
    + '6. 分頁標記：「續下頁」、頁碼、重複出現的表頭。\n'
    + '7. 定期存款明細：定存筆數、到期日等參考資訊。\n'
    + '8. 金額為 0 的行（如外幣利息 $0）。\n\n'

    + '## PDF 分頁去重\n'
    + '部分銀行 PDF 因分頁導致同一區塊重複出現（如永豐信用卡臺幣區塊出現兩次）。\n'
    + '請比對交易日期+金額+品項，去除完全重複的交易，每筆只保留一次。\n\n'

    + '## 交易分類規則\n'
    + '1. 一般消費：根據商店名稱判斷最適合的支出分類。\n'
    + '2. 回饋金/現金回饋：金額為負數且含「回饋」→ type:收入, category:回饋。\n'
    + '   特殊情況：「大戶消費回饋入帳戶_國內 207 元」金額欄為 0，實際金額在描述中，請提取 207。\n'
    + '   「幣倍卡國外消費回饋金入帳戶」和「幣倍卡國外消費回饋」互相抵消，跳過。\n'
    + '3. 國外交易服務費：→ type:支出, category:手續費。\n'
    + '4. 利息存入/存款息：→ type:收入, category:利息。\n'
    + '5. 證券交易：\n'
    + '   - 現買/普買/買進 → type:支出, category:投資, amount 用「客戶應付」或「應收付(-)金額」的絕對值。\n'
    + '   - 現賣/普賣/賣出 → type:收入, category:投資獲利, amount 用「客戶應收」或正數金額。\n'
    + '   - 復委託：應收/付(-)金額為負數=買進(支出)，正數=賣出(收入)。\n'
    + '6. 貸款相關：貸款利息、償還本金、還本、本金攤還、放款繳款 → type:支出, category:貸款。網銀明細中的「還本」不可歸為轉帳。\n'
    + '7. 轉帳相關：跨行轉帳、網路轉帳、轉帳支取 → type:支出, category:轉帳；但若描述含「還本」或其他貸款本金償還語意，優先歸「貸款」。\n'
    + '   轉帳存入、跨行轉入、CD轉收 → type:收入, category:轉帳（收入分類中歸「其他」）。\n'
    + '8. 信用卡款扣繳（從銀行帳戶扣信用卡費，例：卡款扣繳、信用卡自扣、信用卡款）→ type:支出, category:繳信用卡。\n'
    + '9. 連結帳戶交易、連結帳戶扣款、線上支付、電子支付，若無明確商店或用途可判斷，多數先歸為 type:支出, category:飲食。\n'
    + '10. 發票獎金：→ type:收入, category:獎金。\n'
    + '11. 「連加*」前綴為感應支付消費，去除前綴後保留商店名稱。\n'
    + '12. LINE Bank 注意：主帳戶的「刷卡交易」和簽帳金融卡明細是同一筆，只記一次（記簽帳金融卡明細）。\n\n'

    + '## 帳戶名稱清單\n'
    + accountNames.join('、') + '\n'
    + '"account" 欄位必須從上述帳戶清單中選擇最接近的名稱；若完全無法對應，則填空字串。\n\n'

    + '## 支出分類清單\n'
    + expenseCategories.join('、') + '\n\n'
    + '## 收入分類清單\n'
    + incomeCategories.join('、') + '\n\n'

    + '## 輸出格式（嚴格 JSON）\n'
    + '{"bank":"銀行名稱","transactions":[{"date":"yyyy/MM/dd","type":"支出或收入","category":"分類名稱","item":"品項","description":"明細描述","institution":"金融機構","account":"帳戶清單中的帳戶名稱或空字串","currency":"幣別","amount":金額正數}],"skipped":跳過的行數}\n\n'

    + '## 範例\n\n'

    + '### 範例1：第一銀行信用卡（民國年）\n'
    + '輸入：帳單結帳日期 115/04/06\n'
    + '03/07 03/11 連加*南紡購物中心 1,901 7142\n'
    + '03/13 03/17 國外交易手續費(670.00 TWD) 10 7142\n'
    + '04/02 04/02 現金回饋-iLEO信用卡 -58 7142\n'
    + '03/09 03/09 永豐自扣已入帳,謝謝! -3,159\n'
    + '輸出：{"bank":"第一銀行","transactions":[{"date":"2026/03/07","type":"支出","category":"購物","item":"南紡購物中心","description":"連加*南紡購物中心","institution":"第一銀行","account":"一銀","currency":"TWD","amount":1901},{"date":"2026/03/13","type":"支出","category":"手續費","item":"國外交易手續費","description":"國外交易手續費(670.00 TWD)","institution":"第一銀行","account":"一銀","currency":"TWD","amount":10},{"date":"2026/04/02","type":"收入","category":"回饋","item":"現金回饋","description":"現金回饋-iLEO信用卡","institution":"第一銀行","account":"一銀","currency":"TWD","amount":58}],"skipped":2}\n\n'

    + '### 範例2：永豐銀行帳戶明細\n'
    + '輸入：帳號:198-01*-**10443-*(新臺幣)\n'
    + '2026/03/02 大戶回饋 607 210,973\n'
    + '2026/03/09 永豐卡費 21,207 239,766\n'
    + '2026/03/12 房貸還本 30,000 209,766\n'
    + '2026/03/15 連結帳戶交易 180 209,586\n'
    + '2026/03/21 利息存入 356 339,455\n'
    + '輸出：{"bank":"永豐銀行","transactions":[{"date":"2026/03/02","type":"收入","category":"回饋","item":"大戶回饋","description":"大戶回饋","institution":"永豐銀行","account":"永豐大戶","currency":"TWD","amount":607},{"date":"2026/03/09","type":"支出","category":"繳信用卡","item":"永豐卡費","description":"永豐卡費扣繳","institution":"永豐銀行","account":"永豐大戶","currency":"TWD","amount":21207},{"date":"2026/03/12","type":"支出","category":"貸款","item":"房貸還本","description":"房貸還本","institution":"永豐銀行","account":"永豐大戶","currency":"TWD","amount":30000},{"date":"2026/03/15","type":"支出","category":"飲食","item":"連結帳戶交易","description":"連結帳戶交易","institution":"永豐銀行","account":"永豐大戶","currency":"TWD","amount":180},{"date":"2026/03/21","type":"收入","category":"利息","item":"利息存入","description":"利息存入","institution":"永豐銀行","account":"永豐大戶","currency":"TWD","amount":356}],"skipped":0}\n\n'

    + '### 範例3：永豐證券\n'
    + '輸入：2026/03/03 普賣 國產 1,000 39.5500 39,550 56 118 39,376\n'
    + '2026/03/06 普買 台積電 5 1,892.0000 9,460 1 9,461\n'
    + '輸出：{"bank":"永豐證券","transactions":[{"date":"2026/03/03","type":"收入","category":"投資獲利","item":"國產","description":"普賣 國產 1,000股","institution":"永豐證券","account":"永豐證券","currency":"TWD","amount":39376},{"date":"2026/03/06","type":"支出","category":"投資","item":"台積電","description":"普買 台積電 5股","institution":"永豐證券","account":"永豐證券","currency":"TWD","amount":9461}],"skipped":0}\n\n'

    + '只回傳 JSON，不要有任何其他文字。';
}

/**
 * 呼叫 OpenAI API 批次解析 PDF 帳單文字
 * @param {string} text - PDF 擷取的文字內容
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {string[]} accountNames - 帳戶名稱清單
 * @returns {Object} { bank, transactions: [...], skipped }
 */
function parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accountNames) {
  var apiKey = getConfig('OPENAI_API_KEY');
  var url = 'https://api.openai.com/v1/chat/completions';

  var systemPrompt = buildPdfSystemPrompt(expenseCategories, incomeCategories, accountNames);

  var payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var resCode = response.getResponseCode();

  if (resCode !== 200) {
    throw new Error('OpenAI API 錯誤 (' + resCode + '): ' + response.getContentText());
  }

  var resJson = JSON.parse(response.getContentText());
  var content = resJson.choices[0].message.content;
  var parsed = JSON.parse(content);

  if (parsed.transactions) {
    parsed.transactions = parsed.transactions.map(function(tx) {
      tx.amount = Number(tx.amount);
      return tx;
    });
  }

  return parsed;
}
