import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage } from './utils/i18n.js';
import { validateQuizAnswer } from './utils/validation.js';
import { QuizAttempt, QuizPerformance, LearningPath, LearningModule, QuizQuestion } from './utils/types.js';

/**
 * Tool: learning_quiz_answer
 *
 * Submit an answer to a quiz question and get immediate feedback.
 * Tracks performance and logs incorrect answers to Spiritual Biology.
 */

interface QuizAnswerDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
}

// UI Messages
const messages: Record<string, Record<string, string>> = {
    es: {
        correct: '✅ ¡Correcto!',
        incorrect: '❌ Respuesta incorrecta',
        explanation: '📝 Explicación: {explanation}',
        correctAnswer: 'Respuesta correcta: {answer}',
        performance: '📊 Tu desempeño: {score}% ({correct}/{total} correctas)',
        tryAgain: '💡 Intenta de nuevo o continúa con la siguiente pregunta',
        completed: '🎉 ¡Quiz completado! Puntuación final: {score}%',
        error: '❌ Error: {error}'
    },
    en: {
        correct: '✅ Correct!',
        incorrect: '❌ Incorrect answer',
        explanation: '📝 Explanation: {explanation}',
        correctAnswer: 'Correct answer: {answer}',
        performance: '📊 Your performance: {score}% ({correct}/{total} correct)',
        tryAgain: '💡 Try again or continue with the next question',
        completed: '🎉 Quiz completed! Final score: {score}%',
        error: '❌ Error: {error}'
    },
    pt: {
        correct: '✅ Correto!',
        incorrect: '❌ Resposta incorreta',
        explanation: '📝 Explicação: {explanation}',
        correctAnswer: 'Resposta correta: {answer}',
        performance: '📊 Seu desempenho: {score}% ({correct}/{total} corretas)',
        tryAgain: '💡 Tente novamente ou continue com a próxima pergunta',
        completed: '🎉 Quiz concluído! Pontuação final: {score}%',
        error: '❌ Erro: {error}'
    }
};


/**
 * Check if the answer is correct
 * Handles bilingual answers like "Verdadero / True" and "Falso / False"
 */
function _checkAnswer(question: QuizQuestion, userAnswer: string): boolean {
    const correctAnswer = question.correctAnswer;

    if (!correctAnswer) {
        // For open-ended questions, cannot auto-check
        return true;
    }

    // Normalize answers for comparison
    const normalize = (s: string) => s.toLowerCase().trim();
    const userNorm = normalize(userAnswer);
    const correctNorm = normalize(correctAnswer);

    if (question.type === 'multiple_choice') {
        // Direct match
        if (userNorm === correctNorm) return true;

        // Check if user answer contains the correct answer
        if (userNorm.includes(correctNorm)) return true;

        // Check if options array exists and user selected the correct option
        if (question.options && question.correctOptionId !== undefined) {
            const correctOption = normalize(question.options[question.correctOptionId]);
            if (userNorm === correctOption || userNorm.includes(correctOption)) {
                return true;
            }
        }

        return false;
    } else if (question.type === 'true_false') {
        // Handle bilingual true/false answers
        const isTrue = correctNorm === 'true' || correctNorm.includes('true') ||
                      correctNorm === 'verdadero' || correctNorm.includes('verdadero') ||
                      correctNorm === 'verdade';

        const userSaysTrue = userNorm.includes('true') ||
                           userNorm.includes('verdadero') ||
                           userNorm.includes('verdade') ||
                           userNorm === 'yes' ||
                           userNorm === 'sí' ||
                           userNorm === 'si' ||
                           userNorm === 'sim';

        const userSaysFalse = userNorm.includes('false') ||
                            userNorm.includes('falso') ||
                            userNorm === 'no' ||
                            userNorm === 'não';

        if (isTrue && userSaysTrue) return true;
        if (!isTrue && userSaysFalse) return true;

        return false;
    } else {
        // For other types, do fuzzy matching
        return userNorm === correctNorm || userNorm.includes(correctNorm);
    }
}

