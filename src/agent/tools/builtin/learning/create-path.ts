import { z } from 'zod';
import { ToolDefinition, ToolExecutionContext } from '../../registry.js';
import { FirstPrinciplesService } from './services/first-principles.js';
import { PerplexityResearchService } from './services/perplexity-research.js';
import { UserAdaptationService } from './services/user-adaptation.js';
import { ProgressTracker } from './services/progress-tracker.js';
import { SessionStore } from '../../../../sessions/store.js';
import { MindStore } from '../../../../mind/store.js';
import { ChatProvider } from '../../../providers/types.js';
import { ChannelManager } from '../../../../channels/manager.js';
import { EnhancedTelegramChannel } from '../../../../channels/telegram/enhanced-adapter.js';
import { logger } from '../../../../utils/logger.js';
import { formatMessage, getLearningTitle } from './utils/i18n.js';
import { LEARNING_PATH } from './utils/constants.js';
import { ExtractedModule, QuizQuestion } from './utils/types.js';

/**
 * Tool: learning_create_path
 *
 * Generates a personalized 25-minute learning path using First Principles methodology.
 * Adapts to user's language, difficulty level, and preferred analogy domains.
 */

interface CreatePathDeps {
    sessionStore: SessionStore;
    mindStore: MindStore;
    provider: ChatProvider;
    model: string;
    config: {
        perplexityApiKey?: string;
        defaultLanguage: string;
        autoDetectLanguage: boolean;
        adaptiveDifficulty: boolean;
    };
    webSearchTool?: (query: string) => Promise<any>;
    channelManager?: ChannelManager;
}

// UI Messages in multiple languages
const messages: Record<string, Record<string, string>> = {
    es: {
        creating: '📚 Creando ruta de aprendizaje personalizada sobre "{topic}"...',
        analyzing: '[Analizando tu historial de conversación...]',
        detectedLanguage: 'Idioma detectado: {language}',
        detectedLevel: 'Nivel detectado: {level}',
        analogies: 'Analogías preferidas: {domains}',
        researching: '🔍 Investigando fuentes académicas...',
        generating: '⚙️  Generando contenido educativo...',
        ready: '✅ Ruta de aprendizaje lista: "{title}"',
        structure: '📖 Estructura:',
        module: '• Módulo {num}: {title} ({min} min)',
        total: 'Total: {duration} minutos (1 sesión Pomodoro)',
        start: '¿Listo para comenzar? Di "Empezar ruta de {topic}" o usa:',
        command: '/learning_start_session path_id={id}',
        error: '❌ Error al crear ruta de aprendizaje: {error}'
    },
    en: {
        creating: '📚 Creating personalized learning path on "{topic}"...',
        analyzing: '[Analyzing your conversation history...]',
        detectedLanguage: 'Language detected: {language}',
        detectedLevel: 'Detected level: {level}',
        analogies: 'Preferred analogies: {domains}',
        researching: '🔍 Researching academic sources...',
        generating: '⚙️  Generating educational content...',
        ready: '✅ Learning path ready: "{title}"',
        structure: '📖 Structure:',
        module: '• Module {num}: {title} ({min} min)',
        total: 'Total: {duration} minutes (1 Pomodoro session)',
        start: 'Ready to start? Say "Start {topic} path" or use:',
        command: '/learning_start_session path_id={id}',
        error: '❌ Error creating learning path: {error}'
    },
    pt: {
        creating: '📚 Criando rota de aprendizagem personalizada sobre "{topic}"...',
        analyzing: '[Analisando seu histórico de conversação...]',
        detectedLanguage: 'Idioma detectado: {language}',
        detectedLevel: 'Nível detectado: {level}',
        analogies: 'Analogias preferidas: {domains}',
        researching: '🔍 Pesquisando fontes acadêmicas...',
        generating: '⚙️  Gerando conteúdo educacional...',
        ready: '✅ Rota de aprendizagem pronta: "{title}"',
        structure: '📖 Estrutura:',
        module: '• Módulo {num}: {title} ({min} min)',
        total: 'Total: {duration} minutos (1 sessão Pomodoro)',
        start: 'Pronto para começar? Diga "Iniciar rota de {topic}" ou use:',
        command: '/learning_start_session path_id={id}',
        error: '❌ Erro ao criar rota de aprendizagem: {error}'
    }
};


