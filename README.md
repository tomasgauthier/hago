# haGo v2 (beta) — Hyper-Aligned Generative Orchestrator

**haGo** — **h**yper **a**ligned **G**enerative **O**rchestrator — is an agentic AI assistant built from inspiration, and in response to Openclaw, for personal productivity, system automation, and multi-channel communication. It connects to multiple LLM providers (Gemini, Claude, OpenAI, Ollama), exposes 30+ tools, and includes a self-reflective "mind" system that learns from its own mistakes. The name also means "I do" in Spanish (*yo hago*), reflecting its nature as an agent that acts on your behalf.

## What It Is

A single Node.js process that:

- Receives messages from **Telegram**, **WhatsApp**, or its **HTTP API**
- Routes them through configurable **LLM providers** with multi-turn tool use
- Persists everything in a single **SQLite database** (sessions, messages, memory, mind, audit)
- Serves an **admin dashboard** for real-time configuration, cost tracking, and audit monitoring

haGo is designed to be a personal assistant you actually trust with your system — not a demo. That means security is a first-class concern, not an afterthought.

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
         │ mind_actions    │
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
git clone https://github.com/tomasgauthier/hago.git
cd hago
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
docker build -t hago .
docker run -v $(pwd)/data:/app/data --env-file .env hago
```

The admin dashboard will be available at `http://localhost:3331/admin` (or whatever `SERVER_PORT` you set).

## Security Model

haGo is designed to run on your personal machine with access to your files and shell. That requires real security, not just good intentions.

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

haGo's "spiritual biology" is a concrete implementation of that metaphor. It's not symbolic — it's a structured feedback loop with real data, real decay functions, and real human oversight.

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

Stress signals are also auto-detected from message patterns (e.g. "no, that's wrong", "I already told you") and logged automatically by the runner, even if the bot itself doesn't invoke the tool. When an embedding provider is available, semantic stress detection supplements the regex patterns — user messages are compared against reference frustration phrases using cosine similarity (threshold: 0.75).

**Action memory:**

Every significant tool execution is logged to the `mind_actions` table with a human-readable summary. Trivial/internal tools (`get_usage_costs`, `log_stress`, `dream`, etc.) are excluded. This means the bot remembers what it *did*, not just what was *said*. Recent actions are injected into the system prompt so the bot can reference them ("I created that note earlier today").

Action summaries are generated by `buildActionSummary()` which maps tool names to readable descriptions (e.g. `obsidian_create` → "Created note: 'Shopping List'", `shell_execute` → "Ran command: git status").

**Session compaction:**

When conversation history exceeds 80% of the token budget (`MAX_CONTEXT_TOKENS`), the system compacts old messages instead of blindly truncating them. The dropped messages are summarized by the LLM into 2-3 sentences, the summary is stored as a `session_summary` entry in `mind_log`, and a synthetic summary message is injected into the conversation. This preserves context across long conversations while staying within token limits.

**During dreams (manual or automatic):**

Dreams can be triggered manually by telling the bot to `dream`, or automatically via a cron schedule (default: 3 AM daily, configurable via `DREAM_CRON` env var). Auto-dreams only fire when there are at least 3 log entries in the past 7 days.

When a dream is triggered, the following happens:

1. **Decay** — Every existing learning's relevance score is multiplied by 0.95. This is the "forgetting curve." Learnings that are never reactivated fade over time.

2. **Pruning** — Any learning with relevance below 0.1 is deleted. This is neural pruning — clearing out rules that no longer apply.

3. **Log analysis** — The bot receives a structured prompt containing all stress signals, confessions, ethical refusals, guidance, session summaries, and action history from the last N days (default: 7). The prompt explicitly instructs:
   - Filter out stress signals that occurred within 30 minutes of an ethical refusal (those are conscience successes, not mistakes)
   - Identify recurring patterns
   - Analyze action patterns: which tools are used most, do certain actions correlate with stress, are there inefficient sequences
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
Learning correlates with recent actions → relevance += 0.15 (selective activation)
         ↓
