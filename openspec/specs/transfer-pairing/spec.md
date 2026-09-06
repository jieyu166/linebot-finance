# transfer-pairing Specification

## Purpose

在「交易紀錄」新增 K 欄 ID、L 欄轉帳ID 後，提供轉帳配對核心：LINE 匯入與 App 新增交易時自動找出對方帳戶的配對列並寫入相同轉帳ID，也提供手動連結／解除連結／建立轉帳的 API。涵蓋繳信用卡、一般轉帳、跨幣別換匯、ATM 提款、證券交割戶匯款等情境，以及從交易描述辨識對方帳戶／對方銀行的比對邏輯。

## Requirements

### Requirement: Link two existing transactions as a transfer

The system SHALL provide `linkTransfer(idA, idB, ss)` that pairs two existing transaction rows by writing a new UUID to the L 欄（轉帳ID）of both rows and setting their E 欄（分類）to "轉帳". The function SHALL look up both transactions by ID via `findTransactionsByIds()` and validate, in order:
1. Both IDs must resolve to existing transactions, else throw `Error('找不到要連結的交易，可能已被刪除')`.
2. Neither transaction may already have a 轉帳ID, else throw `Error('其中一筆已是轉帳配對，請先解除')`.
3. The two transactions must belong to different accounts (normalized comparison), else throw `Error('兩筆交易屬於同一帳戶，無法配對')`.
4. The two transactions must have different `type` (one 支出, one 收入), else throw `Error('兩筆交易必須一筆支出、一筆收入')`.
5. If both transactions share the same currency, their amounts must match within 0.005, else throw `Error('同幣別的轉帳金額必須相同')`. Cross-currency pairs are not amount-checked.

On success the function acquires `LockService.getScriptLock()`, writes the shared transfer ID and category "轉帳" to both rows, and returns the transfer ID.

#### Scenario: Successful link writes shared transfer ID and category

- **WHEN** `linkTransfer('idA', 'idB', ss)` is called with two existing transactions of different accounts, opposite types, and matching TWD amounts
- **THEN** both rows' L 欄 (轉帳ID) receive the same newly generated UUID and both rows' E 欄 (分類) become "轉帳"

#### Scenario: Transaction not found

- **WHEN** one of the given IDs does not match any row in "交易紀錄"
- **THEN** the system throws an error containing "找不到要連結的交易"

#### Scenario: Already paired

- **WHEN** one of the two transactions already has a non-empty 轉帳ID
- **THEN** the system throws an error containing "已是轉帳配對"

#### Scenario: Same account rejected

- **WHEN** both transactions have the same 帳戶名稱 (after normalization)
- **THEN** the system throws an error containing "同一帳戶"

#### Scenario: Same type rejected

- **WHEN** both transactions have `type` "支出" (or both "收入")
- **THEN** the system throws an error containing "一筆支出、一筆收入"

#### Scenario: Same-currency amount mismatch rejected

- **WHEN** both transactions share currency "TWD" but their amounts differ by 1 (e.g. 1000 vs 999)
- **THEN** the system throws an error containing "金額必須相同"

---
### Requirement: Unlink a transfer pairing

The system SHALL provide `unlinkTransfer(transferId, ss)` that scans "交易紀錄" for every row whose L 欄 (轉帳ID) equals `transferId`, clears their L 欄 to an empty string, and returns the count of rows cleared. The category (E 欄) is left unchanged.

#### Scenario: Unlink clears transfer ID on all matching rows

- **WHEN** two rows share 轉帳ID "tr-1" and one unrelated row has no 轉帳ID
- **THEN** `unlinkTransfer('tr-1', ss)` returns 2 and both matching rows' L 欄 become empty; the unrelated row's L 欄 stays empty

#### Scenario: Unknown transfer ID returns zero

- **WHEN** `transferId` does not match any row's L 欄
- **THEN** `unlinkTransfer` returns 0 and no rows are modified

---
### Requirement: Create a transfer between two accounts

