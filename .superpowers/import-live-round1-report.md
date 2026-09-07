# fix/import-live-round1 — 修復報告

分支：`fix/import-live-round1`（未 merge、未 push）
`npm test`：全部通過（7 → 8 個測試檔，全綠）

## A. Schema 新增

- `balance`／`counterparty`／`statementTotals` 加進輸出格式與四個範例。
  實作：`src/OpenAIService.gs:203`（schema 行）、範例 1-4（`208`-`236` 一帶，各自補上 `"balance"`/`"counterparty"`，範例 1/4 補 `statementTotals`）。
  測試：`test/prompt.test.js`「buildPdfSystemPrompt 含 balance/counterparty/statementTotals schema 與新規則字句」。

## B. 後處理函式（皆為純函式，`test/postprocess.test.js` 逐一 TDD）

| # | 函式 | 檔案:行 | 測試 |
|---|---|---|---|
| 1 | `fixDirectionByBalance` | `src/OpenAIService.gs:406` | 5 案例（永豐/玉山/中信/不符不動/非銀行帳戶不處理） |
| 2 | `appendCounterparty` | `src/OpenAIService.gs:436` | 3 案例（附加／已存在不重複／空不動作） |
| 3 | `dropZeroAndRewardDeposits` | `src/OpenAIService.gs:453` | 2 案例（金額0／信用卡回饋入帳戶） |
| 4 | `normalizeCategories` + `EXPENSE_CATEGORY_SYNONYMS`/`CATEGORY_KEYWORD_RULES` | `src/OpenAIService.gs:471-529` | 9 案例（同義詞、5 組關鍵字、合法不變、fallback、投資獲利→投資） |
| 5 | `forceCardPaymentCategory` | `src/OpenAIService.gs:531` | 2 案例（台新卡費／純換匯不觸發） |
| 6 | `dropSettlementBuyRows` | `src/OpenAIService.gs:550` | 2 案例（含 notes 訊息；後續放寬為依 `type==='支出'` 而非 `category==='投資'`，見下方 D 節） |
| 7 | `resolveImportedAccounts` 證券分支忽略 `accountNumber` | `src/OpenAIService.gs:310-333` | `test/postprocess.test.js` + `test/prompt.test.js`「證券帳單忽略 accountNumber」 |
| 8 | `detectCardAccountFromText` + `splitAccountNoteTokens` | `src/OpenAIService.gs:576-616` | 3 案例（玉山 UBear／永豐幣倍卡／無命中回 null） |
| 9 | `checkStatementTotals` | `src/OpenAIService.gs:618` | 2 案例（不符記 notes／相符不記） |
| 10 | `OPENAI_MODEL` 可設定 | `src/OpenAIService.gs:658`（`parsePdfWithOpenAI`）與 `parseWithOpenAI` 未改（規格僅要求兩個解析函式，`parseWithOpenAI` 未涉及本次修復範圍，之後如需可比照補上） | 未獨立測試（無 mock 驗證 payload.model，交由既有 `getConfig` stub 測試涵蓋） |

`parsePdfWithOpenAI`（`src/OpenAIService.gs:647`）依規格順序串接：
coerce amount/balance → `detectCardAccountFromText` → `dropZeroAndRewardDeposits` → `fixDirectionByBalance` → `appendCounterparty` → `forceCardPaymentCategory` → `extractFxCardPayment` → `resolveImportedAccounts` → `dropSettlementBuyRows` → `normalizeCategories` → `checkStatementTotals`。

`buildImportSummary`（`src/Main.gs:492` 附近新增區塊）印出 `result.notes` 每行 `  ℹ <text>`；測試見 `test/import.test.js`「result.notes 非空/未提供」兩案例。

## C. Prompt 文字強化

`src/OpenAIService.gs:155-198` 一帶新增：多卡號小計後繼續解析／雙幣 USD 區塊、同天同店同額多筆保留（僅分頁完全重複才去重）、外幣折算金額取繳款幣別、跨行商店名合併、balance/counterparty 必填說明、分類禁止自創、信用卡別名→銀行提示（UBear/Cube/Costco/Line卡/綠活.iLEO/大戶.幣倍.大衛/Richart）。
測試：`test/prompt.test.js`「buildPdfSystemPrompt 含 balance/counterparty/statementTotals schema 與新規則字句」逐條 assert 關鍵字存在。

