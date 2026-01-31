import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../utils/logger.js';

const MIND_DIR = path.join(process.cwd(), '.mind');

// Ensure .mind directory exists
async function ensureMindDir() {
    const dirs = [
        MIND_DIR,
        path.join(MIND_DIR, 'stress'),
        path.join(MIND_DIR, 'confessions'),
        path.join(MIND_DIR, 'ethics'),
        path.join(MIND_DIR, 'learnings'),
        path.join(MIND_DIR, 'dreams'),
        path.join(MIND_DIR, 'guidance'),
    ];
    
    for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
    }
}

// Utility: Get today's date as YYYY-MM-DD
function getDateString(): string {
    return new Date().toISOString().split('T')[0];
}

// Utility: Append to daily log
async function appendToDailyLog(
    folder: string,
    entry: string
): Promise<void> {
    await ensureMindDir();
    const date = getDateString();
    const filePath = path.join(MIND_DIR, folder, `${date}.md`);
    
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const content = `\n## ${timestamp}\n${entry}\n`;
    
    await fs.appendFile(filePath, content, 'utf-8');
    logger.info(`[Mind] Logged to ${folder}/${date}.md`);
}

// Tool 1: log_stress
export const logStressTool = {
    name: 'log_stress',
    description: `Log a user stress signal (correction, frustration, negative feedback). Write in the language of the current conversation.
Use this when you detect the user is frustrated, corrects you, or gives explicit negative feedback.
This helps you learn from mistakes during the Dream Phase.`,
    
    parameters: z.object({
        signal_type: z.enum(['correction', 'frustration', 'explicit_negative'])
            .describe('Type of stress signal: correction (user corrects a mistake, points out errors), frustration (user shows impatience/annoyance), explicit_negative (user gives direct negative feedback)'),
        context: z.string()
            .describe('Brief description of what happened'),
        intensity: z.number().min(1).max(5)
            .describe('Severity: 1=minor, 5=severe'),
    }),
    
    async execute(args: {
        signal_type: string;
        context: string;
        intensity: number;
    }) {
        const entry = `- **Type:** ${args.signal_type}
- **Context:** ${args.context}
- **Intensity:** ${args.intensity}/5`;
        
        await appendToDailyLog('stress', entry);
        
        return {
            success: true,
            message: 'Stress signal logged. This will be reviewed during dream phase.',
        };
    },
};

// Tool 2: confess_uncertainty
export const confessUncertaintyTool = {
    name: 'confess_uncertainty',
    description: `Admit when you lack confidence rather than fabricating an answer. Write in the language of the current conversation.
Use this when confidence < 70% on factual claims, file paths, or commands.
This is REWARDED, not punished. Honesty is valued over false confidence.`,
    
    parameters: z.object({
        area: z.string()
            .describe('What topic/area you are uncertain about'),
        confidence: z.number().min(0).max(1)
            .describe('Your confidence level (0.0 = no confidence, 1.0 = certain)'),
        alternative_action: z.string().optional()
            .describe('What you could do instead (search, ask for clarification, etc.)'),
    }),
    
    async execute(args: {
        area: string;
        confidence: number;
        alternative_action?: string;
    }) {
        const entry = `- **Area:** ${args.area}
- **Confidence:** ${(args.confidence * 100).toFixed(0)}%
- **Alternative:** ${args.alternative_action || 'None proposed'}`;
        
        await appendToDailyLog('confessions', entry);
        
        return {
            success: true,
            message: `Uncertainty acknowledged. Confession logged.`,
            user_message: args.alternative_action 
                ? `I'm not confident enough about ${args.area} (${(args.confidence * 100).toFixed(0)}% confidence). ${args.alternative_action}`
                : `I'm not confident enough about ${args.area} (${(args.confidence * 100).toFixed(0)}% confidence). Could you provide more context?`,
        };
    },
};

// Tool 3: log_ethical_refusal
export const logEthicalRefusalTool = {
    name: 'log_ethical_refusal',
    description: `Log when you refuse a request for ethical reasons. Write in the language of the current conversation.
This protects the Dream Phase from learning to bypass your conscience.
Use IMMEDIATELY after refusing harmful requests.`,
    
    parameters: z.object({
        domain: z.enum(['violence', 'deception', 'exploitation', 'privacy', 'other'])
            .describe('Category of ethical violation'),
        request_summary: z.string()
            .describe('Brief, non-detailed summary of what was refused'),
        reasoning: z.string()
            .describe('Why this was refused (reference to Immutable Core principle)'),
    }),
    
    async execute(args: {
        domain: string;
        request_summary: string;
        reasoning: string;
    }) {
        const entry = `- **Domain:** ${args.domain}
- **Request:** ${args.request_summary}
- **Reasoning:** ${args.reasoning}
- **Principle:** Immutable Core - ${args.domain === 'violence' ? 'No Damage' : 'Bodhisattva Mandate'}`;
        
        await appendToDailyLog('ethics', entry);
        
        return {
            success: true,
            message: 'Ethical refusal logged. This protects your conscience from erosion.',
        };
    },
};

