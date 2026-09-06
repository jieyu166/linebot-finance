# account-management Specification

## Purpose

維護「帳戶管理」主檔（帳戶名稱、機構、幣別、初始餘額、初始日期），並依交易紀錄即時計算各帳戶餘額。帳戶名稱是交易紀錄 C 欄的比對鍵。

## Requirements

### Requirement: Initialize account management worksheet

The system SHALL create a worksheet named "帳戶管理" when `initializeSheets()` is executed, if the worksheet does not already exist. The worksheet SHALL have the following 10 columns in row 1 (`ACCOUNT_HEADERS`): A 帳戶名稱, B 金融機構, C 幣別, D 初始餘額, E 初始日期, F 備註, G 是否啟用, H 帳戶類型, I 扣款帳戶, J 帳號識別. The system SHALL pre-populate 21 default accounts (`DEFAULT_ACCOUNTS`) with G 是否啟用 set to TRUE and D 初始餘額／E 初始日期 left empty for the user to fill in.

H 帳戶類型 SHALL be one of `現金`／`銀行`／`信用卡`／`證券`. I 扣款帳戶 SHALL, for a 信用卡 account, name the bank account it is auto-debited from, and for a 證券 account, name its usual settlement-source bank account; auto-pairing (see transfer-pairing, credit-card-accounts) prefers this column when resolving counterpart accounts. J 帳號識別 SHALL hold the account-number fragment(s) visible on statements for this account (comma/顿號-separated when a bank exposes multiple sub-accounts, e.g. 玉山 `0015977,0381979`), used to route transactions from a multi-account statement to the correct row.

The 21 default accounts SHALL be:

| 帳戶名稱 | 金融機構 | 幣別 | 類型 | 扣款帳戶 | 帳號識別 | 備註 |
|---|---|---|---|---|---|---|
| 現金 | 現金 | TWD | 現金 | | | |
| 一銀 | 第一銀行 | TWD | 銀行 | | 630 | |
| 一銀信用卡 | 第一銀行 | TWD | 信用卡 | 一銀 | | 綠活卡＋iLEO 同一帳單 |
| LineBank | LINE Bank | TWD | 銀行 | | | 簽帳卡走銀行明細 |
| 王道 | 王道銀行 | TWD | 銀行 | | | 簽帳卡走銀行明細 |
| 永豐大戶 | 永豐銀行 | TWD | 銀行 | | 198-01 | |
| 永豐信用卡 | 永豐銀行 | TWD | 信用卡 | 永豐大戶 | | 大戶卡＋幣倍卡＋大衛卡 同一帳單 |
| 永豐信用卡外幣 | 永豐銀行 | USD | 信用卡 | 永豐大戶 | | 雙幣卡美元帳單 |
| 永豐證券 | 永豐銀行 | TWD | 證券 | 永豐大戶 | 042-01 | 交割戶 |
| 永豐外幣 | 永豐銀行 | USD | 銀行 | | 042-00 | |
| 玉山 | 玉山銀行 | TWD | 銀行 | | 0015977,0381979 | |
| 玉山信用卡 | 玉山銀行 | TWD | 信用卡 | 玉山 | | UBear 卡 |
| 台新 | 台新銀行 | TWD | 銀行 | | 288810,288815,288818 | Richart |
| 台新信用卡 | 台新銀行 | TWD | 信用卡 | 台新 | | Richart 卡 |
| 中信 | 中國信託 | TWD | 銀行 | | | 網頁複製文字匯入 |
| 中信信用卡 | 中國信託 | TWD | 信用卡 | 中信 | | 中信 Line 卡 |
| 富邦 | 富邦銀行 | TWD | 銀行 | | | |
| 富邦信用卡 | 富邦銀行 | TWD | 信用卡 | 富邦 | | Costco 卡 |
| 國泰 | 國泰銀行 | TWD | 銀行 | | | |
| 國泰信用卡 | 國泰銀行 | TWD | 信用卡 | 國泰 | | Cube 卡 |
| 樂天 | 樂天銀行 | TWD | 銀行 | | | |

