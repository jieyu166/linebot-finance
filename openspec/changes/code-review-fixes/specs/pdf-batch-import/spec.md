## MODIFIED Requirements

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
