# dynamic-categories Specification

## Purpose

TBD - created by archiving change 'line-bot-accounting-app'. Update Purpose after archive.

## Requirements

### Requirement: Store categories in dedicated worksheets

The system SHALL store expense categories in a "支出分類" worksheet and income categories in a "收入分類" worksheet within the Google Sheets workbook. Each worksheet SHALL have a header row "分類名稱" in cell A1, with category names listed in column A starting from row 2. The initialization function SHALL create these worksheets with default categories if they do not exist.

#### Scenario: Initialize expense categories

- **WHEN** the initializeSheets function runs and no "支出分類" worksheet exists
- **THEN** the system creates the worksheet with header "分類名稱" and populates 21 default expense categories: 飲食, 服飾, 家庭, 交通, 學習, 休閒, 購物, 醫療, 其他, 保險, 手續費, 稅金, 工作, 父母, 老婆, 買房, 紅包, 投資, 轉帳, 貸款, 繳信用卡

#### Scenario: Initialize income categories

- **WHEN** the initializeSheets function runs and no "收入分類" worksheet exists
- **THEN** the system creates the worksheet with header "分類名稱" and populates 10 default income categories: 薪資, 利息, 兼職, 獎金, 回饋, 投資獲利, 股利, 家人給, 保險, 其他

#### Scenario: Worksheets already exist

- **WHEN** the initializeSheets function runs and the category worksheets already exist
- **THEN** the system leaves existing worksheets unchanged

---
### Requirement: Dynamically load categories for AI prompt

The system SHALL read the current category lists from the "支出分類" and "收入分類" worksheets each time a message is processed. The system SHALL inject these category lists into the OpenAI system prompt. The system SHALL NOT hardcode category names in the source code.

#### Scenario: Categories loaded at runtime

- **WHEN** a user sends a text message for accounting
- **THEN** the system reads all non-empty values from column A (rows 2+) of both "支出分類" and "收入分類" worksheets and includes them in the OpenAI prompt

#### Scenario: User adds a new category via spreadsheet

- **WHEN** a user manually adds "寵物" to cell A19 of the "支出分類" worksheet
- **THEN** the next message processed will include "寵物" in the expense category list sent to OpenAI, and the AI can classify messages into this new category without any code changes

#### Scenario: Empty category sheet

- **WHEN** a category worksheet has only the header row and no category entries
- **THEN** the system returns an empty array for that category type, and the OpenAI prompt reflects no categories for that type
