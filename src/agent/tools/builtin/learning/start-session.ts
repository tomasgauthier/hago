import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { convertToTelegramPoll } from './services/quiz-delivery.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage } from './utils/i18n.js';
import { QuizQuestion, LearningPath, LearningModule, LearningSession } from './utils/types.js';

/**
 * Tool: learning_start_session
 *
 * Starts a Pomodoro learning session for a learning path.
 * Loads the first incomplete module and begins tracking time.
 */

interface StartSessionDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
}

// UI Messages in multiple languages
const messages: Record<string, Record<string, string>> = {
    es: {
        starting: '🍅 Iniciando sesión Pomodoro de aprendizaje...',
        pathNotFound: '❌ Ruta de aprendizaje #{id} no encontrada',
        pathCompleted: '✅ ¡Esta ruta ya está completa! Progreso: 100%',
        sessionStarted: '📖 Sesión iniciada - Módulo {num}/5',
        timer: '⏱️  Tiempo estimado: {min} minutos',
        ready: '¿Listo? ¡Comencemos!',
        completed: 'Cuando termines, usa: /learning_complete_module module_id={moduleId}',
        error: '❌ Error al iniciar sesión: {error}'
    },
    en: {
        starting: '🍅 Starting Pomodoro learning session...',
        pathNotFound: '❌ Learning path #{id} not found',
        pathCompleted: '✅ This path is already complete! Progress: 100%',
        sessionStarted: '📖 Session started - Module {num}/5',
        timer: '⏱️  Estimated time: {min} minutes',
        ready: 'Ready? Let\'s begin!',
        completed: 'When done, use: /learning_complete_module module_id={moduleId}',
        error: '❌ Error starting session: {error}'
    },
    pt: {
        starting: '🍅 Iniciando sessão Pomodoro de aprendizagem...',
        pathNotFound: '❌ Rota de aprendizagem #{id} não encontrada',
        pathCompleted: '✅ Esta rota já está completa! Progresso: 100%',
        sessionStarted: '📖 Sessão iniciada - Módulo {num}/5',
        timer: '⏱️  Tempo estimado: {min} minutos',
        ready: 'Pronto? Vamos começar!',
        completed: 'Quando terminar, use: /learning_complete_module module_id={moduleId}',
        error: '❌ Erro ao iniciar sessão: {error}'
    }
};


export function createLearningStartSessionTool(deps: StartSessionDeps): ToolDefinition {
    return {
        name: 'learning_start_session',
        description: 'Start a Pomodoro learning session for a learning path. Loads the first incomplete module and begins time tracking.',
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
                    const lang = 'en'; // Default, could be detected
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
                    currentModule = modules[0]; // Start from beginning if all marked complete
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

                // Build response
                let response = formatMessage(language, messages, 'starting') + '\n\n';
                response += formatMessage(language, messages, 'sessionStarted', { num: currentModule.module_number }) + '\n';
                response += formatMessage(language, messages, 'timer', { min: currentModule.estimated_time_min }) + '\n\n';

                // CRITICAL: Module content MUST be shown to user
                response += `\n📖 **CONTENIDO DEL MÓDULO (Lee esto primero):**\n\n`;
                response += '─'.repeat(50) + '\n\n';
                response += `# ${currentModule.title}\n\n`;
                response += currentModule.content + '\n\n';
                response += '─'.repeat(50) + '\n\n';

                // Add quiz section
                const quizData: QuizQuestion[] = currentModule.quiz_questions ? JSON.parse(currentModule.quiz_questions) : [];
                if (quizData.length > 0) {
                    const channelId = context.sessionKey.split(':')[0];

                    // Language-specific labels
                    const quizLabels = {
                        es: {
                            quizTitle: '📝 Quiz (obligatorio para continuar)',
                            question: 'Pregunta',
                            openQuestion: 'abierta',
                            toAnswer: 'Para responder',
                            answer: 'tu respuesta',
                            answerThese: 'Responde estas preguntas para demostrar tu comprensión'
                        },
                        en: {
                            quizTitle: '📝 Quiz (mandatory to continue)',
                            question: 'Question',
                            openQuestion: 'open-ended',
                            toAnswer: 'To answer',
                            answer: 'your answer',
                            answerThese: 'Answer these questions to demonstrate your understanding'
                        },
                        pt: {
                            quizTitle: '📝 Quiz (obrigatório para continuar)',
                            question: 'Pergunta',
                            openQuestion: 'aberta',
                            toAnswer: 'Para responder',
                            answer: 'sua resposta',
                            answerThese: 'Responda estas perguntas para demonstrar sua compreensão'
                        }
                    };

                    const labels = quizLabels[language as keyof typeof quizLabels] || quizLabels.en;

                    if (channelId === 'telegram') {
                        // For Telegram: instruct agent to create native quiz polls
                        response += `\n**${labels.quizTitle}**\n\n`;
                        response += `**[IMPORTANT: The user has already received the module content above. Now create quiz polls]**\n\n`;
                        response += `Use telegram_create_poll tool for each question below:\n\n`;

                        quizData.forEach((q, idx) => {
                            const pollConfig = convertToTelegramPoll(q);
                            if (pollConfig) {
                                response += `**${labels.question} ${idx + 1}:**\n`;
                                response += `Call: telegram_create_poll(\n`;
                                response += `  question="${pollConfig.question}",\n`;
                                response += `  options=[`;
                                pollConfig.options.forEach((opt, i) => {
                                    response += `"${opt}"`;
                                    if (i < pollConfig.options.length - 1) response += ', ';
                                });
                                response += `],\n`;
                                response += `  poll_type="quiz",\n`;
                                response += `  correct_option_id=${pollConfig.correctOptionId}`;
                                if (pollConfig.explanation) {
                                    response += `,\n  explanation="${pollConfig.explanation.substring(0, 150)}"`;
                                }
                                response += `,\n  module_id=${currentModule.id},\n  question_index=${idx}`;
                                response += `\n)\n\n`;
                            } else {
                                // Open-ended question - keep as text
                                response += `**${labels.question} ${idx + 1} (${labels.openQuestion}):**\n${q.question}\n`;
                                response += `${labels.toAnswer}: /learning_quiz_answer module_id=${currentModule.id} question_index=${idx} answer="${labels.answer}"\n\n`;
                            }
                        });

                        response += `\nNote: Quiz answers are tracked automatically when user selects poll options.\n`;
                    } else {
                        // For other channels: show text-based quiz
                        response += `\n**${labels.quizTitle}**\n\n`;
                        response += `**Ahora que leíste el contenido, responde:**\n\n`;

                        quizData.forEach((q, idx) => {
                            response += `**${labels.question} ${idx + 1}:**\n${q.question}\n\n`;
                            if (q.options) {
                                q.options.forEach((opt, i) => {
                                    response += `${String.fromCharCode(97 + i)}) ${opt}\n`;
                                });
                                response += '\n';
                            }
                        });

                        response += `\n${labels.toAnswer}:\n`;
                        response += `/learning_quiz_answer module_id=${currentModule.id} question_index=0 answer="${labels.answer}"\n\n`;
                    }
                } else {
                    response += formatMessage(language, messages, 'ready') + '\n';
                    response += formatMessage(language, messages, 'completed', { moduleId: currentModule.id });
                }

                return response;

            } catch (error: any) {
                logger.error('Error in learning_start_session:', error);
                const lang = 'en';
                return formatMessage(lang, messages, 'error', { error: error.message });
            }
        }
    };
}