## D. 實測 8 檔案 + 修正輪（每檔最多 2 次）

第一輪跑完後發現的問題與對應修正：

1. **`resolveImportedAccounts` 信用卡分流 bug**：`detectCardAccountFromText` 設定 `parsed.bank` 後，若 LLM 自己填的 `tx.account` 恰好是「別家銀行也存在的信用卡帳戶名稱」（幣別/類型都符合），原本的條件判斷不會用偵測到的銀行覆寫，導致玉山帳單被分流到「一銀信用卡」。修正：`src/OpenAIService.gs:328-332` 加入 `bankMismatch` 檢查，機構名不符 `parsed.bank` 時也強制用 `findAccountByTypeAndBank` 重新分流。單元測試：`test/prompt.test.js`「即使 tx.account 剛好對到別家銀行的信用卡帳戶名稱，仍以 parsed.bank 優先重新分流」。
2. **`dropSettlementBuyRows` 過嚴**：LLM 有時把交割戶「定期買股」列的 category 標成「轉帳」而非「投資」，原條件 `category==='投資'` 因此漏丟。改為 `type==='支出'`（`src/OpenAIService.gs:553`），品項樣式 + 證券帳戶 + 支出方向已足夠唯一識別。
3. **`getScriptProperties().getProperty` 測試 stub bug（重要，已修正並記錄於此避免復發）**：`test/prompt-live.js` 原本的 stub 忽略呼叫參數、對任何 key 都回傳 API 金鑰；本次新增 `getConfig('OPENAI_MODEL')` 呼叫後，第一次執行把金鑰當成 model 名稱送給 OpenAI，OpenAI 的 404 錯誤訊息把金鑰原文回顯，被印進終端機與（原本要寫入的）live2 輸出檔。**已立即刪除該次輸出檔、修正 stub 依 key 名稱回傳**（`test/prompt-live.js:79`），確認金鑰未被提交、未殘留在任何已保存檔案中（`grep sk- live2/*.txt` 全部 0 命中）。
4. Prompt 增補：ANTHROPIC/OPENAI/KOBO/BOOK WALKER → 學習；信用卡回饋方向規則加強（回饋不看原始正負號一律收入）；電匯薪資規則涵蓋被截斷的醫院全銜；`自扣已入帳`/`自動換匯自扣已入帳` 強調不可記為手續費。

### 比對表（fixture → 期望 vs 實際）

