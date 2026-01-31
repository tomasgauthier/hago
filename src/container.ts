import { AppConfig } from './config/schema.js';
import { SessionStore } from './sessions/store.js';
import { AgentRunner } from './agent/runner.js';
import { ClaudeProvider } from './agent/providers/claude.js';
import { GeminiProvider } from './agent/providers/gemini.js';
import { OpenAIProvider } from './agent/providers/openai.js';
import { OllamaProvider } from './agent/providers/ollama.js';
import { LLMProvider } from './agent/providers/types.js';
import { ChannelManager } from './channels/manager.js';
import { AgentRouter } from './agent/router.js';
import { TelegramChannel } from './channels/telegram/adapter.js';
import { EnhancedTelegramChannel } from './channels/telegram/enhanced-adapter.js';
import { WhatsAppChannel } from './channels/whatsapp/adapter.js';
import { ToolRegistry } from './agent/tools/registry.js';
import { searchTool } from './agent/tools/builtin/search.js';
import { obsidianSearchTool, obsidianReadTool, obsidianCreateTool, obsidianSearchContentTool } from './agent/tools/builtin/obsidian.js';
import { shellExecuteTool } from './agent/tools/builtin/shell.js';
import { journalTool } from './agent/tools/builtin/journal.js';
import { createFinanceTools } from './agent/tools/builtin/finance.js';
import { logStressTool, confessUncertaintyTool, logEthicalRefusalTool, dreamTool, getLearningsTool, logGuidanceTool } from './agent/tools/builtin/spiritual-biology.js';
import { getCostsTool, estimateCostTool } from './agent/tools/builtin/cost-tracker.js';
import { scheduleMessageTool, listScheduledMessagesTool, cancelScheduledMessageTool } from './agent/tools/builtin/scheduler.js';
import { telegramCreatePollTool, telegramCreateKeyboardTool, telegramReactToMessageTool, telegramEditLastMessageTool, telegramGetMediaInfoTool } from './agent/tools/builtin/telegram.js';
import { createServer } from './server/app.js';
import { MemoryStore } from './memory/store.js';
import { MemoryIndex } from './memory/index.js';
import { CronScheduler } from './cron/scheduler.js';
import { logger } from './utils/logger.js';
import { serve } from '@hono/node-server';
import { PermissionManager } from './utils/permissions.js';
import { ApprovalQueue } from './utils/approval-queue.js';
import { BrowserManager, createBrowserTools } from './agent/tools/builtin/browser.js';
import { createFileSystemTools } from './agent/tools/builtin/filesystem.js';
import { createSelfModTools } from './agent/tools/builtin/selfmod.js';
import { createMemoryTools } from './agent/tools/builtin/memory.js';

export interface AppContainer {
    sessions: SessionStore;
    agent: AgentRunner;
    channels: ChannelManager;
    config: AppConfig;
    tools: ToolRegistry;
    memory: MemoryIndex;
    cron: CronScheduler;
    permissions: PermissionManager;
    approvalQueue: ApprovalQueue;
    browserManager: BrowserManager;
    start: () => Promise<void>;
    stop: () => Promise<void>;
}

