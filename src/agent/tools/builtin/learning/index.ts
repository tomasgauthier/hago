/**
 * Learning System Tools
 *
 * AI-powered micro-learning with First Principles methodology
 * - Multi-language support (Spanish, English, Portuguese, etc.)
 * - Adaptive difficulty based on conversation history
 * - Personalized analogies from tool usage patterns
 * - Spiritual Biology integration for teaching improvements
 */

import { ToolDefinition } from '../../registry.js';
import { createLearningCreatePathTool } from './create-path.js';
import { createLearningStartSessionTool } from './start-session.js';
import { createLearningCompleteModuleTool } from './complete-module.js';
import { createLearningGetProgressTool } from './get-progress.js';
import { createLearningQuizAnswerTool } from './quiz-answer.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { ChatProvider } from '../../../providers/types.js';
import { AppConfig } from '../../../../config/schema.js';
import { ChannelManager } from '../../../../channels/manager.js';

interface LearningToolsDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
    provider: ChatProvider;
    model: string;
    config: AppConfig;
    webSearchTool?: (query: string) => Promise<any>;
    channelManager?: ChannelManager;
}

export function registerLearningTools(deps: LearningToolsDeps): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    if (!deps.config.learning?.enabled) {
        return tools;
    }

    // Tool 1: Create Learning Path (with multi-language support)
    tools.push(createLearningCreatePathTool({
        sessionStore: deps.sessionStore,
        mindStore: deps.mindStore,
        provider: deps.provider,
        model: deps.model,
        config: {
            perplexityApiKey: deps.config.learning.perplexityApiKey,
            defaultLanguage: deps.config.learning.defaultLanguage || 'en',
            autoDetectLanguage: deps.config.learning.autoDetectLanguage !== false,
            adaptiveDifficulty: deps.config.learning.adaptiveDifficulty !== false
        },
        webSearchTool: deps.webSearchTool,
        channelManager: deps.channelManager
    }));

    // Tool 2: Start Learning Session (Pomodoro timer)
    tools.push(createLearningStartSessionTool({
        sessionStore: deps.sessionStore,
        mindStore: deps.mindStore
    }));

    // Tool 3: Complete Module (with Spiritual Biology integration)
    tools.push(createLearningCompleteModuleTool({
        sessionStore: deps.sessionStore,
        mindStore: deps.mindStore
    }));

    // Tool 4: Get Progress (view all learning paths)
    tools.push(createLearningGetProgressTool({
        sessionStore: deps.sessionStore
    }));

    // Tool 5: Quiz Answer (submit quiz answers with feedback)
    if (deps.config.learning.quizEnabled !== false) {
        tools.push(createLearningQuizAnswerTool({
            sessionStore: deps.sessionStore,
            mindStore: deps.mindStore
        }));
    }

    // TODO: Future enhancements
    // - learning_export_path (Phase 3)

    return tools;
}
