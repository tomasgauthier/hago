import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { SessionStore } from '../../../../sessions/store.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage, createProgressBar, formatTimeAgo } from './utils/i18n.js';
import { LearningPath, LearningModule } from './utils/types.js';

/**
 * Tool: learning_get_progress
 *
 * View learning progress across all paths or a specific path.
 * Shows completion status, time spent, and next steps.
 */

interface GetProgressDeps {
    sessionStore: SessionStore;
}

// UI Messages
const messages: Record<string, Record<string, any>> = {
    es: {
        title: '📊 Tu Progreso de Aprendizaje',
        noPaths: '📚 Aún no has creado ninguna ruta de aprendizaje.',
        suggestion: '💡 Prueba: "Enséñame sobre [tema]" para comenzar',
        pathTitle: '**{title}**',
        progress: 'Progreso: {bar} {percent}% ({completed}/{total} módulos)',
        timeSpent: '⏱️  Tiempo dedicado: {min} minutos',
        lastActivity: '📅 Última actividad: {time}',
        status: {
            ready: '🆕 Listo para comenzar',
            in_progress: '📖 En progreso',
            completed: '✅ Completado'
        },
        startCmd: 'Comenzar: /learning_start_session path_id={id}',
        continueCmd: 'Continuar: /learning_start_session path_id={id}',
        summary: '\n📈 **Resumen Total:**',
        totalPaths: '• Rutas totales: {total}',
        completedPaths: '• Completadas: {completed}',
        inProgress: '• En progreso: {inProgress}',
        totalTime: '• Tiempo total: {hours}h {mins}m',
        error: '❌ Error al obtener progreso: {error}'
    },
    en: {
        title: '📊 Your Learning Progress',
        noPaths: '📚 You haven\'t created any learning paths yet.',
        suggestion: '💡 Try: "Teach me about [topic]" to get started',
        pathTitle: '**{title}**',
        progress: 'Progress: {bar} {percent}% ({completed}/{total} modules)',
        timeSpent: '⏱️  Time spent: {min} minutes',
        lastActivity: '📅 Last activity: {time}',
        status: {
            ready: '🆕 Ready to start',
            in_progress: '📖 In progress',
            completed: '✅ Completed'
        },
        startCmd: 'Start: /learning_start_session path_id={id}',
        continueCmd: 'Continue: /learning_start_session path_id={id}',
        summary: '\n📈 **Total Summary:**',
        totalPaths: '• Total paths: {total}',
        completedPaths: '• Completed: {completed}',
        inProgress: '• In progress: {inProgress}',
        totalTime: '• Total time: {hours}h {mins}m',
        error: '❌ Error getting progress: {error}'
    },
    pt: {
        title: '📊 Seu Progresso de Aprendizagem',
        noPaths: '📚 Você ainda não criou nenhuma rota de aprendizagem.',
        suggestion: '💡 Tente: "Me ensine sobre [tema]" para começar',
        pathTitle: '**{title}**',
        progress: 'Progresso: {bar} {percent}% ({completed}/{total} módulos)',
        timeSpent: '⏱️  Tempo gasto: {min} minutos',
        lastActivity: '📅 Última atividade: {time}',
        status: {
            ready: '🆕 Pronto para começar',
            in_progress: '📖 Em progresso',
            completed: '✅ Completado'
        },
        startCmd: 'Começar: /learning_start_session path_id={id}',
        continueCmd: 'Continuar: /learning_start_session path_id={id}',
        summary: '\n📈 **Resumo Total:**',
        totalPaths: '• Rotas totais: {total}',
        completedPaths: '• Completadas: {completed}',
        inProgress: '• Em progresso: {inProgress}',
        totalTime: '• Tempo total: {hours}h {mins}m',
        error: '❌ Erro ao obter progresso: {error}'
    }
};