The system SHALL provide `createTransfer(params, ss)` where `params` is `{ fromAccount, toAccount, amount, date, note, toAmount }`. The function SHALL:
1. Resolve `fromAccount` and `toAccount` via `findAccountByName()`; if either is missing, throw `Error('找不到帳戶：' + 缺少的帳戶名稱)`.
2. Reject when `from.name === to.name` with `Error('轉出與轉入帳戶不可相同')`.
3. Compute the outgoing amount as `Math.abs(parseAmount(params.amount))`.
4. Compute the incoming amount: if the two accounts share the same currency, or `params.toAmount` is undefined/empty, the incoming amount equals the outgoing amount; otherwise (cross-currency with `toAmount` supplied) the incoming amount is `Math.abs(parseAmount(params.toAmount))`.
5. Generate one shared transfer ID (UUID) and write two rows via `appendTransactionsBatch(..., 'App', ss)`: the outgoing row (支出／轉帳, item "轉帳至" + toAccount name, currency = from account's currency, amount = outgoing amount) and the incoming row (收入／轉帳, item "來自" + fromAccount name, currency = to account's currency, amount = incoming amount). Both rows share `description` = `params.note || ''`.

#### Scenario: Same-currency transfer writes matching amounts

- **WHEN** `createTransfer({ fromAccount: '永豐大戶', toAccount: '玉山', amount: 1000, date: '2026/09/01', note: '' }, ss)` is called and both accounts are TWD
- **THEN** two rows are written sharing one transfer ID: a 支出 row on 永豐大戶 with item "轉帳至玉山", and a 收入 row on 玉山 with item "來自永豐大戶", both amount 1000

#### Scenario: Cross-currency transfer with explicit toAmount

- **WHEN** `createTransfer({ fromAccount: '永豐大戶', toAccount: '永豐外幣', amount: 161325, toAmount: 5000, date: '2026/09/01', note: '' }, ss)` is called (永豐大戶 is TWD, 永豐外幣 is USD)
- **THEN** the outgoing row records amount 161325 in TWD and the incoming row records amount 5000 in USD, sharing one transfer ID

#### Scenario: Cross-currency transfer without toAmount falls back to same amount

- **WHEN** `createTransfer` is called for the same cross-currency pair without `toAmount`
- **THEN** both rows record amount 161325, each in its own account's currency (TWD and USD respectively)

#### Scenario: Missing account

- **WHEN** `fromAccount` or `toAccount` does not resolve via `findAccountByName()`
- **THEN** the system throws an error containing "找不到帳戶：" followed by the missing account name

#### Scenario: Same account for both sides

- **WHEN** `fromAccount` and `toAccount` are the same account
- **THEN** the system throws an error containing "不可相同"

---
### Requirement: Auto-pair newly imported or added transactions

The system SHALL provide `autoPairImportedTransactions(newTxs, ss)` that inspects each transaction in `newTxs` (already written to "交易紀錄", each with at least an `id`) and, when unpaired (`transferId` empty), attempts to find or create its counterpart row. The function SHALL return `{ paired, created, details[] }` where `details` holds one human-readable line per transaction that could not be auto-paired.

Per transaction, the logic SHALL branch on category:

1. **繳信用卡**: call `resolveCreditCardAccount(tx, accounts)`. If no card account is found, push `<label>：無法判斷信用卡帳戶，請在 App 手動連結` to `details` and skip (where `<label>` is `category + ' ' + date + ' ' + account + ' ' + amount`). If found and the card's currency differs from the transaction's currency, the transaction MUST carry a `fxAmount` (from the caller); if absent, push `<label>：外幣卡費金額不明，請在 App 手動連結` and skip. Otherwise call `pairWithNewRow(tx, card, amount, '卡費入帳', ss)`, which appends one new counterpart row (收入／轉帳, item "卡費入帳", account = the card account, same date) via `appendTransactionsBatch` and writes a shared UUID to both rows' L 欄; increment both `paired` and `created`.

2. **轉帳**: compute `cp = matchCounterpartyAccount(tx.description, accounts)`, then call `pickTransferCandidates(tx, all, accounts, { counterpartyAccount: cp ? cp.name : '', counterpartyBank: cp ? '' : parseCounterpartyBank(tx.description) })`.
   - If exactly one candidate: write the shared transfer ID and category "轉帳" to both rows via `writeTransferCells`; increment `paired`.
   - If more than one candidate: push `<label>：多個候選，請在 App 手動連結` to `details` and skip (no pairing).
   - If zero candidates and `tx.type` is not 支出: skip silently (nothing to do for a 收入-side row awaiting its counterpart).
   - If zero candidates and `tx.type` is 支出 and `isCashWithdrawal(tx)` is true (description/item matches 現金提／atm提款／提款／提領): find the active 現金-type account matching the transaction's currency and, if found, call `pairWithNewRow(tx, cash, amount, 'ATM 提款', ss)`; increment `paired` and `created`.
   - Otherwise, call `resolveBrokerageAccount(tx, accounts)`; if it returns a 證券-type account whose currency matches the transaction's currency, call `pairWithNewRow(tx, broker, amount, '交割戶入帳', ss)`; increment `paired` and `created`.
   - Any other category is skipped without side effects.

