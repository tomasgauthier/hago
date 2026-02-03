import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage } from './utils/i18n.js';
import { validateTimeSpent, validateDifficultyRating } from './utils/validation.js';
import { QUIZ_CONFIG } from './utils/constants.js';
import { LearningPath, LearningModule, LearningSession, QuizAttempt, QuizQuestion } from './utils/types.js';

/**
 * Tool: learning_complete_module
 *
 * Mark a module as completed and track learning progress.
 * Integrates with Spiritual Biology to log learning difficulty as stress signals.
 */

interface CompleteModuleDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
}

// UI Messages
const messages: Record<string, Record<string, string>> = {
    es: {
        completing: '✅ Completando módulo...',
        moduleNotFound: '❌ Módulo #{id} no encontrado',
        completed: '🎉 ¡Módulo completado!',
        timeSpent: '⏱️  Tiempo dedicado: {min} minutos',
        progress: '📊 Progreso del camino: {percent}% ({completed}/{total} módulos)',
        nextModule: '📖 Siguiente: Módulo {num} - {title}',
        pathCompleted: '🎊 ¡Felicitaciones! Has completado toda la ruta de aprendizaje',
        difficulty: '📝 Dificultad reportada: {rating}/5',
        stressLogged: '💭 Registrado como señal de aprendizaje para mejora continua',
        continueCmd: 'Para continuar: /learning_start_session path_id={pathId}',
        error: '❌ Error al completar módulo: {error}'
    },
    en: {
        completing: '✅ Completing module...',
        moduleNotFound: '❌ Module #{id} not found',
        completed: '🎉 Module completed!',
        timeSpent: '⏱️  Time spent: {min} minutes',
        progress: '📊 Path progress: {percent}% ({completed}/{total} modules)',
        nextModule: '📖 Next: Module {num} - {title}',
        pathCompleted: '🎊 Congratulations! You\'ve completed the entire learning path',
        difficulty: '📝 Difficulty reported: {rating}/5',
        stressLogged: '💭 Logged as learning signal for continuous improvement',
        continueCmd: 'To continue: /learning_start_session path_id={pathId}',
        error: '❌ Error completing module: {error}'
    },
    pt: {
        completing: '✅ Completando módulo...',
        moduleNotFound: '❌ Módulo #{id} não encontrado',
        completed: '🎉 Módulo completado!',
        timeSpent: '⏱️  Tempo gasto: {min} minutos',
        progress: '📊 Progresso do caminho: {percent}% ({completed}/{total} módulos)',
        nextModule: '📖 Próximo: Módulo {num} - {title}',
        pathCompleted: '🎊 Parabéns! Você completou toda a rota de aprendizagem',
        difficulty: '📝 Dificuldade reportada: {rating}/5',
        stressLogged: '💭 Registrado como sinal de aprendizagem para melhoria contínua',
        continueCmd: 'Para continuar: /learning_start_session path_id={pathId}',
        error: '❌ Erro ao completar módulo: {error}'
    }
};


