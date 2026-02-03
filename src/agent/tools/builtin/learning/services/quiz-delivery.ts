/**
 * Quiz Delivery Service
 *
 * Provides channel-aware quiz delivery using native platform features:
 * - Telegram: Native quiz polls with correct answer marking
 * - WhatsApp: Inline keyboards or text-based
 * - Other: Text-based fallback
 */

export interface QuizQuestion {
    question: string;
    type: 'open' | 'multiple_choice' | 'true_false';
    options?: string[];
    correctAnswer?: string;
    correctOptionId?: number;
    explanation?: string;
    points: number;
}

export interface TelegramPollConfig {
    question: string;
    options: string[];
    correctOptionId: number;
    explanation?: string;
}

/**
 * Convert quiz question to Telegram quiz poll format
 */
export function convertToTelegramPoll(question: QuizQuestion): TelegramPollConfig | null {
    // Only convert multiple choice and true/false to polls
    if (question.type === 'open') {
        return null; // Open questions stay text-based
    }

    if (question.type === 'true_false') {
        return {
            question: question.question,
            options: ['Verdadero / True', 'Falso / False'],
            correctOptionId: question.correctAnswer?.toLowerCase().includes('true') ||
                           question.correctAnswer?.toLowerCase().includes('verdadero') ? 0 : 1,
            explanation: question.explanation
        };
    }

    if (question.type === 'multiple_choice' && question.options && question.options.length >= 2) {
        // Find correct option index
        let correctIdx = 0;
        if (question.correctAnswer) {
            const normalizedAnswer = question.correctAnswer.toLowerCase().trim();
            correctIdx = question.options.findIndex(opt =>
                opt.toLowerCase().trim().includes(normalizedAnswer) ||
                normalizedAnswer.includes(opt.toLowerCase().trim())
            );
            if (correctIdx === -1) correctIdx = 0;
        }

        return {
            question: question.question,
            options: question.options,
            correctOptionId: correctIdx,
            explanation: question.explanation
        };
    }

    return null;
}

/**
 * Generate instructions for creating quiz based on channel
 */
export function getQuizInstructions(
    channelType: 'telegram' | 'whatsapp' | 'unknown',
    moduleId: number,
    questions: QuizQuestion[],
    language: string = 'en'
): string {
    const messages: Record<string, any> = {
        es: {
            title: '📝 Quiz (obligatorio para continuar)',
            instruction: 'Responde estas preguntas para demostrar tu comprensión:',
            telegramPoll: 'Voy a enviarte un quiz interactivo para cada pregunta...',
            textBased: 'Para responder, usa:',
            command: '/learning_quiz_answer module_id={moduleId} question_index={idx} answer="tu respuesta"'
        },
        en: {
            title: '📝 Quiz (mandatory to continue)',
            instruction: 'Answer these questions to demonstrate your understanding:',
            telegramPoll: 'I\'ll send you an interactive quiz for each question...',
            textBased: 'To answer, use:',
            command: '/learning_quiz_answer module_id={moduleId} question_index={idx} answer="your answer"'
        }
    };

    const msg = messages[language] || messages.en;
    let instructions = `\n**${msg.title}**\n\n${msg.instruction}\n\n`;

    if (channelType === 'telegram') {
        // Count how many can be polls vs text
        const pollQuestions = questions.filter(q => q.type !== 'open');
        const textQuestions = questions.filter(q => q.type === 'open');

        if (pollQuestions.length > 0) {
            instructions += `${msg.telegramPoll}\n\n`;

            // Suggest agent to create polls
            instructions += `[Agent: Use telegram_create_poll tool for multiple choice questions]\n\n`;
        }

        if (textQuestions.length > 0) {
            instructions += `**Preguntas abiertas:**\n\n`;
            textQuestions.forEach((q, idx) => {
                const qIdx = questions.indexOf(q);
                instructions += `**${qIdx + 1}.** ${q.question}\n\n`;
            });
            instructions += `\n${msg.textBased}\n`;
            instructions += msg.command.replace('{moduleId}', String(moduleId)).replace('{idx}', 'N') + '\n\n';
        }
    } else {
        // WhatsApp or other: text-based only
        questions.forEach((q, idx) => {
            instructions += `**Pregunta ${idx + 1}:**\n${q.question}\n\n`;
            if (q.options) {
                q.options.forEach((opt, i) => {
                    instructions += `${String.fromCharCode(97 + i)}) ${opt}\n`;
                });
                instructions += '\n';
            }
        });

        instructions += `\n${msg.textBased}\n`;
        instructions += msg.command.replace('{moduleId}', String(moduleId)).replace('{idx}', 'N');
    }

    return instructions;
}

/**
 * Create inline keyboard for simple yes/no or multiple choice
 */
export function createInlineKeyboard(question: QuizQuestion, moduleId: number, questionIndex: number) {
    if (question.type === 'true_false') {
        return {
            keyboard: [
                [
                    { text: '✅ Verdadero / True', callback_data: `quiz_${moduleId}_${questionIndex}_true` },
                    { text: '❌ Falso / False', callback_data: `quiz_${moduleId}_${questionIndex}_false` }
                ]
            ]
        };
    }

    if (question.type === 'multiple_choice' && question.options && question.options.length <= 4) {
        const keyboard = question.options.map((opt, idx) => [{
            text: `${String.fromCharCode(65 + idx)}. ${opt.substring(0, 30)}`,
            callback_data: `quiz_${moduleId}_${questionIndex}_${idx}`
        }]);

        return { keyboard };
    }

    return null;
}
