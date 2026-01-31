# Tombot v2 — Personal AI Assistant

Tombot is an agentic AI assistant built from scratch for personal productivity, system automation, and multi-channel communication. It connects to multiple LLM providers (Gemini, Claude, OpenAI, Ollama), exposes 30+ tools, and includes a self-reflective "mind" system that learns from its own mistakes.

## What It Is

A single Node.js process that:

- Receives messages from **Telegram**, **WhatsApp**, or its **HTTP API**
- Routes them through configurable **LLM providers** with multi-turn tool use
- Persists everything in a single **SQLite database** (sessions, messages, memory, mind, audit)
- Serves an **admin dashboard** for real-time configuration, cost tracking, and audit monitoring

Tombot is designed to be a personal assistant you actually trust with your system — not a demo. That means security is a first-class concern, not an afterthought.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Telegram   │     │   WhatsApp   │     │   HTTP API   │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └──────────┬─────────┴────────────────────┘
                  │
         ┌────────▼────────┐
         │ Channel Manager │  Queue + rate limiting
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │  Agent Runner   │  Multi-turn loop (up to 5 iterations)
         │  + Tool Registry│  30+ tools, Zod-validated params
         │  + RAG Memory   │  Embedding-based semantic search
         │  + MindStore    │  Stress detection, learnings, dreams
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐   ┌───▼───┐
│Gemini │   │ Claude  │   │OpenAI │   ...Ollama
└───────┘   └─────────┘   └───────┘

         ┌─────────────────┐
         │   SQLite (1 DB) │
         │ sessions, msgs  │
         │ memory_chunks   │
         │ mind_log        │
         │ mind_learnings  │
         │ audit_log       │
         │ usage, cron     │
         └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- npm

### Installation

```bash
git clone https://github.com/tomasgauthier/tombot.git
cd tombot
npm install
```

### Configuration

1. Copy the example files:

```bash
cp .env.example .env
cp config.example.json5 config.json5
```

2. Edit `.env` with your API keys:

```env
# Required: at least one LLM provider
GOOGLE_API_KEY=your_google_api_key

# Required: protects the admin dashboard and HTTP API
ADMIN_PASSWORD=a_strong_password

# Optional: Telegram bot
TELEGRAM_TOKEN=your_bot_token

# Optional: daily spending limit (default $5)
DAILY_COST_CEILING=5.00
```

