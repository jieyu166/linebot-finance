# pdf-batch-import Specification

## Purpose

使用者上傳銀行／信用卡／證券對帳單 PDF 給 LINE Bot，系統辨識帳單類型與帳號、批次解析出多筆交易、去除與既有紀錄重複的項目，並嘗試自動配對轉帳與信用卡繳款，最後以一則摘要訊息回覆匯入結果。

## Requirements

### Requirement: Download PDF from LINE message

The system SHALL detect when a user sends a file message with a PDF content type via LINE. The system SHALL download the PDF binary data from the LINE Content API endpoint (https://api-data.line.me/v2/bot/message/{messageId}/content) using the Channel Access Token for authorization. The downloaded data SHALL be stored as a Blob for further processing.

#### Scenario: PDF file received

- **WHEN** a user sends a PDF file to the LINE Bot
- **THEN** the system downloads the PDF binary via LINE Content API and obtains a Blob object

#### Scenario: Non-PDF file received

- **WHEN** a user sends a non-PDF file (e.g., .xlsx, .docx) to the LINE Bot
- **THEN** the system replies: "目前僅支援 PDF 檔案，請傳送 PDF 格式的銀行帳單。"

---
### Requirement: Extract text from PDF via Google Drive OCR

The system SHALL upload the PDF Blob to Google Drive with OCR conversion enabled, creating a temporary Google Doc. The system SHALL extract the full text content from the Google Doc. The system SHALL delete the temporary Google Doc after text extraction is complete. If the PDF is encrypted and OCR conversion fails, the system SHALL reply asking the user to decrypt the PDF themselves and re-send it.

#### Scenario: Successful text extraction

- **WHEN** an unencrypted PDF is uploaded to Google Drive with OCR enabled
- **THEN** the system creates a temporary Google Doc, extracts the text content, and deletes the temporary Doc

#### Scenario: Encrypted PDF detected

- **WHEN** the PDF is encrypted and Google Drive OCR fails to convert it
- **THEN** the system replies: "此 PDF 已加密，請先自行解密後再傳送。"

---
### Requirement: Batch parse bank statement text with OpenAI

The system SHALL send the extracted PDF text to OpenAI gpt-4o-mini with a system prompt designed for batch parsing bank statements AND containing the active account list read from `getAccounts()`, described via `describeAccounts()` as "名稱（機構，幣別，類型，帳號 hint1/hint2）" per account (the 帳號 segment omitted when an account has no accountNumberHints). The system SHALL support statements from 10 Taiwan banks: 第一銀行, LINE Bank, 王道銀行, 永豐銀行, 玉山銀行, 台新銀行, 富邦銀行, 國泰銀行, 樂天銀行, and 台新證券/永豐證券. The API SHALL return a JSON object with top-level fields `bank`, `statementType`, `transactions` (array), and `skipped` (count); each transaction element SHALL contain: date, type, category, item, description, institution, account, accountNumber, currency, and amount. The "account" field SHALL be selected from the provided account list; if no account can be identified, it SHALL be an empty string. The "accountNumber" field SHALL carry the raw account-number text from the statement's "帳號：" line for 銀行帳戶-type statements (empty otherwise).

The system prompt SHALL instruct the model to first classify the whole statement into a top-level `statementType` of "信用卡"／"銀行帳戶"／"證券" based on characteristic keywords (信用卡: 結帳日／應繳總額／最低應繳金額／卡號後四碼／循環信用; 銀行帳戶: 帳號／摘要／支出／存入／餘額; 證券: 成交日期／交易別／股數／單價／客戶應收付／交割), and for 信用卡 statements to select only accounts with 類型=信用卡, for 銀行帳戶 statements to select 類型=銀行, and for 證券 statements to select 類型=證券.

The function `parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accounts)` SHALL accept a fourth parameter `accounts` (array of account objects, not just names) and pass it to `buildPdfSystemPrompt()`. The `buildPdfSystemPrompt()` function SHALL include the account list in the system prompt with the instruction that the "account" field MUST be selected from the provided list.

After the OpenAI call returns, the system SHALL post-process the result via `resolveImportedAccounts(parsed, accounts)`:
- For a transaction with a non-empty `accountNumber`, resolve the account via `findAccountByNumber()` (unique 帳號識別 prefix match, see transfer-pairing). If no account uniquely matches, the transaction is dropped and its `accountNumber` is recorded in the reply's 未對應帳號 list. If `matchCounterpartyAccount(tx.description, accounts)` resolves to the same account as the transaction's own account (i.e. an intra-account transfer between two of the user's own sub-accounts under the same statement), the row is dropped entirely (both legs of a self-transfer are skipped rather than recorded).
- Otherwise (no `accountNumber`, i.e. 信用卡 or 證券 statements), resolve by `findAccountByName(accounts, tx.account)`; if `statementType` is "信用卡" and that account is missing, not type 信用卡, or has the wrong currency, the system re-resolves via `findAccountByTypeAndBank(accounts, '信用卡', bank, currency)` (institution name compared with "銀行" suffix stripped from both sides) and overrides `tx.account`/`tx.institution`/`tx.currency` accordingly; the same override applies for `statementType` "證券" against 類型=證券 accounts.
- 回饋入帳戶 lines: the system prompt instructs the model to skip every line in a credit-card statement containing "回饋入帳戶" entirely (these rewards post to the bank account and are recorded there instead), so they never appear in `transactions`.
- A card-statement reward line that is NOT "回饋入帳戶" (e.g. "現金回饋-iLEO信用卡 -58") and has a negative amount with "回饋" in the text SHALL be recorded as `type:收入, category:回饋` on the credit-card account itself (not the bank account).

The system prompt SHALL include these bank-specific rules:
1. ROC year conversion: dates in format 115/MM/DD SHALL be converted to 2026/MM/DD (民國年 + 1911 = 西元年). Banks using ROC year: 第一銀行, 玉山銀行, 台新銀行, 富邦銀行.
2. Payment/auto-debit confirmation lines in credit card statements (negative amounts with keywords 扣繳/繳款/自扣/感謝您) SHALL be skipped. Actual bank account debits in online banking statements SHALL NOT be skipped solely because they contain 扣繳 or 自扣.
3. Cashback/reward lines (negative amounts with keywords 回饋/現金回饋) SHALL be classified as type "收入" with category "回饋". If the actual amount is embedded in the description text (e.g., "回饋入帳戶_國內 207 元"), the amount SHALL be extracted from the description.
4. Foreign transaction service fees (國外交易服務費) SHALL be classified as category "手續費".
5. Securities trades: 現買/買進 SHALL be category "投資" (支出), 現賣/賣出 SHALL be category "投資獲利" (收入). The amount SHALL use 客戶應付 (buy) or 客戶應收 (sell) which includes fees.
6. Loan payments (貸款利息/償還本金/還本/本金攤還) SHALL be category "貸款"; online banking rows containing 還本 SHALL NOT be classified as 轉帳.
7. Credit card payment debits from bank account statements (卡款扣繳/信用卡自扣/信用卡款) SHALL be category "繳信用卡".
8. Linked account transactions / online payments (連結帳戶交易/連結帳戶扣款/線上支付/電子支付) with no clearer merchant or purpose SHALL default to category "飲食".
9. Marketing text, asset summaries, rate information, page headers, and pagination markers SHALL be skipped.
10. Duplicate data caused by PDF pagination SHALL be deduplicated.
11. Before the OpenAI call, the extracted text SHALL be filtered line-by-line via `stripGarbledLines(text)`: a line is dropped when the proportion of characters NOT in the allowed set (CJK, full/half-width punctuation, alphanumerics, common symbols) exceeds 50%; a line with no bad characters, or an all-whitespace line, is always kept. This replaces the previous whole-file "亂碼比例 > 30%" rejection — a statement (e.g. 一銀信用卡, which embeds barcode-garbage lines) can still be parsed as long as it has any surviving lines. Only when `stripGarbledLines` leaves nothing but whitespace SHALL the system reply: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。"

#### Scenario: Parse credit card statement with ROC year dates

- **WHEN** the extracted text contains 第一銀行 credit card lines like "03/07 03/11 連加*南紡購物中心 1,901 7142" with statement date "115/04/06"
- **THEN** OpenAI converts 115 to 2026, returns transactions with date "2026/03/07", institution "第一銀行", account selected from the account list (e.g., "一銀")

#### Scenario: Parse statement with cashback

- **WHEN** the extracted text contains cashback lines like "iLEO卡行動支付回饋_2月 -10" or "大戶消費回饋入帳戶_國內 207 元"
- **THEN** OpenAI returns transactions with type "收入", category "回饋", extracting the correct amount (10 or 207)

#### Scenario: Parse bank account statement

- **WHEN** the extracted text contains 永豐銀行 account transactions with columns 交易日/摘要/支出/存入/餘額
- **THEN** OpenAI returns transactions with institution "永豐銀行", account set to "永豐大戶" (matched from account list), classifying 股款交割 as 投資, 利息存入 as 收入/利息, 跨行轉帳 as 轉帳

#### Scenario: Parse securities statement

- **WHEN** the extracted text contains securities trades like "2026/03/06 普買 台積電 5 1,892.0000 9,460 ... -9,461"
- **THEN** OpenAI returns a transaction with type "支出", category "投資", item "台積電", amount 9461, account set to "永豐證券" (matched from account list)

#### Scenario: Skip payment and auto-debit lines

- **WHEN** the extracted text contains "感謝您本行自動扣繳已收到 -3,159" or "自動扣繳 -10,867"
- **THEN** OpenAI skips these lines and does not include them in the transactions array

#### Scenario: Classify online banking repayment and linked account rows

- **WHEN** the extracted text from a bank account statement contains rows such as "房貸還本 30,000", "卡款扣繳 21,207", and "連結帳戶交易 180"
- **THEN** OpenAI returns transactions classified respectively as category "貸款", "繳信用卡", and "飲食"

#### Scenario: Garbled barcode lines are dropped per-line, not the whole statement

- **WHEN** a 一銀信用卡 PDF's extracted text contains scattered barcode-garbage lines (each with over 50% non-CJK/non-alphanumeric characters) interleaved with normal transaction lines
- **THEN** `stripGarbledLines()` removes only the garbled lines, and the remaining text (including the valid transaction lines) is still sent to OpenAI for parsing

#### Scenario: Entirely garbled text still triggers the rejection reply

- **WHEN** `stripGarbledLines()` leaves nothing but blank lines (every line was over the 50% bad-character threshold)
- **THEN** the system replies: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。" without calling OpenAI

#### Scenario: Partially unparseable statement

- **WHEN** some lines in the PDF text cannot be parsed as transactions
- **THEN** the system imports only the successfully parsed transactions and notes the count of skipped entries in the reply

#### Scenario: Deduplicate paginated data

- **WHEN** the extracted text contains duplicate transaction sections caused by PDF pagination (e.g., 永豐信用卡 臺幣 section appearing twice)
- **THEN** OpenAI deduplicates the transactions and returns each transaction only once

#### Scenario: Account name matched from list for 永豐外幣

- **WHEN** the extracted text contains foreign currency transactions from 永豐銀行 外幣帳戶
- **THEN** OpenAI sets account to "永豐外幣" (matched from account list) and currency to the appropriate foreign currency code (e.g., "USD")

---
### Requirement: Batch write transactions and reply summary

The system SHALL write all parsed transactions to the "交易紀錄" worksheet in batch via `importTransactions(result, source, ss)`, which chains three steps: `dedupeAgainstSheet()` (see credit-card-accounts), `appendTransactionsBatch(dedupe.kept, source, ss)` (writing the full 12-column row — A–J unchanged, K 欄 ID auto-generated as a UUID, L 欄 轉帳ID left blank), then `autoPairImportedTransactions(written, ss)` (see transfer-pairing). The source parameter SHALL be "PDF匯入" for PDF file imports and "文字匯入" for pasted text imports. For PDF-sourced transactions, the date column SHALL use the transaction date from the statement (not the processing date). The original message column (J 欄) SHALL contain the source parameter value.

The reply is built by a shared `buildImportSummary(result, source, outcome)` function, where `outcome` is `importTransactions()`'s return value `{ written, skipped, merged, pairing }`. The reply SHALL include, in order: a header ("📄 帳單匯入完成！" for PDF, "📄 帳單文字匯入完成！" for text), the bank name line ("銀行：" + `result.bank`) when detected, a "帳單類型：" line when `result.statementType` is set (信用卡／銀行帳戶／證券), the total written count ("共匯入 N 筆交易"), an expense count/total line and an income count/total line (each only when that count is nonzero), a "（跳過 N 筆無法辨識的項目）" note when `result.skipped` (the OpenAI-reported skip count) is nonzero, then (when `outcome` is supplied) a "跳過與既有紀錄重複 N 筆" line (with "（更新 M 筆股名）" appended when `outcome.merged` is nonzero) when `outcome.skipped.length` is nonzero, a "已自動配對 N 筆" line (with "（新增 M 筆對方帳戶紀錄）" appended when `outcome.pairing.created` is nonzero) when `outcome.pairing.paired` is nonzero, one "⚠ " line per entry in `outcome.pairing.details`, and finally a "未對應帳號：" line listing `result.unmatchedAccountNumbers` (joined by "、", with a hint to fill in 帳戶管理 J 欄) when that list is non-empty.

#### Scenario: Successful PDF batch import

- **WHEN** 23 transactions are parsed from a 玉山銀行 PDF statement (18 expenses totaling 15,230, 5 income/cashback totaling 320) with no dedupe or pairing activity
- **THEN** the system writes 23 rows (each with a generated ID and blank 轉帳ID) with original message "PDF匯入" and replies: "📄 帳單匯入完成！\n銀行：玉山銀行\n共匯入 23 筆交易\n  支出：18 筆，合計 15,230 元\n  收入：5 筆，合計 320 元"

#### Scenario: Successful text batch import

- **WHEN** 5 transactions are parsed from pasted 樂天銀行 text (4 expenses totaling 8,000, 1 income totaling 500)
- **THEN** the system writes 5 rows with original message "文字匯入" and replies: "📄 帳單文字匯入完成！\n銀行：樂天銀行\n共匯入 5 筆交易\n  支出：4 筆，合計 8,000 元\n  收入：1 筆，合計 500 元"

#### Scenario: No transactions found

- **WHEN** the extracted PDF text yields zero parseable transactions
- **THEN** the system replies: "無法從此 PDF 中解析出交易紀錄，請確認是否為銀行帳單。"

#### Scenario: Summary reports statement type, dedupe, pairing, and unmatched accounts together

- **WHEN** `buildImportSummary(result, 'PDF', outcome)` is called with `result.statementType` = "銀行帳戶", `result.unmatchedAccountNumbers` = ["198-00*-**10443-*"], `outcome.skipped.length` = 1, `outcome.merged` = 1, `outcome.pairing` = `{ paired: 2, created: 1, details: ['轉帳 2026/08/04 50000：多個候選，請在 App 手動連結'] }`
- **THEN** the reply includes the lines "帳單類型：銀行帳戶", "跳過與既有紀錄重複 1 筆（更新 1 筆股名）", "已自動配對 2 筆（新增 1 筆對方帳戶紀錄）", "⚠ 轉帳 2026/08/04 50000：多個候選，請在 App 手動連結", and "未對應帳號：198-00*-**10443-*"

#### Scenario: Unresolved account numbers listed for manual mapping

- **WHEN** a multi-account statement has a sub-account whose 帳號 cannot be matched to any account's 帳號識別 (J 欄)
- **THEN** that sub-account's transactions are excluded from the write, and the reply's "未對應帳號：" line lists the unmatched account-number text


<!-- @trace
source: code-review-fixes
updated: 2026-04-09
code:
  - src/SheetService.gs
  - src/LineService.gs
  - src/Main.gs
-->

---
### Requirement: Clean up temporary files

The system SHALL delete all temporary files from Google Drive after processing is complete, regardless of success or failure. Temporary files include: uploaded PDFs and converted Google Docs.

#### Scenario: Cleanup after successful import

- **WHEN** batch import completes successfully
- **THEN** all temporary Drive files are deleted

#### Scenario: Cleanup after failure

- **WHEN** any step in the PDF processing pipeline fails
- **THEN** all temporary Drive files created during the process are deleted
