# Tombot v2: Personal AI Assistant

A minimalistic yet powerful personal AI assistant from scratch. Inspired by Moltbot, fixing its over-engineering while keeping its best patterns.

## Features

- **Multi-Model**: Support for Claude, Gemini (Default), OpenAI, and Ollama.
- **Unified Channels**: Integrated with Telegram and WhatsApp.
- **Memory (RAG)**: SQLite-based semantic memory system for long-term knowledge.
- **Tools**: Extendable tool registry with 25+ built-in tools.
- **Cron Jobs**: Scheduled automated interactions.
- **Atomic Persistence**: Single SQLite database for sessions, messages, memory, and cron.

### New Capabilities (v2.1)

- **Admin Dashboard**: Web interface for configuration, cost tracking, and tool management
- **Browser Automation**: Navigate websites, fill forms, click elements, take screenshots using Playwright
- **File System Access**: Read, write, list, copy, move, and delete files with permission controls
- **Self-Modification**: Agent can update its own configuration, add/remove providers, and manage settings
- **Permission System**: Tiered permission levels (READ_ONLY, WRITE_SAFE, EXECUTE_SAFE, PRIVILEGED)
- **Approval Queue**: User confirmation required for dangerous operations
- **Safety Controls**: Whitelists, blacklists, and restricted operations to prevent accidents

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (ESM)
- **HTTP**: Hono
- **WhatsApp**: @whiskeysockets/baileys
- **Telegram**: grammy
- **Database**: better-sqlite3

