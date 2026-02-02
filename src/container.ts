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
import { createSpiritualBiologyTools } from './agent/tools/builtin/spiritual-biology.js';
import { MindStore as MindStoreClass } from './mind/store.js';
import { setMindStore } from './agent/identity.js';
import { getCostsTool, estimateCostTool } from './agent/tools/builtin/cost-tracker.js';
import { scheduleMessageTool, listScheduledMessagesTool, cancelScheduledMessageTool } from './agent/tools/builtin/scheduler.js';
import { telegramCreatePollTool, telegramCreateKeyboardTool, telegramReactToMessageTool, telegramEditLastMessageTool, telegramGetMediaInfoTool } from './agent/tools/builtin/telegram.js';
import { createServer } from './server/app.js';
import { MemoryStore } from './memory/store.js';
import { MemoryIndex } from './memory/index.js';
import { CronScheduler } from './cron/scheduler.js';
import { loadConfig } from './config/load.js';
import { logger } from './utils/logger.js';
import { serve } from '@hono/node-server';
import { PermissionManager } from './utils/permissions.js';
import { ApprovalQueue } from './utils/approval-queue.js';
import { BrowserManager, createBrowserTools } from './agent/tools/builtin/browser.js';
import { createFileSystemTools } from './agent/tools/builtin/filesystem.js';
import { createSelfModTools } from './agent/tools/builtin/selfmod.js';
import { createMemoryTools } from './agent/tools/builtin/memory.js';
import { loadPlugins } from './plugins/loader.js';
import { Cron } from 'croner';
import * as path from 'path';

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
    const mindStore = new MindStoreClass(sessions.db); // Mind system in same DB

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

        // Spiritual Biology tools (backed by MindStore/SQLite)
        if (config.spiritualBiology?.enabled) {
            const spiritTools = createSpiritualBiologyTools(mindStore);
            spiritTools.forEach(tool => tools.register(tool));
            setMindStore(mindStore);
            logger.info('Spiritual Biology tools registered (6 tools, SQLite-backed)');
        }
    }

    // Providers
    const providers: LLMProvider[] = config.providers.map(p => {
        switch (p.type) {
            case 'claude': {
                const apiKey = p.apiKey || process.env.ANTHROPIC_API_KEY;
                if (!apiKey) throw new Error(`Provider "${p.id}": missing apiKey (set in config or ANTHROPIC_API_KEY env)`);
                return new ClaudeProvider({ id: p.id, apiKey, model: p.model });
            }
            case 'gemini': {
                const apiKey = p.googleApiKey || process.env.GOOGLE_API_KEY;
                if (!apiKey) throw new Error(`Provider "${p.id}": missing googleApiKey (set in config or GOOGLE_API_KEY env)`);
                return new GeminiProvider({ id: p.id, apiKey, model: p.model, embeddingModel: p.embeddingModel });
            }
            case 'openai': {
                const apiKey = p.apiKey || process.env.OPENAI_API_KEY;
                if (!apiKey) throw new Error(`Provider "${p.id}": missing apiKey (set in config or OPENAI_API_KEY env)`);
                return new OpenAIProvider({ id: p.id, apiKey, model: p.model, baseUrl: p.baseUrl, embeddingModel: p.embeddingModel });
            }
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
        mindStore: config.spiritualBiology?.enabled ? mindStore : null,
        toolRegistry: tools,
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
        channels.registerChannel(new WhatsAppChannel(
            config.dataDir,
            config.channels.whatsapp.phoneNumber,
            config.channels.whatsapp.authorizedJids || []
        ));
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

    // Load external plugins from plugins/ directory
    const pluginDir = path.join(config.dataDir, 'plugins');
    loadPlugins(pluginDir, tools, { dataDir: config.dataDir, db: sessions.db }).then(count => {
        if (count > 0) logger.info(`Loaded ${count} plugin tools from ${pluginDir}`);
    }).catch(err => {
        logger.warn(`Plugin loading failed: ${err.message}`);
    });

    const app = createServer({ sessions, agent, channels, config, tools, memory, cron } as any);
    let serverHandle: any;

    // Auto-schedule dream phase (nightly at 3 AM) if spiritual biology is enabled
    if (config.spiritualBiology?.enabled) {
        const dreamCronPattern = process.env.DREAM_CRON || '0 3 * * *'; // Default: 3 AM daily
        // Use croner directly since scheduleFixed expects a CronJob with sessionKey
        new Cron(dreamCronPattern, async () => {
            const logCount = mindStore.getLogCount(7);
            if (logCount < 3) {
                logger.info('[Mind] Auto-dream skipped — fewer than 3 logs in past 7 days');
                return;
            }

            logger.info(`[Mind] Auto-dream triggered (${logCount} logs in past 7 days)`);
            try {
                const dreamTool = tools.getTool('dream');
                if (dreamTool) {
                    await tools.execute('dream', { days: 7 });
                    logger.info('[Mind] Auto-dream completed');
                }
            } catch (err: any) {
                logger.error(`[Mind] Auto-dream failed: ${err.message}`);
            }
        });
        logger.info(`[Mind] Dream auto-scheduling enabled: ${dreamCronPattern}`);
    }

    const start = async () => {
        logger.info('haGo starting...');
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
        logger.info('haGo stopping...');
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

    // Config hot-reload via SIGHUP — reloads config without restart
    process.on('SIGHUP', () => {
        try {
            const newConfig = loadConfig();
            Object.assign(container.config, newConfig);

            // Hot-reload channel configs
            if (newConfig.channels.telegram) {
                container.channels.updateChannelConfig('telegram', newConfig.channels.telegram);
            }
            if (newConfig.channels.whatsapp) {
                container.channels.updateChannelConfig('whatsapp', newConfig.channels.whatsapp);
            }

            logger.info('Configuration reloaded via SIGHUP');
        } catch (err: any) {
            logger.error(`Config hot-reload failed: ${err.message}`);
        }
    });

    return container;
}