export function createLearningGetProgressTool(deps: GetProgressDeps): ToolDefinition {
    return {
        name: 'learning_get_progress',
        description: 'View your learning progress across all paths or a specific path. Shows completion status, time spent, and what to do next.',
        parameters: z.object({
            path_id: z.number().optional().describe('Optional: View progress for a specific path ID. Omit to see all paths.')
        }),

        execute: async (args: any, context?: ToolExecutionContext) => {
            if (!context?.sessionKey) {
                throw new Error('Session context required');
            }

            const { path_id } = args;

            try {
                // Get user's learning paths
                const pathQuery = path_id
                    ? 'SELECT * FROM learning_paths WHERE id = ? AND session_key = ?'
                    : 'SELECT * FROM learning_paths WHERE session_key = ? ORDER BY created_at DESC';

                const pathParams = path_id ? [path_id, context.sessionKey] : [context.sessionKey];
                const paths = path_id
                    ? [deps.sessionStore.db.prepare(pathQuery).get(...pathParams)]
                    : deps.sessionStore.db.prepare(pathQuery).all(...pathParams);

                const validPaths = (Array.isArray(paths) ? paths : [paths]).filter(Boolean) as LearningPath[];

                if (validPaths.length === 0) {
                    const lang = 'en'; // Could detect from profile
                    let response = formatMessage(lang, messages, 'title') + '\n\n';
                    response += formatMessage(lang, messages, 'noPaths') + '\n';
                    response += formatMessage(lang, messages, 'suggestion');
                    return response;
                }

                // Use language from first path
                const language = validPaths[0].language || 'en';

                // Optimize: Get all modules for all paths in a single query if not viewing single path
                let modulesByPath: Map<number, LearningModule[]>;
                if (!path_id && validPaths.length > 1) {
                    const pathIds = validPaths.map(p => p.id);
                    const placeholders = pathIds.map(() => '?').join(',');
                    const allModules = deps.sessionStore.db.prepare(
                        `SELECT * FROM learning_modules WHERE learning_path_id IN (${placeholders}) ORDER BY learning_path_id, module_number`
                    ).all(...pathIds) as LearningModule[];

                    // Group by path_id
                    modulesByPath = new Map();
                    for (const module of allModules) {
                        if (!modulesByPath.has(module.learning_path_id)) {
                            modulesByPath.set(module.learning_path_id, []);
                        }
                        modulesByPath.get(module.learning_path_id)!.push(module);
                    }
                } else {
                    // Single path - query individually
                    modulesByPath = new Map();
                }

                // Build response
                let response = formatMessage(language, messages, 'title') + '\n\n';

                let totalTimeSpent = 0;
                let completedCount = 0;
                let inProgressCount = 0;

                for (const path of validPaths) {
                    // Get modules for this path (from cache or query)
                    let modules: LearningModule[];
                    if (modulesByPath.has(path.id)) {
                        modules = modulesByPath.get(path.id)!;
                    } else {
                        modules = deps.sessionStore.db.prepare(
                            'SELECT * FROM learning_modules WHERE learning_path_id = ? ORDER BY module_number'
                        ).all(path.id) as LearningModule[];
                    }

                    const completedModules = modules.filter(m => m.completed);
                    const progressPercent = Math.round((completedModules.length / modules.length) * 100);
                    const progressBar = createProgressBar(progressPercent);

                    const pathTimeSpent = modules.reduce((sum, m) => sum + (m.time_spent_sec || 0), 0);
                    totalTimeSpent += pathTimeSpent;

                    if (path.status === 'completed') completedCount++;
                    if (path.status === 'in_progress') inProgressCount++;

                    // Path header
                    response += formatMessage(language, messages, 'pathTitle', { title: path.title }) + '\n';
                    response += formatMessage(language, messages, `status.${path.status}`) + '\n';
                    response += formatMessage(language, messages, 'progress', {
                        bar: progressBar,
                        percent: progressPercent,
                        completed: completedModules.length,
                        total: modules.length
                    }) + '\n';

                    if (pathTimeSpent > 0) {
                        response += formatMessage(language, messages, 'timeSpent', {
                            min: Math.round(pathTimeSpent / 60)
                        }) + '\n';
                    }

                    // Last activity
                    const lastActivity = path.completed_at || modules.filter(m => m.completed_at)
                        .sort((a, b) => (b.completed_at || 0) - (a.completed_at || 0))[0]?.completed_at || path.created_at;

                    response += formatMessage(language, messages, 'lastActivity', {
                        time: formatTimeAgo(lastActivity, language)
                    }) + '\n';

                    // Action button
                    if (path.status === 'ready') {
                        response += formatMessage(language, messages, 'startCmd', { id: path.id }) + '\n';
                    } else if (path.status === 'in_progress') {
                        response += formatMessage(language, messages, 'continueCmd', { id: path.id }) + '\n';
                    }

                    response += '\n';
                }

                // Summary (only if viewing all paths)
                if (!path_id && validPaths.length > 1) {
                    const totalHours = Math.floor(totalTimeSpent / 3600);
                    const totalMins = Math.floor((totalTimeSpent % 3600) / 60);

                    response += formatMessage(language, messages, 'summary') + '\n';
                    response += formatMessage(language, messages, 'totalPaths', { total: validPaths.length }) + '\n';
                    response += formatMessage(language, messages, 'completedPaths', { completed: completedCount }) + '\n';
                    response += formatMessage(language, messages, 'inProgress', { inProgress: inProgressCount }) + '\n';
                    response += formatMessage(language, messages, 'totalTime', { hours: totalHours, mins: totalMins });
                }

                return response;

            } catch (error: any) {
                logger.error('Error in learning_get_progress:', error);
                return formatMessage('en', messages, 'error', { error: error.message });
            }
        }
    };
}