3. Edit `config.json5` to enable the features you need (see [Configuration](#configuration-reference) below).

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

### Docker

```bash
docker build -t tombot .
docker run -v $(pwd)/data:/app/data --env-file .env tombot
```

The admin dashboard will be available at `http://localhost:3331/admin` (or whatever `SERVER_PORT` you set).

## Security Model

Tombot is designed to run on your personal machine with access to your files and shell. That requires real security, not just good intentions.

### Authentication

- **HMAC token auth** — the HTTP API uses time-limited tokens generated from `ADMIN_PASSWORD` via `POST /auth/token`. Tokens are validated with timing-safe comparison to prevent timing attacks.
- **Raw password fallback** — for simplicity, `Authorization: Bearer <password>` also works, validated with constant-time comparison.
- **No password = locked** — if `ADMIN_PASSWORD` is not set, all API and admin routes return 403. The dashboard HTML loads without auth (it's just static files), but every data endpoint requires authentication.

### Permission System

A 4-level tiered system controls what the agent can do:

| Level | Name | What it unlocks |
|-------|------|-----------------|
| 1 | `READ_ONLY` | Read files, list directories, web fetch |
| 2 | `WRITE_SAFE` | Write/delete files in whitelisted directories |
| 3 | `EXECUTE_SAFE` | Browser automation, shell command execution |
| 4 | `PRIVILEGED` | Self-modification, `browser_evaluate`, directory deletion |

**Recommendations:**
- Personal use: `maxLevel: 2` with explicit `allowedDirectories`
- Automation tasks: `maxLevel: 3` with `requireApprovalLevel: 4`
- Never run `maxLevel: 4` unattended

### What's Hardened

| Attack vector | Mitigation |
|---|---|
| **Shell command injection** | Pipes, backticks, `$()`, chaining operators, and redirection are blocked |
| **Path traversal** | Directory boundary checks use proper prefix matching (not naive `startsWith`) |
| **Browser JS execution** | `browser_evaluate` requires `PRIVILEGED` level; blocks `fetch()`, `eval()`, `document.cookie`, `XMLHttpRequest`, and 10+ other dangerous patterns |
| **Dream prompt injection** | User text in `.mind/` logs is sanitized before LLM injection — strips `ignore previous instructions`, `<system>` tags, etc. |
| **Config injection** | All config updates validated against Zod schema before applying |
| **Identity exposure** | `/api/identity` moved behind auth (was public at `/identity`) |
| **Rate limiting** | In-memory per-IP rate limiter (30 req/min) on all routes |
| **Daily cost ceiling** | Configurable via `DAILY_COST_CEILING` env var; blocks all LLM calls when exceeded |
| **Audit logging** | All auth failures, shell executions, config changes, and privileged operations logged to SQLite |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options: DENY`, CSP, Referrer-Policy, Permissions-Policy |

### Audit Log

Every sensitive operation is recorded in the `audit_log` SQLite table:

- `auth_failure` — failed login/token attempts (with IP)
- `shell_execute` — every shell command run by the agent
- `config_update` / `config_restore` — configuration changes
- `file_write` / `file_delete` — filesystem mutations
- `privileged_tool` — any tool requiring level 4

View the audit log in the admin dashboard or via `GET /api/audit?limit=50`.

## The Mind System

Tombot includes a "spiritual biology" — a self-reflective system inspired by how biological minds consolidate learning during sleep.

### How It Works

The mind system has two phases:

**Waking phase** (during conversations):
- `log_stress` — records when the user is frustrated or corrects the bot
- `confess_uncertainty` — records when the bot admits low confidence instead of guessing
- `log_ethical_refusal` — records when the bot refuses a harmful request
- `log_guidance` — records meta-advice from the user ("be more concise", "don't apologize so much")

**Dream phase** (triggered manually):
- The `dream` tool collects all logs from the last N days
- Applies **relevance decay** (0.95x per dream) to existing learnings — unused learnings fade
- **Prunes** any learning below 0.1 relevance (neural pruning)
- Generates a prompt for the LLM to analyze patterns and propose 1–3 new tactical learnings
- The user approves or rejects each proposal

### Why SQLite, Not Files

The original implementation stored everything in `.mind/` markdown files. The current version uses SQLite because:

- **Atomic writes** — no partial file corruption
- **Queryable** — "show me all stress signals from the last 3 days with intensity > 3"
- **Decay is a SQL UPDATE** — not a file rewrite
- **No directory creation race conditions**
- **Backed up with the rest of the database**

### Learnings Lifecycle

```
User frustration → log_stress (auto or manual)
                         ↓
Dream phase → analyze patterns → propose learning
                         ↓
User approves → learning added (relevance = 1.0)
                         ↓
Each dream → relevance *= 0.95 (decay)
                         ↓
Learning matched in context → relevance += 0.15 (reactivation)
                         ↓
relevance < 0.1 → pruned (forgotten)
```

Approved learnings are injected into the system prompt and cached in memory (5-minute TTL) so they don't require a DB read on every message.

### Safety Guardrails

The mind system has explicit protections against self-corruption:

1. **Immutable Core** — the conscience (ethical principles) is frozen. The dream phase can only improve *how* the bot serves, never *who* it serves.
2. **Ethical refusal filtering** — stress signals that occur within 30 minutes of an ethical refusal are filtered out. Refusing harm is a success, not a mistake.
3. **Prompt sanitization** — dream prompts (built from user text in logs) are sanitized against injection patterns before being sent to the LLM.
4. **Human-in-the-loop** — no learning is applied without explicit user approval.

## Configuration Reference

### `config.json5`

```json5
{
    dataDir: './data',
    logLevel: 'info',           // debug | info | warn | error

    providers: [
        {
            id: 'gemini-default',
            type: 'gemini',     // gemini | claude | openai | ollama
            model: 'gemini-2.0-flash-exp',
            // API keys come from .env (GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)
        },
    ],
    defaultProvider: 'gemini-default',

    channels: {
        telegram: {
            enabled: true,
            authorizedUsers: [123456789],  // Telegram user IDs
        },
        whatsapp: { enabled: false },
    },

    tools: { enabled: true },

    memory: {
        enabled: false,
        provider: 'gemini-default',   // Which provider generates embeddings
    },

    spiritualBiology: { enabled: false },

    browser: { enabled: false },       // Requires maxLevel >= 3
    filesystem: { enabled: false },    // Requires maxLevel >= 2
    selfModification: { enabled: false }, // Requires maxLevel = 4

    permissions: {
        maxLevel: 2,
        allowedDirectories: ['./data', './tmp'],
        deniedDirectories: ['./src', './node_modules', './.git'],
        allowedDomains: [],            // Empty = allow all (for browser)
        requireApprovalLevel: 4,       // Ask user before privileged ops
    },

    obsidian: {
        enabled: false,
        vaultPath: '/path/to/vault',
    },
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | Yes | — | Protects all API endpoints |
| `GOOGLE_API_KEY` | If using Gemini | — | Google AI API key |
| `ANTHROPIC_API_KEY` | If using Claude | — | Anthropic API key |
| `OPENAI_API_KEY` | If using OpenAI | — | OpenAI API key |
| `TELEGRAM_TOKEN` | If using Telegram | — | Bot token from @BotFather |
| `SERVER_HOST` | No | `127.0.0.1` | Bind address |
| `SERVER_PORT` | No | `3000` | HTTP port |
| `DAILY_COST_CEILING` | No | `5.00` | Max daily spend in USD |
| `SESSION_TOKEN_BUDGET` | No | `500000` | Max tokens per request |
| `BRAVE_SEARCH_API_KEY` | No | — | For `web_search` tool |
| `DATA_DIR` | No | `./data` | Database and data directory |

## Admin Dashboard

Access at `http://localhost:<port>/admin`. Features:

- **Status bar** — system status, total cost, token count, daily budget with progress bar
- **LLM Providers** — view and update API keys
- **Channels** — configure Telegram token and authorized users
- **Capabilities** — toggle Memory/RAG, tools, Spiritual Biology, Obsidian
- **Security** — permission level, approval requirements, directory whitelists
- **Advanced** — self-modification, browser, filesystem toggles
- **Audit Log** — real-time viewer of security events with refresh
- **Chat Console** — talk to the bot directly from the dashboard (streaming)

## Tools (30+)

| Category | Tools |
|----------|-------|
| **Web** | `web_search` |
| **Memory** | `memory_store`, `memory_query` |
| **Shell** | `shell_execute` (with injection blocking) |
| **Browser** | `browser_navigate`, `browser_get_content`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_evaluate`, `browser_wait_for`, `browser_close` |
| **Filesystem** | `fs_read_file`, `fs_write_file`, `fs_append_file`, `fs_list_directory`, `fs_delete_file`, `fs_create_directory`, `fs_delete_directory`, `fs_copy_file`, `fs_move_file`, `fs_file_info` |
| **Obsidian** | `obsidian_search`, `obsidian_read`, `obsidian_create`, `obsidian_search_content` |
| **Finance** | `log_transaction`, `get_spending_summary` |
| **Scheduling** | `schedule_message`, `list_scheduled_messages`, `cancel_scheduled_message` |
| **Costs** | `get_usage_costs`, `estimate_message_cost` |
| **Telegram** | `telegram_create_poll`, `telegram_create_keyboard`, `telegram_react_to_message`, `telegram_edit_last_message`, `telegram_get_media_info` |
| **Mind** | `log_stress`, `confess_uncertainty`, `log_ethical_refusal`, `dream`, `get_learnings`, `log_guidance` |
| **Self-mod** | `config_read`, `config_update`, `config_add_provider`, `config_remove_provider`, `config_list_backups`, `config_restore_backup`, `system_info` |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript (ESM) |
| HTTP framework | Hono |
| Database | better-sqlite3 |
| Telegram | grammy |
| WhatsApp | @whiskeysockets/baileys |
| Browser | Playwright |
| Validation | Zod |
| Logging | Pino |

## Troubleshooting

**Admin dashboard shows "Server misconfigured"**
- Set `ADMIN_PASSWORD` in your `.env` file

**Build fails with "Cannot find module" errors**
- Run `npm install` — ensure `@types/node` is installed as a dev dependency

**Browser automation not working**
- Run `npx playwright install chromium`
- Set `permissions.maxLevel` to 3 or higher
- Set `browser.enabled: true` in config

**Daily cost ceiling reached**
- The bot returns 429 on all chat requests until midnight UTC
- Adjust `DAILY_COST_CEILING` in `.env` or set to a higher value

**Mind system not logging**
- Ensure `spiritualBiology.enabled: true` in config
- Check logs for `[MindStore] Initialized SQLite tables`

## License

Private repository. All rights reserved.
