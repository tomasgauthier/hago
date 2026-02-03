/**
 * Type Definitions for Learning System
 *
 * Centralized TypeScript types to replace 'any' types throughout the codebase
 */

/**
 * Learning path database record
 */
export interface LearningPath {
    id: number;
    session_key: string;
    title: string;
    topic: string;
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    language: string;
    total_duration_min: number;
    research_data: string; // JSON stringified
    status: 'ready' | 'in_progress' | 'completed';
    created_at: number;
    completed_at?: number;
}

/**
 * Learning module database record
 */
export interface LearningModule {
    id: number;
    learning_path_id: number;
    module_number: number;
    title: string;
    content: string;
    estimated_time_min: number;
    quiz_questions: string | null; // JSON stringified QuizQuestion[]
    completed: boolean;
    completed_at?: number;
    time_spent_sec?: number;
}

/**
 * Learning session database record
 */
export interface LearningSession {
    id: number;
    session_key: string;
    learning_path_id: number;
    started_at: number;
    ended_at?: number;
    pomodoro_completed: boolean;
    modules_completed: number;
}

/**
 * Quiz attempt database record
 */
export interface QuizAttempt {
    id: number;
    session_key: string;
    module_id: number;
    question_index: number;
    user_answer: string;
    is_correct: boolean;
    attempted_at: number;
}

/**
 * User progress database record
 */
export interface UserProgress {
    id: number;
    session_key: string;
    module_id: number;
    status: 'not_started' | 'in_progress' | 'completed';
    started_at?: number;
    completed_at?: number;
    time_spent_sec?: number;
    difficulty_rating?: number;
}

/**
 * Quiz question structure
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

/**
 * Module extraction result
 */
export interface ExtractedModule {
    title: string;
    content: string;
    quiz?: QuizQuestion[];
}

/**
 * Quiz performance metrics
 */
export interface QuizPerformance {
    score: number;
    correctQuestions: number;
    totalQuestions: number;
    attempts: number;
}

/**
 * Perplexity API response
 */
export interface PerplexityResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
    citations?: Array<{
        title?: string;
        url?: string;
    }>;
}

/**
 * Research source
 */
export interface ResearchSource {
    title: string;
    url: string;
    type: string;
    level: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
}
