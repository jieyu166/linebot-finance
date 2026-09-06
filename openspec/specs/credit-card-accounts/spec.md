# credit-card-accounts Specification

## Purpose

信用卡消費與繳卡費扣款分開記在兩個帳戶：信用卡帳戶（type 信用卡）記錄消費本身，銀行帳戶記錄扣款；兩者透過 transfer-pairing 自動配對，避免同一筆錢被算兩次。同樣地，證券交割戶（type 證券）代表交割銀行帳戶的現金，與同機構的活存帳戶分離。本規格涵蓋這兩種帳戶類型的餘額語意、匯入時的帳戶判斷順序、對帳單去重規則，以及舊資料一次性搬移工具。

## Requirements

### Requirement: Credit card modeled as a separate account with negative balance

The system SHALL treat a credit card as its own row in "帳戶管理" with 帳戶類型 (H 欄) = "信用卡", distinct from the bank account it is debited from. A credit card account's `currentBalance` (= `initialBalance + transactionTotal`) SHALL be negative when there is unpaid card debt: card purchases are recorded as 支出 on the card account (decreasing the balance further into negative territory) and card payments received (see "Payment auto-pair") are recorded as 收入 on the card account (moving the balance back toward zero). The user SHALL set a card account's `initialBalance` to the negative of the prior period's unpaid amount (上期未繳金額的負數) and `initialDate` to that period's statement closing date (結帳日).

Balance calculation no longer excludes 繳信用卡 rows: `calculateBalanceFromRows` includes every row that matches the account, regardless of category, so a 繳信用卡 row posted to the **bank** account reduces that bank account's balance like any other 支出, while the matching auto-paired 收入 row on the **card** account raises the card's balance back toward zero.

#### Scenario: Card purchases decrease the card account balance

- **WHEN** 永豐信用卡 (type 信用卡, initialBalance -0, initialDate the July statement closing date) has 支出 rows for August purchases totaling 15,000
- **THEN** `calculateAccountBalance('永豐信用卡')` returns a `currentBalance` more negative than -0 by 15,000 (i.e. -37,564), representing more unpaid debt

#### Scenario: Payment posted to the card account raises balance toward zero

