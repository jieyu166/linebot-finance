# pdf-batch-import Specification

## Purpose

TBD - created by archiving change 'line-bot-accounting-app'. Update Purpose after archive.

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

The system SHALL send the extracted PDF text to OpenAI gpt-4o-mini with a system prompt designed for batch parsing bank statements AND containing the active account name list read from `getAccounts()`. The system SHALL support statements from 10 Taiwan banks: 第一銀行, LINE Bank, 王道銀行, 永豐銀行, 玉山銀行, 台新銀行, 富邦銀行, 國泰銀行, 樂天銀行, and 台新證券/永豐證券. The API SHALL return a JSON object with a "transactions" array, where each element contains: date, type, category, item, description, institution, account, currency, and amount. The "account" field in each transaction SHALL be selected from the provided account name list; if no account can be identified, it SHALL be an empty string.

The function `parsePdfWithOpenAI(text, expenseCategories, incomeCategories, accountNames)` SHALL accept a fourth parameter `accountNames` (array of strings) and pass it to `buildPdfSystemPrompt()`. The `buildPdfSystemPrompt()` function SHALL include the account name list in the system prompt with the instruction that the "account" field MUST be selected from the provided list.

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
11. 中國信託 statements that produce garbled OCR text SHALL trigger a reply: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。"

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

#### Scenario: Garbled OCR text from 中國信託

- **WHEN** the extracted PDF text is mostly garbled with broken column structure (characteristic of 中國信託 PDFs)
- **THEN** the system replies: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。"

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

The system SHALL write all parsed transactions to the "交易紀錄" worksheet in batch using a shared buildImportSummary(result, source) function. The source parameter SHALL be "PDF匯入" for PDF file imports and "文字匯入" for pasted text imports. For PDF-sourced transactions, the date column SHALL use the transaction date from the statement (not the processing date). The original message column SHALL contain the source parameter value. The system SHALL reply with a summary including: source type, bank name (if detected), total transactions imported, expense count and total, income/cashback count and total.

#### Scenario: Successful PDF batch import

- **WHEN** 23 transactions are parsed from a 玉山銀行 PDF statement (18 expenses totaling 15,230, 5 cashback totaling 320)
- **THEN** the system writes 23 rows with original message "PDF匯入" and replies: "📄 帳單匯入完成！\n銀行：玉山銀行\n共匯入 23 筆交易\n  支出：18 筆，合計 15,230 元\n  回饋：5 筆，合計 320 元"

#### Scenario: Successful text batch import

- **WHEN** 5 transactions are parsed from pasted 樂天銀行 text (4 expenses totaling 8,000, 1 income totaling 500)
- **THEN** the system writes 5 rows with original message "文字匯入" and replies: "📄 帳單文字匯入完成！\n銀行：樂天銀行\n共匯入 5 筆交易\n  支出：4 筆，合計 8,000 元\n  收入：1 筆，合計 500 元"

#### Scenario: No transactions found

- **WHEN** the extracted PDF text yields zero parseable transactions
- **THEN** the system replies: "無法從此 PDF 中解析出交易紀錄，請確認是否為銀行帳單。"


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
