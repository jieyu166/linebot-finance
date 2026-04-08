## ADDED Requirements

### Requirement: Download PDF from LINE message

The system SHALL detect when a user sends a file message with a PDF content type via LINE. The system SHALL download the PDF binary data from the LINE Content API endpoint (https://api-data.line.me/v2/bot/message/{messageId}/content) using the Channel Access Token for authorization. The downloaded data SHALL be stored as a Blob for further processing.

#### Scenario: PDF file received

- **WHEN** a user sends a PDF file to the LINE Bot
- **THEN** the system downloads the PDF binary via LINE Content API and obtains a Blob object

#### Scenario: Non-PDF file received

- **WHEN** a user sends a non-PDF file (e.g., .xlsx, .docx) to the LINE Bot
- **THEN** the system replies: "目前僅支援 PDF 檔案，請傳送 PDF 格式的銀行帳單。"

### Requirement: Extract text from PDF via Google Drive OCR

The system SHALL upload the PDF Blob to Google Drive with OCR conversion enabled, creating a temporary Google Doc. The system SHALL extract the full text content from the Google Doc. The system SHALL delete the temporary Google Doc after text extraction is complete. If the PDF is encrypted and OCR conversion fails, the system SHALL reply asking the user to decrypt the PDF themselves and re-send it.

#### Scenario: Successful text extraction

- **WHEN** an unencrypted PDF is uploaded to Google Drive with OCR enabled
- **THEN** the system creates a temporary Google Doc, extracts the text content, and deletes the temporary Doc

#### Scenario: Encrypted PDF detected

- **WHEN** the PDF is encrypted and Google Drive OCR fails to convert it
- **THEN** the system replies: "此 PDF 已加密，請先自行解密後再傳送。"

### Requirement: Batch parse bank statement text with OpenAI

The system SHALL send the extracted PDF text to OpenAI gpt-4o-mini with a system prompt designed for batch parsing bank statements. The system SHALL support statements from 10 Taiwan banks: 第一銀行, LINE Bank, 王道銀行, 永豐銀行, 玉山銀行, 台新銀行, 富邦銀行, 國泰銀行, 樂天銀行, and 台新證券/永豐證券. The API SHALL return a JSON object with a "transactions" array, where each element contains: date, type, category, item, description, institution, account, currency, and amount. The system prompt SHALL include these bank-specific rules:
1. ROC year conversion: dates in format 115/MM/DD SHALL be converted to 2026/MM/DD (民國年 + 1911 = 西元年). Banks using ROC year: 第一銀行, 玉山銀行, 台新銀行, 富邦銀行.
2. Payment/auto-debit lines (negative amounts with keywords 扣繳/繳款/自扣) SHALL be skipped.
3. Cashback/reward lines (negative amounts with keywords 回饋/現金回饋) SHALL be classified as type "收入" with category "回饋". If the actual amount is embedded in the description text (e.g., "回饋入帳戶_國內 207 元"), the amount SHALL be extracted from the description.
4. Foreign transaction service fees (國外交易服務費) SHALL be classified as category "手續費".
5. Securities trades: 現買/買進 SHALL be category "投資" (支出), 現賣/賣出 SHALL be category "投資獲利" (收入). The amount SHALL use 客戶應付 (buy) or 客戶應收 (sell) which includes fees.
6. Loan payments (貸款利息/償還本金) SHALL be category "貸款".
7. Marketing text, asset summaries, rate information, page headers, and pagination markers SHALL be skipped.
8. Duplicate data caused by PDF pagination SHALL be deduplicated.
9. 中國信託 statements that produce garbled OCR text SHALL trigger a reply: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。"

#### Scenario: Parse credit card statement with ROC year dates

- **WHEN** the extracted text contains 第一銀行 credit card lines like "03/07 03/11 連加*南紡購物中心 1,901 7142" with statement date "115/04/06"
- **THEN** OpenAI converts 115 to 2026, returns transactions with date "2026/03/07", institution "第一銀行", account "信用卡(7142)"

#### Scenario: Parse statement with cashback

- **WHEN** the extracted text contains cashback lines like "iLEO卡行動支付回饋_2月 -10" or "大戶消費回饋入帳戶_國內 207 元"
- **THEN** OpenAI returns transactions with type "收入", category "回饋", extracting the correct amount (10 or 207)

#### Scenario: Parse bank account statement

- **WHEN** the extracted text contains 永豐銀行 account transactions with columns 交易日/摘要/支出/存入/餘額
- **THEN** OpenAI returns transactions with institution "永豐銀行", classifying 股款交割 as 投資, 利息存入 as 收入/利息, 跨行轉帳 as 轉帳

#### Scenario: Parse securities statement

- **WHEN** the extracted text contains securities trades like "2026/03/06 普買 台積電 5 1,892.0000 9,460 ... -9,461"
- **THEN** OpenAI returns a transaction with type "支出", category "投資", item "台積電", amount 9461, currency "TWD"

#### Scenario: Skip payment and auto-debit lines

- **WHEN** the extracted text contains "感謝您本行自動扣繳已收到 -3,159" or "自動扣繳 -10,867"
- **THEN** OpenAI skips these lines and does not include them in the transactions array

#### Scenario: Garbled OCR text from 中國信託

- **WHEN** the extracted PDF text is mostly garbled with broken column structure (characteristic of 中國信託 PDFs)
- **THEN** the system replies: "此帳單格式無法正確辨識，請嘗試其他方式提供明細。"

#### Scenario: Partially unparseable statement

- **WHEN** some lines in the PDF text cannot be parsed as transactions
- **THEN** the system imports only the successfully parsed transactions and notes the count of skipped entries in the reply

#### Scenario: Deduplicate paginated data

- **WHEN** the extracted text contains duplicate transaction sections caused by PDF pagination (e.g., 永豐信用卡 臺幣 section appearing twice)
- **THEN** OpenAI deduplicates the transactions and returns each transaction only once

### Requirement: Batch write transactions and reply summary

The system SHALL write all parsed transactions to the "交易紀錄" worksheet in batch. For PDF-sourced transactions, the date column SHALL use the transaction date from the statement (not the processing date). The time column SHALL be empty for PDF-sourced transactions. The original message column SHALL contain "PDF匯入" as identifier. The system SHALL reply with a summary including: bank name (if detected), total transactions imported, expense count and total, income/cashback count and total.

#### Scenario: Successful batch import

- **WHEN** 23 transactions are parsed from a 玉山銀行 statement (18 expenses totaling 15,230, 5 cashback totaling 320)
- **THEN** the system writes 23 rows to "交易紀錄" and replies: "📄 帳單匯入完成！\n銀行：玉山銀行\n共匯入 23 筆交易\n  支出：18 筆，合計 15,230 元\n  回饋：5 筆，合計 320 元"

#### Scenario: No transactions found

- **WHEN** the extracted PDF text yields zero parseable transactions
- **THEN** the system replies: "無法從此 PDF 中解析出交易紀錄，請確認是否為銀行帳單。"

### Requirement: Clean up temporary files

The system SHALL delete all temporary files from Google Drive after processing is complete, regardless of success or failure. Temporary files include: uploaded PDFs and converted Google Docs.

#### Scenario: Cleanup after successful import

- **WHEN** batch import completes successfully
- **THEN** all temporary Drive files are deleted

#### Scenario: Cleanup after failure

- **WHEN** any step in the PDF processing pipeline fails
- **THEN** all temporary Drive files created during the process are deleted