## Setup

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env` file (see `.env.example`):

   ```env
   GOOGLE_API_KEY=your_key
   TELEGRAM_TOKEN=your_token
   DATA_DIR=./data
   ```

3. **Run Development**:

   ```bash
   npm run dev
   ```

4. **Build and Start**:

   ```bash
   npm run build
   npm start
   ```

## Docker

```bash
docker build -t tombot .
docker run -v $(pwd)/data:/app/data --env-file .env tombot
```

## Advanced Features

### Browser Automation

Enable browser automation to let your AI assistant interact with websites:

**Configuration** ([config.json5](config.json5)):

```json5
{
  browser: { enabled: true },
  permissions: { maxLevel: 3 } // EXECUTE_SAFE or higher
}
```

**Available Tools**:

- `browser_navigate` - Navigate to URLs
- `browser_get_content` - Extract text from pages
- `browser_click` - Click elements
- `browser_fill` - Fill form fields
- `browser_screenshot` - Take screenshots
- `browser_evaluate` - Execute JavaScript
- `browser_wait_for` - Wait for elements to appear
- `browser_close` - Close browser session

**Example Usage**:
> "Navigate to github.com and search for 'tombot'"

### File System Access

Grant your AI assistant controlled access to the file system:

**Configuration**:

```json5
{
  filesystem: { enabled: true },
  permissions: {
    maxLevel: 2, // WRITE_SAFE
    allowedDirectories: ['./data', './logs'],
    deniedDirectories: ['./src', './node_modules']
  }
}
```

**Available Tools**:

- `fs_read_file` - Read file contents
- `fs_write_file` - Create or overwrite files
- `fs_append_file` - Append to files
- `fs_list_directory` - List directory contents
- `fs_delete_file` - Delete files
- `fs_create_directory` - Create directories
- `fs_delete_directory` - Delete directories (requires PRIVILEGED)
- `fs_copy_file` - Copy files
- `fs_move_file` - Move or rename files
- `fs_file_info` - Get file metadata

**Example Usage**:
> "Read the contents of ./data/logs/error.log"
> "Create a summary report and save it to ./data/reports/summary.txt"

### Self-Modification

**⚠️ USE WITH EXTREME CAUTION** - Allow the AI to modify its own configuration:

**Configuration**:

```json5
{
  selfModification: { enabled: true },
  permissions: { maxLevel: 4 } // PRIVILEGED required
}
```

**Available Tools**:

- `config_read` - Read current configuration
- `config_update` - Update configuration values
- `config_add_provider` - Add new LLM providers
- `config_remove_provider` - Remove providers
- `config_list_backups` - List configuration backups
- `config_restore_backup` - Restore from backup
- `system_info` - Get system information

**Safety Features**:

- Automatic backups before any config change
- Requires PRIVILEGED permission level
- All modifications are logged

**Example Usage**:
> "Add a new Claude provider with model claude-3-opus-20240229"
> "Update the default provider to use gpt-4"

## Permission System

Tombot uses a tiered permission system to control what the AI can do:

| Level | Name | Capabilities |
|-------|------|--------------|
| 1 | READ_ONLY | Read files, list directories, web fetch |
| 2 | WRITE_SAFE | Write to whitelisted directories |
| 3 | EXECUTE_SAFE | Browser automation, safe command execution |
| 4 | PRIVILEGED | Full system access, self-modification |

**Recommended Settings**:

- **Personal Use (Low Risk)**: `maxLevel: 2` (WRITE_SAFE)
- **Automation Tasks**: `maxLevel: 3` (EXECUTE_SAFE)
- **Experimental/Trusted**: `maxLevel: 4` (PRIVILEGED) - Use only in controlled environments

**Safety Controls**:

```json5
permissions: {
  maxLevel: 2,
  allowedDirectories: ['./data', './tmp'],    // Whitelist
  deniedDirectories: ['./src', './.git'],     // Blacklist
  deniedCommands: ['rm -rf /', 'shutdown'],   // Forbidden commands
  allowedDomains: ['*.github.com'],           // Browser domain restrictions
  requireApprovalLevel: 4                     // Require user approval for PRIVILEGED ops
}
```

## Available Tools

Tombot includes 25+ built-in tools across multiple categories:

**Web & Search**:

- `web_search` - Brave Search integration

**Obsidian**:

- `obsidian_search`, `obsidian_read`, `obsidian_create`, `obsidian_search_content`

**Finance**:

- `log_transaction`, `get_spending_summary`

**Scheduling**:

- `schedule_message`, `list_scheduled_messages`, `cancel_scheduled_message`

**Cost Tracking**:

- `get_usage_costs`, `estimate_message_cost`

**Telegram**:

- `telegram_create_poll`, `telegram_create_keyboard`, `telegram_react_to_message`, etc.

**Spiritual Biology**:

- `log_stress`, `confess_uncertainty`, `log_ethical_refusal`, `dream`, `get_learnings`, `log_guidance`

**Browser Automation** (8 tools) - See above

**File System** (10 tools) - See above

**Self-Modification** (7 tools) - See above

## Admin Dashboard

A built-in web dashboard is available to manage the bot:

- **URL**: `http://localhost:3000/admin` (default)
- **Features**:
  - **Configuration Editor**: Safely modify `config.json5` with validation.
  - **Cost Measurement**: Track token usage and costs by provider/model.
  - **Tool Explorer**: View available tools and their definitions.
  - **Logs**: View recent activity logs.

## Security Best Practices

1. **Start Conservative**: Begin with `maxLevel: 2` and increase only when needed
2. **Use Whitelists**: Specify `allowedDirectories` rather than relying on blacklists
3. **Monitor Logs**: Review logs regularly for unexpected behavior
4. **Backup Config**: Keep backups of your configuration (automatic with self-mod tools)
5. **Limit Domains**: Restrict browser automation to trusted domains
6. **Enable Approval Queue**: Set `requireApprovalLevel` for critical operations
7. **Review Tool Lists**: Use `tools.denyList` to disable tools you don't need

## Troubleshooting

**Browser automation not working?**

- Ensure Playwright is installed: `npx playwright install chromium`
- Check permission level is 3 or higher
- Verify domain is in `allowedDomains` (if configured)

**File operations denied?**

- Check path is in `allowedDirectories`
- Verify path is not in `deniedDirectories`
- Ensure permission level is 2 or higher

**Self-modification disabled?**

- Must set `selfModification.enabled: true`
- Must set `permissions.maxLevel: 4`
- Review security implications carefully