export function createLearningCompleteModuleTool(deps: CompleteModuleDeps): ToolDefinition {
    return {
        name: 'learning_complete_module',
        description: 'Mark a learning module as completed. Track time spent and optional difficulty rating. Integrates with Spiritual Biology for continuous improvement.',
        parameters: z.object({
            module_id: z.number().describe('The ID of the module to mark as completed'),
            time_spent_min: z.number().optional().describe('Optional: Time spent in minutes (for tracking)'),
            difficulty_rating: z.number().min(1).max(5).optional().describe('Optional: How difficult was this module? 1=very easy, 5=very hard'),
            understood: z.boolean().optional().describe('Optional: Did you understand the content?')
        }),

        execute: async (args: any, context?: ToolExecutionContext) => {
            if (!context?.sessionKey) {
                throw new Error('Session context required');
            }

            const { module_id, time_spent_min, difficulty_rating, understood } = args;

            try {
                // Validate inputs
                if (time_spent_min !== undefined) {
                    const timeValidation = validateTimeSpent(time_spent_min);
                    if (!timeValidation.valid) {
                        return formatMessage('en', messages, 'error', { error: timeValidation.error });
                    }
                }

                if (difficulty_rating !== undefined) {
                    const ratingValidation = validateDifficultyRating(difficulty_rating);
                    if (!ratingValidation.valid) {
                        return formatMessage('en', messages, 'error', { error: ratingValidation.error });
                    }
                }

                // Get the module
                const module = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_modules WHERE id = ?'
                ).get(module_id) as LearningModule | undefined;

                if (!module) {
                    return formatMessage('en', messages, 'moduleNotFound', { id: module_id });
                }

                // Get the learning path
                const path = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_paths WHERE id = ?'
                ).get(module.learning_path_id) as LearningPath | undefined;

                if (!path) {
                    return formatMessage('en', messages, 'error', { error: 'Learning path not found' });
                }

                const language = path.language || 'en';

                // Check if module has quiz and if it's been completed
                const quizData: QuizQuestion[] = module.quiz_questions ? JSON.parse(module.quiz_questions) : [];
                if (quizData.length > 0) {
                    // Check quiz attempts
                    const attempts = deps.sessionStore.db.prepare(
                        'SELECT * FROM quiz_attempts WHERE session_key = ? AND module_id = ?'
                    ).all(context.sessionKey, module_id) as QuizAttempt[];

                    const answeredQuestionsSet = new Set(attempts.map(a => a.question_index));
                    // Count unique correct questions (not total correct attempts)
                    const correctQuestionsSet = new Set(
                        attempts.filter(a => a.is_correct).map(a => a.question_index)
                    );
                    const numCorrectQuestions = correctQuestionsSet.size;
                    const passingScore = QUIZ_CONFIG.MIN_PASSING_QUESTIONS(quizData.length);

                    if (answeredQuestionsSet.size < quizData.length) {
                        return `❌ Debes responder todas las preguntas del quiz antes de completar el módulo.\n` +
                            `Preguntas respondidas: ${answeredQuestionsSet.size}/${quizData.length}\n\n` +
                            `Usa: /learning_quiz_answer module_id=${module_id} question_index=N answer="tu respuesta"`;
                    }

                    if (numCorrectQuestions < passingScore) {
                        return `❌ Necesitas al menos ${passingScore}/${quizData.length} respuestas correctas para avanzar.\n` +
                            `Tu puntaje actual: ${numCorrectQuestions}/${quizData.length}\n\n` +
                            `Revisa el contenido e intenta de nuevo con las preguntas incorrectas.`;
                    }
                }

                const now = Date.now();
                const timeSpentSec = (time_spent_min || 5) * 60;

                // Mark module as completed
                deps.sessionStore.db.prepare(`
                    UPDATE learning_modules
                    SET completed = 1, completed_at = ?, time_spent_sec = ?
                    WHERE id = ?
                `).run(now, timeSpentSec, module_id);

                // Update or create user progress
                const existingProgress = deps.sessionStore.db.prepare(
                    'SELECT * FROM user_progress WHERE session_key = ? AND module_id = ?'
                ).get(context.sessionKey, module_id) as any | undefined;

                if (existingProgress) {
                    deps.sessionStore.db.prepare(`
                        UPDATE user_progress
                        SET status = 'completed', completed_at = ?, time_spent_sec = ?, difficulty_rating = ?
                        WHERE session_key = ? AND module_id = ?
                    `).run(now, timeSpentSec, difficulty_rating || null, context.sessionKey, module_id);
                } else {
                    deps.sessionStore.db.prepare(`
                        INSERT INTO user_progress (
                            session_key, module_id, status, started_at, completed_at,
                            time_spent_sec, difficulty_rating
                        ) VALUES (?, ?, 'completed', ?, ?, ?, ?)
                    `).run(context.sessionKey, module_id, now, now, timeSpentSec, difficulty_rating || null);
                }

                // Check if this was difficult and log to Spiritual Biology
                if (difficulty_rating && difficulty_rating >= 4) {
                    deps.mindStore.addLog('stress', {
                        signal_type: 'learning_difficulty',
                        context: `Struggled with module: "${module.title}" in "${path.topic}"`,
                        intensity: difficulty_rating - 2, // Map 4-5 to intensity 2-3
                        metadata: {
                            topic: path.topic,
                            module_number: module.module_number,
                            module_title: module.title,
                            time_spent_sec: timeSpentSec,
                            difficulty_rating
                        }
                    }, context.sessionKey);

                    logger.info(`[Learning] Difficulty logged for module "${module.title}" (rating: ${difficulty_rating})`);
                }

                // Check if understanding was low
                if (understood === false) {
                    deps.mindStore.addLog('confession', {
                        area: `Learning: ${path.topic}`,
                        confidence: 0.3,
                        alternative_action: 'Review module content or try different teaching approach',
                        context: `Did not understand module: "${module.title}"`
                    }, context.sessionKey);
                }

                // Log action to mind
                deps.mindStore.logAction(
                    'learning_complete_module',
                    { module_id, path_id: path.id, difficulty_rating, time_spent_min, module_title: module.title, module_number: module.module_number },
                    context.sessionKey
                );

                // Update learning session
                const session = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_sessions WHERE learning_path_id = ? AND session_key = ? AND ended_at IS NULL'
                ).get(path.id, context.sessionKey) as LearningSession | undefined;

                if (session) {
                    const completedCount = (session.modules_completed || 0) + 1;
                    deps.sessionStore.db.prepare(`
                        UPDATE learning_sessions
                        SET modules_completed = ?
                        WHERE id = ?
                    `).run(completedCount, session.id);
                }

                // Get all modules to calculate progress
                const allModules = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_modules WHERE learning_path_id = ? ORDER BY module_number'
                ).all(path.id) as LearningModule[];

                const completedModules = allModules.filter(m => m.completed);
                const progressPercent = Math.round((completedModules.length / allModules.length) * 100);

                // Build response
                let response = formatMessage(language, messages, 'completing') + '\n\n';
                response += formatMessage(language, messages, 'completed') + '\n';
                response += formatMessage(language, messages, 'timeSpent', { min: time_spent_min || 5 }) + '\n';

                if (difficulty_rating) {
                    response += formatMessage(language, messages, 'difficulty', { rating: difficulty_rating }) + '\n';
                    if (difficulty_rating >= 4) {
                        response += formatMessage(language, messages, 'stressLogged') + '\n';
                    }
                }

                response += '\n' + formatMessage(language, messages, 'progress', {
                    percent: progressPercent,
                    completed: completedModules.length,
                    total: allModules.length
                }) + '\n\n';

                // Check if path is complete
                if (completedModules.length === allModules.length) {
                    // Mark path as completed
                    deps.sessionStore.db.prepare(
                        'UPDATE learning_paths SET status = ?, completed_at = ? WHERE id = ?'
                    ).run('completed', now, path.id);

                    // Mark session as completed
                    if (session) {
                        deps.sessionStore.db.prepare(
                            'UPDATE learning_sessions SET ended_at = ?, pomodoro_completed = 1 WHERE id = ?'
                        ).run(now, session.id);
                    }

                    // Update user learning profile
                    _updateUserProfile(deps.sessionStore, context.sessionKey, allModules, language);

                    response += '🌟 ' + formatMessage(language, messages, 'pathCompleted') + ' 🌟\n';
                } else {
                    // Find next module
                    const nextModule = allModules.find(m => !m.completed);
                    if (nextModule) {
                        response += formatMessage(language, messages, 'nextModule', {
                            num: nextModule.module_number,
                            title: nextModule.title
                        }) + '\n\n';
                        response += formatMessage(language, messages, 'continueCmd', { pathId: path?.id || 0 });
                    }
                }

                return response;

            } catch (error: any) {
                logger.error('Error in learning_complete_module:', error);
                return formatMessage('en', messages, 'error', { error: error.message });
            }
        }
    };
}

/**
 * Update user learning profile with completion data
 */
function _updateUserProfile(sessionStore: SessionStore, sessionKey: string, modules: LearningModule[], language: string): void {
    const totalTime = modules.reduce((sum, m) => sum + (m.time_spent_sec || 0), 0);
    const avgTimePerModule = Math.round(totalTime / modules.length);

    const existingProfile = sessionStore.db.prepare(
        'SELECT * FROM user_learning_profiles WHERE session_key = ?'
    ).get(sessionKey) as any;

    const now = Date.now();

    if (existingProfile) {
        // Calculate new averages
        const newAvgTime = Math.round((existingProfile.avg_module_time_sec + avgTimePerModule) / 2);

        sessionStore.db.prepare(`
            UPDATE user_learning_profiles
            SET avg_module_time_sec = ?, completion_rate = 1.0, last_updated = ?
            WHERE session_key = ?
        `).run(newAvgTime, now, sessionKey);
    } else {
        sessionStore.db.prepare(`
            INSERT INTO user_learning_profiles (
                session_key, avg_module_time_sec, completion_rate,
                preferred_language, last_updated
            ) VALUES (?, ?, 1.0, ?, ?)
        `).run(sessionKey, avgTimePerModule, language, now);
    }
}