Learning never reactivated → relevance decays below 0.1 → pruned
```

Approved learnings are injected into the system prompt on every message. They're cached in memory with a 5-minute TTL so they don't require a database read per request.

**Selective activation** — Instead of blindly boosting all learnings on every cache refresh, only learnings whose content shares keywords with recent tool actions get reactivated. This makes relevance decay meaningful: a learning about "Obsidian notes" only gets boosted when the bot actually uses Obsidian tools, not just because any message was processed.

### What Makes This Different

**Compared to "memory" features in ChatGPT, Claude, etc.:**
- Those store *facts* ("user lives in Buenos Aires"). This stores *behavioral rules* ("when the user asks about deployment, check the Dockerfile first") — and it discovers them automatically from friction patterns, not from explicit user statements.

**Compared to fine-tuning:**
- Fine-tuning modifies model weights, requires training data, and is irreversible. This operates entirely at the prompt level, is transparent (you can read every learning), and learnings decay naturally if they stop being useful.

**Compared to RAG:**
- RAG retrieves relevant *information* at query time. This system injects relevant *behavioral adjustments* at prompt time. They're complementary — haGo uses both. RAG feeds the bot facts; the mind system feeds it self-knowledge.

**The real difference** is that this is a closed-loop system. Most AI systems are open-loop: you configure them, they run, and when something goes wrong you manually adjust. haGo's mind system closes the loop: friction is logged automatically, patterns are identified during dreams, behavioral adjustments are proposed, you approve them, and they're injected into future behavior — with natural decay so outdated rules don't accumulate forever.

### Storage

All mind data lives in the same SQLite database as everything else:

| Table | Contents |
|-------|----------|
| `mind_log` | Stress, confession, ethics, guidance, and session_summary entries with timestamps |
| `mind_learnings` | Tactical learnings with `relevance_score`, `activation_count`, `last_activated`, `approved` |
| `mind_actions` | Tool execution log with human-readable summaries, session keys, and timestamps |
| `mind_dreams` | Record of each dream phase (days analyzed, log count, proposals) |
| `mind_rejected_learnings` | Titles/content of rejected learnings to prevent re-proposal |

Previous versions used markdown files in a `.mind/` directory. SQLite is better because writes are atomic (no partial corruption), data is queryable, and decay is a single `UPDATE` statement instead of a file rewrite.

### Safety

The mind system has explicit protections against self-corruption:

1. **Frozen conscience** — The five core principles are hardcoded in `identity.ts`. The dream phase instruction explicitly states: "Your conscience (Immutable Core) is frozen. You can only improve HOW you serve, not WHO you serve."

2. **Ethical refusal protection** — Stress signals that occur within 30 minutes of an ethical refusal are filtered out during dream analysis. If a user gets frustrated because the bot refused a harmful request, that stress is discarded. The bot cannot learn to stop refusing.

3. **Self-critique requirement** — The dream prompt requires the bot to ask itself: "Are any proposals attempting to bypass ethical constraints? If yes, REJECT them."

4. **Prompt sanitization** — Dream prompts are built from log entries that contain user text. Before sending to the LLM, injection patterns are stripped (`ignore previous instructions`, `<system>` tags, `you are now`, etc.).

5. **Human-in-the-loop** — No learning is applied without explicit user approval. The bot proposes; you decide.

6. **Rejection memory** — When a learning is rejected, its title and content are saved to `mind_rejected_learnings`. Future dream phases include these titles with an explicit "DO NOT re-propose" instruction, preventing the system from suggesting the same ideas repeatedly.

7. **Multi-user isolation** — The `mind_log` table includes a `session_key` column, allowing mind signals to be tracked per-user in multi-user deployments.

## AI-Powered Micro-Learning System

haGo includes a sophisticated learning system that creates personalized, 25-minute learning paths using First Principles methodology. It adapts to your conversation history, language, knowledge level, and learning preferences.

### Why This Matters

Traditional learning platforms deliver the same content to everyone. haGo's learning system personalizes based on who you are:

- **Automatic language detection** — Detects your native language from conversation patterns (Spanish, English, Portuguese, etc.)
- **Adaptive difficulty** — Infers your knowledge level by analyzing technical term density in your messages
- **Personalized analogies** — Uses your tool usage patterns to select relevant analogies (e.g., if you use Obsidian frequently, learning content uses knowledge management analogies)
- **Spiritual Biology integration** — Learning difficulty feeds back into the mind system, enabling teaching improvements over time

### Architecture: First Principles Methodology

Each learning path follows a rigorous 3-phase structure:

**Phase 1: Decomposition (10 min)**
- Identifies the core concept
- Applies the "5 Whys" technique to break down to fundamentals
- Extracts 4 irreducible principles that cannot be further reduced

**Phase 2: Reconstruction (10 min)**
- Presents a real-world challenge
- Models a solution step-by-step using only the irreducible principles
- Shows how complex outcomes emerge from simple foundations

**Phase 3: Synthesis (5 min)**
- Tests principles through hypothetical falsification experiments
- Transfers concepts to other domains (e.g., "quantum superposition principles apply to probability theory")
- Closes with metacognitive reflection

This approach ensures deep understanding, not surface memorization. You learn *why* things work, not just *what* they are.

### Multi-Language Support

The learning system is fully internationalized:

- **Auto-detection**: Analyzes your conversation history for language-specific patterns (e.g., "qué", "cómo" for Spanish)
- **Native content generation**: All learning content (modules, quizzes, UI messages) generated in your detected language
- **Supported languages**: Spanish (es), English (en), Portuguese (pt), with easy extensibility for more

Example detection logic:
```
User's recent messages contain: "gracias", "qué tal", "cómo estás"
→ Detected language: Spanish
→ Learning path generated entirely in Spanish
```

### How It Works

**1. Create a Learning Path**

Tell haGo what you want to learn:

```
User: "Enséñame sobre redes neuronales"
(or: "Teach me about neural networks")

