# balance-query Specification

## Purpose

LINE 文字指令查詢帳戶餘額：全部帳戶一覽、單一帳戶明細、帳戶清單。

## Requirements

### Requirement: Detect balance query commands

The system SHALL detect balance query commands in the `handleTextMessage` function BEFORE the bank statement detection check (`isBankStatement`). A `detectBalanceCommand(text)` function SHALL return an object `{ isCommand: boolean, accountName: string|null }`. The detection rules SHALL be applied in this order:

1. If text exactly matches "餘額", "查餘額", "所有餘額", or "帳戶餘額" → `{ isCommand: true, accountName: null }` (all accounts)
2. If text exactly matches "帳戶清單" or "帳戶列表" → `{ isCommand: true, accountName: "__LIST__" }` (account list)
3. If text matches the pattern `<X>餘額` (suffix) → `{ isCommand: true, accountName: X.trim() }`
4. If text matches the pattern `餘額 <X>` (prefix with space) → `{ isCommand: true, accountName: X.trim() }`
5. Otherwise → `{ isCommand: false, accountName: null }`

When `isCommand` is true, the system SHALL call `handleBalanceCommand(replyToken, accountName, ss)` and return without proceeding to the accounting flow.

#### Scenario: All-account query detected

- **WHEN** user sends "餘額"
- **THEN** `detectBalanceCommand("餘額")` returns `{ isCommand: true, accountName: null }`

#### Scenario: Single account suffix query detected

- **WHEN** user sends "永豐大戶餘額"
- **THEN** `detectBalanceCommand("永豐大戶餘額")` returns `{ isCommand: true, accountName: "永豐大戶" }`

#### Scenario: Single account prefix query detected

- **WHEN** user sends "餘額 玉山"
- **THEN** `detectBalanceCommand("餘額 玉山")` returns `{ isCommand: true, accountName: "玉山" }`

#### Scenario: Account list command detected

- **WHEN** user sends "帳戶清單"
- **THEN** `detectBalanceCommand("帳戶清單")` returns `{ isCommand: true, accountName: "__LIST__" }`

#### Scenario: Normal accounting message not misidentified

- **WHEN** user sends "午餐80"
- **THEN** `detectBalanceCommand("午餐80")` returns `{ isCommand: false, accountName: null }` and the message proceeds to normal accounting flow

---
### Requirement: Reply with all account balances

The system SHALL reply with a formatted list of all active accounts and their current balances when `accountName` is null. The reply SHALL begin with "💰 帳戶餘額一覽（yyyy/MM/dd）" where the date is today in Asia/Taipei timezone. Each account SHALL appear on its own line showing the account name and current balance. TWD balances SHALL be formatted with a dollar sign and thousands separators (e.g., "$12,500"). Non-TWD balances SHALL include the currency code after the amount (e.g., "$1,230 USD"). The reply SHALL end with the total count of accounts.

#### Scenario: All accounts listed with correct balance format

- **WHEN** user sends "餘額" and 3 active accounts exist: 現金 ($12,500 TWD), 永豐大戶 ($210,973 TWD), 永豐外幣 ($1,230 USD)
- **THEN** the system replies with a message starting "💰 帳戶餘額一覽" and listing all three accounts with correct amounts and currency labels

#### Scenario: No accounts configured

- **WHEN** user sends "餘額" but no active accounts exist in "帳戶管理"
- **THEN** the system replies: "尚未設定任何帳戶，請先在試算表「帳戶管理」工作表填入資料。"

---
### Requirement: Reply with single account balance

The system SHALL reply with detailed balance information for a named account when `accountName` is a non-null, non-"__LIST__" string. The reply SHALL include: account name, currency, initial balance with initialDate (if set), transaction total with transaction count, and current balance. Amounts SHALL be formatted with dollar sign and thousands separators; negative totals SHALL use a minus sign prefix (e.g., "-$3,000"). Positive totals SHALL use a plus sign prefix (e.g., "+$10,973"). If the account name does not match any active account, the system SHALL reply with a not-found message listing the valid account names.

#### Scenario: Single account found and displayed

- **WHEN** user sends "永豐大戶餘額" and the account has initialBalance 200000, initialDate "2026/01/01", transactionTotal +10973 (47 transactions)
- **THEN** the system replies with: "💰 永豐大戶 餘額\n\n幣別：TWD\n初始餘額：$200,000（2026/01/01 起算）\n交易調整：+$10,973（共 47 筆）\n當前餘額：$210,973"

#### Scenario: Account name not found

- **WHEN** user sends "聯邦餘額" and "聯邦" does not exist in the account list
- **THEN** the system replies with a not-found message that lists the valid account names from `getAccounts()`

---
### Requirement: Reply with account list

The system SHALL reply with the list of all active account names when `accountName` is "__LIST__". The reply SHALL begin with "📋 帳戶清單（共 N 個）" where N is the count of active accounts, followed by each account name and its currency.

#### Scenario: Account list displayed

- **WHEN** user sends "帳戶清單" and 13 active accounts exist
- **THEN** the system replies starting with "📋 帳戶清單（共 13 個）" followed by all 13 account names with their currency codes
