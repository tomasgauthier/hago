/**
 * Validation Utilities
 *
 * Input validation and sanitization for learning tools
 */

import { VALIDATION } from './constants.js';
import { ValidationResult } from './types.js';

/**
 * Validate time spent on a module
 *
 * @param timeSpentMin - Time spent in minutes
 * @returns Validation result
 */
export function validateTimeSpent(timeSpentMin: number): ValidationResult {
    if (typeof timeSpentMin !== 'number' || isNaN(timeSpentMin)) {
        return { valid: false, error: 'Time spent must be a valid number' };
    }

    if (timeSpentMin < VALIDATION.MIN_MODULE_TIME_MIN) {
        return { valid: false, error: `Time spent cannot be negative` };
    }

    if (timeSpentMin > VALIDATION.MAX_MODULE_TIME_MIN) {
        return {
            valid: false,
            error: `Time spent cannot exceed ${VALIDATION.MAX_MODULE_TIME_MIN} minutes`
        };
    }

    return { valid: true };
}

/**
 * Validate difficulty rating
 *
 * @param rating - Difficulty rating (1-5)
 * @returns Validation result
 */
export function validateDifficultyRating(rating: number): ValidationResult {
    if (typeof rating !== 'number' || isNaN(rating)) {
        return { valid: false, error: 'Difficulty rating must be a valid number' };
    }

    if (rating < 1 || rating > 5) {
        return { valid: false, error: 'Difficulty rating must be between 1 and 5' };
    }

    return { valid: true };
}

/**
 * Validate and sanitize quiz answer
 *
 * @param answer - User's answer
 * @returns Validation result with sanitized answer
 */
export function validateQuizAnswer(answer: string): ValidationResult & { sanitized?: string } {
    if (typeof answer !== 'string') {
        return { valid: false, error: 'Answer must be a string' };
    }

    const trimmed = answer.trim();

    if (trimmed.length === 0) {
        return { valid: false, error: 'Answer cannot be empty' };
    }

    if (trimmed.length > VALIDATION.MAX_ANSWER_LENGTH) {
        return {
            valid: false,
            error: `Answer cannot exceed ${VALIDATION.MAX_ANSWER_LENGTH} characters`
        };
    }

    return { valid: true, sanitized: trimmed };
}

/**
 * Validate question index
 *
 * @param index - Question index
 * @param totalQuestions - Total number of questions
 * @returns Validation result
 */
export function validateQuestionIndex(index: number, totalQuestions: number): ValidationResult {
    if (typeof index !== 'number' || isNaN(index)) {
        return { valid: false, error: 'Question index must be a valid number' };
    }

    if (index < 0) {
        return { valid: false, error: 'Question index cannot be negative' };
    }

    if (index >= totalQuestions) {
        return {
            valid: false,
            error: `Question index ${index} is out of range (max: ${totalQuestions - 1})`
        };
    }

    return { valid: true };
}

/**
 * Sanitize user input text
 *
 * @param text - Raw user input
 * @param maxLength - Maximum allowed length
 * @returns Sanitized text
 */
export function sanitizeText(text: string, maxLength?: number): string {
    let sanitized = text.trim();

    if (maxLength && sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
}
