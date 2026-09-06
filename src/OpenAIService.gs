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
    + '請比對交易日期+金額+品項，去除完全重複的交易，每筆只保留一次；只有整段文字完全重複（分頁造成）才去重。\n'
    + '同一天同商店同金額的多筆交易是真實發生的多筆交易，全部保留，不要因為日期金額相同就當成重複；每筆國外交易服務費也各自獨立記一筆，不可合併或省略。\n\n'

    + '## 信用卡多卡號區塊與雙幣帳單\n'
    + '信用卡帳單可能包含多個卡號區塊（同一帳戶不同卡片，或本人卡＋附卡），每個區塊以「小計」結尾；看到「小計」後不可停止，必須繼續解析下一個卡號區塊，直到整份帳單出現「總計」或「本期應繳總金額」為止，不可只解析第一個小計前的區塊。\n'
    + '雙幣信用卡帳單（同時有臺幣與美金消費）：美元區塊的交易務必解析並以 currency:"USD" 輸出，不可只解析臺幣區塊、遺漏美元區塊。\n'
    + '含外幣折算資訊的行（例如「Google Pikmin Bloom W USA Mountain View 07/31 TWD 660 TWD 660」，前一個金額是原幣別、後一個是繳款幣別折算金額）：amount 一律取「繳款幣別」的折算金額，不要取原幣別金額。\n'
    + '商店名稱跨多行顯示時，請合併成一個完整名稱再輸出，不要只取其中一行或拆成兩筆。\n\n'

    + '## 方向判斷（支出／收入）\n'
    + '1. 若文字是以 tab 分隔的表格（例如從網銀網頁複製貼上），直接依「支出」欄與「存入」欄所在位置判斷：支出欄有值→type:支出；存入欄有值→type:收入。\n'
    + '2. 若欄位在 PDF 擷取時黏在一起、無法分辨金額屬於支出或存入，改用「餘額」欄判斷：本列餘額小於上一列餘額→支出；大於上一列餘額→收入；金額取兩列餘額差的絕對值。\n'
    + '   即使方向不確定，也要照常輸出這一列（先填你判斷的 type），系統會依 balance 欄再次核對修正，不要因為方向不確定就跳過整列。\n'
    + '3. 轉帳列的對方帳號請原文保留在 description 中（例如「網路非約轉帳 8080000015977221」），不要刪除數字。\n\n'

    + '## balance／counterparty 欄位（銀行帳戶明細必填）\n'
    + '"balance" 欄位：這一列交易完成後的餘額／結餘數字（不含千分位逗號），銀行帳戶明細每一列都要填；信用卡帳單、證券對帳單沒有餘額欄則填 null。\n'
    + '"counterparty" 欄位：這一列摘要／備註中的對方帳號、轉入帳戶或原始備註文字（含數字），原文照抄，無則填空字串 ""；系統會用這個欄位補到 description 裡，不需要你手動重複附加。\n'
    + '"openingBalance" 欄位：僅每個帳號區塊「第一筆」交易需要填寫該區塊的上期餘額／期初餘額數字（不含千分位逗號），帳單上若無此資訊則填 null；同一區塊其餘列一律填 null。\n\n'

    + '## 交易分類規則\n'
    + '1. 一般消費：根據商店名稱判斷最適合的支出分類。\n'
    + '2. 回饋金/現金回饋：金額為負數且含「回饋」→ type:收入, category:回饋。\n'
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
    + '    momo、蝦皮、PChome → type:支出, category:購物。易遊網、NETFLIX、XSOLLA/PIKMIN、GOOGLE PLAY、YOUTUBE、PressPlay → type:支出, category:休閒。\n'
    + '11. 連結帳戶交易、連結帳戶扣款、線上支付、電子支付，若無明確商店或用途可判斷，多數先歸為 type:支出, category:飲食。\n'
    + '12. 發票獎金：→ type:收入, category:獎金。\n'
    + '13. 「連加*」前綴為感應支付消費，去除前綴後保留商店名稱。\n'
    + '14. LINE Bank 注意：主帳戶的「刷卡交易」和簽帳金融卡明細是同一筆，只記一次（記簽帳金融卡明細）。\n'
    + '15. "category" 只能填「支出分類清單」或「收入分類清單」中列出的字串，禁止自創清單以外的分類名稱（例如清單沒有「娛樂」就不可以填「娛樂」，要選清單中最接近的，例如「休閒」）。\n\n'

    + '## 帳戶清單\n'
    + describeAccounts(accounts) + '\n'
    + '"account" 欄位必須從上述帳戶清單中選擇；若完全無法對應，則填空字串。分流規則：\n'
    + '- 信用卡帳單（statementType=信用卡）：選同機構且類型=信用卡、幣別相符的帳戶；雙幣卡帳單的美元區塊要用 USD 的信用卡帳戶。\n'
    + '- 銀行帳戶明細（statementType=銀行帳戶）：依該段落上方的「帳號」行，把帳號原文（含 * 遮罩）填入該列的 "accountNumber" 欄位，例如 "198-01*-**10443-*"；一份 PDF 有多個帳號段落時，每列要填自己所屬段落的帳號。\n'
    + '- 證券對帳單（statementType=證券）：選同機構且類型=證券的帳戶。\n'
    + '- 同一份信用卡帳單有多張卡但屬同一個帳戶時，請把卡號末四碼寫入 description（例如「南紡購物中心 (7142)」）。\n'
    + '- 信用卡帳單銀行判斷提示（帳單上常見卡片別名 → 所屬銀行）：UBear 卡／U Bear 卡 → 玉山銀行；Cube 卡 → 國泰銀行；Costco 卡 → 富邦銀行；Line 卡 → 中國信託；綠活卡／iLEO 卡 → 第一銀行；大戶卡／幣倍卡／大衛卡 → 永豐銀行；Richart 卡 → 台新銀行。\n\n'

    + '## 支出分類清單\n'
    + expenseCategories.join('、') + '\n\n'
    + '## 收入分類清單\n'
    + incomeCategories.join('、') + '\n\n'

    + '## 輸出格式（嚴格 JSON）\n'
    + '{"bank":"銀行名稱","statementType":"信用卡或銀行帳戶或證券","transactions":[{"date":"yyyy/MM/dd","type":"支出或收入","category":"分類名稱","item":"品項","description":"明細描述","institution":"金融機構","account":"帳戶清單中的帳戶名稱或空字串","accountNumber":"銀行帳戶明細的帳號原文，其他情況填空字串","currency":"幣別","amount":金額正數,"balance":這筆交易後的餘額數字或null,"counterparty":"對方帳號／轉入帳戶／備註原文，無則空字串","openingBalance":該帳號區塊第一筆才填的上期餘額／期初餘額數字，其餘列填null}],"skipped":跳過的行數,"statementTotals":[{"currency":"TWD","newCharges":本期新增款項數字}]（僅信用卡帳單填，其他帳單類型省略此欄位）}\n\n'

    + '## 範例\n\n'

    + '### 範例1：第一銀行信用卡（民國年）\n'
    + '輸入：帳單結帳日期 115/04/06\n'
    + '03/07 03/11 連加*南紡購物中心 1,901 7142\n'
    + '03/13 03/17 國外交易手續費(670.00 TWD) 10 7142\n'
    + '04/02 04/02 現金回饋-iLEO信用卡 -58 7142\n'
    + '03/09 03/09 永豐自扣已入帳,謝謝! -3,159\n'
    + '小計 1,911\n本期應繳總金額 1,911\n'
    + '輸出：{"bank":"第一銀行","statementType":"信用卡","transactions":[{"date":"2026/03/07","type":"支出","category":"購物","item":"南紡購物中心","description":"連加*南紡購物中心 (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":1901,"balance":null,"counterparty":""},{"date":"2026/03/13","type":"支出","category":"手續費","item":"國外交易手續費","description":"國外交易手續費(670.00 TWD) (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":10,"balance":null,"counterparty":""},{"date":"2026/04/02","type":"收入","category":"回饋","item":"現金回饋","description":"現金回饋-iLEO信用卡 (7142)","institution":"第一銀行","account":"一銀信用卡","accountNumber":"","currency":"TWD","amount":58,"balance":null,"counterparty":""}],"skipped":2,"statementTotals":[{"currency":"TWD","newCharges":1911}]}\n\n'

    + '### 範例2：永豐銀行帳戶明細\n'
    + '輸入：帳號:198-01*-**10443-*(新臺幣)\n'
    + '2026/03/02 大戶回饋 607 210,973\n'
    + '2026/03/09 永豐卡費 21,207 239,766\n'
    + '2026/03/12 房貸還本 30,000 209,766\n'
    + '2026/03/15 連結帳戶交易 180 209,586\n'
    + '2026/03/21 利息存入 356 339,455\n'
    + '輸出：{"bank":"永豐銀行","statementType":"銀行帳戶","transactions":[{"date":"2026/03/02","type":"收入","category":"回饋","item":"大戶回饋","description":"大戶回饋","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":607,"balance":210973,"counterparty":""},{"date":"2026/03/09","type":"支出","category":"繳信用卡","item":"永豐卡費","description":"永豐卡費扣繳","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":21207,"balance":239766,"counterparty":""},{"date":"2026/03/12","type":"支出","category":"貸款","item":"房貸還本","description":"房貸還本","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":30000,"balance":209766,"counterparty":""},{"date":"2026/03/15","type":"支出","category":"飲食","item":"連結帳戶交易","description":"連結帳戶交易","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":180,"balance":209586,"counterparty":""},{"date":"2026/03/21","type":"收入","category":"利息","item":"利息存入","description":"利息存入","institution":"永豐銀行","account":"永豐大戶","accountNumber":"198-01*-**10443-*","currency":"TWD","amount":356,"balance":339455,"counterparty":""}],"skipped":0}\n\n'

    + '### 範例3：永豐證券\n'
    + '輸入：2026/03/03 普賣 國產 1,000 39.5500 39,550 56 118 39,376\n'
    + '2026/03/06 普買 台積電 5 1,892.0000 9,460 1 9,461\n'
    + '輸出：{"bank":"永豐證券","statementType":"證券","transactions":[{"date":"2026/03/03","type":"收入","category":"投資獲利","item":"國產","description":"普賣 國產 1,000股","institution":"永豐銀行","account":"永豐證券","accountNumber":"","currency":"TWD","amount":39376,"balance":null,"counterparty":""},{"date":"2026/03/06","type":"支出","category":"投資","item":"台積電","description":"普買 台積電 5股","institution":"永豐銀行","account":"永豐證券","accountNumber":"","currency":"TWD","amount":9461,"balance":null,"counterparty":""}],"skipped":0}\n\n'

    + '### 範例4：中國信託帳戶明細（網頁複製，tab 分隔）\n'
    + '輸入：日期\t摘要\t支出\t存入\t餘額\t備註\n'
    + '2026/08/05\t薪資\t\t120,000\t185,000\t電匯 醫療財團法人\n'
    + '2026/08/07\t現金提\t20,000\t\t165,000\tATM提款\n'
    + '2026/08/12\t中信卡\t8,432\t\t156,568\t信用卡自動扣繳\n'
    + '2026/08/20\t跨行轉\t5,000\t\t151,568\t轉出 8220001234567\n'
    + '輸出：{"bank":"中國信託","statementType":"銀行帳戶","transactions":[{"date":"2026/08/05","type":"收入","category":"薪資","item":"薪資","description":"電匯 醫療財團法人","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":120000,"balance":185000,"counterparty":""},{"date":"2026/08/07","type":"支出","category":"轉帳","item":"現金提","description":"ATM提款","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":20000,"balance":165000,"counterparty":""},{"date":"2026/08/12","type":"支出","category":"繳信用卡","item":"中信卡","description":"信用卡自動扣繳","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":8432,"balance":156568,"counterparty":""},{"date":"2026/08/20","type":"支出","category":"轉帳","item":"跨行轉","description":"轉出 8220001234567","institution":"中國信託","account":"中信","accountNumber":"","currency":"TWD","amount":5000,"balance":151568,"counterparty":"8220001234567"}],"skipped":0}\n\n'

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
 * @returns {{transactions: Object[], unmatchedAccountNumbers: string[], intraAccountSkipped: Object[]}}
 */