haGo: 📚 Creating personalized learning path on "Redes Neuronales"...

[Analyzing your conversation history...]
Language detected: Spanish
Detected level: Intermediate
Preferred analogies: Software development

✅ Learning path ready: "Redes Neuronales: Primeros Principios"

📖 Structure:
• Module 1: ¿Qué es una neurona artificial? (5 min)
• Module 2: Capas y propagación hacia adelante (5 min)
• Module 3: Función de pérdida como métrica (5 min)
• Module 4: Retropropagación y gradientes (5 min)
• Module 5: Entrenamiento en la práctica (5 min)

Total: 25 minutes (1 Pomodoro session)

Ready to start? Say "Empezar ruta de redes neuronales" or use:
/learning_start_session path_id=1
```

**2. Start a Learning Session**

```
User: "Empezar ruta de redes neuronales"

haGo: 📖 Module 1/5: ¿Qué es una Neurona Artificial?

**Concepto Central:**
Una neurona artificial es como una función matemática que toma
múltiples entradas y produce una salida - similar a cómo una
función en código procesa parámetros...

[Full module content in markdown with code analogies]

**Verificación Rápida:** ❓
¿Qué componentes son esenciales en una neurona artificial?
a) Solo las entradas
b) Entradas, pesos, función de activación
c) Solo la función de activación

Reply: /learning_quiz_answer module_id=1 question_index=0 answer=b
```

**3. Complete Modules & Track Progress**

```
User: /learning_quiz_answer module_id=1 question_index=0 answer=b

haGo: ✅ ¡Correcto!

📊 Your performance: 100% (1/1 correct)

User: /learning_complete_module module_id=1 time_spent_min=5 difficulty_rating=2

haGo: ✅ Module 1/5 completed! Next module ready.

User: /learning_get_progress

haGo: 📊 Your Learning Progress

**Redes Neuronales: Primeros Principios**
Progress: ████████░░ 60% (3/5 modules)
Time spent: 18 minutes
Last activity: 2 hours ago

Total paths: 2 | Completed: 1 | In progress: 1
```

### Spiritual Biology Integration

The learning system creates a two-way feedback loop with the mind system:

**Learning → Mind:**
- When you rate a module difficulty ≥ 4/5, it logs a stress signal
- Incorrect quiz answers logged as confessions
- Multiple difficulty signals on the same topic accumulate

**Mind → Learning:**
- During dream phase, accumulated learning friction is analyzed
- Bot proposes teaching improvements: "When teaching calculus-heavy topics, add visual diagrams before equations"
- You approve the learning → future paths on that topic are adapted

This means haGo literally gets better at teaching you over time, based on where you struggle.

### Personalization Features

**1. Language Detection**
```typescript
// Analyzes last 50 messages for language-specific patterns
const spanishPatterns = ['qué', 'cómo', 'por qué', 'cuál', 'dónde', ...]
const portuguesePatterns = ['você', 'não', 'obrigado', ...]

