/**
 * Learning System Constants
 *
 * Centralized configuration values to avoid magic numbers throughout the codebase
 */

// Quiz Configuration
export const QUIZ_CONFIG = {
    /** Minimum passing score (percentage) */
    PASSING_SCORE_PERCENT: 0.7,

    /** Minimum score to consider quiz completed successfully */
    MIN_PASSING_QUESTIONS: (totalQuestions: number) => Math.ceil(totalQuestions * QUIZ_CONFIG.PASSING_SCORE_PERCENT)
} as const;

// Language Detection
export const LANGUAGE_DETECTION = {
    /** Minimum pattern matches required for confident language detection */
    MIN_CONFIDENCE_MATCHES: 3,

    /** Default language when detection fails */
    DEFAULT_LANGUAGE: 'en'
} as const;

// Difficulty Inference
export const DIFFICULTY_THRESHOLDS = {
    /** Technical term density threshold for advanced level */
    ADVANCED_THRESHOLD: 0.3,

    /** Technical term density threshold for intermediate level */
    INTERMEDIATE_THRESHOLD: 0.15,

    /** Default difficulty when detection fails */
    DEFAULT_DIFFICULTY: 'intermediate' as const
} as const;

// Learning Path Structure
export const LEARNING_PATH = {
    /** Total duration of a learning path in minutes (Pomodoro session) */
    TOTAL_DURATION_MIN: 25,

    /** Number of modules per learning path */
    MODULES_PER_PATH: 5,

    /** Duration per module in minutes */
    MODULE_DURATION_MIN: 5,

    /** Phase durations */
    PHASE_1_DURATION_MIN: 10,
    PHASE_2_DURATION_MIN: 10,
    PHASE_3_DURATION_MIN: 5
} as const;

// First Principles Content Generation
export const FIRST_PRINCIPLES = {
    /** Minimum number of irreducible principles */
    MIN_PRINCIPLES: 2,

    /** Maximum number of irreducible principles */
    MAX_PRINCIPLES: 3,

    /** Required number of "Why" iterations */
    REQUIRED_WHYS: 5,

    /** Minimum construction steps in reconstruction phase */
    MIN_CONSTRUCTION_STEPS: 1
} as const;

// Progress Tracker
export const PROGRESS_TRACKER = {
    /** Typing indicator refresh interval (milliseconds) */
    TYPING_REFRESH_INTERVAL_MS: 4000,

    /** Typing indicator duration in Telegram (milliseconds) */
    TELEGRAM_TYPING_DURATION_MS: 5000
} as const;

// API Configuration
export const API_CONFIG = {
    /** Perplexity API timeout (milliseconds) */
    PERPLEXITY_TIMEOUT_MS: 30000,

    /** Default Perplexity model */
    DEFAULT_PERPLEXITY_MODEL: 'llama-3.1-sonar-small-128k-online',

    /** Temperature for research queries */
    RESEARCH_TEMPERATURE: 0.2
} as const;

// Validation Limits
export const VALIDATION = {
    /** Maximum answer length for quiz responses */
    MAX_ANSWER_LENGTH: 5000,

    /** Maximum time spent per module (minutes) */
    MAX_MODULE_TIME_MIN: 120,

    /** Minimum time spent per module (minutes) */
    MIN_MODULE_TIME_MIN: 0,

    /** Maximum recent messages to analyze for context */
    MAX_HISTORY_MESSAGES: 50,

    /** Maximum recent actions to analyze for context */
    MAX_RECENT_ACTIONS: 30
} as const;

// Source Quality Levels (for Perplexity research)
export const SOURCE_LEVELS = {
    AXIOMS: 1,              // arxiv.org, Stanford Encyclopedia
    STANDARDS: 2,           // IEEE, ACM, ISO, W3C
    TOP_JOURNALS: 3,        // Nature, Science, Cell
    DOCUMENTATION: 4,       // Official docs (Python, MDN, React)
    REPOSITORIES: 5,        // GitHub, GitLab
    PUBLISHERS: 6,          // Springer, Wiley, JSTOR
    EDUCATIONAL: 7,         // MIT, Stanford, Coursera
    GENERAL: 8              // Other web sources
} as const;

// Learning Titles by Language
export const LEARNING_TITLES = {
    es: 'Primeros Principios',
    en: 'First Principles',
    pt: 'Primeiros Princípios',
    fr: 'Premiers Principes',
    de: 'Erste Prinzipien'
} as const;

// Message Chunking Limits per Platform
export const PLATFORM_MESSAGE_LIMITS = {
    /** Telegram max message length (4096 chars, use 3800 for safety margin with markdown) */
    telegram: 3800,
    /** WhatsApp max message length (practical limit ~4096) */
    whatsapp: 3800,
    /** Discord max message length */
    discord: 1900,
    /** SMS max message length (for concatenated SMS) */
    sms: 1500,
    /** Default fallback limit */
    default: 3800
} as const;

export type PlatformType = keyof typeof PLATFORM_MESSAGE_LIMITS;