| Fixture | 期望筆數/合計 | 實際筆數/合計（最終一次） | 主要缺口 |
|---|---|---|---|
| sinopac-securities-2026-08 | 1 筆，9,498，台積電 | 1 筆，9,498，台積電 | 無，完全相符 ✓ |
| sinopac-bank-2026-08 | 期末餘額：永豐證券 0／永豐大戶 0／永豐外幣 USD 1,858.62 | 逐一相符（0／0／1,858.62）✓ | 唯一差異：08/05「手機換匯 161,325」我方判為收入，expected.md 寫支出；但依餘額連續性回算（100,991→262,316，+161,325）與期末餘額吻合，判斷 expected.md 該行方向敘述有誤，非程式錯誤（診斷見下） |
| ctbc-bank-2026-08 | 15 筆，支出 432,909／收入 375,431（+電匯 36,709 應歸薪資） | 15 筆，支出 396,200／收入 412,140（含電匯 36,709 已歸薪資）✓ | 無明顯缺口；支出/收入合計與 expected.md 敘述的「跨檔配對」項目一致，08/31 電匯已修正為薪資 |
| taishin-bank-2026-07 | 5 筆，媒體轉帳→繳信用卡，轉帳支取/存入方向正確 | 5 筆，逐行方向與分類皆符 ✓ | 無 |
| esun-bank-2026-07 | 7 筆（含 2 筆同帳戶內轉應跳過，另 07/02 ATM跨行轉 500 應為收入） | 7 筆，07/02 ATM跨行轉 500 仍判為支出 | 該列是其 accountNumber 分組內第一筆（無前一筆餘額可比對），規格明訂「首列且無 openingBalances 時不處理」，此為已知、規格允許的殘留限制 |
| firstbank-card-2026-07 | 22 筆（20 消費+2 回饋），BOOK WALKER→學習，iLEO回饋兩筆皆收入 | 15 筆，BOOK☆WAL 仍為休閒，iLEO行動支付回饋（10）仍判支出/其他 | 2 次機會用盡：LLM 對「已是合法分類就不套關鍵字」與「回饋方向」的規則仍未穩定遵守，屬 prompt 指令遵從度問題（診斷見下） |
| esun-card-2026-07 | 21 消費+3 回饋，帳戶=玉山信用卡，BOOK WALKER→學習 | 21 筆，帳戶已修正為玉山信用卡 ✓，但 3 筆 UBear 回饋列全數缺席、BOOK☆WAL 仍休閒 | 銀行分流 bug 已修好；回饋列 LLM 兩輪都沒輸出，可能是這批 OCR 文字中回饋列格式與其他銀行差異較大，需要更多樣例或改用更明確的行首錨點 |
| sinopac-card-2026-08 | TWD 18 筆/0，USD 4 筆/0 | 第 1 輪：TWD 0 完全相符、USD 差 509.66（多算了自扣已入帳兩行）；第 2 輪：規則加強後反而退化（APPLE.COM/BILL 誤標手續費、自扣已入帳三行重新被記為手續費，TWD 變 37,258） | 2 次機會用盡，且第 2 輪明顯退化，判斷是本次新增的多條 prompt 規則同時生效造成模型遵從度下降（見診斷）；建議下一輪回退部分新規則或拆成更短的訊息重測 |

### 殘留偏差與診斷

1. **sinopac-card 第 2 輪退化**：加了「ANTHROPIC/OPENAI/KOBO/BOOK→學習」與「回饋方向加強」等段落後，模型在同一輪反而把「自扣已入帳」類確認列重新記為手續費、部分正常消費也誤標手續費。懷疑是 system prompt 段落數已相當多，本次新增的三段（多卡號小計、balance/counterparty、分類禁自創、銀行別名提示、回饋方向強化、學習關鍵字、電匯薪資）疊加後總長度顯著增加，可能超過模型穩定遵循全部規則的臨界點。建議下一輪：拆分成「先跑一版量測哪段規則造成退化」（逐段回退 A/B 測試），而非一次疊加多段；或改用結構化 few-shot 而非純文字規則清單。
2. **firstbank-card / esun-card 的「回饋方向」與「合法分類優先於關鍵字覆寫」**：規格明定「僅當 LLM 分類為其他或不在清單中才套用關鍵字規則」，這造成 LLM 直接給出「休閒」「其他」等合法但不夠精確的分類時，後處理無法覆寫（`normalizeCategories` 依規格行為正確，是 prompt 遵從度問題而非程式錯誤）。若要進一步提升精準度，需要放寬 `normalizeCategories` 允許關鍵字規則覆寫特定「已知較不精確」的分類（如休閒/其他/購物），但這會偏離題目對第 4 點規則的字面定義，本輪未擅自更動，留待下一輪決策。
3. **esun-bank 07/02 ATM跨行轉方向**：規格明訂第一筆（無前一筆餘額）不修正，此為設計上可接受的限制，不視為 bug。
4. **sinopac-bank 08/05 手機換匯方向與 expected.md 不一致**：以四個帳戶最終餘額（0／0／USD 1,858.62）全部吻合 expected.md 所述「餘額驗證」段落回推，判斷是 expected.md 撰寫時對這行方向的敘述有誤（人工撰寫、未實際跑餘額連續性驗證），而非程式輸出錯誤；建議請人工覆核後更新 expected.md 或確認銀行原始 PDF 該行真實方向。

### 安全事項

