# account-management Specification

## Purpose

維護「帳戶管理」主檔（帳戶名稱、機構、幣別、初始餘額、初始日期），並依交易紀錄即時計算各帳戶餘額。帳戶名稱是交易紀錄 C 欄的比對鍵。

## Requirements

### Requirement: Initialize account management worksheet

The system SHALL create a worksheet named "帳戶管理" when `initializeSheets()` is executed, if the worksheet does not already exist. The worksheet SHALL have the following 7 columns in row 1: 帳戶名稱, 金融機構, 幣別, 初始餘額, 初始日期, 備註, 是否啟用. The system SHALL pre-populate 13 default accounts with 是否啟用 set to TRUE and 初始餘額 and 初始日期 left empty for the user to fill in.

The 13 default accounts SHALL be:

| 帳戶名稱 | 金融機構 | 幣別 |
|---------|---------|------|
| 現金 | 現金 | TWD |
| 一銀 | 第一銀行 | TWD |
| LineBank | LINE Bank | TWD |
| 王道 | 王道銀行 | TWD |
| 永豐大戶 | 永豐銀行 | TWD |
| 永豐證券 | 永豐證券 | TWD |
| 永豐外幣 | 永豐銀行 | USD |
| 玉山 | 玉山銀行 | TWD |
| 台新 | 台新銀行 | TWD |
| 中信 | 中國信託 | TWD |
| 富邦 | 富邦銀行 | TWD |
| 國泰 | 國泰銀行 | TWD |
| 樂天 | 樂天銀行 | TWD |

#### Scenario: First-time initialization creates worksheet

- **WHEN** `initializeSheets()` is called and no "帳戶管理" worksheet exists
- **THEN** the system creates the worksheet, writes the 7-column header in row 1, freezes row 1, and populates 13 default account rows starting at row 2

#### Scenario: Re-initialization is idempotent

- **WHEN** `initializeSheets()` is called and the "帳戶管理" worksheet already exists
- **THEN** the system leaves the worksheet unchanged

---
### Requirement: Read active account list

The system SHALL provide a `getAccounts(ss)` function that reads all rows from the "帳戶管理" worksheet and returns an array of account objects. Each object SHALL contain: name (帳戶名稱), institution (金融機構), currency (幣別, default "TWD"), initialBalance (初始餘額 as number, default 0), initialDate (初始日期 as string "yyyy/MM/dd" or empty), note (備註), and active (是否啟用 as boolean). Only accounts with 是否啟用 equal to TRUE SHALL be returned.

#### Scenario: Returns only active accounts

- **WHEN** the "帳戶管理" worksheet contains 13 rows of which 2 have 是否啟用 = FALSE
- **THEN** `getAccounts()` returns an array of 11 account objects

#### Scenario: Returns empty array when worksheet has no data rows

- **WHEN** the "帳戶管理" worksheet contains only the header row
- **THEN** `getAccounts()` returns an empty array

---
### Requirement: Calculate account current balance

The system SHALL provide a `calculateAccountBalance(accountName, ss)` function that computes the current balance for a named account. The function SHALL:
1. Call `getAccounts()` to find the account configuration (name, initialBalance, initialDate, currency).
2. Read all rows from the "交易紀錄" worksheet (columns A–I: 日期, 金融機構, 帳戶名稱, 類型, 幣別 at column H, 金額 at column I).
3. Include only rows that match the account (see matching rules below) AND column H (幣別) matches the account currency (case-insensitive) AND the transaction date is strictly after the account's initialDate (i.e., transaction date > initialDate; the initialDate itself is excluded). Date cells that are Date objects SHALL be interpreted in Asia/Taipei regardless of the script timezone.

   Account matching rules, applied in order after normalizing names (strip whitespace, full-width to half-width, lowercase):
   - a. Column C equals the account name.
   - b. Column C equals the account's 金融機構, and that institution + currency maps to exactly one active account.
   - c. Column C is blank and column B equals the account's 金融機構, and that institution + currency maps to exactly one active account (legacy rows).
   - d. Column C is blank and column B is blank or "現金" → treated as account "現金".
   
   Amount cells (column I and 初始餘額) MAY be numbers or strings containing thousands separators or currency symbols; the system SHALL parse them and use the absolute value for transaction amounts.
4. Subtract the amount for 支出 transactions and add the amount for 收入 transactions.
5. Exclude rows whose category is "繳信用卡" from balance calculations, because credit card statement expenses may already be imported separately and counting the bank debit would double-count the same spending.
6. Return an object with: name, currency, initialBalance, transactionTotal, currentBalance (initialBalance + transactionTotal), txCount, and initialDate.
7. Return null if no active account with the given name exists.

The `getAllAccountBalances(ss)` function SHALL compute balances for all active accounts in a single worksheet read, applying the same logic to each account.

#### Scenario: Balance with initial value and subsequent transactions

- **GIVEN** account 永豐大戶 has initialBalance 200000 and initialDate "2026/01/01"
- **WHEN** the "交易紀錄" worksheet contains 3 rows with 帳戶名稱 "永豐大戶", dates "2026/01/15", "2026/02/10", "2026/03/05", type 支出 for 5000, type 收入 for 2000, type 支出 for 3000
- **THEN** `calculateAccountBalance("永豐大戶")` returns currentBalance = 194000, transactionTotal = -6000, txCount = 3

#### Scenario: Transactions on or before initialDate are excluded

- **GIVEN** account 玉山 has initialDate "2026/01/01"
- **WHEN** a 支出 transaction of 1000 has date "2026/01/01" (same as initialDate)
- **THEN** that transaction is excluded from the balance calculation

#### Scenario: Account not found returns null

- **WHEN** `calculateAccountBalance("不存在帳戶")` is called
- **THEN** the function returns null

#### Scenario: No initialDate means all transactions are included

- **WHEN** an account has an empty initialDate
- **THEN** all transactions matching the account name and currency are included in the balance calculation

#### Scenario: Legacy row with blank account column matched by institution

- **WHEN** a transaction row has 金融機構 "永豐銀行", blank 帳戶名稱, 幣別 "TWD", and only one active TWD account has institution 永豐銀行
- **THEN** `calculateAccountBalance("永豐大戶")` includes that row

#### Scenario: Account column holds institution name

- **WHEN** a transaction row has 帳戶名稱 "LINE Bank" and account "LineBank" has institution "LINE Bank"
- **THEN** the row is matched to account "LineBank"

#### Scenario: Amount stored as formatted string

- **WHEN** a 支出 row has 金額 "1,234" (string)
- **THEN** the balance decreases by 1234

#### Scenario: Blank cash account rows count as cash

- **WHEN** a transaction row has 金融機構 "現金", blank 帳戶名稱, 幣別 "TWD", and type 支出
- **THEN** `calculateAccountBalance("現金")` includes that row in the cash balance calculation

#### Scenario: Credit card payment rows excluded from balance

- **WHEN** a transaction row has category "繳信用卡"
- **THEN** account balance calculations exclude that row to avoid double-counting with imported credit card statement expenses

##### Example: boundary date cases

| Transaction Date | initialDate | Included? |
|-----------------|-------------|-----------|
| 2026/01/01 | 2026/01/01 | No (equal, excluded) |
| 2026/01/02 | 2026/01/01 | Yes (strictly after) |
| 2025/12/31 | 2026/01/01 | No (before) |
| 2026/01/01 | (empty) | Yes (no filter) |