function resolveImportedAccounts(parsed, accounts) {
  var out = [], unmatched = {}, skipped = [], st = parsed.statementType || '';
  (parsed.transactions || []).forEach(function(tx) {
    var currency = String(tx.currency || 'TWD').toUpperCase();
    var acct = null;
    if (st === '證券') { tx.accountNumber = ''; }
    if (tx.accountNumber) {
      acct = findAccountByNumber(accounts, tx.accountNumber);
      if (!acct) { unmatched[tx.accountNumber] = true; return; }
      if (tx.category === '轉帳') {
        var cp = matchCounterpartyAccount(tx.description, accounts);
        if (cp && cp.name === acct.name) { // 同帳戶內轉
          skipped.push({ date: tx.date, item: tx.item, amount: tx.amount });
          return;
        }
      }
    } else {
      acct = findAccountByName(accounts, tx.account);
      if (st === '信用卡') {
        var bankMismatch = parsed.bank && acct && normalizeName(acct.institution).replace(/銀行$/, '') !== normalizeName(parsed.bank).replace(/銀行$/, '');
        if (!acct || acct.type !== '信用卡' || acct.currency !== currency || bankMismatch) {
          acct = findAccountByTypeAndBank(accounts, '信用卡', parsed.bank || tx.institution, currency) || acct;
        }
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
  return { transactions: out, unmatchedAccountNumbers: Object.keys(unmatched), intraAccountSkipped: skipped };
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
  var fxCandidates = kept.filter(function(tx) {
    return tx.category === '繳信用卡' && /換匯/.test((tx.item || '') + (tx.description || '')) && fxTotal > 0;
  });
  if (fxCandidates.length > 0) {
    fxCandidates[0].fxAmount = Math.round(fxTotal * 100) / 100;
    if (fxCandidates.length > 1) {
      parsed.fxWarnings = parsed.fxWarnings || [];
      parsed.fxWarnings.push('外幣卡費換匯有 ' + fxCandidates.length + ' 筆，僅第一筆自動配對，其餘請在 App 手動連結');
    }
  }
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
 * 依「類型＋機構＋幣別」比對帳戶（唯一命中才回傳）——見上方 findAccountByTypeAndBank
 */

/**
 * 依帳號分組後，用前後列餘額差修正方向（僅限銀行帳戶類型）
 * 規則：同一 accountNumber 分組（保留原順序），逐一比較連續兩列的 balance；
 * |Δbalance| 與 amount 相差 < 0.01 時，依 Δbalance 正負改寫 type；
 * 任一餘額缺漏或金額對不上則該列方向維持原樣。
 * 每個分組的第一列若有 openingBalance（該帳號區塊的上期餘額／期初餘額），
 * 則改用 delta = balance − openingBalance 比對，同樣規則修正方向。
 * @param {Object} parsed - { statementType, transactions }
 * @returns {Object} parsed（就地修改並回傳）
 */
function fixDirectionByBalance(parsed) {
  if (parsed.statementType !== '銀行帳戶') { return parsed; }
  var txs = parsed.transactions || [];
  var groups = {};
  var order = [];
  txs.forEach(function(tx) {
    var key = String(tx.accountNumber || '');
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(tx);
  });
  order.forEach(function(key) {
    var list = groups[key];
    if (list.length > 0) {
      var first = list[0];
      if (typeof first.openingBalance === 'number' && typeof first.balance === 'number') {
        var delta0 = first.balance - first.openingBalance;
        var amount0 = Number(first.amount) || 0;
        if (Math.abs(Math.abs(delta0) - amount0) < 0.01) {
          first.type = delta0 > 0 ? '收入' : '支出';
        }
      }
    }
    for (var i = 1; i < list.length; i++) {
      var prev = list[i - 1], cur = list[i];
      if (typeof prev.balance !== 'number' || typeof cur.balance !== 'number') { continue; }
      var delta = cur.balance - prev.balance;
      var amount = Number(cur.amount) || 0;
      if (Math.abs(Math.abs(delta) - amount) < 0.01) {
        cur.type = delta > 0 ? '收入' : '支出';
      }
    }
  });
  return parsed;
}

/**
 * 把 counterparty 原文（若尚未出現在 description 中）附加到 description
 * @param {Object} parsed - { transactions }
 * @returns {Object} parsed
 */
function appendCounterparty(parsed) {
  (parsed.transactions || []).forEach(function(tx) {
    var cp = String(tx.counterparty || '').trim();
    if (cp === '') { return; }
    var digits = cp.replace(/\D/g, '');
    var descDigits = String(tx.description || '').replace(/\D/g, '');
    if (digits !== '' && descDigits.indexOf(digits) >= 0) { return; }
    tx.description = String(tx.description || '').trim() ? (tx.description.trim() + ' ' + cp) : cp;
  });
  return parsed;
}

/**
 * 丟棄金額為 0 的列，以及信用卡帳單中「入帳戶」（回饋入帳戶）的列；計入 parsed.skipped
 * @param {Object} parsed - { statementType, skipped, transactions }
 * @returns {Object} parsed
 */
function dropZeroAndRewardDeposits(parsed) {
  var txs = parsed.transactions || [];
  var dropped = 0;
  var kept = txs.filter(function(tx) {
    var amount = Math.abs(parseAmount(tx.amount));
    if (amount === 0) { dropped++; return false; }
    if (parsed.statementType === '信用卡') {
      var text = (tx.item || '') + (tx.description || '');
      if (text.indexOf('入帳戶') >= 0) { dropped++; return false; }
    }
    return true;
  });
  parsed.transactions = kept;
  parsed.skipped = (parsed.skipped || 0) + dropped;
  return parsed;
}

/** 分類同義詞對照表（支出） */
var EXPENSE_CATEGORY_SYNONYMS = {
  '娛樂': '休閒', '餐飲': '飲食', '訂閱': '休閒', '網購': '購物',
  '交通費': '交通', '醫療費': '醫療', '投資獲利': '投資'
};

/** 分類同義詞對照表（收入） */
var INCOME_CATEGORY_SYNONYMS = {};

/**
 * 分類關鍵字規則（商店/服務名稱 → 分類）
 * 支出列：命中即強制覆寫 LLM 給的分類（使用者指定的商店對應優先於模型判斷）；
 * 收入列不套用本規則。
 */
var CATEGORY_KEYWORD_RULES = [
  { pattern: /統一超商|愛金卡|一卡通|悠遊卡|icash\s*加值|gogoro|中油|加油|停車|臺鐵|台鐵|高鐵|捷運/i, category: '交通' },
  { pattern: /優步-|uber\s*eats|foodpanda/i, category: '飲食' },
  { pattern: /易遊網|eztravel|agoda|booking|netflix|xsolla|pikmin|google\s*play|youtube|pressplay/i, category: '休閒' },
  { pattern: /momo|蝦皮|pchome|amazon/i, category: '購物' },
  { pattern: /book|kobo|anthropic|openai|chatgpt|claude/i, category: '學習' },
  { pattern: /保險/, category: '保險' }
];

/**
 * 修正每筆交易的分類：支出列先套商店關鍵字規則（強制覆寫，優先於 LLM 判斷），
 * 未命中則沿用「同義詞對照 → 合法分類保留 → fallback其他」邏輯；收入列不套關鍵字規則。
 * @param {Object} parsed - { transactions }
 * @param {string[]} expenseCategories - 支出分類清單
 * @param {string[]} incomeCategories - 收入分類清單
 * @returns {Object} parsed
 */
function normalizeCategories(parsed, expenseCategories, incomeCategories) {
  var expSet = {}, incSet = {};
  (expenseCategories || []).forEach(function(c) { expSet[c] = true; });
  (incomeCategories || []).forEach(function(c) { incSet[c] = true; });

  (parsed.transactions || []).forEach(function(tx) {
    var isExpense = tx.type === '支出';
    var validSet = isExpense ? expSet : incSet;
    var synonyms = isExpense ? EXPENSE_CATEGORY_SYNONYMS : INCOME_CATEGORY_SYNONYMS;
    var category = tx.category;

    // 「國外交易手續/服務費」列的分類由 fixCardStatementRows 決定性判斷（item 本身即為手續費字樣），
    // 不可再被 description 中夾帶的商店名稱關鍵字覆寫（例如 ANTHROPIC 訂閱的服務費列）。
    var isFeeRow = /國外交易(手續|服務)費/.test(tx.item || '');
    if (isExpense && !isFeeRow) {
      var text = (tx.item || '') + ' ' + (tx.description || '');
      for (var i = 0; i < CATEGORY_KEYWORD_RULES.length; i++) {
        var rule = CATEGORY_KEYWORD_RULES[i];
        if (rule.pattern.test(text) && validSet[rule.category]) {
          tx.category = rule.category;
          return;
        }
      }
    }

    if (validSet[category] && category !== '其他') { return; }
    if (synonyms[category] && validSet[synonyms[category]]) {
      tx.category = synonyms[category];
      return;
    }

    tx.category = '其他';
  });
  return parsed;
}

/**
 * 銀行帳戶明細中，支出且品項/描述含「卡費／卡款／信用卡」（且非純換匯）→ 強制分類為「繳信用卡」
 * @param {Object} parsed - { statementType, transactions }
 * @returns {Object} parsed
 */
function forceCardPaymentCategory(parsed) {
  if (parsed.statementType !== '銀行帳戶') { return parsed; }
  (parsed.transactions || []).forEach(function(tx) {
    if (tx.type !== '支出') { return; }
    var text = (tx.item || '') + (tx.description || '');
    if (/卡費|卡款|信用卡/.test(text)) {
      tx.category = '繳信用卡';
    }
  });
  return parsed;
}

/**
 * 信用卡帳單列修正（statementType === '信用卡' 時套用，需在 extractFxCardPayment 之前呼叫）：
 * (a) 丟棄繳款確認行（自扣已入帳／自動扣繳／自動轉帳繳款／已收到／繳款），計入 parsed.skipped；
 * (b) 品項或描述含「回饋」且不含「入帳戶」的列，一律強制 type:收入, category:回饋，amount 取絕對值；
 * (c) 品項符合「國外交易手續費／服務費」的列，強制 category:手續費, type:支出。
 * @param {Object} parsed - { statementType, skipped, transactions }
 * @returns {Object} parsed
 */
function fixCardStatementRows(parsed) {
  if (parsed.statementType !== '信用卡') { return parsed; }
  var txs = parsed.transactions || [];
  var dropped = 0;
  var kept = txs.filter(function(tx) {
    var text = (tx.item || '') + (tx.description || '');
    if (/自扣已入帳|自動扣繳|自動轉帳繳款|已收到|繳款/.test(text)) {
      dropped++;
      return false;
    }
    return true;
  });
  kept.forEach(function(tx) {
    var text = (tx.item || '') + (tx.description || '');
    if (text.indexOf('回饋') >= 0 && text.indexOf('入帳戶') < 0) {
      tx.type = '收入';
      tx.category = '回饋';
      tx.amount = Math.abs(parseAmount(tx.amount));
      return;
    }
    if (/國外交易(手續|服務)費/.test(tx.item || '')) {
      tx.category = '手續費';
      tx.type = '支出';
    }
  });
  parsed.transactions = kept;
  parsed.skipped = (parsed.skipped || 0) + dropped;
  return parsed;
}

/**
 * 丟棄證券（交割戶）帳戶上的「定期買股／交割／證券買賣」列（以證券對帳單為準，避免重複）
 * 需在 resolveImportedAccounts 之後呼叫（tx.account 已解析為帳戶名稱）
 * @param {Object} parsed - { skipped, notes, transactions }
 * @param {Object[]} accounts - 帳戶清單
 * @returns {Object} parsed
 */
function dropSettlementBuyRows(parsed, accounts) {
  var brokerageNames = {};
  (accounts || []).forEach(function(a) { if (a.type === '證券') { brokerageNames[a.name] = true; } });
  var txs = parsed.transactions || [];
  var dropped = 0;
  var kept = txs.filter(function(tx) {
    if (brokerageNames[tx.account] && tx.type === '支出' && /定期買股|交割|證券買賣/.test((tx.item || '') + (tx.description || ''))) {
      dropped++;
      return false;
    }
    return true;
  });
  parsed.transactions = kept;
  if (dropped > 0) {
    parsed.skipped = (parsed.skipped || 0) + dropped;
    parsed.notes = parsed.notes || [];
    parsed.notes.push('交割戶買股扣款 ' + dropped + ' 筆已略過（以證券對帳單為準）');
  }
  return parsed;
}

/**
 * 從 note 欄位拆出關鍵字 token：以 ＋+、，,空白 分隔，去除「卡」與「同一帳單」字樣
 * @param {string} note - 帳戶備註
 * @returns {string[]}
 */
function splitAccountNoteTokens(note) {
  return String(note || '')
    .split(/[＋+、，,\s]+/)
    .map(function(s) { return s.replace(/同一帳單/g, '').replace(/卡$/, '').trim(); })
    .filter(function(s) { return s !== ''; });
}

/**
 * 從帳單原始文字中偵測所屬信用卡帳戶：依機構全名／機構去「銀行」／備註拆出的關鍵字逐一計分，
 * 命中分數最高且唯一者回傳；平手或無命中回傳 null
 * @param {string} text - stripGarbledLines 後的帳單原文
 * @param {Object[]} accounts - 帳戶清單
 * @param {string} [currency] - 幣別，未提供時不限制
 * @returns {Object|null}
 */
function detectCardAccountFromText(text, accounts, currency) {
  var lower = String(text || '').toLowerCase();
  var cards = (accounts || []).filter(function(a) {
    return a.type === '信用卡' && (!currency || (a.currency || 'TWD') === currency);
  });
  var scores = cards.map(function(a) {
    var keywords = [a.institution, String(a.institution || '').replace(/銀行$/, '')]
      .concat(splitAccountNoteTokens(a.note))
      .filter(function(s) { return s && s.length >= 2; });
    var score = 0;
    keywords.forEach(function(k) {
      if (lower.indexOf(String(k).toLowerCase()) >= 0) { score++; }
    });
    return { account: a, score: score };
  }).filter(function(s) { return s.score > 0; });

  if (scores.length === 0) { return null; }
  scores.sort(function(a, b) { return b.score - a.score; });
  if (scores.length > 1 && scores[0].score === scores[1].score) { return null; }
  return scores[0].account;
}

/**
 * 比對信用卡帳單解析總額與 statementTotals（本期新增款項），差異 ≥ 1 時寫入 parsed.notes
 * @param {Object} parsed - { statementType, statementTotals, notes, transactions }
 * @returns {Object} parsed
 */
function checkStatementTotals(parsed) {
  if (parsed.statementType !== '信用卡' || !parsed.statementTotals || parsed.statementTotals.length === 0) { return parsed; }
  var sums = {};
  (parsed.transactions || []).forEach(function(tx) {
    var cur = String(tx.currency || 'TWD').toUpperCase();
    sums[cur] = sums[cur] || 0;
    sums[cur] += (tx.type === '支出' ? 1 : -1) * (Number(tx.amount) || 0);
  });
  parsed.notes = parsed.notes || [];
  parsed.statementTotals.forEach(function(st) {
    var cur = String(st.currency || 'TWD').toUpperCase();
    var got = Math.round((sums[cur] || 0) * 100) / 100;
    var expected = Number(st.newCharges) || 0;
    var diff = Math.round((got - expected) * 100) / 100;
    if (Math.abs(diff) >= 1) {
      parsed.notes.push((cur === 'TWD' ? '臺幣' : cur) + '解析合計 ' + got + ' 與帳單本期新增款項 ' + expected + ' 不符（差 ' + diff + '），請核對');
    }
  });
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
  var model = getConfig('OPENAI_MODEL') || 'gpt-4o-mini';

  var payload = {
    model: model,
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
  accounts = accounts || [];

  if (parsed.transactions) {
    parsed.transactions = parsed.transactions.map(function(tx) {
      tx.amount = Number(tx.amount);
      if (typeof tx.balance !== 'undefined' && tx.balance !== null && tx.balance !== '') {
        tx.balance = Number(tx.balance);
      } else {
        tx.balance = null;
      }
      if (typeof tx.openingBalance !== 'undefined' && tx.openingBalance !== null && tx.openingBalance !== '') {
        tx.openingBalance = Number(tx.openingBalance);
      } else {
        tx.openingBalance = null;
      }
      return tx;
    });
  }

  if (parsed.statementType === '信用卡') {
    var detected = detectCardAccountFromText(text, accounts, null);
    if (detected) { parsed.bank = detected.institution; }
  }

  dropZeroAndRewardDeposits(parsed);
  fixDirectionByBalance(parsed);
  appendCounterparty(parsed);
  forceCardPaymentCategory(parsed);
  fixCardStatementRows(parsed);
  parsed = extractFxCardPayment(parsed, accounts);
  var resolved = resolveImportedAccounts(parsed, accounts);
  parsed.transactions = resolved.transactions;
  parsed.unmatchedAccountNumbers = resolved.unmatchedAccountNumbers;
  parsed.intraAccountSkipped = resolved.intraAccountSkipped;
  dropSettlementBuyRows(parsed, accounts);
  normalizeCategories(parsed, expenseCategories, incomeCategories);
  checkStatementTotals(parsed);

  return parsed;
}