一次意外事件：`test/prompt-live.js` 舊有的 `getProperty` stub 忽略 key 名稱、對任何屬性都回傳 API 金鑰；本次新增 `getConfig('OPENAI_MODEL')` 呼叫後，第一次執行時金鑰被當成 model 名稱送給 OpenAI，其 404 錯誤訊息回顯了金鑰全文，短暫出現在終端機輸出與待寫入的 `live2/sinopac-card-2026-08.txt`。已於下一個指令立即刪除該輸出檔（未提交、未寫入任何持久檔案），並修正 stub 使其僅在 key === 'OPENAI_API_KEY' 時回傳金鑰。之後所有 live2 輸出檔皆以 `grep -c "sk-"` 確認為 0 命中才留存/檢視。

## 未完成／建議下一輪

- sinopac-card-2026-08 第 2 輪退化需要單獨 A/B 測試找出是哪一段新規則造成，而非本輪繼續疊加。
- firstbank-card / esun-card 的回饋方向與 BOOK/易遊網類關鍵字覆寫，建議與使用者確認是否放寬 `normalizeCategories` 的覆寫條件（允許覆寫「休閒／其他／購物」等常見誤判目標，而不僅限 `其他`/不合法時）。
- `parseWithOpenAI`（純文字記帳，非 PDF）尚未套用 `OPENAI_MODEL` 可設定與其餘後處理規則；本次任務範圍限定在 PDF 匯入層，未動它。

## Round 2

分支：`fix/import-live-round1`（延續，未 merge、未 push）
`npm test`：全部通過

### 變更摘要

1. **`normalizeCategories` 關鍵字規則改為強制覆寫**（`src/OpenAIService.gs`）：支出列命中
   `CATEGORY_KEYWORD_RULES` 時一律覆寫 LLM 給的分類（不再限於「其他／非法」才套用），解決
   round1 殘留的「LLM 給合法但不夠精確分類（休閒/其他/購物）時關鍵字規則無法覆寫」問題。
   新增關鍵字：易遊網/ezTravel/agoda/booking→休閒；BOOK☆WAL/BOOK WAL/bookwalker/Kobo/
   ANTHROPIC/Claude/OPENAI/ChatGPT→學習（原規則已含 book/anthropic/openai/chatgpt/claude/
   kobo，涵蓋 BOOK☆WAL）；momo/蝦皮/PChome/Amazon→購物；愛金卡/一卡通/悠遊卡/icash 加值→
   交通；Gogoro/中油/加油/停車/臺鐵/台鐵/高鐵/捷運→交通；保險→保險。收入列不受影響，同義詞
   對照與「其他」fallback 不變。
   **發現並修正一個交互 bug**：`fixCardStatementRows` 依 item 本身判斷「國外交易服務費」列
   強制設為 category:手續費後，若同一筆的 description 夾帶商店名稱（如
   「ANTHROPIC* CLAUDE SUB 國外交易服務費」），關鍵字覆寫規則會誤把它改回「學習」。修正：
   `normalizeCategories` 對 item 本身即符合 `/國外交易(手續|服務)費/` 的列略過關鍵字覆寫，
   保留 `fixCardStatementRows` 的決定性分類。已補測試涵蓋此案例。
2. **新增 `fixCardStatementRows(parsed)`**：信用卡帳單列後處理（`extractFxCardPayment` 之前）：
   (a) 丟棄自扣已入帳/自動扣繳/自動轉帳繳款/已收到/繳款等繳款確認行，計入 `skipped`；
   (b) 含「回饋」不含「入帳戶」的列強制 type:收入, category:回饋, amount 取絕對值；
   (c) 「國外交易手續/服務費」列強制 category:手續費, type:支出。
3. **`fixDirectionByBalance` 支援 `openingBalance`**：每個 accountNumber 分組第一列若帶
   `openingBalance`（該帳號區塊上期餘額/期初餘額，新 schema 欄位，僅第一筆需要），改用
   `delta = balance − openingBalance` 判斷方向，同既有規則。`parsePdfWithOpenAI` 對其做
   Number 強制轉型（同 `balance` 處理）。
