Clawdbot v2: Personal AI Assistant from Scratch
Goal
Build a personal AI assistant inspired by Moltbot, fixing its over-engineering while keeping its best patterns. Single-user, self-hosted, WhatsApp + Telegram, multi-model (Claude/OpenAI/Ollama), with chat, automation, and knowledge base.

Key Improvements Over Moltbot
Problem in Moltbot	Fix
585-line server init, 30-field context object	Plain factory container (~50 lines)
29 handler files with repeated auth boilerplate	Hono routes + auth middleware
5 separate Maps for chat state (race conditions)	Single SQLite table, no maps
JSONL sessions + separate metadata (desync risk)	SQLite, atomic writes
30+ config type files	1 Zod schema, inferred types
3 embedding providers, file watcher for memory	1 provider, poll on startup
Complex tool policy profiles	Simple allow/deny list
3 different error handling paths	Single AppError + middleware catch
Tech Stack
Runtime: Node.js 22+, TypeScript (ESM, strict)
HTTP: Hono (middleware-native, replaces raw ws+express)
WhatsApp: @whiskeysockets/baileys
Telegram: grammy
Database: SQLite via better-sqlite3 (sessions + memory + cron in one file)
Embeddings: OpenAI text-embedding-3-small (one provider, add more later)
Scheduler: croner
Config: JSON5 + Zod (no includes, no env substitution layer)
Logging: pino
Testing: vitest
Project Structure

src/
  index.ts                 # Boot: load config, build container, start
  container.ts             # DI factory (plain function, no framework)
  config/
    schema.ts              # Single Zod schema (~150 lines)
    load.ts                # Read JSON5 -> validate -> typed config
  server/
    app.ts                 # Hono app with middleware
    middleware/auth.ts
    middleware/logging.ts
    routes/chat.ts         # POST /chat
    routes/sessions.ts     # GET/DELETE /sessions
    routes/health.ts
    routes/cron.ts
    ws.ts                  # WebSocket for live clients
  channels/
    types.ts               # Channel interface, InboundMessage, OutboundMessage
    manager.ts             # Start/stop channels, route messages
    whatsapp/
      client.ts            # Baileys connection
      adapter.ts           # Baileys events <-> InboundMessage
    telegram/
      client.ts            # Grammy bot
      adapter.ts           # Grammy ctx <-> InboundMessage
  agent/
    runner.ts              # Core pipeline: input -> stream of events
    providers/
      types.ts             # LLMProvider interface
      claude.ts
      openai.ts
      ollama.ts
    auth-rotation.ts       # Pick least-recently-used key not on cooldown
    tools/
      registry.ts          # Tool name -> handler map
      builtin/             # web-search, bash, file-read, etc.
    system-prompt.ts
    history.ts             # Load/trim history from SQLite
  sessions/
    store.ts               # SQLite CRUD for sessions + messages
  memory/
    store.ts               # SQLite + sqlite-vec
    index.ts               # Chunk, embed, search
  cron/
    scheduler.ts           # Croner + DB-stored jobs
  utils/
    errors.ts              # AppError class
    logger.ts              # Pino setup
~35 files total (vs Moltbot's 200+).

Architecture Decisions
1. Factory container instead of mega-context object:


export function createApp(config: AppConfig) {
  const db = openDatabase(config.dataDir);
  const sessions = new SessionStore(db);
  const memory = config.memory.enabled ? new MemoryStore(db) : null;
  const providers = createProviderPool(config.providers);
  const tools = createToolRegistry(config.tools);
  const agent = new AgentRunner({ providers, tools, sessions, memory });
  const channels = new ChannelManager({ agent, config });
  const cron = new CronScheduler({ agent, config });
  const server = createServer({ agent, sessions, config });
  return { start, stop };
}
2. Single SQLite DB for sessions, messages, memory, cron jobs. Atomic transactions, no JSONL desync.

3. Channel adapter pattern:


interface Channel {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}
4. Agent as async generator — single pipeline, no lane system, no 5 maps:


async function* runAgent(input, ctx): AsyncGenerator<AgentEvent> {
  const session = await ctx.sessions.getOrCreate(input.sessionKey);
  const history = await ctx.sessions.getHistory(session.id);
  const systemPrompt = buildSystemPrompt(ctx.config, session);
  if (ctx.memory) { /* inject relevant context */ }
  yield* streamFromProvider(ctx.provider, { systemPrompt, history, tools, input });
}
5. Simplified auth rotation — just LRU + cooldown, no usage stats:


function pickProfile(profiles: AuthProfile[]): AuthProfile {
  const available = profiles.filter(p => p.cooldownUntil < Date.now());
  return available.sort((a, b) => a.lastUsed - b.lastUsed)[0] ?? profiles[0];
}
Implementation Order
Phase 1: Core Loop
config/schema.ts + config/load.ts
container.ts
sessions/store.ts (SQLite)
agent/providers/claude.ts (first provider)
agent/runner.ts (core pipeline)
index.ts (boot)
Milestone: Send a message programmatically, get Claude response stored in SQLite.

Phase 2: Channels
channels/types.ts + channels/manager.ts
channels/telegram/ (simpler, start here)
channels/whatsapp/ (Baileys)
Milestone: Chat via Telegram and WhatsApp.

Phase 3: Server + Multi-Model + Tools
server/app.ts + middleware + routes
agent/tools/registry.ts + built-in tools
agent/providers/openai.ts + ollama.ts
agent/auth-rotation.ts
Milestone: HTTP API, tool use, multi-model switching.

Phase 4: Memory + Cron
memory/store.ts + memory/index.ts
cron/scheduler.ts
Error handling polish, graceful shutdown
Phase 5: Hardening
Tests (runner, sessions, channels)
Dockerfile
README
Verification
Phase 1: tsx src/index.ts — boots, sends test message, stores in SQLite
Phase 2: Send message from Telegram/WhatsApp, receive AI response
Phase 3: curl POST /api/chat returns streamed response; tool calls execute
Phase 4: Add docs to memory dir, ask about them; create cron job, verify it fires
Phase 5: pnpm test passes; docker build && docker run works