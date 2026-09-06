# text-accounting Specification

## Purpose

TBD - created by archiving change 'line-bot-accounting-app'. Update Purpose after archive.

## Requirements

### Requirement: Receive text messages via LINE Webhook

The system SHALL expose a doPost(e) endpoint as a Google Apps Script Web App that receives LINE Webhook POST events. The system SHALL verify the LINE signature before processing (see "Verify LINE Webhook signature"). The system SHALL parse the JSON payload and extract text message events. The system SHALL ignore non-text message types (sticker, image, video, audio, location) without replying. The system SHALL always return HTTP 200 to LINE regardless of processing outcome.

#### Scenario: Text message received

- **WHEN** a user sends a text message "午餐80" to the LINE Bot with a valid signature
- **THEN** the system receives the Webhook event, extracts the message text "午餐80" and the replyToken, and passes them to the parsing flow

#### Scenario: Non-text message received

- **WHEN** a user sends a sticker or image to the LINE Bot
- **THEN** the system ignores the event and does not reply, but still returns HTTP 200

#### Scenario: Webhook returns 200 on error

- **WHEN** the system encounters an internal error during message processing
- **THEN** the system still returns HTTP 200 to LINE to prevent retry loops, and logs the error


<!-- @trace
source: code-review-fixes
updated: 2026-04-09
code:
  - src/SheetService.gs
  - src/LineService.gs
  - src/Main.gs
-->

---
### Requirement: Parse text messages with OpenAI

The system SHALL send the user's text message to OpenAI gpt-4o-mini API with a system prompt containing the current expense and income category lists AND the active account name list read from `getAccounts()`. The system SHALL use temperature 0 and response_format json_object. The API SHALL return a JSON object with fields: type (支出 or 收入), category (from the provided category list), item (short description), and amount (positive integer). The "account" field SHALL be selected from the provided account name list; ordinary cash transactions SHALL use account "現金"; if no account can be identified and the transaction is not cash, the field SHALL be an empty string.

The function `parseWithOpenAI(message, expenseCategories, incomeCategories, accountNames)` SHALL accept a fourth parameter `accountNames` (array of strings) and pass it to `buildSystemPrompt()`. The `buildSystemPrompt()` function SHALL include the account name list in the system prompt with the instruction: "帳戶名稱必須從以下帳戶清單中選擇最接近的名稱；若完全無法對應，則填空字串" followed by the comma-separated account names.

#### Scenario: Natural language expense input

- **WHEN** the user sends "午餐80"
- **THEN** OpenAI returns `{"type":"支出","category":"飲食","item":"午餐","amount":80}`

#### Scenario: Fixed format expense input

- **WHEN** the user sends "飲食 午餐便當 80"
- **THEN** OpenAI returns `{"type":"支出","category":"飲食","item":"午餐便當","amount":80}`

#### Scenario: Income input

- **WHEN** the user sends "收到薪水50000"
- **THEN** OpenAI returns `{"type":"收入","category":"薪資","item":"薪水","amount":50000}`

#### Scenario: Expense for family member

- **WHEN** the user sends "給爸媽生活費10000"
- **THEN** OpenAI returns `{"type":"支出","category":"父母","item":"生活費","amount":10000}`

#### Scenario: Default to expense

- **WHEN** the user sends an ambiguous message without explicit income keywords
- **THEN** OpenAI defaults to type "支出"

#### Scenario: Account name matched from list

- **WHEN** the user sends "玉山信用卡 加油1500" and the account list contains "玉山"
- **THEN** OpenAI returns `{"account":"玉山","institution":"玉山銀行","type":"支出","category":"交通","item":"加油","amount":1500}`

#### Scenario: Cash transaction uses cash account

- **WHEN** the user sends "午餐80" with no account context in the message
- **THEN** OpenAI returns `{"account":"現金","institution":"現金","type":"支出","category":"飲食","item":"午餐","amount":80}`

---
### Requirement: Write transaction to Google Sheets

The system SHALL append a new row to the "交易紀錄" worksheet with columns: date (yyyy/MM/dd in Asia/Taipei timezone), time (HH:mm), type, category, item, amount, and original message text. The date and time SHALL reflect the moment of processing, not a date mentioned in the message.

#### Scenario: Successful write

- **WHEN** OpenAI successfully parses a message into type "支出", category "飲食", item "午餐便當", amount 80
- **THEN** the system appends a row `[2026/04/08, 14:30, 支出, 飲食, 午餐便當, 80, 午餐便當80]` to the "交易紀錄" worksheet

---
### Requirement: Reply confirmation via LINE

The system SHALL reply to the user via LINE Reply API with a confirmation message containing the parsed type, category, item, and amount. Expense messages SHALL use the 💸 emoji prefix. Income messages SHALL use the 💰 emoji prefix.

#### Scenario: Expense confirmation reply

- **WHEN** a text message is successfully parsed and written as an expense
- **THEN** the system replies: "💸 記帳成功！\n類型：支出\n分類：飲食\n品項：午餐便當\n金額：80 元"

#### Scenario: Income confirmation reply

- **WHEN** a text message is successfully parsed and written as income
- **THEN** the system replies: "💰 記帳成功！\n類型：收入\n分類：薪資\n品項：薪水\n金額：50000 元"

---
### Requirement: Handle parsing failures

The system SHALL detect when OpenAI returns invalid results (missing fields, amount <= 0, or unparseable JSON) and reply with a help message. The system SHALL NOT write any data to the worksheet when parsing fails.

#### Scenario: Unparseable message

- **WHEN** the user sends a message that cannot be parsed into a valid transaction (e.g., "你好")
- **THEN** the system replies: "抱歉，無法解析這筆記帳。請輸入如：\n「午餐80」或「飲食 午餐便當 80」"
- **THEN** no row is appended to the "交易紀錄" worksheet

#### Scenario: OpenAI API error

- **WHEN** the OpenAI API returns a non-200 status code
- **THEN** the system replies: "記帳失敗，請稍後再試。\n錯誤：" followed by the error description

---
### Requirement: Verify LINE Webhook signature

The system SHALL verify the x-line-signature HTTP header on every incoming Webhook POST request using HMAC-SHA256 with the LINE_CHANNEL_SECRET. If the signature is missing or invalid, the system SHALL log the event and return HTTP 200 without processing any events. If Google Apps Script does not expose HTTP headers in the doPost(e) parameter, the system SHALL log a warning and proceed without blocking (graceful degradation).

#### Scenario: Valid signature

- **WHEN** a POST request arrives with a valid x-line-signature header matching the HMAC-SHA256 of the request body
- **THEN** the system processes the events normally

#### Scenario: Invalid signature

- **WHEN** a POST request arrives with an invalid or missing x-line-signature header
- **THEN** the system logs "Invalid LINE signature" and returns HTTP 200 without processing events

#### Scenario: GAS header limitation

- **WHEN** Google Apps Script doPost(e) does not expose HTTP headers
- **THEN** the system logs a warning "Cannot verify LINE signature: headers not available" and processes events normally

<!-- @trace
source: code-review-fixes
updated: 2026-04-09
code:
  - src/SheetService.gs
  - src/LineService.gs
  - src/Main.gs
-->
