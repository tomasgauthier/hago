import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage } from './utils/i18n.js';
import { validateQuizAnswer } from './utils/validation.js';
import { QuizPerformance, QuizQuestion } from './utils/types.js';

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
        // Direct match (exact)
        if (userNorm === correctNorm) return true;

        // Check if user selected by option letter (a, b, c, d) or number (1, 2, 3, 4)
        if (question.options && question.correctOptionId !== undefined) {
            const correctOption = normalize(question.options[question.correctOptionId]);

            // Exact match with full option text
            if (userNorm === correctOption) return true;

            // User answered with letter (a, b, c, d)
            const letterIndex = userNorm.charCodeAt(0) - 'a'.charCodeAt(0);
            if (userNorm.length === 1 && letterIndex >= 0 && letterIndex < question.options.length) {
                return letterIndex === question.correctOptionId;
            }

            // User answered with number (1, 2, 3, 4)
            const numIndex = parseInt(userNorm, 10) - 1;
            if (!isNaN(numIndex) && numIndex >= 0 && numIndex < question.options.length) {
                return numIndex === question.correctOptionId;
            }

            // Check if user's answer starts with correct option (handles "A. answer text")
            const optionPrefixes = ['a', 'b', 'c', 'd', '1', '2', '3', '4'];
            for (let i = 0; i < optionPrefixes.length && i < question.options.length; i++) {
                const prefix = optionPrefixes[i];
                // Match patterns like "a.", "a)", "a:", "a " at start
                const prefixPattern = new RegExp(`^${prefix}[.):\\s]`);
                if (prefixPattern.test(userNorm)) {
                    const mappedIndex = i < 4 ? i : i - 4; // 'a'-'d' = 0-3, '1'-'4' = 0-3
                    return mappedIndex === question.correctOptionId;
                }
            }

            // Strict word boundary match to avoid false positives
            // Only match if the correct option appears as complete words
            const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(correctNorm)}\\b`, 'i');
            if (wordBoundaryRegex.test(userAnswer)) {
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
        // For open-ended types, use word boundary matching instead of substring
        if (userNorm === correctNorm) return true;

        // Check with word boundaries to avoid false positives
        const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(correctNorm)}\\b`, 'i');
        return wordBoundaryRegex.test(userAnswer);
    }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate quiz performance for a module
 * Counts unique questions answered correctly, not total attempts
 */
function _getQuizPerformance(deps: QuizAnswerDeps, sessionKey: string, moduleId: number, totalQuestions: number): QuizPerformance {
    const attempts = deps.sessionStore.getQuizAttempts(sessionKey, moduleId);

    if (attempts.length === 0) {
        return { score: 0, correctQuestions: 0, totalQuestions, attempts: 0 };
    }

    // Count unique questions that were answered correctly
    const correctQuestionsSet = new Set(
        attempts.filter((a) => a.isCorrect).map((a) => a.questionIndex)
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
    const allAttempts = deps.sessionStore.getAllQuizAttempts(sessionKey);

    if (allAttempts.length === 0) return;

    // Calculate overall performance across all modules
    // Group by moduleId to calculate per-module scores, then average
    const moduleAttempts = new Map<number, typeof allAttempts>();
    for (const attempt of allAttempts) {
        if (!moduleAttempts.has(attempt.moduleId)) {
            moduleAttempts.set(attempt.moduleId, []);
        }
        moduleAttempts.get(attempt.moduleId)!.push(attempt);
    }

    let totalScore = 0;
    let moduleCount = 0;

    for (const [, attempts] of moduleAttempts) {
        const correctQuestionsSet = new Set(
            attempts.filter(a => a.isCorrect).map(a => a.questionIndex)
        );
        const uniqueQuestionsSet = new Set(
            attempts.map(a => a.questionIndex)
        );

        if (uniqueQuestionsSet.size > 0) {
            totalScore += correctQuestionsSet.size / uniqueQuestionsSet.size;
            moduleCount++;
        }
    }

    const avgScore = moduleCount > 0 ? totalScore / moduleCount : 0;

    // Update or create profile using repository method
    deps.sessionStore.upsertLearningProfile(sessionKey, { quizAvgScore: avgScore });
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

                // Get module and quiz data using repository methods
                const module = deps.sessionStore.getLearningModule(module_id);

                if (!module) {
                    return formatMessage('en', messages, 'error', { error: 'Module not found' });
                }

                // Get learning path for language
                const path = deps.sessionStore.getLearningPath(module.learningPathId);

                const language = path?.language || 'en';

                // Parse quiz questions
                const quizQuestions: QuizQuestion[] = module.quizQuestions ? JSON.parse(module.quizQuestions) : [];

                if (question_index < 0 || question_index >= quizQuestions.length) {
                    return formatMessage(language, messages, 'error', { error: 'Question index out of range' });
                }

                const question = quizQuestions[question_index];
                const isCorrect = _checkAnswer(question, sanitizedAnswer);

                // Record attempt using repository method
                deps.sessionStore.addQuizAttempt({
                    sessionKey: context.sessionKey,
                    moduleId: module_id,
                    questionIndex: question_index,
                    userAnswer: sanitizedAnswer,
                    isCorrect,
                    attemptedAt: Date.now()
                });

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

                // Check if all questions have been attempted using repository method
                const answeredQuestions = deps.sessionStore.getAnsweredQuestionIndices(context.sessionKey, module_id);

                if (answeredQuestions.length === quizQuestions.length) {
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
