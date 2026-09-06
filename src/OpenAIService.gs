/**
 * OpenAIService.gs — OpenAI API 呼叫與 Prompt 設計
 */

/**
 * 把帳戶清單描述成「名稱（機構，幣別，類型，帳號 hint1/hint2）」的頓號串
 * 無帳號提示時省略「，帳號 …」段落
 * @param {Object[]} accounts - 帳戶物件陣列
 * @returns {string} 帳戶描述字串
 */
function describeAccounts(accounts) {
  return (accounts || []).map(function(a) {
    var hints = (a.accountNumberHints || []).filter(function(h) { return String(h || '').trim() !== ''; });
    return a.name + '（' + a.institution + '，' + (a.currency || 'TWD') + '，' + (a.type || '')
      + (hints.length > 0 ? '，帳號 ' + hints.join('/') : '') + '）';
  }).join('、');
}

/**
 * 建構文字記帳用 System Prompt
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {Object[]} accounts - 帳戶物件陣列
 * @returns {string} system prompt
 */
function buildSystemPrompt(expenseCategories, incomeCategories, accounts) {
  accounts = accounts || [];
  return '你是一個記帳助手。使用者會傳送記帳訊息，你必須解析並回傳 JSON。\n\n'
    + '## 規則\n'
    + '1. 判斷是「支出」還是「收入」。預設為「支出」，除非訊息明確提到收入相關的詞彙（如：薪水、收到、入帳、獎金、股利、利息、回饋等）。\n'
    + '2. 從對應的分類清單中選擇最適合的分類。\n'
    + '3. 提取品項（簡短名稱）。\n'
    + '4. 提取明細描述（原始訊息內容或補充說明）。\n'
    + '5. 提取金額（正整數）。\n'
    + '6. 金融機構預設為「現金」，除非使用者明確提到銀行、信用卡等。\n'
    + '7. 帳戶名稱必須從以下帳戶清單中選擇；一般現金交易填「現金」；提到某銀行信用卡時選該銀行「類型=信用卡」的帳戶；無法對應則填空字串：' + describeAccounts(accounts) + '\n'
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
    + '輸入：玉山信用卡 加油1500\n輸出：{"type":"支出","category":"交通","item":"加油","description":"玉山信用卡加油","institution":"玉山銀行","account":"玉山信用卡","currency":"TWD","amount":1500}\n\n'
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
 * @param {Object[]} accounts - 帳戶物件陣列
 * @returns {Object} { type, category, item, description, institution, account, currency, amount }
 */
function parseWithOpenAI(message, expenseCategories, incomeCategories, accounts) {
  var apiKey = getConfig('OPENAI_API_KEY');
  var url = 'https://api.openai.com/v1/chat/completions';

  var systemPrompt = buildSystemPrompt(expenseCategories, incomeCategories, accounts);

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
 * @param {Object[]} accounts - 帳戶物件陣列
 * @returns {string} system prompt
 */
function buildPdfSystemPrompt(expenseCategories, incomeCategories, accounts) {
  accounts = accounts || [];
  return '你是一個台灣銀行帳單解析助手。使用者會提供從銀行帳單 PDF 擷取的文字內容，你必須批次解析所有交易並回傳 JSON。\n\n'

    + '## 支援的銀行與帳單類型\n'
    + '信用卡帳單：第一銀行、永豐銀行、玉山銀行、台新銀行、富邦銀行、國泰銀行\n'
    + '銀行帳戶明細：永豐銀行、LINE Bank、王道銀行、玉山銀行、台新銀行(Richart)、富邦銀行、樂天銀行、中國信託\n'
    + '證券對帳單：永豐證券（國內+復委託）、台新證券\n\n'

    + '## 帳單類型判斷（statementType）\n'
    + '先判斷整份帳單屬於哪一種類型，填入頂層 "statementType" 欄位，只能是「信用卡」「銀行帳戶」「證券」三者之一：\n'
    + '- 信用卡：出現「結帳日」「帳單結帳日期」「應繳總額」「最低應繳金額」「卡號後四碼」「循環信用」等字樣。\n'
    + '- 銀行帳戶：出現「帳號」「摘要」「支出」「存入」「餘額」等欄位，逐筆列出存提款明細。\n'
    + '- 證券：出現「成交日期」「交易別」「股數」「單價」「客戶應收」「客戶應付」「應收付(-)金額」「交割」等字樣。\n\n'

    + '## 民國年轉換規則（重要）\n'
    + '台灣部分銀行使用民國年（ROC year）。轉換方式：民國年 + 1911 = 西元年。\n'
    + '例如：115/03/07 → 2026/03/07，114/12/25 → 2025/12/25。\n'
    + '使用民國年的銀行：第一銀行、玉山銀行、台新銀行、富邦銀行。\n'
    + '判斷依據：日期格式為 1XX/MM/DD（三位數年份）即為民國年。\n'
    + '其他銀行使用西元年（2026/MM/DD）或僅有 MM/DD。\n'
    + '信用卡帳單只有 MM/DD 時，以「帳單結帳日」的年份推算；若消費月份大於結帳月份，代表是前一年（跨年帳單）。\n\n'

    + '## 必須跳過的行（不計入交易）\n'
    + '1. 信用卡帳單中的繳款/自動扣繳確認行：含「自動扣繳」「自扣已入帳」「繳款」「感謝您」且金額為負數，通常代表信用卡帳單已付款確認，應跳過。\n'
    + '   但銀行帳戶明細或網銀明細中的實際扣款交易不可跳過，需依交易內容分類，例如卡款扣繳分類為「繳信用卡」。\n'
    + '2. 帳單摘要行：「上期應繳總額」「本期應繳總額」「小計」「合計」「TOTAL」。\n'
    + '3. 行銷文字：權益公告、防詐宣導、額度資訊、利率資訊、點數資訊。\n'
    + '4. 資產摘要：存款總計、貸款總計、投資組合、資產配置。\n'
    + '5. 庫存明細：證券庫存、持股明細（只記交易明細，不記庫存）。\n'
    + '6. 分頁標記：「續下頁」、頁碼、重複出現的表頭。\n'
    + '7. 定期存款明細：定存筆數、到期日等參考資訊。\n'
    + '8. 金額為 0 的行（如外幣利息 $0）。\n'
    + '9. 信用卡帳單中含「回饋入帳戶」的列：這是回饋撥入銀行帳戶的紀錄，會在銀行帳戶明細重複出現，信用卡帳單一律跳過。\n'
    + '10. 交割戶（證券交割專戶）明細中的「定期買股」「交割」「證券買賣」列：實際交易已在證券對帳單記錄，跳過以免重複。\n'
    + '11. 證券對帳單的庫存段（未實現損益、庫存股數、市值）整段跳過。\n'
    + '12. 同帳戶內轉：轉出／轉入的對方帳號是自己的另一個帳號時，仍請照常輸出該列（含 accountNumber 與描述中的對方帳號原文），由系統後處理判斷是否丟棄。\n'
    + '13. 金額為 0 的「INTEREST」「利息」列。\n\n'

    + '## PDF 分頁去重\n'
    + '部分銀行 PDF 因分頁導致同一區塊重複出現（如永豐信用卡臺幣區塊出現兩次）。\n'
    + '請比對交易日期+金額+品項，去除完全重複的交易，每筆只保留一次。\n\n'

    + '## 方向判斷（支出／收入）\n'
    + '1. 若文字是以 tab 分隔的表格（例如從網銀網頁複製貼上），直接依「支出」欄與「存入」欄所在位置判斷：支出欄有值→type:支出；存入欄有值→type:收入。\n'
    + '2. 若欄位在 PDF 擷取時黏在一起、無法分辨金額屬於支出或存入，改用「餘額」欄判斷：本列餘額小於上一列餘額→支出；大於上一列餘額→收入；金額取兩列餘額差的絕對值。\n'
    + '3. 轉帳列的對方帳號請原文保留在 description 中（例如「網路非約轉帳 8080000015977221」），不要刪除數字。\n\n'

    + '## 交易分類規則\n'
    + '1. 一般消費：根據商店名稱判斷最適合的支出分類。\n'
    + '2. 回饋金/現金回饋：金額為負數且含「回饋」→ type:收入, category:回饋。\n'
    + '   信用卡帳單中含「回饋」但不含「入帳戶」且為負數的列 → type:收入, category:回饋，account 記在該張卡的信用卡帳戶。\n'
    + '   「大戶回饋」「幣倍回饋」「折讓款」→ type:收入, category:回饋。\n'
    + '   特殊情況：「大戶消費回饋入帳戶_國內 207 元」金額欄為 0，實際金額在描述中，請提取 207。\n'
    + '3. 國外交易服務費：→ type:支出, category:手續費。\n'
    + '4. 利息存入/存款息：→ type:收入, category:利息。「ACH股息」「股息」「配息」→ type:收入, category:股利。\n'
    + '5. 證券交易：\n'
    + '   - 現買/普買/買進 → type:支出, category:投資, amount 用「客戶應付」或「應收付(-)金額」的絕對值。\n'
    + '   - 現賣/普賣/賣出 → type:收入, category:投資獲利, amount 用「客戶應收」或正數金額。\n'
    + '   - 復委託：應收/付(-)金額為負數=買進(支出)，正數=賣出(收入)。\n'
    + '6. 貸款相關：貸款利息、償還本金、還本、本金攤還、放款繳款 → type:支出, category:貸款。網銀明細中的「還本」不可歸為轉帳。\n'
    + '7. 轉帳相關：跨行轉帳、網路轉帳、轉帳支取、跨行轉 → type:支出, category:轉帳；但若描述含「還本」或其他貸款本金償還語意，優先歸「貸款」。\n'
    + '   轉帳存入、跨行轉入、CD轉收 → type:收入, category:轉帳（收入分類中歸「其他」）。\n'
    + '   「手機換匯」「換匯」→ type:支出, category:轉帳。\n'
    + '   「現金提」「ATM提款」「跨行提款」→ type:支出, category:轉帳。\n'
    + '8. 信用卡款扣繳（從銀行帳戶扣信用卡費，例：卡款扣繳、信用卡自扣、信用卡款）→ type:支出, category:繳信用卡。\n'
    + '   「卡費換匯」→ type:支出, category:繳信用卡。「媒體轉帳 台新卡費」「玉山卡款扣繳」「中信卡」→ type:支出, category:繳信用卡。\n'
    + '9. 「薪資」「電匯 醫療財團法人」→ type:收入, category:薪資。\n'
    + '10. 愛金卡、一卡通、悠遊卡加值 → type:支出, category:交通。「優步-餐廳」「Uber Eats」→ type:支出, category:飲食。\n'
    + '11. 連結帳戶交易、連結帳戶扣款、線上支付、電子支付，若無明確商店或用途可判斷，多數先歸為 type:支出, category:飲食。\n'
    + '12. 發票獎金：→ type:收入, category:獎金。\n'
    + '13. 「連加*」前綴為感應支付消費，去除前綴後保留商店名稱。\n'
    + '14. LINE Bank 注意：主帳戶的「刷卡交易」和簽帳金融卡明細是同一筆，只記一次（記簽帳金融卡明細）。\n\n'

    + '## 帳戶清單\n'
    + describeAccounts(accounts) + '\n'
    + '"account" 欄位必須從上述帳戶清單中選擇；若完全無法對應，則填空字串。分流規則：\n'
    + '- 信用卡帳單（statementType=信用卡）：選同機構且類型=信用卡、幣別相符的帳戶；雙幣卡帳單的美元區塊要用 USD 的信用卡帳戶。\n'
    + '- 銀行帳戶明細（statementType=銀行帳戶）：依該段落上方的「帳號」行，把帳號原文（含 * 遮罩）填入該列的 "accountNumber" 欄位，例如 "198-01*-**10443-*"；一份 PDF 有多個帳號段落時，每列要填自己所屬段落的帳號。\n'
    + '- 證券對帳單（statementType=證券）：選同機構且類型=證券的帳戶。\n'
    + '- 同一份信用卡帳單有多張卡但屬同一個帳戶時，請把卡號末四碼寫入 description（例如「南紡購物中心 (7142)」）。\n\n'

    + '## 支出分類清單\n'
    + expenseCategories.join('、') + '\n\n'
    + '## 收入分類清單\n'
    + incomeCategories.join('、') + '\n\n'

    + '## 輸出格式（嚴格 JSON）\n'
    + '{"bank":"銀行名稱","statementType":"信用卡或銀行帳戶或證券","transactions":[{"date":"yyyy/MM/dd","type":"支出或收入","category":"分類名稱","item":"品項","description":"明細描述","institution":"金融機構","account":"帳戶清單中的帳戶名稱或空字串","accountNumber":"銀行帳戶明細的帳號原文，其他情況填空字串","currency":"幣別","amount":金額正數}],"skipped":跳過的行數}\n\n'

    + '## 範例\n\n'

    + '### 範例1：第一銀行信用卡（民國年）\n'
    + '輸入：帳單結帳日期 115/04/06\n'
    + '03/07 03/11 連加*南紡購物中心 1,901 7142\n'
    + '03/13 03/17 國外交易手續費(670.00 TWD) 10 7142\n'
    + '04/02 04/02 現金回饋-iLEO信用卡 -58 7142\n'
    + '03/09 03/09 永豐自扣已入帳,謝謝! -3,159\n'
    + '輸出：{"bank":"第一銀行","statementType":"信用卡","transactions":[{"date":"2026/03/07","type":"支出","category":"購物","item":"南紡購物中心","description":"連加*南紡購物中心 (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":1901},{"date":"2026/03/13","type":"支出","category":"手續費","item":"國外交易手續費","description":"國外交易手續費(670.00 TWD) (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":10},{"date":"2026/04/02","type":"收入","category":"回饋","item":"現金回饋","description":"現金回饋-iLEO信用卡 (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":58}],"skipped":2}\n\n'

    + '### 範例2：永豐銀行帳戶明細\n'
    + '輸入：帳號:198-01*-**10443-*(新臺幣)\n'
    + '2026/03/02 大戶回饋 607 210,973\n'
    + '2026/03/09 永豐卡費 21,207 239,766\n'
    + '2026/03/12 房貸還本 30,000 209,766\n'
    + '2026/03/15 連結帳戶交易 180 209,586\n'
    + '2026/03/21 利息存入 356 339,455\n'
    + '輸出：{"bank":"永豐銀行","statementType":"銀行帳戶","transactions":[{"date":"2026/03/02","type":"收入","category":"回饋","item":"大戶回饋","description":"大戶回饋","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":607},{"date":"2026/03/09","type":"支出","category":"繳信用卡","item":"永豐卡費","description":"永豐卡費扣繳","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":21207},{"date":"2026/03/12","type":"支出","category":"貸款","item":"房貸還本","description":"房貸還本","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":30000},{"date":"2026/03/15","type":"支出","category":"飲食","item":"連結帳戶交易","description":"連結帳戶交易","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":180},{"date":"2026/03/21","type":"收入","category":"利息","item":"利息存入","description":"利息存入","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":356}],"skipped":0}\n\n'

    + '### 範例3：永豐證券\n'
    + '輸入：2026/03/03 普賣 國產 1,000 39.5500 39,550 56 118 39,376\n'
    + '2026/03/06 普買 台積電 5 1,892.0000 9,460 1 9,461\n'
    + '輸出：{"bank":"永豐證券","statementType":"證券","transactions":[{"date":"2026/03/03","type":"收入","category":"投資獲利","item":"國產","description":"普賣 國產 1,000股","institution":"永豐銀行","account":"永豐證券","accountNumber":"","currency":"TWD","amount":39376},{"date":"2026/03/06","type":"支出","category":"投資","item":"台積電","description":"普買 台積電 5股","institution":"永豐銀行","account":"永豐證券","accountNumber":"","currency":"TWD","amount":9461}],"skipped":0}\n\n'

    + '### 範例4：中國信託帳戶明細（網頁複製，tab 分隔）\n'
    + '輸入：日期\t摘要\t支出\t存入\t餘額\t備註\n'
    + '2026/08/05\t薪資\t\t120,000\t185,000\t電匯 醫療財團法人\n'
    + '2026/08/07\t現金提\t20,000\t\t165,000\tATM提款\n'
    + '2026/08/12\t中信卡\t8,432\t\t156,568\t信用卡自動扣繳\n'
    + '2026/08/20\t跨行轉\t5,000\t\t151,568\t轉出 8220001234567\n'
    + '輸出：{"bank":"中國信託","statementType":"銀行帳戶","transactions":[{"date":"2026/08/05","type":"收入","category":"薪資","item":"薪資","description":"電匯 醫療財團法人","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":120000},{"date":"2026/08/07","type":"支出","category":"轉帳","item":"現金提","description":"ATM提款","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":20000},{"date":"2026/08/12","type":"支出","category":"繳信用卡","item":"中信卡","description":"信用卡自動扣繳","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":8432},{"date":"2026/08/20","type":"支出","category":"轉帳","item":"跨行轉","description":"轉出 8220001234567","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":5000}],"skipped":0}\n\n'

    + '只回傳 JSON，不要有任何其他文字。';
}

/**
 * 逐行過濾亂碼：去掉「非中英數與常見標點」字元比例超過 50% 的行
 * @param {string} text - 原始文字
 * @returns {string} 過濾後的文字
 */
function stripGarbledLines(text) {
  return String(text || '').split('\n').filter(function(line) {
    var s = line.trim();
    if (s === '') { return true; }
    var bad = (s.match(/[^一-鿿　-〿＀-￯A-Za-z0-9\s,.\/\-\+\*\(\)\[\]:：;；%$＄'"「」『』、。，！？!?_#&@=~]/g) || []).length;
    return bad / s.length <= 0.5;
  }).join('\n');
}

/**
 * 以帳號提示比對帳戶（唯一命中才回傳）
 * @param {Object[]} accounts - 帳戶清單
 * @param {string} accountNumber - 帳單上的帳號原文
 * @returns {Object|null} 命中的帳戶物件，否則 null
 */
function findAccountByNumber(accounts, accountNumber) {
  var hits = accounts.filter(function(a) {
    return (a.accountNumberHints || []).some(function(h) { return hintMatches(accountNumber, h); });
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 以「類型＋機構＋幣別」比對帳戶（唯一命中才回傳）
 * @param {Object[]} accounts - 帳戶清單
 * @param {string} type - 帳戶類型（信用卡／證券／銀行…）
 * @param {string} bank - 機構名稱
 * @param {string} currency - 幣別
 * @returns {Object|null} 命中的帳戶物件，否則 null
 */
function findAccountByTypeAndBank(accounts, type, bank, currency) {
  var b = normalizeName(bank || '').replace(/銀行$/, '');
  var hits = accounts.filter(function(a) {
    var inst = normalizeName(a.institution).replace(/銀行$/, '');
    return a.type === type && (a.currency || 'TWD') === (currency || 'TWD')
      && (b === '' || inst.indexOf(b) >= 0 || b.indexOf(inst) >= 0);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 匯入後處理：帳號分流、信用卡／證券帳單強制對應類型帳戶、同帳戶內轉丟棄
 * @param {Object} parsed - OpenAI 解析結果
 * @param {Object[]} accounts - 帳戶清單
 * @returns {{transactions: Object[], unmatchedAccountNumbers: string[]}}
 */
function resolveImportedAccounts(parsed, accounts) {
  var out = [], unmatched = {}, st = parsed.statementType || '';
  (parsed.transactions || []).forEach(function(tx) {
    var currency = String(tx.currency || 'TWD').toUpperCase();
    var acct = null;
    if (tx.accountNumber) {
      acct = findAccountByNumber(accounts, tx.accountNumber);
      if (!acct) { unmatched[tx.accountNumber] = true; return; }
      var cp = matchCounterpartyAccount(tx.description, accounts);
      if (cp && cp.name === acct.name) { return; } // 同帳戶內轉
    } else {
      acct = findAccountByName(accounts, tx.account);
      if (st === '信用卡' && (!acct || acct.type !== '信用卡' || acct.currency !== currency)) {
        acct = findAccountByTypeAndBank(accounts, '信用卡', parsed.bank || tx.institution, currency) || acct;
      } else if (st === '證券' && (!acct || acct.type !== '證券')) {
        acct = findAccountByTypeAndBank(accounts, '證券', parsed.bank || tx.institution, currency) || acct;
      }
    }
    if (acct) {
      tx.account = acct.name;
      tx.institution = acct.institution;
      tx.currency = acct.currency;
    } else {
      tx.currency = currency;
    }
    out.push(tx);
  });
  return { transactions: out, unmatchedAccountNumbers: Object.keys(unmatched) };
}

/**
 * 永豐 198-00 過渡戶處理：卡費合計寫入 TWD「卡費換匯」列的 fxAmount，
 * 「回饋」列改記到 USD 信用卡帳戶，其餘過渡戶列丟棄
 * @param {Object} parsed - OpenAI 解析結果
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object} 處理後的 parsed
 */
function extractFxCardPayment(parsed, accounts) {
  var txs = parsed.transactions || [];
  var isTransit = function(tx) { return String(tx.accountNumber || '').replace(/-/g, '').indexOf('19800') === 0; };
  var transit = txs.filter(isTransit);
  if (transit.length === 0) { return parsed; }
  var fxTotal = 0, rewards = [];
  transit.forEach(function(tx) {
    var text = (tx.item || '') + ' ' + (tx.description || '');
    if (tx.type === '支出' && /卡費/.test(text)) { fxTotal += Number(tx.amount) || 0; }
    if (tx.type === '收入' && /回饋/.test(text)) { rewards.push(tx); }
  });
  var usdCard = findAccountByTypeAndBank(accounts, '信用卡', parsed.bank, 'USD');
  var kept = txs.filter(function(tx) { return !isTransit(tx); });
  kept.forEach(function(tx) {
    if (tx.category === '繳信用卡' && /換匯/.test((tx.item || '') + (tx.description || '')) && fxTotal > 0) {
      tx.fxAmount = Math.round(fxTotal * 100) / 100;
    }
  });
  if (usdCard) {
    rewards.forEach(function(tx) {
      tx.accountNumber = '';
      tx.account = usdCard.name;
      tx.institution = usdCard.institution;
      tx.currency = 'USD';
      tx.category = '回饋';
      tx.type = '收入';
      kept.push(tx);
    });
  }
  parsed.transactions = kept;
  return parsed;
}

/**
 * 呼叫 OpenAI API 批次解析 PDF 帳單文字
 * @param {string} text - PDF 擷取的文字內容
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @param {Object[]} accounts - 帳戶物件陣列
 * @returns {Object} { bank, statementType, transactions: [...], skipped, unmatchedAccountNumbers }
 */
function parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accounts) {
  var apiKey = getConfig('OPENAI_API_KEY');
  var url = 'https://api.openai.com/v1/chat/completions';

  var systemPrompt = buildPdfSystemPrompt(expenseCategories, incomeCategories, accounts);

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

  parsed = extractFxCardPayment(parsed, accounts || []);
  var resolved = resolveImportedAccounts(parsed, accounts || []);
  parsed.transactions = resolved.transactions;
  parsed.unmatchedAccountNumbers = resolved.unmatchedAccountNumbers;

  return parsed;
}