- **WHEN** a 收入／轉帳 "卡費入帳" row of 0 is posted to 永豐信用卡 (auto-paired against the bank's 繳信用卡 row)
- **THEN** the card account's `currentBalance` increases by 0

#### Scenario: 繳信用卡 row on the bank account is a normal expense

- **WHEN** a 支出／繳信用卡 row of 0 exists on 永豐大戶 (a 銀行-type account)
- **THEN** it is included in 永豐大戶's balance calculation like any other 支出, decreasing 永豐大戶's `currentBalance` by 0 (no longer excluded from balance calculation)

---
### Requirement: Resolve the credit card account for a payment row

The system SHALL provide `resolveCreditCardAccount(tx, accounts)` to determine which 信用卡-type account a 繳信用卡 payment row belongs to, trying these strategies in order and stopping at the first that yields exactly one match:

1. **Name in text**: filter accounts of type 信用卡 whose normalized name appears within the normalized text of `tx.description` + `tx.item` (via `textOf(tx)`). If exactly one matches, return it.
2. **Institution in text, filtered by currency hint**: filter 信用卡 accounts whose normalized institution (or that institution with a trailing "銀行" suffix stripped, when at least 2 characters remain) appears in the text, then apply `filterByCurrencyHint(tx, list)` — which narrows to non-TWD accounts when the text hints at 換匯／外幣／usd, else to TWD accounts, falling back to the unfiltered list if the filter empties it. If exactly one remains, return it.
3. **扣款帳戶 (debitAccount) fallback**: filter 信用卡 accounts whose I 欄「扣款帳戶」equals `tx.account` (normalized), again narrowed by `filterByCurrencyHint`. If exactly one remains, return it.
4. Otherwise return null.

#### Scenario: Card name resolved from institution shorthand in description

- **WHEN** `resolveCreditCardAccount` is called for a 繳信用卡 row on 永豐大戶 with description "永豐卡費", and 永豐信用卡 (institution 永豐銀行) is the only credit-card account whose institution text appears in the description
- **THEN** the function returns 永豐信用卡

#### Scenario: Currency hint disambiguates dual-currency cards

- **WHEN** the description is "永豐卡費換匯" and both 永豐信用卡 (TWD) and 永豐信用卡外幣 (USD) match on institution
- **THEN** `filterByCurrencyHint` narrows to the USD account because "換匯" is present, so the function returns 永豐信用卡外幣

#### Scenario: Debit account fallback when text gives no hint

- **WHEN** the description is a generic "卡費" with no matching card name or institution text, and exactly one 信用卡 account (一銀信用卡) has 扣款帳戶 equal to the payment row's account (一銀)
- **THEN** the function returns 一銀信用卡

#### Scenario: Ambiguous debit account returns null

- **WHEN** two 信用卡 accounts both have 扣款帳戶 equal to the payment row's account and neither the card name nor institution appears in the text
- **THEN** `resolveCreditCardAccount` returns null, and `autoPairImportedTransactions` records "無法判斷信用卡帳戶，請在 App 手動連結" for that row

---
### Requirement: Brokerage settlement account represents cash at the settlement bank account

The system SHALL support 帳戶類型 = "證券" to represent the cash balance of a securities settlement account (交割戶), which is a separate bank account number from the user's regular checking account at the same institution (e.g. 永豐證券 vs 永豐大戶). A 證券-type account does NOT track share holdings or market value — only cash movements. Securities statement imports record a buy as 支出／投資 and a sell as 收入／投資獲利 on the 證券-type account, with the stock name in 品項 and 明細描述.

`resolveBrokerageAccount(tx, accounts)` resolves the settlement account for a bank-side 轉帳 row (e.g. a transfer from 永豐大戶 to its settlement account) by:
1. Filtering accounts to type 證券 and calling `matchCounterpartyAccount(tx.description, brokers)`; if it uniquely resolves, return that account.
2. Otherwise, if the transaction's text (`textOf(tx)`) does not contain "交割" or "證券", return null.
3. Otherwise filter 證券 accounts whose 扣款帳戶 equals `tx.account` (normalized); if exactly one remains, return it, else return null.

#### Scenario: Settlement account resolved by counterparty account number

- **WHEN** a 轉帳 row on 永豐大戶 has description "手機轉帳 04201820006159" and 永豐證券's 帳號識別 is "042-01"
- **THEN** `resolveBrokerageAccount` returns 永豐證券 via the account-number match, without needing the "交割"/"證券" keyword check

#### Scenario: No settlement keyword and no account match returns null

- **WHEN** a 轉帳 row's description contains neither a matching account number nor the words "交割" or "證券"
- **THEN** `resolveBrokerageAccount` returns null

---
### Requirement: Deduplicate imported transactions against the existing sheet

The system SHALL provide `dedupeAgainstSheet(transactions, ss)` to prevent the same real-world transaction from being recorded twice when it appears on more than one statement (e.g. a brokerage settlement account's bank-statement line duplicating its securities-statement line). For each incoming transaction, `isDuplicateImport(tx, existingTxs, options)` (default `dayWindow` 2) considers an existing row a duplicate when: the existing row's `source` is one of `IMPORT_SOURCES` (`PDF匯入`, `文字匯入`, `自動配對` — i.e. not a manually typed entry), its `type` matches, its normalized `account` and `currency` match, its amount matches within 0.005, and the two dates differ by no more than `dayWindow` (2) days.

When a duplicate is found:
- The incoming transaction is added to `result.skipped` (not written to the sheet).
- If the incoming transaction has a specific stock name (`category` is 投資 or 投資獲利, `item` is non-empty, and `item` does NOT match the generic pattern `GENERIC_STOCK_ITEMS` = /定期買股|交割|證券|股票/) while the existing row's `item` IS generic (matches that pattern), the existing row's F–G 欄 (品項, 明細描述) are overwritten with the incoming transaction's item/description, and `result.merged` is incremented.
- Each existing row can be consumed as a duplicate at most once per call (later incoming transactions cannot match an already-consumed existing row), but duplicates among the incoming batch itself are compared against the (still generic) existing row again, so a same-day duplicate purchase (e.g. two identical "XSOLLA 670" charges) does not shrink to one row purely because of this rewrite step — only the first of the batch triggers the merge/skip against that existing row; the remainder are still checked and may separately match other rows or be kept.

#### Scenario: Securities statement item overwrites a generic bank-statement placeholder

- **WHEN** an existing row (from a bank statement import) reads 支出／投資／"定期買股" for 9,498 on 永豐證券, and the securities statement import later brings a matching-amount, matching-account, matching-type row within 2 days with item "台積電" and description "普買 台積電 4股"
- **THEN** the existing row's 品項/明細描述 are rewritten to "台積電" / "普買 台積電 4股", the incoming transaction is skipped (not written as a new row), and `result.merged` is 1

#### Scenario: Bank statement's generic item does not overwrite an already-specific row

- **WHEN** an existing row already has the specific item "台積電", and a later bank-statement import brings a matching-amount row with the generic item "定期買股"
- **THEN** the incoming transaction is skipped, the existing row is left unchanged, and `result.merged` is 0

#### Scenario: Genuine same-day duplicate transactions are not merged into one

- **WHEN** the incoming batch has two separate rows both "XSOLLA" 670 on the same account/date, and only one existing generic placeholder row of the same amount exists
- **THEN** exactly one of the two incoming rows is kept (matched and rewrites the existing row) while the other is also skipped as matching the (now-rewritten) existing row, with `result.merged` counting only the first rewrite

---
### Requirement: Legacy data migration to credit card accounts

The system SHALL provide a one-off `migrateCreditCardRows(fromAccount, toAccount, startDate, endDate, dryRun, ss)` function to move historical rows that were mistakenly recorded against a bank account into the correct credit-card account. `dryRun` defaults to `true` (any value other than `false` is treated as true). The function SHALL:
1. Resolve `toAccount` via `findAccountByName()`; if not found, throw `Error('找不到目標帳戶：' + toAccount)`.
2. Scan all rows in "交易紀錄"; select rows whose 帳戶名稱 (normalized) equals `fromAccount`, whose category is neither "繳信用卡" nor "轉帳", whose `source` is one of `IMPORT_SOURCES` (imported rows only — manually typed entries are never migrated), and whose date falls within `[startDate, endDate]` when those bounds are supplied.
3. For each matching row, log a preview line via `Logger.log` prefixed "[預覽] " (dryRun) or "[搬移] " (dryRun=false) with the row number, date, item, and amount; increment `result.matched` and record the row index.
4. When `dryRun` is false, overwrite that row's B–C 欄 (金融機構, 帳戶名稱) with the target account's institution and name, and increment `result.moved`.
5. Log a summary line with the matched/moved counts, and if still in dryRun mode, a reminder "（預覽，未寫入；正式執行傳 dryRun=false）".
6. Return `{ matched, moved, rows[] }`.

#### Scenario: Preview run reports matches without writing

- **WHEN** `migrateCreditCardRows('一銀', '一銀信用卡', '', '', true, ss)` is called and one qualifying purchase row exists on 一銀 (plus a 繳信用卡 row and a manually-typed row, both excluded)
- **THEN** the result is `{ matched: 1, moved: 0 }` and the qualifying row's 帳戶名稱 is unchanged ("一銀")

#### Scenario: Live run moves matching rows and leaves excluded rows untouched

- **WHEN** `migrateCreditCardRows('一銀', '一銀信用卡', '', '', false, ss)` is called against the same fixture
- **THEN** the qualifying row's B/C 欄 become "第一銀行" / "一銀信用卡"; the 繳信用卡 row and the manually-typed row (source not in `IMPORT_SOURCES`) remain on "一銀" / "現金" respectively, and `result` is `{ matched: 1, moved: 1 }`

#### Scenario: Date range restricts matched rows

- **WHEN** `startDate` is later than a qualifying row's date
- **THEN** that row is excluded from `matched`

#### Scenario: Unknown target account throws

- **WHEN** `toAccount` does not resolve to any active account
- **THEN** the system throws an error containing "找不到目標帳戶："

---
### Requirement: Re-pair existing unpaired credit card payment rows

The system SHALL provide `pairExistingCreditCardPayments(dryRun, ss)` (default `dryRun` true) to retroactively auto-pair 繳信用卡 rows that predate the transfer-pairing feature (or were migrated without a corresponding paired counterpart). The function SHALL collect every row whose category is "繳信用卡" and whose 轉帳ID is empty. In dryRun mode it SHALL log the count and return `{ paired: 0, created: 0, details: [...] }` where each detail line is `date + ' ' + account + ' ' + amount` (no rows written). When `dryRun` is false, it SHALL call `autoPairImportedTransactions(targets, ss)` on that same list and return its result.

#### Scenario: Dry run lists unpaired rows without writing

- **WHEN** `pairExistingCreditCardPayments(true, ss)` is called and one 繳信用卡 row (2026/03/09, 一銀, 3159) has no 轉帳ID
- **THEN** the result is `{ paired: 0, created: 0, details: ['2026/03/09 一銀 3159'] }` and no rows are modified

#### Scenario: Live run pairs and creates counterpart rows

- **WHEN** `pairExistingCreditCardPayments(false, ss)` is called against the same fixture, and `resolveCreditCardAccount` uniquely resolves 一銀信用卡 for that row
- **THEN** a new 收入／轉帳 row is appended on 一銀信用卡 sharing a transfer ID with the original 繳信用卡 row, and the result reports `paired: 1, created: 1`
