## ADDED Requirements

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

## MODIFIED Requirements

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