/**
 * Calculate quiz performance for a module
 * Counts unique questions answered correctly, not total attempts
 */
function _getQuizPerformance(deps: QuizAnswerDeps, sessionKey: string, moduleId: number, totalQuestions: number): QuizPerformance {
    const attempts = deps.sessionStore.db.prepare(
        'SELECT * FROM quiz_attempts WHERE session_key = ? AND module_id = ?'
    ).all(sessionKey, moduleId) as QuizAttempt[];

    if (attempts.length === 0) {
        return { score: 0, correctQuestions: 0, totalQuestions, attempts: 0 };
    }

    // Count unique questions that were answered correctly
    const correctQuestionsSet = new Set(
        attempts.filter((a) => a.is_correct).map((a) => a.question_index)
    );
    const correctQuestions = correctQuestionsSet.size;

    // Score is based on unique questions answered correctly
    const score = totalQuestions > 0 ? correctQuestions / totalQuestions : 0;

    return {
        score,
        correctQuestions,
        totalQuestions,
        attempts: attempts.length
    };
}

/**
 * Update user learning profile with quiz performance
 */
function _updateQuizPerformance(deps: QuizAnswerDeps, sessionKey: string): void {
    // Get all quiz attempts for this user
    const allAttempts = deps.sessionStore.db.prepare(
        'SELECT * FROM quiz_attempts WHERE session_key = ?'
    ).all(sessionKey) as QuizAttempt[];

    if (allAttempts.length === 0) return;

    // Calculate overall performance across all modules
    // Group by module_id to calculate per-module scores, then average
    const moduleAttempts = new Map<number, QuizAttempt[]>();
    for (const attempt of allAttempts) {
        if (!moduleAttempts.has(attempt.module_id)) {
            moduleAttempts.set(attempt.module_id, []);
        }
        moduleAttempts.get(attempt.module_id)!.push(attempt);
    }

    let totalScore = 0;
    let moduleCount = 0;

    for (const [moduleId, attempts] of moduleAttempts) {
        const correctQuestionsSet = new Set(
            attempts.filter(a => a.is_correct).map(a => a.question_index)
        );
        const uniqueQuestionsSet = new Set(
            attempts.map(a => a.question_index)
        );

        if (uniqueQuestionsSet.size > 0) {
            totalScore += correctQuestionsSet.size / uniqueQuestionsSet.size;
            moduleCount++;
        }
    }

    const avgScore = moduleCount > 0 ? totalScore / moduleCount : 0;

    // Update or create profile
    const existing = deps.sessionStore.db.prepare(
        'SELECT * FROM user_learning_profiles WHERE session_key = ?'
    ).get(sessionKey) as any;

    if (existing) {
        deps.sessionStore.db.prepare(
            'UPDATE user_learning_profiles SET quiz_avg_score = ?, last_updated = ? WHERE session_key = ?'
        ).run(avgScore, Date.now(), sessionKey);
    } else {
        deps.sessionStore.db.prepare(`
            INSERT INTO user_learning_profiles (
                session_key, quiz_avg_score, last_updated
            ) VALUES (?, ?, ?)
        `).run(sessionKey, avgScore, Date.now());
    }
}

