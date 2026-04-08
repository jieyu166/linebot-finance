## ADDED Requirements

### Requirement: Receive text messages via LINE Webhook

The system SHALL expose a doPost(e) endpoint as a Google Apps Script Web App that receives LINE Webhook POST events. The system SHALL parse the JSON payload and extract text message events. The system SHALL ignore non-text message types (sticker, image, video, audio, location) without replying. The system SHALL always return HTTP 200 to LINE regardless of processing outcome.

#### Scenario: Text message received

- **WHEN** a user sends a text message "午餐80" to the LINE Bot
- **THEN** the system receives the Webhook event, extracts the message text "午餐80" and the replyToken, and passes them to the parsing flow

#### Scenario: Non-text message received

- **WHEN** a user sends a sticker or image to the LINE Bot
- **THEN** the system ignores the event and does not reply, but still returns HTTP 200

#### Scenario: Webhook returns 200 on error

- **WHEN** the system encounters an internal error during message processing
- **THEN** the system still returns HTTP 200 to LINE to prevent retry loops, and logs the error

### Requirement: Parse text messages with OpenAI

The system SHALL send the user's text message to OpenAI gpt-4o-mini API with a system prompt containing the current expense and income category lists. The system SHALL use temperature 0 and response_format json_object. The API SHALL return a JSON object with fields: type (支出 or 收入), category (from the provided category list), item (short description), and amount (positive integer).

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

### Requirement: Write transaction to Google Sheets

The system SHALL append a new row to the "交易紀錄" worksheet with columns: date (yyyy/MM/dd in Asia/Taipei timezone), time (HH:mm), type, category, item, amount, and original message text. The date and time SHALL reflect the moment of processing, not a date mentioned in the message.

#### Scenario: Successful write

- **WHEN** OpenAI successfully parses a message into type "支出", category "飲食", item "午餐便當", amount 80
- **THEN** the system appends a row `[2026/04/08, 14:30, 支出, 飲食, 午餐便當, 80, 午餐便當80]` to the "交易紀錄" worksheet

### Requirement: Reply confirmation via LINE

The system SHALL reply to the user via LINE Reply API with a confirmation message containing the parsed type, category, item, and amount. Expense messages SHALL use the 💸 emoji prefix. Income messages SHALL use the 💰 emoji prefix.

#### Scenario: Expense confirmation reply

- **WHEN** a text message is successfully parsed and written as an expense
- **THEN** the system replies: "💸 記帳成功！\n類型：支出\n分類：飲食\n品項：午餐便當\n金額：80 元"

#### Scenario: Income confirmation reply

- **WHEN** a text message is successfully parsed and written as income
- **THEN** the system replies: "💰 記帳成功！\n類型：收入\n分類：薪資\n品項：薪水\n金額：50000 元"

### Requirement: Handle parsing failures

The system SHALL detect when OpenAI returns invalid results (missing fields, amount <= 0, or unparseable JSON) and reply with a help message. The system SHALL NOT write any data to the worksheet when parsing fails.

#### Scenario: Unparseable message

- **WHEN** the user sends a message that cannot be parsed into a valid transaction (e.g., "你好")
- **THEN** the system replies: "抱歉，無法解析這筆記帳。請輸入如：\n「午餐80」或「飲食 午餐便當 80」"
- **THEN** no row is appended to the "交易紀錄" worksheet

#### Scenario: OpenAI API error

- **WHEN** the OpenAI API returns a non-200 status code
- **THEN** the system replies: "記帳失敗，請稍後再試。\n錯誤：" followed by the error description
