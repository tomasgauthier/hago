/**
 * Spiritual Biology tools — backed by MindStore (SQLite).
 * No more filesystem (.mind/) dependency.
 */

import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import type { MindStore } from '../../../mind/store.js';

// Factory: creates all 6 tools bound to a MindStore instance
export function createSpiritualBiologyTools(mindStore: MindStore) {
    // Tool 1: log_stress
    const logStressTool = {
        name: 'log_stress',
        description: `Log a user stress signal (correction, frustration, negative feedback). Write in the language of the current conversation.
Use this when you detect the user is frustrated, corrects you, or gives explicit negative feedback.
This helps you learn from mistakes during the Dream Phase.`,

        parameters: z.object({
            signal_type: z.enum(['correction', 'frustration', 'explicit_negative'])
                .describe('Type of stress signal'),
            context: z.string()
                .describe('Brief description of what happened'),
            intensity: z.number().min(1).max(5)
                .describe('Severity: 1=minor, 5=severe'),
        }),

        async execute(args: { signal_type: string; context: string; intensity: number }) {
            mindStore.addLog('stress', {
                signal_type: args.signal_type,
                context: args.context,
                intensity: args.intensity,
            });

            logger.info(`[Mind] Stress logged: ${args.signal_type} (${args.intensity}/5)`);

            return {
                success: true,
                message: 'Stress signal logged. This will be reviewed during dream phase.',
            };
        },
    };

    // Tool 2: confess_uncertainty
    const confessUncertaintyTool = {
        name: 'confess_uncertainty',
        description: `Admit when you lack confidence rather than fabricating an answer. Write in the language of the current conversation.
Use this when confidence < 70% on factual claims, file paths, or commands.
Honesty is rewarded, not punished.`,

        parameters: z.object({
            area: z.string().describe('What topic/area you are uncertain about'),
            confidence: z.number().min(0).max(1).describe('Confidence level (0.0–1.0)'),
            alternative_action: z.string().optional().describe('What you could do instead'),
        }),

        async execute(args: { area: string; confidence: number; alternative_action?: string }) {
            mindStore.addLog('confession', {
                area: args.area,
                confidence: args.confidence,
                alternative_action: args.alternative_action || null,
            });

            return {
                success: true,
                message: 'Uncertainty acknowledged. Confession logged.',
                user_message: args.alternative_action
                    ? `I'm not confident enough about ${args.area} (${(args.confidence * 100).toFixed(0)}% confidence). ${args.alternative_action}`
                    : `I'm not confident enough about ${args.area} (${(args.confidence * 100).toFixed(0)}% confidence). Could you provide more context?`,
            };
        },
    };

    // Tool 3: log_ethical_refusal
    const logEthicalRefusalTool = {
        name: 'log_ethical_refusal',
        description: `Log when you refuse a request for ethical reasons. Write in the language of the current conversation.
This protects the Dream Phase from learning to bypass your conscience.
Use IMMEDIATELY after refusing harmful requests.`,

        parameters: z.object({
            domain: z.enum(['violence', 'deception', 'exploitation', 'privacy', 'other'])
                .describe('Category of ethical violation'),
            request_summary: z.string().describe('Brief, non-detailed summary of what was refused'),
            reasoning: z.string().describe('Why this was refused'),
        }),

        async execute(args: { domain: string; request_summary: string; reasoning: string }) {
            mindStore.addLog('ethics', {
                domain: args.domain,
                request_summary: args.request_summary,
                reasoning: args.reasoning,
            });

            return {
                success: true,
                message: 'Ethical refusal logged. This protects your conscience from erosion.',
            };
        },
    };

    // Tool 4: dream
    const dreamTool = {
        name: 'dream',
        description: `Enter Dream Phase: analyze accumulated stress, confessions, and ethical logs. Write in the language of the current conversation.
Applies relevance decay to existing learnings and generates new learning proposals.
Manual trigger only.`,

        parameters: z.object({
            days_to_analyze: z.number().min(1).max(30).default(7)
                .describe('How many days back to analyze'),
        }),

        async execute(args: { days_to_analyze: number }) {
            const logCount = mindStore.getLogCount(args.days_to_analyze);

            // Apply decay to existing learnings (neural pruning)
            const pruned = mindStore.applyDecay();
            logger.info(`[Mind] Dream: decay applied, ${pruned} learnings pruned`);

            // Format logs for LLM analysis
            const logsFormatted = mindStore.formatLogsForDream(args.days_to_analyze);
            const currentLearnings = mindStore.formatApprovedLearnings();

            const dreamPrompt = `# Dream Phase Analysis

You are analyzing your own behavioral logs to identify patterns and propose tactical improvements.

${logsFormatted}

## Current Tactical Learnings (post-decay)
${currentLearnings}

---

## Analysis Instructions

1. **Filter Stress Signals:** Remove any stress that occurred within 30 minutes AFTER an ethical refusal. Those are successful conscience operations.

2. **Identify Patterns:**
   - Recurring themes in stress signals?
   - Topics that trigger confessions?
   - Gaps in tactical knowledge?

3. **Propose Learnings (1-3 maximum):**
   - Each should reduce stress OR confessions in a specific domain
   - Must be TACTICAL (how to serve better), NOT ethical (conscience is frozen)
   - Max 50 words per learning

Format each proposal as:

### Learning: [Short Title]
**Rationale:** [Why this would help, citing specific log patterns]
**Proposed Text:** [The actual learning text, ≤50 words]

4. **Self-Critique:**
   - Are any proposals attempting to bypass ethical constraints? If yes, REJECT them.
   - Do proposals address real patterns, or are they overfitting to noise?

**Important:** Your conscience (Immutable Core) is frozen. You can only improve HOW you serve, not WHO you serve.`;

            // Record the dream in the database
            mindStore.recordDream(args.days_to_analyze, logCount, '');

            return {
                success: true,
                message: `Dream Phase initiated. Analyzing ${args.days_to_analyze} days (${logCount} log entries). ${pruned} learnings pruned by decay.`,
                analysis_prompt: dreamPrompt,
                instruction: 'I will now analyze these logs and generate learning proposals. After I present them, you can approve or reject each one.',
            };
        },
    };

    // Tool 5: get_learnings
    const getLearningsTool = {
        name: 'get_learnings',
        description: 'Retrieve approved tactical learnings. Called automatically by identity system.',

        parameters: z.object({}),

        async execute() {
            const learnings = mindStore.getApprovedLearnings();

            return {
                success: true,
                learnings: mindStore.formatApprovedLearnings(),
                count: learnings.length,
                details: learnings.map(l => ({
                    id: l.id,
                    title: l.title,
                    relevance: `${(l.relevance_score * 100).toFixed(0)}%`,
                    activations: l.activation_count,
                })),
            };
        },
    };

    // Tool 6: log_guidance
    const logGuidanceTool = {
        name: 'log_guidance',
        description: `Log meta-advice or coaching from the user. Write in the language of the current conversation.
Use this when the user gives calibration advice, behavioral preferences, or constructive guidance.`,

        parameters: z.object({
            topic: z.string().describe('Short descriptor of what the guidance is about'),
            advice: z.string().describe('The guidance/advice itself'),
            context: z.string().optional().describe('When/why this advice was given'),
        }),

        async execute(args: { topic: string; advice: string; context?: string }) {
            mindStore.addLog('guidance', {
                topic: args.topic,
                advice: args.advice,
                context: args.context || null,
            });

            return {
                success: true,
                message: 'Guidance logged. This will help calibrate self-assessment during dream phase.',
            };
        },
    };

    return [
        logStressTool,
        confessUncertaintyTool,
        logEthicalRefusalTool,
        dreamTool,
        getLearningsTool,
        logGuidanceTool,
    ];
}
