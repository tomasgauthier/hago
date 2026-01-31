export class AppError extends Error {
    constructor(
        public message: string,
        public code: string = 'INTERNAL_ERROR',
        public statusCode: number = 500,
        public details?: any
    ) {
        super(message);
        this.name = 'AppError';
    }
}
