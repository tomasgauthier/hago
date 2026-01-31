# Telegram Enhanced Features for Tombot

## Overview

Tombot now supports rich Telegram features beyond basic text messages, including polls, inline keyboards, message reactions, media handling, and more. These features are available through both automatic message handling and explicit agent tools.

## Configuration

To enable enhanced Telegram features, set the environment variable:
```bash
TELEGRAM_ENHANCED=true
```

This will use the `EnhancedTelegramChannel` instead of the basic `TelegramChannel`.

## Supported Message Types

### 1. Text Messages (Default)
- Standard text messages with Markdown formatting support
- Automatic fallback to plain text if Markdown parsing fails

### 2. Polls
- Regular polls (multiple answers allowed)
- Quiz polls (single correct answer)
- Anonymous voting disabled by default for better user tracking

### 3. Inline Keyboards
- Interactive buttons that users can press
- Callback data sent back to the bot when pressed
- Support for multi-row layouts

### 4. Message Reactions
- Emoji reactions on messages
- Automatic detection when users react to messages
- Bot can react to messages with emojis

### 5. Media Messages
- **Photos**: Automatic caption extraction and file ID storage
- **Documents**: File name and content detection
- **Voice Messages**: Duration tracking and file ID storage

### 6. Message Editing
- Edit previously sent messages
- Track last message ID per session for editing/reactions

## Available Tools

### `telegram_create_poll`
Creates polls with multiple options.

**Parameters:**
- `question` (string): The poll question
- `options` (array): 2-10 poll options
- `type` (enum): "regular" or "quiz" 
- `correctOptionIndex` (number): For quiz polls, the index of correct answer

**Example Usage:**
```
User: "Create a poll asking what should we have for lunch with options pizza, burgers, salad"
Agent: Uses telegram_create_poll tool to create the poll
```

### `telegram_create_keyboard`
Creates interactive button menus.

**Parameters:**
- `message` (string): Text to display with the keyboard
- `buttons` (2D array): Button layout with text and actions

**Example Usage:**
```
User: "Show me options for Settings, Help, About"
Agent: Creates inline keyboard with those buttons
```

### `telegram_react_to_message`
Adds emoji reactions to the last message.

**Parameters:**
- `emoji` (string): Emoji to react with (❤️, 👍, 🔥, etc.)

**Example Usage:**
```
User: "React with a heart"
Agent: Adds ❤️ reaction to the last message
```

### `telegram_edit_last_message`
Edits the bot's most recent message.

**Parameters:**
- `newText` (string): New content for the message

**Example Usage:**
```
User: "Edit your last message to say Hello World"
Agent: Updates the previous message
```

### `telegram_get_media_info`
Gets information about uploaded media files.

**Parameters:**
- `fileId` (string): Telegram file ID from received media

## Automatic Message Handling

The enhanced adapter automatically handles:

### Button Presses
When users press inline keyboard buttons, the bot receives:
```
"Button pressed: {callback_data}"
```

### Poll Answers
When users answer polls, the bot receives:
```
"Poll answer: options 0, 2"  // User selected options 0 and 2
```

### Reactions
When users react to messages, the bot receives:
```
"Reacted with: ❤️ 👍"  // User added heart and thumbs up
```

### Media Uploads
- Photos: `"[Photo received]"` + caption if provided
- Documents: `"[Document: filename.pdf]"` + caption
- Voice: `"[Voice message received]"` + duration info

## Context Awareness

The enhanced features include:

### Session Memory
- Tracks last message ID per session for reactions/editing
- Maintains conversation context across different message types

### Authorization
- All enhanced features respect the existing `authorizedUsers` configuration
- Unauthorized access attempts are logged and rejected

### Error Handling
- Graceful fallbacks for unsupported features
- Detailed error logging for troubleshooting
- Automatic retry mechanisms where appropriate

## Examples

### Creating Interactive Menus
```
User: "Show me a menu with options for Weather, News, and Help"

Agent Response: Creates inline keyboard with 3 buttons
→ User presses "Weather" button
→ Bot receives: "Button pressed: Weather"
→ Agent can then provide weather information
```

### Sentiment Reactions
```
User: "I love this feature!"
Agent: "I'm glad you like it!" + adds ❤️ reaction to user's message

User: "That's amazing!"
Agent: Uses telegram_react_to_message with emoji: "🔥"
```

### Polls for Decisions
```
User: "Help me decide what movie to watch tonight"
Agent: Creates poll with movie options using telegram_create_poll
→ User votes in poll
→ Bot receives poll results and can suggest based on votes
```

### Media Interaction
```
User: *uploads photo of receipt*
Bot receives: "[Photo received] + caption"
Agent: Can analyze the image context and respond appropriately
```

## Technical Implementation

### Message Flow
1. User interacts (text, button, poll, reaction, media)
2. Enhanced adapter captures the event and creates appropriate `InboundMessage`
3. Message includes type-specific metadata (fileId, pollAnswers, reactions, etc.)
4. Agent can use this context information in responses
5. Agent can use Telegram tools for rich responses

### Channel Detection
Tools automatically check if the session is Telegram-based:
```typescript
if (!context.sessionKey.startsWith('telegram:')) {
    return 'Error: This feature is only supported in Telegram.';
}
```

## Benefits

1. **Richer User Experience**: Interactive elements beyond text
2. **Better Engagement**: Polls, reactions, and buttons increase interaction
3. **Context Awareness**: Bot understands different types of user input
4. **Media Support**: Handle photos, documents, and voice messages
5. **Efficient Communication**: Edit messages instead of sending new ones
6. **Sentiment Expression**: React with emojis to show understanding

This enhanced Telegram integration makes Tombot much more interactive and capable of handling the full spectrum of modern messaging app features.