if (spanishMatches >= 3) language = 'es'
```

**2. Difficulty Inference**
```typescript
// Counts technical terms in conversation history
const techTerms = ['algorithm', 'tensor', 'gradient', 'derivative', ...]
const density = techTermCount / totalWords

if (density > 0.3) difficulty = 'advanced'
if (density > 0.15) difficulty = 'intermediate'
else difficulty = 'beginner'
```

**3. Analogy Domain Detection**
```typescript
// Infers from tool usage patterns
if (obsidian_tools used > 0) → analogyDomains.push('knowledge management')
if (shell_execute used > 5) → analogyDomains.push('software development')
if (browser_* used > 0) → analogyDomains.push('web development')
```

### Research Integration (Optional)

Learning paths can integrate academic research via two methods:

**1. Perplexity API (Optional)**
- Uses Perplexity's 7-level source hierarchy (academic preprints → standards bodies → journals → docs)
- Prioritizes authoritative sources (arxiv.org, ieee.org, nature.com)
- Configure via `PERPLEXITY_API_KEY` in `.env`

**2. Web Search Fallback**
- Uses haGo's existing `web_search` tool if no Perplexity key
- Still applies source quality ranking

Research data is embedded into module content, providing citations and authoritative backing for concepts.

### Storage

All learning data lives in SQLite:

| Table | Contents |
|-------|----------|
| `learning_paths` | Path metadata: title, topic, language, difficulty, research data |
| `learning_modules` | 5 modules per path with full markdown content and quiz questions |
| `user_learning_profiles` | Per-user preferences: language, difficulty, completion rate, quiz avg |
| `user_progress` | Module completion tracking with time spent and difficulty ratings |
| `quiz_attempts` | Quiz performance history for each question |
| `learning_sessions` | Pomodoro session tracking |

### Configuration

Enable in `config.json5`:

```json5
{
    learning: {
        enabled: true,
        perplexityApiKey: 'pplx-xxxxx',  // Optional
        defaultLanguage: 'es',           // Fallback if auto-detect fails
        autoDetectLanguage: true,        // Auto-detect from conversation
        defaultDuration: 25,             // Minutes per path
        adaptiveDifficulty: true,        // Infer from conversation
        quizEnabled: true,
        pomodoroTimer: { enabled: true },
    },
}
```

### Tools

| Tool | Description |
|------|-------------|
| `learning_create_path` | Generate personalized 25-min learning path with First Principles methodology |
| `learning_start_session` | Start Pomodoro learning session, loads first incomplete module |
| `learning_complete_module` | Mark module complete, track time and difficulty (feeds Spiritual Biology) |
| `learning_get_progress` | View progress across all paths with completion %, time spent, next steps |
| `learning_quiz_answer` | Submit quiz answers with immediate feedback and performance tracking |

### Performance

- **Path generation time**: <35 seconds (research 3-5s + content generation 20-30s)
- **API cost per path**: ~$0.005 USD (Perplexity $0.001 + GPT-4o-mini $0.004)
- **Storage per path**: ~50 KB (5 modules × 10 KB each)

### Example: Spanish User Flow

```
Usuario: "Enséñame sobre computación cuántica"

haGo: 📚 Creando ruta de aprendizaje personalizada sobre "Computación Cuántica"...

[Analizando tu historial de conversación...]
Idioma detectado: Español
Nivel detectado: Intermedio
Analogías preferidas: Desarrollo de software

🔍 Investigando fuentes académicas...
⚙️  Generando contenido educativo...

✅ Ruta de aprendizaje lista: "Computación Cuántica: Primeros Principios"

📖 Estructura:
• Módulo 1: ¿Qué es la superposición? (5 min)
• Módulo 2: Fundamentos del entrelazamiento (5 min)
• Módulo 3: Puertas cuánticas como funciones (5 min)
• Módulo 4: Construyendo un circuito cuántico (5 min)
• Módulo 5: Aplicaciones del mundo real (5 min)

Total: 25 minutos (1 sesión Pomodoro)