export function createContainer(config: AppConfig): AppContainer {
    const sessions = new SessionStore(config.dataDir);
    const mStore = new MemoryStore(sessions.db); // Using the same SQLite DB

    // Permission system
    const permissions = new PermissionManager(config.permissions);
    logger.info({ maxLevel: config.permissions.maxLevel }, 'Permission system initialized');

    // Approval queue for privileged operations
    const approvalQueue = new ApprovalQueue(logger);

    // Browser automation manager
    const browserManager = new BrowserManager(logger, permissions);

    // Tools
    const tools = new ToolRegistry();
    if (config.tools.enabled) {
        // Cost tracking tools
        tools.register(getCostsTool);
        tools.register(estimateCostTool);
        
        tools.register(searchTool);
        tools.register(shellExecuteTool);
        if (config.obsidian.enabled && config.obsidian.vaultPath) {
            tools.register(obsidianSearchTool(config.obsidian.vaultPath));
            tools.register(obsidianReadTool(config.obsidian.vaultPath));
            tools.register(obsidianCreateTool(config.obsidian.vaultPath));
            tools.register(obsidianSearchContentTool(config.obsidian.vaultPath));

            // Register journal tool
            tools.register(journalTool(config.obsidian.vaultPath));

            // Register finance tools
            const financeTools = createFinanceTools(sessions.db, config.obsidian.vaultPath);
            financeTools.forEach(tool => tools.register(tool));

            logger.info('Obsidian tools registered successfully');
            logger.info('Journal and Finance tools registered successfully');
        }

        // Spiritual Biology tools
        if (config.spiritualBiology?.enabled) {
            tools.register(logStressTool);
            tools.register(confessUncertaintyTool);
            tools.register(logEthicalRefusalTool);
            tools.register(dreamTool);
            tools.register(getLearningsTool);
            tools.register(logGuidanceTool);
            logger.info('Spiritual Biology tools registered (6 tools)');
        }
    }

    // Providers
    const providers: LLMProvider[] = config.providers.map(p => {
        switch (p.type) {
            case 'claude':
                return new ClaudeProvider({ id: p.id, apiKey: p.apiKey!, model: p.model });
            case 'gemini':
                return new GeminiProvider({ id: p.id, apiKey: p.googleApiKey!, model: p.model });
            case 'openai':
                return new OpenAIProvider({ id: p.id, apiKey: p.apiKey!, model: p.model, baseUrl: p.baseUrl });
            case 'ollama':
                return new OllamaProvider({ id: p.id, model: p.model, baseUrl: p.baseUrl });
            default:
                throw new Error(`Unsupported provider type: ${p.type}`);
        }
    });

    // Memory Index — pick embedding provider from config, fall back to default provider
    const embeddingProviderId = config.memory.provider || config.defaultProvider;
    const embeddingProvider = providers.find(p => p.id === embeddingProviderId) || null;
    if (config.memory.enabled && !embeddingProvider) {
        logger.warn(`Embedding provider "${embeddingProviderId}" not found — memory/RAG disabled`);
    } else if (config.memory.enabled && embeddingProvider) {
        logger.info(`Memory/RAG using embedding provider: ${embeddingProvider.id}`);
    }
    const memory = new MemoryIndex(mStore, embeddingProvider);

    const agent = new AgentRunner({
        sessions,
        providers,
        defaultProviderId: config.defaultProvider,
        memory: config.memory.enabled ? memory : null,
    });

    // Multi-agent router
    const router = config.routing?.enabled && config.routing.routes.length > 0
        ? new AgentRouter({ defaultProvider: config.defaultProvider, routes: config.routing.routes })
        : undefined;

    const channels = new ChannelManager({ agent, router, sessions });

    if (config.channels.telegram?.enabled && config.channels.telegram.token) {
        // Use enhanced adapter for richer Telegram features
        const useEnhanced = process.env.TELEGRAM_ENHANCED === 'true';
        const telegramChannel = useEnhanced 
            ? new EnhancedTelegramChannel(
                config.channels.telegram.token,
                config.channels.telegram.authorizedUsers || []
              )
            : new TelegramChannel(
                config.channels.telegram.token,
                config.channels.telegram.authorizedUsers || []
              );
        
        channels.registerChannel(telegramChannel);
        logger.info(`Telegram channel registered (${useEnhanced ? 'Enhanced' : 'Standard'} adapter)`);
    }

    if (config.channels.whatsapp?.enabled) {
        channels.registerChannel(new WhatsAppChannel(config.dataDir, config.channels.whatsapp.phoneNumber));
    }

    const cron = new CronScheduler({ dataDir: config.dataDir });

    // Wire up the scheduler to use channels for sending messages
    cron.setChannelManager(channels);

    // Register scheduler tools
    tools.register(scheduleMessageTool);
    tools.register(listScheduledMessagesTool);
    tools.register(cancelScheduledMessageTool);
    logger.info('Scheduler tools registered (3 tools)');

    // Browser automation tools
    if (config.browser.enabled) {
        const browserTools = createBrowserTools(logger, permissions, browserManager);
        browserTools.forEach(tool => tools.register(tool));
        logger.info('Browser automation tools registered (8 tools)');
    }

    // File system tools
    if (config.filesystem.enabled) {
        const fsTools = createFileSystemTools(logger, permissions);
        fsTools.forEach(tool => tools.register(tool));
        logger.info('File system tools registered (10 tools)');
    }

    // Self-modification tools
    if (config.selfModification.enabled) {
        const selfModTools = createSelfModTools(logger, permissions);
        selfModTools.forEach(tool => tools.register(tool));
        logger.info('Self-modification tools registered (7 tools)');
    }

    // Memory/RAG tools
    if (config.memory.enabled && embeddingProvider) {
        const memoryTools = createMemoryTools(logger, memory);
        memoryTools.forEach(tool => tools.register(tool));
        logger.info('Memory tools registered (2 tools: memory_store, memory_query)');
    }

    // Register Telegram-specific tools
    tools.register(telegramCreatePollTool);
    tools.register(telegramCreateKeyboardTool);
    tools.register(telegramReactToMessageTool);
    tools.register(telegramEditLastMessageTool);
    tools.register(telegramGetMediaInfoTool);
    logger.info('Telegram tools registered (5 tools)');

    const app = createServer({ sessions, agent, channels, config, tools, memory, cron } as any);
    let serverHandle: any;

    const start = async () => {
        logger.info('Tombot starting...');
        if (config.memory.enabled) {
            logger.info('Memory system enabled');
        }
        await channels.start();

        const host = process.env.SERVER_HOST || '127.0.0.1';
        const port = Number(process.env.SERVER_PORT || process.env.PORT) || 3000;

        serverHandle = serve({
            fetch: app.fetch,
            port,
            hostname: host,
        }, (info) => {
            logger.info(`Server listening on http://${host}:${info.port}`);
        });
    };

    const stop = async () => {
        logger.info('Tombot stopping...');
        await channels.stop();
        await browserManager.closeAll();
        cron.close();
        if (serverHandle) serverHandle.close();
        sessions.close();
    };

    const container: AppContainer = {
        sessions,
        agent,
        channels,
        config,
        tools,
        memory,
        cron,
        permissions,
        approvalQueue,
        browserManager,
        start,
        stop,
    };

    (global as any).container = container;

    return container;
}
