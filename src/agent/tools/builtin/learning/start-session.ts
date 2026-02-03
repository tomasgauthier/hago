import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { ChannelManager } from '../../../../channels/manager.js';
import { convertToTelegramPoll } from './services/quiz-delivery.js';
import { createThread } from '../../../../utils/message-chunker.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage } from './utils/i18n.js';
import { QuizQuestion, LearningPath, LearningModule, LearningSession } from './utils/types.js';

/**
 * Tool: learning_start_session
 *
 * Starts a Pomodoro learning session for a learning path.
 * Loads the first incomplete module and begins tracking time.
 *
 * For Telegram: Sends content first, then creates quiz polls directly.
 */

interface StartSessionDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
    channelManager?: ChannelManager;
}

// UI Messages in multiple languages
const messages: Record<string, Record<string, string>> = {
    es: {
        starting: '🍅 Iniciando sesión Pomodoro de aprendizaje...',
        pathNotFound: '❌ Ruta de aprendizaje #{id} no encontrada',
        pathCompleted: '✅ ¡Esta ruta ya está completa! Progreso: 100%',
        sessionStarted: '📖 Sesión iniciada - Módulo {num}/{total}: {title}',
        timer: '⏱️  Tiempo estimado: {min} minutos',
        readContent: '📖 Lee el contenido del módulo a continuación...',
        quizIntro: '📝 **Quiz** - Responde para demostrar tu comprensión:',
        quizSent: '✅ Quiz enviado ({count} preguntas). Responde las encuestas arriba.',
        openQuestion: '**Pregunta abierta:** {question}\nResponde con: /learning_quiz_answer module_id={moduleId} question_index={idx} answer="tu respuesta"',
        completed: 'Cuando termines el módulo, usa: /learning_complete_module module_id={moduleId}',
        error: '❌ Error al iniciar sesión: {error}'
    },
    en: {
        starting: '🍅 Starting Pomodoro learning session...',
        pathNotFound: '❌ Learning path #{id} not found',
        pathCompleted: '✅ This path is already complete! Progress: 100%',
        sessionStarted: '📖 Session started - Module {num}/{total}: {title}',
        timer: '⏱️  Estimated time: {min} minutes',
        readContent: '📖 Read the module content below...',
        quizIntro: '📝 **Quiz** - Answer to demonstrate your understanding:',
        quizSent: '✅ Quiz sent ({count} questions). Answer the polls above.',
        openQuestion: '**Open question:** {question}\nAnswer with: /learning_quiz_answer module_id={moduleId} question_index={idx} answer="your answer"',
        completed: 'When done with the module, use: /learning_complete_module module_id={moduleId}',
        error: '❌ Error starting session: {error}'
    },
    pt: {
        starting: '🍅 Iniciando sessão Pomodoro de aprendizagem...',
        pathNotFound: '❌ Rota de aprendizagem #{id} não encontrada',
        pathCompleted: '✅ Esta rota já está completa! Progresso: 100%',
        sessionStarted: '📖 Sessão iniciada - Módulo {num}/{total}: {title}',
        timer: '⏱️  Tempo estimado: {min} minutos',
        readContent: '📖 Leia o conteúdo do módulo abaixo...',
        quizIntro: '📝 **Quiz** - Responda para demonstrar sua compreensão:',
        quizSent: '✅ Quiz enviado ({count} perguntas). Responda as enquetes acima.',
        openQuestion: '**Pergunta aberta:** {question}\nResponda com: /learning_quiz_answer module_id={moduleId} question_index={idx} answer="sua resposta"',
        completed: 'Quando terminar o módulo, use: /learning_complete_module module_id={moduleId}',
        error: '❌ Erro ao iniciar sessão: {error}'
    }
};