export function createLearningQuizAnswerTool(deps: QuizAnswerDeps): ToolDefinition {
    return {
        name: 'learning_quiz_answer',
        description: 'Submit an answer to a quiz question and receive immediate feedback. Tracks your performance and helps identify areas for improvement.',
        parameters: z.object({
            module_id: z.number().describe('The module ID containing the quiz'),
            question_index: z.number().describe('The index of the question (0-based)'),
            answer: z.string().describe('Your answer to the question')
        }),

        execute: async (args: any, context?: ToolExecutionContext) => {
            if (!context?.sessionKey) {
                throw new Error('Session context required');
            }

            const { module_id, question_index, answer } = args;

            try {
                // Validate answer
                const validation = validateQuizAnswer(answer);
                if (!validation.valid) {
                    return formatMessage('en', messages, 'error', { error: validation.error });
                }
                const sanitizedAnswer = validation.sanitized!;

                // Get module and quiz data
                const module = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_modules WHERE id = ?'
                ).get(module_id) as LearningModule | undefined;

                if (!module) {
                    return formatMessage('en', messages, 'error', { error: 'Module not found' });
                }

                // Get learning path for language
                const path = deps.sessionStore.db.prepare(
                    'SELECT * FROM learning_paths WHERE id = ?'
                ).get(module.learning_path_id) as LearningPath | undefined;

                const language = path?.language || 'en';

                // Parse quiz questions
                const quizQuestions: QuizQuestion[] = module.quiz_questions ? JSON.parse(module.quiz_questions) : [];

                if (question_index < 0 || question_index >= quizQuestions.length) {
                    return formatMessage(language, messages, 'error', { error: 'Question index out of range' });
                }

                const question = quizQuestions[question_index];
                const isCorrect = _checkAnswer(question, sanitizedAnswer);

                // Record attempt
                deps.sessionStore.db.prepare(`
                    INSERT INTO quiz_attempts (
                        session_key, module_id, question_index, user_answer, is_correct, attempted_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `).run(
                    context.sessionKey,
                    module_id,
                    question_index,
                    sanitizedAnswer,
                    isCorrect ? 1 : 0,
                    Date.now()
                );

                // Update user learning profile
                _updateQuizPerformance(deps, context.sessionKey);

                // Build response
                let response = '';

                if (isCorrect) {
                    response = formatMessage(language, messages, 'correct') + '\n\n';
                } else {
                    response = formatMessage(language, messages, 'incorrect') + '\n\n';

                    // Log incorrect answer as confession to mind
                    deps.mindStore.addLog('confession', {
                        category: 'learning_quiz_incorrect',
                        question: question.question,
                        user_answer: sanitizedAnswer,
                        correct_answer: question.correctAnswer,
                        module_title: module.title,
                        alternative_action: 'Review module content and retry quiz',
                        context: `Incorrect quiz answer for: "${module.title}"`
                    }, context.sessionKey);

                    // Show correct answer
                    if (question.correctAnswer) {
                        response += formatMessage(language, messages, 'correctAnswer', {
                            answer: question.correctAnswer
                        }) + '\n\n';
                    }
                }

                // Show explanation if available
                if (question.explanation) {
                    response += formatMessage(language, messages, 'explanation', {
                        explanation: question.explanation
                    }) + '\n\n';
                }

                // Calculate overall performance
                const performance = _getQuizPerformance(deps, context.sessionKey, module_id, quizQuestions.length);
                response += formatMessage(language, messages, 'performance', {
                    score: Math.round(performance.score * 100),
                    correct: performance.correctQuestions,
                    total: performance.totalQuestions
                });

                // Check if all questions have been attempted
                const answeredQuestionsSet = new Set(
                    deps.sessionStore.db.prepare(
                        'SELECT DISTINCT question_index FROM quiz_attempts WHERE session_key = ? AND module_id = ?'
                    ).all(context.sessionKey, module_id).map((row: any) => row.question_index)
                );

                if (answeredQuestionsSet.size === quizQuestions.length) {
                    response += '\n\n' + formatMessage(language, messages, 'completed', {
                        score: Math.round(performance.score * 100)
                    });
                }

                // Log action to mind
                deps.mindStore.logAction(
                    'learning_quiz_answer',
                    {
                        module_id,
                        question_index,
                        is_correct: isCorrect,
                        score: performance.score
                    },
                    context.sessionKey
                );

                return response;

            } catch (error: any) {
                logger.error(`Error in learning_quiz_answer: ${error.message}`);
                return formatMessage('en', messages, 'error', { error: error.message });
            }
        }
    };
}
