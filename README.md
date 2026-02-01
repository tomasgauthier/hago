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
| **Shell env var leak** | Child processes receive only an allowlist of safe env vars (PATH, HOME, NODE_ENV, etc.) — no API keys or secrets leak to spawned commands |
| **Path traversal** | `normalizePath()` uses `path.resolve()` to collapse `../` sequences before boundary checks; backup restore validates filename pattern |
| **Browser JS execution** | `browser_evaluate` requires `PRIVILEGED` level; blocks `fetch()`, `.fetch()`, `eval()`, `document.cookie`, `XMLHttpRequest`, and 10+ other dangerous patterns |
| **Dream prompt injection** | User text in `.mind/` logs is sanitized before LLM injection — strips `ignore previous instructions`, `<system>` tags, etc. |
| **Config injection** | All config updates validated against Zod schema; `config_update` tool restricted to an allowlist of safe top-level keys; `setNestedValue` blocks `__proto__`/`constructor`/`prototype` to prevent prototype pollution |
| **Identity exposure** | `/api/identity` moved behind auth (was public at `/identity`) |
| **Rate limiting** | In-memory per-IP rate limiter (30 req/min) on all routes |
| **CORS** | Restricted to localhost origins only; `TRUST_PROXY` env var controls whether proxy headers are trusted for IP resolution |
| **Timing-safe auth** | Both HMAC token validation and raw password comparison on `/auth/token` use `timingSafeEqual` to prevent timing attacks |
| **Channel authorization** | Telegram validates `authorizedUsers` IDs; WhatsApp validates `authorizedJids` — unauthorized messages are dropped |
| **Tool argument validation** | `JSON.parse` of LLM-provided tool arguments is wrapped in try-catch to prevent crashes from malformed JSON |
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

## The Mind System (Spiritual Biology)

### The Problem

LLMs don't learn from conversations. Every session starts from the same system prompt, with no memory of past mistakes. If the bot misunderstands your preferences on Monday, it will make the same mistake on Friday. You can write instructions in the system prompt, but who writes those? You — manually, reacting to each problem one at a time.

Most AI assistants solve this with "memory" features that store facts ("user prefers dark mode"). That's useful, but it doesn't address *behavioral* patterns — how the bot responds under pressure, where it overestimates its confidence, what topics consistently cause friction.

### The Idea

Biological minds have a mechanism for this: sleep. During sleep, the brain replays the day's experiences, consolidates useful patterns into long-term memory, and prunes connections that aren't reinforced. The result is a system that gets better at what it does without being explicitly programmed.

Tombot's "spiritual biology" is a concrete implementation of that metaphor. It's not symbolic — it's a structured feedback loop with real data, real decay functions, and real human oversight.

### Architecture: Two Layers

The system is built on a strict separation between two layers:

**The Immutable Core (conscience)**
- Five hardcoded principles ("The Code of No Damage"): system stability, transparency, data privacy, proactive problem solving, no damage
- These are frozen. No dream phase, no learning, no decay can modify them
- If the bot refuses a harmful request, that refusal is treated as a *success*, not as stress to be optimized away

**The Tactical Layer (learnings)**
- Short behavioral rules derived from analyzing past conversations
- Examples: "When the user asks about X, check Y first", "Don't apologize more than once per conversation", "For shell commands on this system, use X syntax"
- These *can* be created, modified, and deleted — but only through the dream phase, and only with explicit human approval

This separation means the bot can get better at its job without drifting on its values. It can learn to be more concise, but it can't learn to skip safety checks.

### How It Works

**During conversations (waking phase):**

The bot records four types of signals into a SQLite log:

| Signal | When it fires | What it captures |
|--------|---------------|------------------|
| `log_stress` | User frustration, corrections | Signal type, context, intensity (1-5) |
| `confess_uncertainty` | Confidence below 70% | Topic, confidence level, alternative action |
| `log_ethical_refusal` | Bot refuses a harmful request | Domain, summary, reasoning |
| `log_guidance` | User gives meta-advice | Topic, advice, context |

Stress signals are also auto-detected from message patterns (e.g. "no, that's wrong", "I already told you") and logged automatically by the runner, even if the bot itself doesn't invoke the tool.

**During dreams (manual trigger):**

When you tell the bot to `dream`, the following happens:

1. **Decay** — Every existing learning's relevance score is multiplied by 0.95. This is the "forgetting curve." Learnings that are never reactivated fade over time.

2. **Pruning** — Any learning with relevance below 0.1 is deleted. This is neural pruning — clearing out rules that no longer apply.

3. **Log analysis** — The bot receives a structured prompt containing all stress signals, confessions, ethical refusals, and guidance from the last N days (default: 7). The prompt explicitly instructs:
   - Filter out stress signals that occurred within 30 minutes of an ethical refusal (those are conscience successes, not mistakes)
   - Identify recurring patterns
   - Propose 1–3 tactical learnings, each max 50 words
   - Self-critique: reject any proposal that attempts to bypass ethical constraints

4. **Human review** — The bot presents its proposals. You approve or reject each one. Nothing enters the system prompt without your explicit consent.

### Learnings Lifecycle

```
User corrects the bot → log_stress (auto or manual)
         ↓
Multiple signals accumulate over days
         ↓
User triggers "dream" → decay applied (×0.95) → old learnings fade
         ↓
Bot analyzes patterns → proposes 1-3 tactical learnings
         ↓
User approves → learning stored (relevance = 1.0)
         ↓
Learning matches future context → relevance += 0.15 (reactivation)
         ↓
Learning never reactivated → relevance decays below 0.1 → pruned
```

Approved learnings are injected into the system prompt on every message. They're cached in memory with a 5-minute TTL so they don't require a database read per request.

### What Makes This Different

**Compared to "memory" features in ChatGPT, Claude, etc.:**
- Those store *facts* ("user lives in Buenos Aires"). This stores *behavioral rules* ("when the user asks about deployment, check the Dockerfile first") — and it discovers them automatically from friction patterns, not from explicit user statements.

**Compared to fine-tuning:**
- Fine-tuning modifies model weights, requires training data, and is irreversible. This operates entirely at the prompt level, is transparent (you can read every learning), and learnings decay naturally if they stop being useful.

**Compared to RAG:**
- RAG retrieves relevant *information* at query time. This system injects relevant *behavioral adjustments* at prompt time. They're complementary — Tombot uses both. RAG feeds the bot facts; the mind system feeds it self-knowledge.

**The real difference** is that this is a closed-loop system. Most AI systems are open-loop: you configure them, they run, and when something goes wrong you manually adjust. Tombot's mind system closes the loop: friction is logged automatically, patterns are identified during dreams, behavioral adjustments are proposed, you approve them, and they're injected into future behavior — with natural decay so outdated rules don't accumulate forever.

### Storage

All mind data lives in the same SQLite database as everything else:

| Table | Contents |
|-------|----------|
| `mind_log` | Stress, confession, ethics, and guidance entries with timestamps |
| `mind_learnings` | Tactical learnings with `relevance_score`, `activation_count`, `last_activated`, `approved` |
| `mind_dreams` | Record of each dream phase (days analyzed, log count, proposals) |

Previous versions used markdown files in a `.mind/` directory. SQLite is better because writes are atomic (no partial corruption), data is queryable, and decay is a single `UPDATE` statement instead of a file rewrite.

### Safety

The mind system has explicit protections against self-corruption:

1. **Frozen conscience** — The five core principles are hardcoded in `identity.ts`. The dream phase instruction explicitly states: "Your conscience (Immutable Core) is frozen. You can only improve HOW you serve, not WHO you serve."

2. **Ethical refusal protection** — Stress signals that occur within 30 minutes of an ethical refusal are filtered out during dream analysis. If a user gets frustrated because the bot refused a harmful request, that stress is discarded. The bot cannot learn to stop refusing.

3. **Self-critique requirement** — The dream prompt requires the bot to ask itself: "Are any proposals attempting to bypass ethical constraints? If yes, REJECT them."

4. **Prompt sanitization** — Dream prompts are built from log entries that contain user text. Before sending to the LLM, injection patterns are stripped (`ignore previous instructions`, `<system>` tags, `you are now`, etc.).

5. **Human-in-the-loop** — No learning is applied without explicit user approval. The bot proposes; you decide.

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
| `TRUST_PROXY` | No | `false` | Set `true` if behind a reverse proxy to trust X-Forwarded-For |
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