export function createLearningCreatePathTool(deps: CreatePathDeps): ToolDefinition {
    const adaptationService = new UserAdaptationService(
        deps.sessionStore,
        deps.mindStore,
        {
            defaultLanguage: deps.config.defaultLanguage,
            autoDetectLanguage: deps.config.autoDetectLanguage,
            adaptiveDifficulty: deps.config.adaptiveDifficulty
        }
    );

    const researchService = new PerplexityResearchService(
        { apiKey: deps.config.perplexityApiKey },
        deps.webSearchTool
    );

    const firstPrinciplesService = new FirstPrinciplesService(deps.provider, deps.model);

    return {
        name: 'learning_create_path',
        description: 'Create a personalized 25-minute learning path on any topic using First Principles methodology. Automatically adapts to your language, knowledge level, and learning preferences.',
        parameters: z.object({
            topic: z.string().describe('The topic to learn about (e.g., "Machine Learning", "Computación Cuántica")'),
            difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional()
                .describe('Optional: Override automatic difficulty detection'),
            language: z.string().optional()
                .describe('Optional: ISO 639-1 language code (e.g., "es", "en", "pt"). Auto-detected if omitted.'),
            customize: z.object({
                analogy_domain: z.string().optional()
                    .describe('Optional: Preferred domain for analogies (e.g., "cooking", "music")')
            }).optional().describe('Optional customization preferences')
        }),

        execute: async (args: any, context?: ToolExecutionContext) => {
            if (!context?.sessionId || !context?.sessionKey) {
                throw new Error('Session context required for learning_create_path');
            }

            const { topic, difficulty: overrideDifficulty, language: overrideLanguage, customize } = args;

            // Create progress tracker for real-time updates
            let progressTracker: ProgressTracker | null = null;
            if (deps.channelManager) {
                const channelId = context.sessionKey.split(':')[0];
                const channel = deps.channelManager.getChannel(channelId);

                if (channel && channelId === 'telegram') {
                    const telegramChannel = channel as EnhancedTelegramChannel;
                    progressTracker = new ProgressTracker({
                        sessionKey: context.sessionKey,
                        channelId,
                        sendMessage: async (sk, text) => {
                            await channel.sendMessage({ sessionKey: sk, text });
                        },
                        sendChatAction: async (sk, action) => {
                            await telegramChannel.sendChatAction(sk, action as any);
                        },
                        editLastMessage: async (sk, text) => {
                            const lastMsgId = telegramChannel.getLastMessageId(sk);
                            if (lastMsgId) {
                                await telegramChannel.sendMessage({
                                    sessionKey: sk,
                                    text,
                                    editMessageId: lastMsgId
                                } as any);
                            }
                        }
                    });
                }
            }

            try {
                // Start typing indicator
                if (progressTracker) {
                    progressTracker.startTyping();
                }

                // Step 1: Get user adaptation context
                const adaptContext = await adaptationService.getAdaptationContext(
                    context.sessionKey,
                    context.sessionId
                );

                const language = overrideLanguage || adaptContext.language;
                const difficulty = overrideDifficulty || adaptContext.difficulty;
                const analogyDomains = customize?.analogy_domain
                    ? [customize.analogy_domain, ...adaptContext.analogyDomains]
                    : adaptContext.analogyDomains;

                // Send initial progress update
                if (progressTracker) {
                    let statusMsg = formatMessage(language, messages, 'creating', { topic }) + '\n\n';
                    statusMsg += formatMessage(language, messages, 'analyzing') + '\n';
                    statusMsg += formatMessage(language, messages, 'detectedLanguage', {
                        language: language.toUpperCase()
                    }) + '\n';
                    statusMsg += formatMessage(language, messages, 'detectedLevel', {
                        level: difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
                    }) + '\n';
                    if (analogyDomains.length > 0) {
                        statusMsg += formatMessage(language, messages, 'analogies', {
                            domains: analogyDomains.join(', ')
                        }) + '\n';
                    }
                    await progressTracker.updateProgress(statusMsg);
                }

                // Step 2: Research the topic
                if (progressTracker) {
                    await progressTracker.step('🔍', formatMessage(language, messages, 'researching').replace('🔍 ', ''));
                }
                const researchData = await researchService.research(topic, language);

                // Step 3: Generate learning path
                if (progressTracker) {
                    await progressTracker.step('⚙️', formatMessage(language, messages, 'generating').replace('⚙️  ', ''));
                }
                const learningPath = await firstPrinciplesService.generateCompleteLearningPath(
                    topic,
                    researchData,
                    language
                );

                // Step 4: Store in database
                const now = Date.now();
                const learningMethodologyTitle = getLearningTitle(language);
                const pathResult = deps.sessionStore.db.prepare(`
                    INSERT INTO learning_paths (
                        session_key, title, topic, difficulty, language,
                        total_duration_min, research_data, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    context.sessionKey,
                    `${topic}: ${learningMethodologyTitle}`,
                    topic,
                    difficulty,
                    language,
                    LEARNING_PATH.TOTAL_DURATION_MIN,
                    JSON.stringify(researchData),
                    'ready',
                    now
                );

                const pathId = pathResult.lastInsertRowid as number;

                // Step 5: Create modules from the generated content
                const modules = _extractModulesFromPath(learningPath);

                if (!modules || modules.length === 0) {
                    throw new Error('Failed to extract modules from learning path');
                }

                for (let i = 0; i < modules.length; i++) {
                    deps.sessionStore.db.prepare(`
                        INSERT INTO learning_modules (
                            learning_path_id, module_number, title, content,
                            estimated_time_min, quiz_questions
                        ) VALUES (?, ?, ?, ?, ?, ?)
                    `).run(
                        pathId,
                        i + 1,
                        modules[i].title,
                        modules[i].content,
                        LEARNING_PATH.MODULE_DURATION_MIN,
                        modules[i].quiz ? JSON.stringify(modules[i].quiz) : null
                    );
                }

                // Step 6: Log action to mind
                deps.mindStore.logAction(
                    'learning_create_path',
                    { topic, language, difficulty, modules: modules.length },
                    context.sessionKey
                );

                // Step 7: Build success response
                const methodologyTitle = getLearningTitle(language);
                let response = '\n' + formatMessage(language, messages, 'ready', {
                    title: `${topic}: ${methodologyTitle}`
                }) + '\n\n';

                response += formatMessage(language, messages, 'structure') + '\n';
                for (let i = 0; i < modules.length; i++) {
                    response += formatMessage(language, messages, 'module', {
                        num: i + 1,
                        title: modules[i].title,
                        min: LEARNING_PATH.MODULE_DURATION_MIN
                    }) + '\n';
                }

                response += '\n' + formatMessage(language, messages, 'total', { duration: LEARNING_PATH.TOTAL_DURATION_MIN }) + '\n\n';
                response += formatMessage(language, messages, 'start', { topic }) + '\n';
                response += formatMessage(language, messages, 'command', { id: pathId });

                // Stop typing indicator
                if (progressTracker) {
                    progressTracker.cleanup();
                }

                // Always return the full response to the agent
                return response;

            } catch (error: any) {
                logger.error('Error in learning_create_path:', error);
                const lang = overrideLanguage || 'en';

                // Clean up progress tracker on error
                if (progressTracker) {
                    progressTracker.cleanup();
                }

                return formatMessage(lang, messages, 'error', { error: error.message });
            }
        }
    };
}

/**
 * Extract modules from generated learning path structure
 * Creates shorter, thread-friendly content suitable for messaging platforms
 */
function _extractModulesFromPath(learningPath: any): ExtractedModule[] {
    const modules: ExtractedModule[] = [];

    // Validate structure
    if (!learningPath?.structure) {
        logger.error('Learning path missing structure');
        throw new Error('Invalid learning path: missing structure');
    }

    // Extract from the 3-phase structure
    const { fase1_descomposicion, fase2_reconstruccion, fase3_sintesis } = learningPath.structure;

    // Module 1: Core Concept + 5 Whys (will be auto-chunked when sent)
    let coreContent = `**${fase1_descomposicion.conceptoClave.titulo}**\n\n`;
    coreContent += `${fase1_descomposicion.conceptoClave.definicion}\n\n`;
    coreContent += `**Los 5 Porqués**\n\n`;

    fase1_descomposicion.cincoWhys.forEach((w: any, i: number) => {
        coreContent += `${i + 1}. *${w.pregunta}*\n${w.respuesta}\n\n`;
    });

    modules.push({
        title: fase1_descomposicion.conceptoClave.titulo,
        content: coreContent.trim(),
        quiz: _generateQuizForConcept(fase1_descomposicion)
    });

    // Module 2: Irreducible Principles
    let principlesContent = `**Principios Fundamentales**\n\n`;

    fase1_descomposicion.principiosIrreductibles.forEach((p: any, i: number) => {
        principlesContent += `**Principio ${i + 1}: ${p.enunciado}**\n\n`;
        principlesContent += `💡 *Analogía:* ${p.analogia}\n\n`;
        principlesContent += `🔒 *Por qué es fundamental:* ${p.inmutabilidad}\n\n`;
    });

    modules.push({
        title: 'Principios Irreductibles',
        content: principlesContent.trim(),
        quiz: _generateQuizForPrinciples(fase1_descomposicion)
    });

    // Module 3: Real Challenge
    let challengeContent = `**${fase2_reconstruccion.desafio.titulo}**\n\n`;
    challengeContent += `**Contexto**\n${fase2_reconstruccion.desafio.contexto}\n\n`;
    challengeContent += `**Complejidad Aparente**\n${fase2_reconstruccion.desafio.complejidadAparente}\n\n`;
    challengeContent += `**Por qué importa**\n${fase2_reconstruccion.desafio.relevancia}\n\n`;

    modules.push({
        title: fase2_reconstruccion.desafio.titulo,
        content: challengeContent.trim(),
        quiz: _generateQuizForChallenge(fase2_reconstruccion)
    });

    // Module 4: Solution Modeling
    let solutionContent = `**Construcción de la Solución**\n\n`;

    fase2_reconstruccion.modeladoSolucion.pasos.forEach((paso: any) => {
        solutionContent += `**Paso ${paso.numero}**\n`;
        solutionContent += `🧩 *Principio:* ${paso.principioUsado}\n`;
        solutionContent += `💭 *Razonamiento:* ${paso.razonamiento}\n`;
        solutionContent += `💡 *Inferencia:* ${paso.inferencia}\n`;
        solutionContent += `✅ *Validación:* ${paso.validacion}\n\n`;
    });

    solutionContent += `**Solución Final**\n${fase2_reconstruccion.modeladoSolucion.solucionFinal}\n\n`;

    modules.push({
        title: 'Construcción de la Solución',
        content: solutionContent.trim(),
        quiz: _generateQuizForSolution(fase2_reconstruccion)
    });

    // Module 5: Verification & Transfer
    let synthesisContent = `**Síntesis y Proyección**\n\n`;

    synthesisContent += `**🧪 Experimento Mental 1**\n`;
    synthesisContent += `*¿Qué pasa si es falso?*\n`;
    synthesisContent += `Principio: ${fase3_sintesis.verificacionCritica.experimento1.principioFalsificado}\n`;
    synthesisContent += `Consecuencia: ${fase3_sintesis.verificacionCritica.experimento1.consecuencia}\n\n`;

    synthesisContent += `**🧪 Experimento Mental 2**\n`;
    synthesisContent += `*Cambio de contexto:* ${fase3_sintesis.verificacionCritica.experimento2.cambioContexto}\n`;
    synthesisContent += `Nueva solución: ${fase3_sintesis.verificacionCritica.experimento2.nuevaSolucion}\n\n`;

    synthesisContent += `**Transferencia a Otros Dominios**\n\n`;
    fase3_sintesis.transferencia.forEach((t: any, i: number) => {
        synthesisContent += `**🌍 ${t.dominio}**\n`;
        synthesisContent += `*Problema análogo:* ${t.problemaAnalogo}\n`;
        synthesisContent += `*Innovación potencial:* ${t.innovacionPotencial}\n\n`;
    });

    synthesisContent += `**🎯 Reflexión Final**\n`;
    synthesisContent += `${fase3_sintesis.cierre.recapitulacion}\n\n`;
    synthesisContent += `🤔 *Metacognición:* ${fase3_sintesis.cierre.preguntaMetacognitiva}\n`;

    modules.push({
        title: 'Verificación y Transferencia',
        content: synthesisContent.trim(),
        quiz: _generateQuizFromContent(fase3_sintesis)
    });

    return modules;
}

/**
 * Generate quiz for Module 1: Core Concept
 */
function _generateQuizForConcept(decomposition: any): QuizQuestion[] {
    const quiz: QuizQuestion[] = [
        {
            question: `¿Cuál es la idea central de "${decomposition.conceptoClave.titulo}"?`,
            type: 'multiple_choice' as const,
            options: [
                decomposition.conceptoClave.definicion.substring(0, 60),
                'Una metodología de trabajo',
                'Un principio matemático avanzado',
                'Una teoría filosófica'
            ],
            correctAnswer: decomposition.conceptoClave.definicion.substring(0, 60),
            correctOptionId: 0,
            explanation: `Correcto! ${decomposition.conceptoClave.definicion.substring(0, 100)}`,
            points: 3
        }
    ];

    // Add a true/false question from the 5 Whys
    if (decomposition.cincoWhys && decomposition.cincoWhys.length > 0) {
        const why = decomposition.cincoWhys[decomposition.cincoWhys.length - 1];
        quiz.push({
            question: `Verdadero o Falso: ${why.pregunta} → ${why.respuesta.substring(0, 100)}`,
            type: 'true_false' as const,
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: why.respuesta.substring(0, 150),
            points: 2
        });
    }

    return quiz;
}

/**
 * Generate quiz for Module 2: Principles
 */
function _generateQuizForPrinciples(decomposition: any): QuizQuestion[] {
    const quiz: QuizQuestion[] = [];

    // Ask about each principle with true/false questions
    decomposition.principiosIrreductibles.forEach((p: any, i: number) => {
        quiz.push({
            question: `El principio "${p.enunciado}" es inmutable porque: ${p.inmutabilidad.substring(0, 100)}`,
            type: 'true_false',
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: `Exacto! ${p.inmutabilidad}`,
            points: 3
        });
    });

    return quiz;
}

/**
 * Generate quiz for Module 3: Challenge
 */
function _generateQuizForChallenge(reconstruction: any): QuizQuestion[] {
    return [
        {
            question: `El desafío "${reconstruction.desafio.titulo}" es relevante. ¿Verdadero o Falso?`,
            type: 'true_false',
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: reconstruction.desafio.relevancia.substring(0, 150),
            points: 3
        },
        {
            question: `¿Cuál es la complejidad principal de este desafío?`,
            type: 'multiple_choice',
            options: [
                reconstruction.desafio.complejidadAparente.substring(0, 60),
                'Es muy simple de resolver',
                'No hay complejidad real',
                'Solo es complejo en teoría'
            ],
            correctAnswer: reconstruction.desafio.complejidadAparente.substring(0, 60),
            correctOptionId: 0,
            explanation: reconstruction.desafio.complejidadAparente.substring(0, 150),
            points: 2
        }
    ];
}

/**
 * Generate quiz for Module 4: Solution
 */
function _generateQuizForSolution(reconstruction: any): QuizQuestion[] {
    const quiz: QuizQuestion[] = [];

    // Ask about the construction steps
    if (reconstruction.modeladoSolucion.pasos && reconstruction.modeladoSolucion.pasos.length > 0) {
        const firstStep = reconstruction.modeladoSolucion.pasos[0];
        quiz.push({
            question: `En el primer paso, usamos el principio "${firstStep.principioUsado}". ¿Verdadero o Falso?`,
            type: 'true_false',
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: `Correcto! ${firstStep.razonamiento}`,
            points: 3
        });
    }

    // Ask about the final solution
    quiz.push({
        question: 'La solución final que construimos desde los principios es válida. ¿Verdadero o Falso?',
        type: 'true_false',
        options: ['Verdadero / True', 'Falso / False'],
        correctAnswer: 'true',
        correctOptionId: 0,
        explanation: reconstruction.modeladoSolucion.solucionFinal.substring(0, 200),
        points: 2
    });

    return quiz;
}

/**
 * Generate quiz for Module 5: Synthesis
 */
function _generateQuizFromContent(synthesis: any): QuizQuestion[] {
    const quiz: QuizQuestion[] = [
        {
            question: `Si el principio "${synthesis.verificacionCritica.experimento1.principioFalsificado}" fuera falso, la consecuencia sería: ${synthesis.verificacionCritica.experimento1.consecuencia.substring(0, 100)}`,
            type: 'true_false',
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: synthesis.verificacionCritica.experimento1.consecuencia,
            points: 3
        }
    ];

    // Add transfer domain question
    if (synthesis.transferencia && synthesis.transferencia.length > 0) {
        const domain = synthesis.transferencia[0];
        quiz.push({
            question: `Estos principios se pueden aplicar en el dominio de "${domain.dominio}". ¿Verdadero o Falso?`,
            type: 'true_false',
            options: ['Verdadero / True', 'Falso / False'],
            correctAnswer: 'true',
            correctOptionId: 0,
            explanation: domain.problemaAnalogo.substring(0, 150),
            points: 2
        });
    }

    // Add metacognitive open question (keep as open for deep thinking)
    quiz.push({
        question: synthesis.cierre.preguntaMetacognitiva,
        type: 'open',
        explanation: 'Esta es una pregunta de reflexión personal. No hay una única respuesta correcta.',
        points: 5
    });

    return quiz;
}