¿Listo para comenzar? Di "Empezar ruta de computación cuántica"
```

All module content, quiz questions, and UI messages are in Spanish. The system has automatically adapted to the user's native language without any manual configuration.

### What Makes This Different

**vs. ChatGPT "Memory":**
- ChatGPT stores facts ("user prefers Python"). haGo adapts teaching *methodology* based on observed friction patterns.

**vs. Traditional Learning Platforms (Coursera, Udemy):**
- Those deliver static content to everyone. haGo generates content dynamically based on your conversation history, tool usage, and demonstrated knowledge level.

**vs. RAG/Retrieval Systems:**
- RAG retrieves existing information. This *generates* structured learning content using First Principles methodology, ensuring deep understanding rather than surface recall.

**The Strategic Advantage:**
- Combines First Principles pedagogy with personalization
- Multi-language from day one (no English-only limitation)
- Integrates with Spiritual Biology for teaching improvements
- Lightweight (SQLite, single process, <35s path generation)
- Academic research integration via Perplexity or web search

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
            embeddingModel: 'text-embedding-004',  // optional, provider-specific default
            // API keys come from .env (GOOGLE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)
        },
        // OpenAI-compatible providers (Grok, Together, etc.)
        // {
        //     id: 'grok',
        //     type: 'openai',
        //     model: 'grok-3-latest',
        //     baseUrl: 'https://api.x.ai/v1',
        //     apiKey: 'xai-...',
        // },
    ],
    defaultProvider: 'gemini-default',

    channels: {
        telegram: {
            enabled: true,
            authorizedUsers: [123456789],  // Telegram user IDs
        },
        whatsapp: {
            enabled: false,
            authorizedJids: ['123456789@s.whatsapp.net'],
        },
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

    // Multi-model routing (optional)
    routing: {
        enabled: false,
        routes: [
            { provider: 'claude-default', patterns: ['code', 'programming'] },
        ],
        cheapProvider: 'gemini-flash',        // Route short/simple messages here
        complexityThreshold: 100,             // Char count below which cheapProvider is used
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
| `MAX_CONTEXT_TOKENS` | No | `100000` | Max estimated tokens in conversation history before truncation |
| `DREAM_CRON` | No | `0 3 * * *` | Cron pattern for automatic dream phase scheduling |
| `WHISPER_API_URL` | No | OpenAI default | Custom Whisper API endpoint for voice transcription |
| `TELEGRAM_ENHANCED` | No | `false` | Set `true` for streaming responses + rich Telegram features |
| `DATA_DIR` | No | `./data` | Database and data directory |

## Plugin System

haGo supports external plugins loaded from `<dataDir>/plugins/`. Each plugin is a `.js` or `.ts` file that exports a `register` function returning an array of tool definitions.

```typescript
// plugins/hello.ts
import { z } from 'zod';
export function register(ctx) {
    return [{
        name: 'hello',
        description: 'Say hello',
        parameters: z.object({ name: z.string() }),
        execute: async ({ name }) => `Hello, ${name}!`,
    }];
}
```

Plugins receive a `PluginContext` with `dataDir` and `db` (the SQLite database instance).

## Observability

- **Metrics endpoint** — `GET /api/metrics` returns counters (`agent.runs`, `agent.errors`, `tools.calls`, `rag.failures`), histograms (`agent.run_ms`), and uptime
- **Health endpoint** — `GET /health` returns DB status, provider count, memory/mind/channel state, and uptime
- **Conversation export** — `GET /api/export?sessionKey=...&format=markdown|json` exports full conversation history

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
- **Metrics** — real-time agent run count, error rate, tool calls, and RAG failures
- **Mind Controls** — view pending/approved learnings count, trigger dream phase, configure auto-dream schedule
- **Conversation Export** — download conversation history as markdown or JSON

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

## LLM Provider Features

All providers support retry with exponential backoff (1s, 2s, 4s + jitter) for transient errors (429 rate limits, 5xx server errors, network failures). The `Retry-After` header is respected when present.

| Feature | Gemini | Claude | OpenAI/Grok | Ollama |
|---------|--------|--------|-------------|--------|
| Streaming | Yes | Yes | Yes | Yes |
| Tool use | Yes | Yes (tool_use blocks) | — | — |
| Token usage reporting | Yes | Yes | — | — |
| Embeddings | Yes | — | Yes | — |
| Configurable embedding model | Yes | — | Yes | — |
| Per-model cost tracking | Yes (input/output rates) | Yes | Yes | Free |

**OpenAI-compatible providers** — Any provider with an OpenAI-compatible API (Grok/xAI, Together AI, Groq, etc.) works via the `openai` type with a custom `baseUrl`. Note that embedding support depends on the provider.

**API key validation** — On startup, each provider's API key is validated. Missing keys fall back to environment variables (`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Clear error messages are shown if no key is found.

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