Any transaction that already resolved to a paired row (i.e. `transferId` is non-empty by the time it is examined, e.g. because a prior iteration paired it as someone else's counterpart) is skipped.

#### Scenario: Credit card payment auto-pairs to card account with new row

- **WHEN** a newly imported 繳信用卡 row on 永豐大戶 for 14684 TWD is passed to `autoPairImportedTransactions`, and 永豐信用卡 (type 信用卡, debitAccount 永豐大戶) is the only credit-card account resolvable from the description "永豐卡費 4637898810887000"
- **THEN** a new row is appended on 永豐信用卡: 收入／轉帳／"卡費入帳"／14684／TWD, sharing a new transfer ID with the original row; `paired` and `created` both increase by 1

#### Scenario: Transfer with unique candidate auto-pairs without creating a new row

- **WHEN** a 轉帳 支出 row on 永豐大戶 for "手機轉帳 04201820006159" matches exactly one existing unpaired 收入 row on 永豐證券 with the same amount within 3 days
- **THEN** both existing rows receive the same new transfer ID and category "轉帳"; `paired` increases by 1 and `created` does not increase

#### Scenario: ATM withdrawal auto-pairs to 現金 account with new row

- **WHEN** a 轉帳 支出 row has item "現金提" and description "ＡＴＭ", and an active 現金-type TWD account exists
- **THEN** a new row is appended on 現金: 收入／轉帳／"ATM 提款"／same amount／TWD, sharing a new transfer ID with the original row

#### Scenario: Brokerage settlement account auto-pairs to 交割戶入帳

- **WHEN** a 轉帳 支出 row on 永豐大戶 has description "手機轉帳 04201820006159" that uniquely matches 永豐證券 (type 證券) via account-number hint, and 永豐證券's currency matches the row's currency
- **THEN** a new row is appended on 永豐證券: 收入／轉帳／"交割戶入帳"／same amount, sharing a new transfer ID with the original row

#### Scenario: Multiple transfer candidates produce a detail message and no pairing

- **WHEN** a 轉帳 row matches two or more candidate rows via `pickTransferCandidates`
- **THEN** the transaction is left unpaired, and `details` gains a line ending in "：多個候選，請在 App 手動連結"

#### Scenario: Unresolvable credit card account produces a detail message

- **WHEN** `resolveCreditCardAccount` cannot uniquely resolve a card account for a 繳信用卡 row
- **THEN** the transaction is left unpaired, and `details` gains a line ending in "：無法判斷信用卡帳戶，請在 App 手動連結"

---
### Requirement: Cross-currency counterpart matching in pickTransferCandidates

The system SHALL provide `pickTransferCandidates(tx, allTx, accounts, options)` where `options` may include `dayWindow` (default 3), `counterpartyAccount`, and `counterpartyBank`. A candidate `o` qualifies when: it is not `tx` itself, has no existing 轉帳ID, has the opposite `type` from `tx`, belongs to a different account than `tx` (normalized), resolves to a known account, and (when `counterpartyAccount`/`counterpartyBank` are given) matches that account name / institution. For the remaining date/amount test:
- If the candidate's account currency equals `tx`'s account currency (same-currency case): the candidate qualifies when the date difference is within `dayWindow` days AND the amounts match within 0.005.
- If the currencies differ (cross-currency case): the candidate qualifies only when the date difference is exactly 0 days AND either `tx` or the candidate has a "換匯" hint in its description or item (`hasFxHint`). Amount is NOT compared in this case.

#### Scenario: Same-currency candidate requires matching amount within window

- **WHEN** a 支出 row on 永豐大戶 (1000 TWD, 2026/09/01) is compared against a 收入 row on 玉山 (1000 TWD, 2026/09/02) and another 收入 row on 玉山 (500 TWD, 2026/09/02)
- **THEN** `pickTransferCandidates` returns only the 1000 TWD row

#### Scenario: Cross-currency same-day 換匯 pair matches regardless of amount

- **WHEN** a 支出 row on 永豐大戶 (1000 TWD, 2026/09/01, description "換匯") is compared against a 收入 row on 永豐外幣 (30 USD, same date) and another 收入 row on 永豐外幣 (30 USD, next day)
- **THEN** `pickTransferCandidates` returns only the same-day USD row

#### Scenario: counterpartyAccount narrows candidates to a single account

- **WHEN** two same-amount, same-date candidate rows exist on different accounts (玉山 and 永豐證券) and `options.counterpartyAccount` is "永豐證券"
- **THEN** `pickTransferCandidates` returns only the row on 永豐證券

#### Scenario: counterpartyBank narrows candidates to accounts of one institution

- **WHEN** two candidate rows exist, one on 永豐大戶 and one on 永豐證券 (both institution 永豐銀行), and `options.counterpartyBank` is "永豐銀行"
- **THEN** `pickTransferCandidates` returns both rows (institution matches, no further narrowing by account)

#### Scenario: Paired candidates are excluded

- **WHEN** a candidate row already carries a non-empty 轉帳ID
- **THEN** it is excluded from the results regardless of amount or date match

---
### Requirement: Counterparty account recognition from transaction text

The system SHALL provide `matchCounterpartyAccount(text, accounts)` that extracts every run of 8 or more consecutive digits from `text`, and for each such digit-run `d`, tests both `d` and `d.slice(3)` (the digit-run with its first three characters dropped, i.e. a bank-code prefix removed) against every account's `accountNumberHints` using `hintMatches()`. `hintMatches(number, hint)` strips `-` and whitespace from both sides, strips leading zeros from both, and returns true when the cleaned number starts with the cleaned hint (and the hint is non-empty). If exactly one distinct account is hit across all candidates, that account is returned; if zero or more than one distinct account is hit, the function returns null.

Accounts' `accountNumberHints` (J 欄「帳號識別」) MAY contain multiple comma/顿號-separated hints for the same account (e.g. 玉山 `0015977,0381979`, 台新 `288810,288815,288818`, 一銀 `630`); a match against any one hint counts toward that account.

When no digit-run based match is found, `parseCounterpartyBank(text)` MAY be used as a fallback: it extracts the longest run of 10+ digits, takes its first three characters, and looks up the institution name in `BANK_CODE_MAP` (808 玉山銀行, 812 台新銀行, 822 中國信託, 013 國泰銀行, 012 富邦銀行, 007 第一銀行, 824 LINE Bank, 048 王道銀行, 810 樂天銀行, 807 永豐銀行, 700 中華郵政, 006 合作金庫), returning `''` if no 10+ digit run exists.

#### Scenario: Digit-run prefix match resolves 永豐大戶

- **WHEN** `matchCounterpartyAccount('跨行轉 0019801800104436', accounts)` is called and 永豐大戶's 帳號識別 is "198-01"
- **THEN** the function returns the 永豐大戶 account object: after stripping leading zeros, the digit run "0019801800104436" becomes "19801800104436", which starts with the cleaned hint "19801" (from "198-01" with the dash removed)

#### Scenario: Comma-separated hints match either sub-account

- **WHEN** a transaction description contains "手機轉帳 8080000381979084481" and 玉山's 帳號識別 is "0015977,0381979"
- **THEN** `matchCounterpartyAccount` returns the 玉山 account (matched via the "0381979" hint after the bank-code-stripped candidate)

#### Scenario: No qualifying digit run returns null

- **WHEN** the text is "午餐分攤" (no run of 8+ digits)
- **THEN** `matchCounterpartyAccount` returns null

#### Scenario: Ambiguous match (multiple accounts hit) returns null

- **WHEN** a digit run matches hints belonging to two different accounts
- **THEN** `matchCounterpartyAccount` returns null, deferring to bank-code fallback or manual linking

#### Scenario: Bank-code fallback resolves institution when no account hint matches

- **WHEN** `parseCounterpartyBank('8220000234540289458')` is called
- **THEN** it returns "中國信託" (bank code "822")