4. **Prompt 回退**：移除 round1 造成退化的四段文字（學習關鍵字重複列表、回饋方向強化長句、
   自扣已入帳強調句、電匯薪資對方單位擴寫），改由上述後處理函式決定性處理，system prompt
   縮短。`test/prompt.test.js` 既有斷言未涉及被移除文字，無需調整。
5. **修正 `test/fixtures/sinopac-bank-2026-08.expected.md`**：08/05 手機換匯 161,325 應為
   永豐大戶「收入」（100,991→262,316），對應 USD 5,000 為永豐外幣「支出」（USD→TWD 換匯匯出），
   依四帳戶期末餘額回算確認（未提交，僅本機檔案）。
6. **`test/prompt-live.js`**：新增第二個 CLI 參數指定 model（`node test/prompt-live.js <fixture>
   [model]`），透過 `getConfig('OPENAI_MODEL')`；`getProperty` stub 依 key 名稱分流
   （`OPENAI_API_KEY`/`OPENAI_MODEL`/其他→null）；第一行印出實際使用的 model。

### 實測（gpt-4o-mini，各檔跑一次；輸出已 `grep -c "sk-"` 確認為 0）

| Fixture | 期望 | 實際 | 主要偏差 |
|---|---|---|---|
| sinopac-card-2026-08 | TWD 18筆/0；USD 4筆/0 | TWD 18筆/0 ✓（其中 APPLE.COM/BILL 一筆分類誤標手續費，屬本次模型呼叫的非決定性輸出，與程式邏輯無關）；USD 僅 1筆/10.04（ANTHROPIC/OPENAI/KOBO 三筆 USD 消費本輪未輸出） | USD 區塊本輪遺漏 3 筆（recall 問題，非分類問題） |
| firstbank-card-2026-07 | 22筆（20消費+2回饋），0 | 15筆（13消費+2回饋），支出4,649/收入48（差2,638） | BOOK☆WAL→學習 ✓、iLEO/現金回饋兩筆皆收入 ✓ 已修正；但一卡通加值×3／臺鐵／Gogoro／中油／高雄捷運共7筆交通類消費本輪完全遺漏（recall 問題） |
| esun-card-2026-07 | 24筆（21消費+3回饋），0 | 21筆全支出，18,998（差388，note 已正確標出） | UBear 3筆回饋本輪完全遺漏（recall 問題，非方向/分類問題） |
| esun-bank-2026-07 | 7筆 | 7筆，筆數相符 | 07/02 ATM跨行轉500方向仍支出：其 accountNumber 分組第一列且 LLM 未輸出 openingBalance（帳單無明確「上期餘額」行可辨識），屬規格允許的已知限制 |
| sinopac-bank-2026-08 | 4帳戶期末餘額 0／0／USD 1,858.62 | 完全相符 ✓，08/05 手機換匯方向（永豐大戶收入/永豐外幣支出）與更正後 expected.md 一致 | 無缺口 |

### 殘留與建議

- 本輪未再迭代 prompt（依指示）。firstbank-card／esun-card／sinopac-card(USD) 的缺行屬模型
  單次呼叫的 recall 不穩定（漏抓某些行），非分類/方向邏輯問題；`checkStatementTotals` 產生的
  notes 已能正確標出合計差異供人工核對。
- sinopac-card 的 APPLE.COM/BILL 分類誤標「手續費」為單次模型輸出的非決定性結果（同一 prompt
  對同一筆兩次呼叫給出不同分類），不是本輪程式改動造成。
- 建議下一輪若要進一步提升 recall（漏行問題），考慮拆分帳單文字分批送出或改用更穩定的模型，
  而非再疊加 prompt 規則文字。

## Round 3 / merge

分支：`fix/import-live-round1`（延續 round1-2）

### 變更摘要