export function createLearningStartSessionTool(deps: StartSessionDeps): ToolDefinition {
    return {
        name: 'learning_start_session',
        description: 'Start a Pomodoro learning session for a learning path. Sends the module content and quiz directly to the user.',
        parameters: z.object({
            path_id: z.number().describe('The ID of the learning path to start')
        }),

        execute: async (args: any, context?: ToolExecutionContext) => {
            if (!context?.sessionKey) {
                throw new Error('Session context required');
            }

            const { path_id } = args;

            try {
                // Get the learning path
                const path = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_paths WHERE id = ? AND session_key = ?'
                ).get(path_id, context.sessionKey) as LearningPath | undefined;

                if (!path) {
                    const lang = 'en';
                    return formatMessage(lang, messages, 'pathNotFound', { id: path_id });
                }

                const language = path.language || 'en';

                // Check if already completed
                if (path.status === 'completed') {
                    return formatMessage(language, messages, 'pathCompleted');
                }

                // Get all modules for this path
                const modules = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_modules WHERE learning_path_id = ? ORDER BY module_number'
                ).all(path_id) as LearningModule[];

                // Find first incomplete module
                let currentModule = modules.find(m => !m.completed);
                if (!currentModule) {
                    currentModule = modules[0];
                }

                // Create or update learning session
                const now = Date.now();
                const existingSession = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_sessions WHERE learning_path_id = ? AND session_key = ? AND ended_at IS NULL'
                ).get(path_id, context.sessionKey) as LearningSession | undefined;

                if (!existingSession) {
                    deps.sessionStore.db.prepare(`
                        INSERT INTO learning_sessions (
                            session_key, learning_path_id, started_at
                        ) VALUES (?, ?, ?)
                    `).run(context.sessionKey, path_id, now);
                }

                // Update path status to in_progress
                deps.sessionStore.db.prepare(
                    'UPDATE learning_paths SET status = ? WHERE id = ?'
                ).run('in_progress', path_id);

                // Log action to mind
                deps.mindStore.logAction(
                    'learning_start_session',
                    { path_id, module_id: currentModule.id, topic: path.topic, module_number: currentModule.module_number },
                    context.sessionKey
                );

                // Determine channel type
                const channelId = context.sessionKey.split(':')[0];
                const isTelegram = channelId === 'telegram';

                // Get channel for direct messaging
                const channel = deps.channelManager?.getChannel(channelId);

                // Build and send module content
                let contentMessage = formatMessage(language, messages, 'sessionStarted', {
                    num: currentModule.module_number,
                    total: modules.length,
                    title: currentModule.title
                }) + '\n';
                contentMessage += formatMessage(language, messages, 'timer', { min: currentModule.estimated_time_min }) + '\n\n';
                contentMessage += '━'.repeat(30) + '\n\n';
                contentMessage += `**${currentModule.title}**\n\n`;
                contentMessage += currentModule.content + '\n\n';
                contentMessage += '━'.repeat(30);

                // Send content directly via channel (chunked for long content)
                if (channel && isTelegram) {
                    const chunks = createThread(contentMessage, { platform: 'telegram' });
                    for (const chunk of chunks) {
                        await channel.sendMessage({ sessionKey: context.sessionKey, text: chunk });
                        // Small delay between chunks to ensure order
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }

                // Parse quiz questions
                const quizData: QuizQuestion[] = currentModule.quiz_questions
                    ? JSON.parse(currentModule.quiz_questions)
                    : [];

                let pollCount = 0;
                const openQuestions: { question: string; index: number }[] = [];

                // Create quiz polls directly for Telegram
                if (isTelegram && channel && quizData.length > 0) {
                    // Send quiz intro
                    await channel.sendMessage({
                        sessionKey: context.sessionKey,
                        text: formatMessage(language, messages, 'quizIntro')
                    });
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Create each poll
                    for (let idx = 0; idx < quizData.length; idx++) {
                        const q = quizData[idx];
                        const pollConfig = convertToTelegramPoll(q);

                        if (pollConfig) {
                            try {
                                // Create poll directly
                                const pollMessage: any = {
                                    sessionKey: context.sessionKey,
                                    text: pollConfig.question,
                                    type: 'poll',
                                    pollOptions: pollConfig.options,
                                    pollType: 'quiz',
                                    correctOptionId: pollConfig.correctOptionId,
                                    explanation: pollConfig.explanation?.substring(0, 200)
                                };

                                const sentResult = await channel.sendMessage(pollMessage) as any;

                                // Store poll metadata
                                const realPollId = sentResult?.poll_id || `poll_${Date.now()}_${currentModule.id}_${idx}`;
                                deps.sessionStore.db.prepare(`
                                    INSERT OR REPLACE INTO poll_metadata (poll_id, session_key, module_id, question_index, created_at)
                                    VALUES (?, ?, ?, ?, ?)
                                `).run(realPollId, context.sessionKey, currentModule.id, idx, Date.now());

                                pollCount++;
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } catch (pollError: any) {
                                logger.error(`Failed to create poll ${idx}: ${pollError.message}`);
                                // Fall back to open question if poll fails
                                openQuestions.push({ question: q.question, index: idx });
                            }
                        } else {
                            // Open-ended question
                            openQuestions.push({ question: q.question, index: idx });
                        }
                    }

                    // Send any open questions
                    for (const oq of openQuestions) {
                        const openMsg = formatMessage(language, messages, 'openQuestion', {
                            question: oq.question,
                            moduleId: currentModule.id,
                            idx: oq.index
                        });
                        await channel.sendMessage({ sessionKey: context.sessionKey, text: openMsg });
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }

                // Build summary response for the agent
                let response = formatMessage(language, messages, 'starting') + '\n\n';
                response += formatMessage(language, messages, 'sessionStarted', {
                    num: currentModule.module_number,
                    total: modules.length,
                    title: currentModule.title
                }) + '\n\n';

                if (isTelegram && channel) {
                    response += `✅ Contenido del módulo enviado directamente al usuario.\n`;
                    if (pollCount > 0) {
                        response += formatMessage(language, messages, 'quizSent', { count: pollCount }) + '\n';
                    }
                    if (openQuestions.length > 0) {
                        response += `📝 ${openQuestions.length} pregunta(s) abierta(s) enviada(s).\n`;
                    }
                } else {
                    // For non-Telegram channels, include content in response
                    response += contentMessage + '\n\n';

                    if (quizData.length > 0) {
                        response += formatMessage(language, messages, 'quizIntro') + '\n\n';
                        quizData.forEach((q, idx) => {
                            response += `**Pregunta ${idx + 1}:** ${q.question}\n`;
                            if (q.options) {
                                q.options.forEach((opt, i) => {
                                    response += `  ${String.fromCharCode(97 + i)}) ${opt}\n`;
                                });
                            }
                            response += '\n';
                        });
                    }
                }

                response += '\n' + formatMessage(language, messages, 'completed', { moduleId: currentModule.id });

                return response;

            } catch (error: any) {
                logger.error('Error in learning_start_session:', error);
                const lang = 'en';
                return formatMessage(lang, messages, 'error', { error: error.message });
            }
        }
    };
}