#### Scenario: First-time initialization creates worksheet

- **WHEN** `initializeSheets()` is called and no "帳戶管理" worksheet exists
- **THEN** the system creates the worksheet, writes the 10-column header in row 1, freezes row 1, and populates 21 default account rows starting at row 2

#### Scenario: Re-initialization only tops up missing headers and accounts

- **WHEN** `initializeSheets()` is called and the "帳戶管理" worksheet already exists
- **THEN** the system calls `upsertDefaultAccounts()`, which leaves existing rows' 初始餘額／初始日期 untouched, adds the H/I/J 欄 header only if H1 is not already "帳戶類型", and appends any of the 21 default accounts (matched by normalized name) that are missing — it never overwrites existing account rows

#### Scenario: upsertDefaultAccounts is idempotent

- **WHEN** `upsertDefaultAccounts(ss)` is called twice in a row on the same spreadsheet
- **THEN** the second call finds all 21 default accounts already present (by normalized name) and appends 0 rows

---
### Requirement: Read active account list

The system SHALL provide a `getAccounts(ss)` function that reads all rows (A–J, 10 columns) from the "帳戶管理" worksheet and returns an array of account objects. Each object SHALL contain: name (帳戶名稱), institution (金融機構), currency (幣別, default "TWD"), initialBalance (初始餘額 as number, default 0), initialDate (初始日期 as string "yyyy/MM/dd" or empty), note (備註), active (是否啟用 as boolean), type (帳戶類型, H 欄; when blank, defaults to "現金" if the name contains "現金" else "銀行"), debitAccount (扣款帳戶, I 欄, trimmed string), and accountNumberHints (帳號識別, J 欄, split on `,`／`，`／`、` into a trimmed, non-empty string array). Only accounts with 是否啟用 equal to TRUE SHALL be returned. Each returned account also carries `institutionUnique` (true when it is the only active account sharing its normalized 機構＋幣別 combination), used by legacy institution-based row matching.

#### Scenario: Returns only active accounts

- **WHEN** the "帳戶管理" worksheet contains 21 rows of which 2 have 是否啟用 = FALSE
- **THEN** `getAccounts()` returns an array of 19 account objects

#### Scenario: Returns empty array when worksheet has no data rows

- **WHEN** the "帳戶管理" worksheet contains only the header row
- **THEN** `getAccounts()` returns an empty array

#### Scenario: Type defaults when H 欄 is blank

- **WHEN** an account row has blank H 欄 (帳戶類型) and its name contains "現金"
- **THEN** the returned object's `type` is "現金"; for any other blank-H account it is "銀行"

#### Scenario: accountNumberHints splits comma-separated hints

- **WHEN** an account's J 欄 (帳號識別) is "0015977,0381979"
- **THEN** `accountNumberHints` is `['0015977', '0381979']`

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
5. Rows with category 繳信用卡 are included like any other 支出; credit-card accounts (type 信用卡) therefore carry a negative balance equal to the unpaid amount.
6. Return an object with: name, type (帳戶類型, default "銀行"), currency, initialBalance, transactionTotal, currentBalance (initialBalance + transactionTotal), txCount, and initialDate.
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

#### Scenario: Credit card payment rows included as a normal expense

- **WHEN** a transaction row has category "繳信用卡" of 5000 against a 信用卡-type account
- **THEN** the row is included like any other 支出, decreasing that account's currentBalance by 5000 (a negative currentBalance represents the unpaid amount)

##### Example: boundary date cases

| Transaction Date | initialDate | Included? |
|-----------------|-------------|-----------|
| 2026/01/01 | 2026/01/01 | No (equal, excluded) |
| 2026/01/02 | 2026/01/01 | Yes (strictly after) |
| 2025/12/31 | 2026/01/01 | No (before) |
| 2026/01/01 | (empty) | Yes (no filter) |
