## MODIFIED Requirements

### Requirement: Parse text messages with OpenAI

The system SHALL send the user's text message to OpenAI gpt-4o-mini API with a system prompt containing the current expense and income category lists AND the active account name list read from `getAccounts()`. The system SHALL use temperature 0 and response_format json_object. The API SHALL return a JSON object with fields: type (支出 or 收入), category (from the provided category list), item (short description), and amount (positive integer). The "account" field SHALL be selected from the provided account name list; if no account can be identified from the message, the field SHALL be an empty string.

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

#### Scenario: Account name not identifiable returns empty string

- **WHEN** the user sends "午餐80" with no account context in the message
- **THEN** OpenAI returns `{"account":"","institution":"現金","type":"支出","category":"飲食","item":"午餐","amount":80}`