1. **預設模型改 gpt-4.1-mini**：live 測試顯示 gpt-4.1-mini 對三份信用卡帳單（sinopac-card/firstbank-card/esun-card）皆完整解析，gpt-4o-mini 有漏行。`parseWithOpenAI` 與 `parsePdfWithOpenAI`（`src/OpenAIService.gs`）改為 `getConfig('OPENAI_MODEL') || 'gpt-4.1-mini'`。`test/prompt-live.js`、README（技術／設定步驟）同步更新；新增 `test/openai-model.test.js` 斷言 `OPENAI_MODEL` 未設定時兩函式送出的 `payload.model` 為 `gpt-4.1-mini`。
2. **`checkStatementTotals` 支援毛額/淨額雙判準**：一銀「本期新增款項」是毛額（僅 sum(支出)），玉山是淨額（sum(支出)−sum(收入)，回饋已扣除）。改為兩者任一與 `newCharges` 相符（差 < 1）即通過；皆不符才寫入 notes，措辭改為「臺幣解析合計 X（毛額）/ Y（淨額）與帳單本期新增款項 Z 不符，請核對」。`test/postprocess.test.js` 改為毛額相符／淨額相符／皆不符三案例。
3. `npm test`：全部通過（含新增/修改的三個測試檔）。

### 實測（gpt-4.1-mini，五份非信用卡 fixture 各跑一次；輸出已 `grep -c "sk-"` 確認為 0，存於本機 scratchpad，未提交）

| Fixture | 期望 | 實際 | 偏差 |
|---|---|---|---|
| sinopac-securities-2026-08 | 1 筆，9,498，台積電 | 1 筆，9,498，台積電，category 投資 | 無，完全相符 ✓ |
| sinopac-bank-2026-08 | 期末餘額：永豐證券 0／永豐大戶 0／永豐外幣 USD 1,858.62；15 筆逐行方向與分類 | 三帳戶期末餘額逐一相符（0／0／1,858.62）✓；15 筆全部相符，含 08/03 卡費換匯 fx 509.66、08/05 手機換匯方向（大戶收入／外幣支出）✓ | 08/06 定期買股 9,498 這行被 `dropSettlementBuyRows` 依設計丟棄（單獨匯入銀行明細時仍會丟棄交割戶買股列，因為系統假設證券對帳單會另外匯入），非缺陷 |
| ctbc-bank-2026-08 | 15 筆，電匯→薪資，對方帳號數字保留在描述 | 15 筆 ✓，08/31 電匯 36,709 奇美醫療財團法 000088000**78012 → 收入/薪資 ✓，其餘 14 筆對方帳號數字皆保留在描述 | 無 |
| taishin-bank-2026-07 | 5 筆，媒體轉帳→繳信用卡 | 5 筆 ✓，07/02 媒體轉帳 台新卡費 14,503 → 支出/繳信用卡 ✓ | 無 |
| esun-bank-2026-07 | 24,000 同帳戶內轉兩列跳過，07/28 卡款扣繳→繳信用卡 | 兩筆 24,000 皆未出現在輸出（已丟棄）✓；07/28 玉山卡款扣繳 24,084 → 支出/繳信用卡 ✓ | fixture 本身在最後一行「07/14 連結帳戶交易 475」處被使用者截斷（無餘額數字），該行本輪未輸出；判斷是來源文字截斷所致，非程式或模型缺陷 |

### 合併結果

- `git checkout master && git merge --no-ff fix/import-live-round1` → 無衝突（`d0149ee` 的內容已在更早的 cherry-pick 中成為 master 的 `4369f00`，經 diff 確認兩者的 patch 內容一致，僅上下文行號不同）。合併提交 `a92e8ba`。
- 合併後 `npm test`：全部通過。
- `git push origin master`：`4369f00..a92e8ba master -> master`，成功。
- 本地分支 `fix/import-live-round1` 已刪除。

### 未完成／建議下一輪

- esun-bank-2026-07 fixture 本身文字被截斷（07/14 最後一行缺餘額），建議之後若要驗證該行需取得完整帳單文字重跑。
- `parseWithOpenAI`（純文字記帳）現已套用可設定的 `OPENAI_MODEL`，但尚未像 PDF 匯入一樣有專門的 live 測試腳本；如需驗證文字記帳的模型行為，需另外撰寫或擴充手動驗證腳本。
