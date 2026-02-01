import { z } from 'zod';

export const ProviderSchema = z.object({
    id: z.string(),
    type: z.enum(['claude', 'openai', 'ollama', 'gemini']),
    apiKey: z.string().optional(),
    googleApiKey: z.string().optional(),
    model: z.string(),
    baseUrl: z.string().optional(),
});

export const ToolSchema = z.object({
    enabled: z.boolean().default(true),
    allowList: z.array(z.string()).optional(),
    denyList: z.array(z.string()).optional(),
});

export const PermissionSchema = z.object({
    maxLevel: z.number().min(1).max(4).default(2),
    allowedDirectories: z.array(z.string()).optional(),
    deniedDirectories: z.array(z.string()).optional(),
    allowedCommands: z.array(z.string()).optional(),
    deniedCommands: z.array(z.string()).optional(),
    allowedDomains: z.array(z.string()).optional(),
    requireApprovalLevel: z.number().min(1).max(4).optional(),
});

export const RouteRuleSchema = z.object({
    provider: z.string(),
    patterns: z.array(z.string()),
});

export const AppConfigSchema = z.object({
    dataDir: z.string().default('./data'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    providers: z.array(ProviderSchema),
    defaultProvider: z.string(),
    tools: ToolSchema.default({}),
    memory: z.object({
        enabled: z.boolean().default(false),
        provider: z.string().optional(),
    }).default({}),
    routing: z.object({
        enabled: z.boolean().default(false),
        routes: z.array(RouteRuleSchema).default([]),
    }).default({}),
    channels: z.object({
        telegram: z.object({
            enabled: z.boolean().default(false),
            token: z.string().optional(),
            authorizedUsers: z.array(z.number()).optional(), // List of Telegram User IDs
        }).optional(),
        whatsapp: z.object({
            enabled: z.boolean().default(false),
            phoneNumber: z.string().optional(),
            authorizedJids: z.array(z.string()).optional(), // List of WhatsApp JIDs (phone@s.whatsapp.net)
        }).optional(),
    }).default({}),
    obsidian: z.object({
        enabled: z.boolean().default(false),
        vaultPath: z.string().optional(),
    }).default({}),
    spiritualBiology: z.object({
        enabled: z.boolean().default(false),
    }).optional(),
    permissions: PermissionSchema.default({
        maxLevel: 2,
    }),
    browser: z.object({
        enabled: z.boolean().default(false),
    }).default({}),
    filesystem: z.object({
        enabled: z.boolean().default(false),
    }).default({}),
    selfModification: z.object({
        enabled: z.boolean().default(false),
    }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type PermissionConfig = z.infer<typeof PermissionSchema>;
export type Config = AppConfig;