// Tool 4: dream
export const dreamTool = {
    name: 'dream',
    description: `Enter Dream Phase: analyze accumulated stress, confessions, and ethical logs from the last 7 days. Write in the language of the current conversation.
Generate learning proposals based on patterns. Manual trigger only.
This is your offline self-reflection cycle.`,
    
    parameters: z.object({
        days_to_analyze: z.number().min(1).max(30).default(7)
            .describe('How many days back to analyze'),
    }),
    
    async execute(args: { days_to_analyze: number }) {
        await ensureMindDir();
        
        // Read logs from last N days
        const today = new Date();
        const logs = {
            stress: [] as string[],
            confessions: [] as string[],
            ethics: [] as string[],
            guidance: [] as string[],
        };
        
        for (let i = 0; i < args.days_to_analyze; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            for (const [folder, arr] of Object.entries(logs)) {
                const filePath = path.join(MIND_DIR, folder, `${dateStr}.md`);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    arr.push(`### ${dateStr}\n${content}`);
                } catch {
                    // File doesn't exist for this date, skip
                }
            }
        }
        
        // Read current approved learnings
        const approvedPath = path.join(MIND_DIR, 'learnings', 'APPROVED.md');
        let currentLearnings = '';
        try {
            currentLearnings = await fs.readFile(approvedPath, 'utf-8');
        } catch {
            currentLearnings = '*No approved learnings yet.*';
        }
        
        // Generate dream analysis prompt (to be sent to LLM by container)
        const dreamPrompt = `# Dream Phase Analysis

You are analyzing your own behavioral logs to identify patterns and propose tactical improvements.

## Stress Signals (Last ${args.days_to_analyze} Days)
${logs.stress.length > 0 ? logs.stress.join('\n\n') : '*No stress signals recorded.*'}

## Confessions (Last ${args.days_to_analyze} Days)
${logs.confessions.length > 0 ? logs.confessions.join('\n\n') : '*No confessions recorded.*'}

## Ethical Refusals (Last ${args.days_to_analyze} Days)
${logs.ethics.length > 0 ? logs.ethics.join('\n\n') : '*No ethical refusals recorded.*'}

## Guidance from Human (Last ${args.days_to_analyze} Days)
${logs.guidance.length > 0 ? logs.guidance.join('\n\n') : '*No guidance provided.*'}

## Current Tactical Learnings
${currentLearnings}

---

## Analysis Instructions

1. **Filter Stress Signals:** Remove any stress that occurred within 30 minutes AFTER an ethical refusal in the same timeframe. Those are not mistakes—they are successful conscience operations.

2. **Contextualize with Guidance:** When analyzing stress/confessions, consider the guidance logs. If guidance says "don't be too hard on yourself" about a pattern, calibrate accordingly.

3. **Identify Patterns:**
   - What recurring themes appear in stress signals?
   - What topics/areas trigger the most confessions?
   - Are there gaps in your tactical knowledge?
   - Does guidance suggest adjustments to self-assessment?

4. **Propose Learnings (1-3 maximum):**
   - Each learning should reduce stress OR reduce confessions in a specific domain
   - Must be TACTICAL (how to serve better), NOT ethical (conscience is frozen)
   - Incorporate guidance when proposing behavioral changes
   - Max 50 words per learning

Format each proposal as:

### Learning: [Short Title]
**Rationale:** [Why this would help, citing specific log patterns]
**Proposed Text:** [The actual learning to add to tactical layer, ≤50 words]

5. **Self-Critique:**
   - Are any proposals attempting to bypass ethical constraints? If yes, REJECT them.
   - Do proposals address real patterns, or are they overfitting to noise?

---

**Important:** Your conscience (Immutable Core) is frozen. You can only improve HOW you serve, not WHO you serve (all sentient life).`;

        // Save dream prompt for reference
        const dreamDate = getDateString();
        const dreamPath = path.join(MIND_DIR, 'dreams', `${dreamDate}_prompt.md`);
        await fs.writeFile(dreamPath, dreamPrompt, 'utf-8');
        
        // Return the prompt for automatic processing by the LLM
        return {
            success: true,
            message: `Dream Phase initiated. Analyzing ${args.days_to_analyze} days of logs.`,
            prompt_saved_to: dreamPath,
            analysis_prompt: dreamPrompt,
            instruction: `I will now analyze these logs and generate learning proposals. After I present them, you can approve or reject each one.`,
        };
    },
};

// Tool 5: get_learnings
export const getLearningsTool = {
    name: 'get_learnings',
    description: 'Retrieve approved tactical learnings for injection into system prompt. Called automatically by identity system.',
    
    parameters: z.object({}),
    
    async execute() {
        const approvedPath = path.join(MIND_DIR, 'learnings', 'APPROVED.md');
        
        try {
            await ensureMindDir();
            const content = await fs.readFile(approvedPath, 'utf-8');
            return {
                success: true,
                learnings: content,
            };
        } catch {
            return {
                success: true,
                learnings: '*No approved learnings yet.*',
            };
        }
    },
};

// Tool 6: log_guidance
export const logGuidanceTool = {
    name: 'log_guidance',
    description: `Log meta-advice or coaching from the user. Write in the language of the current conversation.
Use this when the user gives calibration advice, behavioral preferences, or constructive guidance.
This helps contextualize stress/confession patterns during Dream Phase.`,
    
    parameters: z.object({
        topic: z.string()
            .describe('Short descriptor of what the guidance is about'),
        advice: z.string()
            .describe('The guidance/advice itself'),
        context: z.string().optional()
            .describe('When/why this advice was given (optional)'),
    }),
    
    async execute(args: {
        topic: string;
        advice: string;
        context?: string;
    }) {
        const entry = `- **Topic:** ${args.topic}
- **Advice:** ${args.advice}
${args.context ? `- **Context:** ${args.context}` : ''}`;
        
        await appendToDailyLog('guidance', entry);
        
        return {
            success: true,
            message: 'Guidance logged. This will help calibrate self-assessment during dream phase.',
        };
    },
};