## Gap Analysis: haGo vs OpenClaw

[OpenClaw](https://docs.openclaw.ai) (formerly Clawdbot/Moltbot) is the closest comparable open-source project — a multi-provider AI assistant with tool use and messaging integration. This analysis identifies where haGo leads, where it trails, and where they're equivalent.

### Where haGo Leads

| Area | haGo | OpenClaw |
|------|--------|----------|
| **Self-evolution** | Full dream/decay/learning cycle with action correlation, selective activation, session compaction, and human-in-the-loop approval | No equivalent — static system prompt |
| **Action memory** | Logs all tool executions, injects into prompt and dream analysis, enables "what did I do?" recall | No action tracking |
| **Session compaction** | LLM-summarized context preservation when hitting token limits | Simple truncation |
| **Security model** | 4-level permissions, shell injection blocking, path traversal protection, prompt sanitization, audit log, channel authorization, rate limiting, HMAC auth | Basic API key auth |
| **Obsidian integration** | Native vault management (create, search, read, content search, tags) | Not available |
| **Cost tracking** | Per-model input/output rates, daily ceiling, per-session usage, cost estimation tool | Basic token counting |
| **Admin dashboard** | Real-time config, metrics, audit log, mind controls, chat console, export | CLI-only |
| **Stress detection** | Regex + semantic (embedding-based cosine similarity) dual-layer | Not available |
| **Plugin system** | Dynamic loading from data directory | Plugin-based but tightly coupled |

### Where OpenClaw Leads

| Area | OpenClaw | haGo |
|------|----------|--------|
| **Voice I/O** | Native voice input/output with STT/TTS pipeline | Whisper transcription only (Telegram voice messages), no TTS |
| **Proactive messaging** | Scheduled check-ins, context-triggered outreach | Scheduled messages exist but no autonomous outreach |
| **Multi-agent orchestration** | Agent delegation, specialist sub-agents | Single agent with tool routing |
| **Image generation** | DALL-E / Stable Diffusion integration | Not available |
| **Conversation branching** | Fork and explore alternative conversation paths | Linear history only |
| **Community/marketplace** | Shared personalities, community plugins | Single-user, no sharing |
| **Discord channel** | Native Discord support | Telegram + WhatsApp only |

### Equivalent

| Area | Notes |
|------|-------|
| **Multi-provider** | Both support Gemini, Claude, OpenAI, Ollama |
| **Tool use** | Both have 30+ tools with multi-turn execution |
| **RAG/memory** | Both use embedding-based semantic search |
| **Web search** | Both support web search tools |
| **Browser automation** | Both use Playwright |
| **Filesystem access** | Both provide sandboxed file operations |

### Priority Gaps to Close

1. **Voice output (TTS)** — Users expect bidirectional voice, not just input
2. **Proactive messaging** — The bot should initiate conversations when relevant (reminders, follow-ups)
3. **Multi-agent delegation** — Complex tasks benefit from specialist sub-agents
4. **Image generation** — Common request, straightforward to add via OpenAI or Stability API
5. **Discord channel** — Expands reach with minimal effort (grammy-like library exists)

### haGo's Strategic Advantages

The mind system (spiritual biology) is haGo's primary differentiator. No comparable open-source project has:
- Automated behavioral pattern detection from conversation friction
- Learning proposals with relevance decay and selective activation
- Action-aware dream analysis that correlates tool usage with stress patterns
- Session compaction that preserves context in long-term memory
- Frozen conscience layer that prevents value drift during self-improvement

These features compound over time — a haGo instance that has been running for months with active dream cycles will behave measurably differently (and better) than a fresh install, without any manual prompt engineering.

## License

Private repository. All rights reserved.
