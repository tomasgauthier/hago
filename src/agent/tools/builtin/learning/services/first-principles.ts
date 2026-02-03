import { ChatProvider } from '../../../../providers/types.js';
import { logger } from '../../../../../utils/logger.js';
import { FIRST_PRINCIPLES } from '../utils/constants.js';

/**
 * First Principles Learning Service
 *
 * Generates educational content following First Principles methodology:
 * - Phase 1: Decomposition (10 min) - Break down to irreducible principles
 * - Phase 2: Reconstruction (10 min) - Build solution from principles
 * - Phase 3: Synthesis (5 min) - Verify and transfer knowledge
 *
 * Multi-language support: Generates content in user's native language
 */

// Types
interface FirstPrinciplesPath {
    topic: string;
    methodology: string;
    totalDuration: string;
    structure: {
        fase1_descomposicion: Decomposition;
        fase2_reconstruccion: Reconstruction;
        fase3_sintesis: Synthesis;
    };
    metadata: {
        principiosIrreductibles: number;
        pasosReconstruccion: number;
        dominiosTransferencia: number;
        generationTime: string;
        generatedAt: string;
        language: string;
    };
}

interface Decomposition {
    conceptoClave: {
        titulo: string;
        definicion: string;
        objetivoReduccion: string;
    };
    cincoWhys: Array<{
        pregunta: string;
        respuesta: string;
        nivel: number;
    }>;
    principiosIrreductibles: Array<{
        id: string;
        enunciado: string;
        analogia: string;
        inmutabilidad: string;
        tipoVerdad: string;
    }>;
    estimatedReadingTime: string;
}

interface Reconstruction {
    desafio: {
        titulo: string;
        contexto: string;
        complejidadAparente: string;
        relevancia: string;
    };
    modeladoSolucion: {
        pasos: Array<{
            numero: number;
            principioUsado: string;
            razonamiento: string;
            inferencia: string;
            validacion: string;
        }>;
        solucionFinal: string;
        porQueEsOriginal: string;
    };
    demostracionCausal: string;
    estimatedReadingTime: string;
}

interface Synthesis {
    verificacionCritica: {
        experimento1: {
            principioFalsificado: string;
            hipotesis: string;
            consecuencia: string;
            cadenaCausal: string;
        };
        experimento2: {
            cambioContexto: string;
            principioAfectado: string;
            nuevaSolucion: string;
        };
    };
    transferencia: Array<{
        dominio: string;
        problemaAnalogo: string;
        mapeoPrincipios: Array<{
            principio: string;
            aplicacionNueva: string;
        }>;
        innovacionPotencial: string;
    }>;
    cierre: {
        recapitulacion: string;
        habilidadDesarrollada: string;
        retoIntelectual: string;
        preguntaMetacognitiva: string;
    };
    estimatedReadingTime: string;
}

interface LanguagePrompts {
    system: string;
    phaseTitles: {
        decomposition: string;
        reconstruction: string;
        synthesis: string;
    };
    instructions: {
        coreConcept: string;
        fiveWhys: string;
        irreduciblePrinciples: string;
        challenge: string;
        modeling: string;
        verification: string;
        transfer: string;
        closure: string;
    };
}

export class FirstPrinciplesService {
    private provider: ChatProvider;
    private model: string;

    constructor(provider: ChatProvider, model: string) {
        this.provider = provider;
        this.model = model;
    }

    /**
     * Strip markdown code fences from LLM JSON responses
     * Handles edge cases: nested blocks, partial fences, multiple JSON objects
     */
    private _cleanJsonResponse(text: string): string {
        let cleaned = text.trim();

        // Strategy 1: Extract JSON from code fence if present
        // Match ```json ... ``` or ``` ... ``` (including nested content)
        const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
        if (fenceMatch && fenceMatch[1]) {
            cleaned = fenceMatch[1].trim();
        } else {
            // Strategy 2: Remove partial fences (incomplete markdown)
            // Opening fence at start
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
            // Closing fence at end
            cleaned = cleaned.replace(/\n?```\s*$/, '');
        }

        // Strategy 3: Find the outermost JSON object if there's extra text
        // This handles cases where LLM adds commentary before/after JSON
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');

        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            // Validate that we have balanced braces
            const potentialJson = cleaned.substring(jsonStart, jsonEnd + 1);
            let braceCount = 0;
            let inString = false;
            let escapeNext = false;

            for (const char of potentialJson) {
                if (escapeNext) {
                    escapeNext = false;
                    continue;
                }
                if (char === '\\') {
                    escapeNext = true;
                    continue;
                }
                if (char === '"') {
                    inString = !inString;
                    continue;
                }
                if (!inString) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
            }

            // Only use extracted JSON if braces are balanced
            if (braceCount === 0) {
                cleaned = potentialJson;
            }
        }

        return cleaned.trim();
    }

    /**
     * Main orchestrator: Generates complete 3-phase learning path
     */
    async generateCompleteLearningPath(
        topic: string,
        researchData: any,
        language: string = 'en'
    ): Promise<FirstPrinciplesPath> {
        logger.info(`🧠 Generating First Principles path: "${topic}" (${language})`);
        logger.info('📊 Structure: Decomposition (10min) + Reconstruction (10min) + Synthesis (5min)');

        const startTime = Date.now();

        try {
            // Phase 1-2: Decomposition + Reconstruction (20 min content)
            logger.info('⚙️  Phase 1-2: Generating Decomposition + Reconstruction...');
            const startTime1 = Date.now();
            const corePhases = await this._generateCorePhases(topic, researchData, language);
            const duration1 = ((Date.now() - startTime1) / 1000).toFixed(2);
            logger.info(`✅ Phases 1-2 completed in ${duration1}s`);

            // Validate
            this._validateCorePhases(corePhases);
            logger.info(`   → Principles identified: ${corePhases.decomposition.principiosIrreductibles.length}`);
            logger.info(`   → Construction steps: ${corePhases.reconstruction.modeladoSolucion.pasos.length}`);

            // Phase 3: Synthesis and Projection (5 min content)
            logger.info('\n🎯 Phase 3: Generating Synthesis and Projection...');
            const startTime2 = Date.now();
            const synthesis = await this._generateSynthesisPhase(
                topic,
                corePhases.decomposition,
                corePhases.reconstruction,
                language
            );
            const duration2 = ((Date.now() - startTime2) / 1000).toFixed(2);
            logger.info(`✅ Phase 3 completed in ${duration2}s`);
            logger.info(`   → Transfer domains: ${synthesis.transferencia.length}`);

            const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

            const completePath: FirstPrinciplesPath = {
                topic,
                methodology: 'First Principles (25min)',
                totalDuration: '25 minutos',
                structure: {
                    fase1_descomposicion: corePhases.decomposition,
                    fase2_reconstruccion: corePhases.reconstruction,
                    fase3_sintesis: synthesis
                },
                metadata: {
                    principiosIrreductibles: corePhases.decomposition.principiosIrreductibles.length,
                    pasosReconstruccion: corePhases.reconstruction.modeladoSolucion.pasos.length,
                    dominiosTransferencia: synthesis.transferencia.length,
                    generationTime: `${totalDuration}s`,
                    generatedAt: new Date().toISOString(),
                    language
                }
            };

            logger.info('\n✅ Complete learning path generated successfully');
            logger.info(`⏱️  Total time: ${totalDuration}s`);
            logger.info(`📚 Principles: ${completePath.metadata.principiosIrreductibles}`);
            logger.info(`🔗 Steps: ${completePath.metadata.pasosReconstruccion}`);
            logger.info(`🌍 Domains: ${completePath.metadata.dominiosTransferencia}\n`);

            return completePath;

        } catch (error: any) {
            logger.error('❌ Error generating First Principles path:', error);
            throw error;
        }
    }

    /**
     * Phase 1-2: Generates Decomposition and Reconstruction together
     */
    private async _generateCorePhases(
        topic: string,
        researchData: any,
        language: string
    ): Promise<{ decomposition: Decomposition; reconstruction: Reconstruction }> {
        const prompts = this._getLanguagePrompts(language);
        const sourcesInfo = researchData?.sources?.slice(0, 3).map((s: any) => ({
            title: s.title,
            type: s.type
        })) || [];

        const prompt = this._buildCorePhasePrompt(topic, sourcesInfo, prompts);

        try {
            const events: any[] = [];
            for await (const event of this.provider.stream({
                systemPrompt: prompts.system,
                messages: [
                    { role: 'user', content: prompt }
                ],
                tools: []
            })) {
                events.push(event);
            }

            // Find the last text event
            const textEvents = events.filter(e => e.type === 'text');
            const fullText = textEvents.map(e => e.content).join('');

            if (!fullText || fullText.trim().length === 0) {
                throw new Error('LLM returned empty response for core phases');
            }

            // Clean and parse JSON response
            const cleanedJson = this._cleanJsonResponse(fullText);

            let content;
            try {
                content = JSON.parse(cleanedJson);
            } catch (parseError: any) {
                logger.error({ response: cleanedJson.substring(0, 500) }, 'Failed to parse LLM JSON response');
                throw new Error(`Invalid JSON from LLM: ${parseError.message}. Response preview: ${cleanedJson.substring(0, 200)}`);
            }

            return content;

        } catch (error: any) {
            logger.error({ err: error }, 'Error in Phases 1-2');
            throw new Error(`Failed to generate core phases: ${error.message}`);
        }
    }

    /**
     * Phase 3: Generates Synthesis and Projection
     */
    private async _generateSynthesisPhase(
        topic: string,
        decomposition: Decomposition,
        reconstruction: Reconstruction,
        language: string
    ): Promise<Synthesis> {
        const prompts = this._getLanguagePrompts(language);
        const principios = decomposition.principiosIrreductibles
            .map(p => p.enunciado)
            .join(', ');

        const prompt = this._buildSynthesisPrompt(topic, principios, reconstruction, prompts);

        try {
            const events: any[] = [];
            for await (const event of this.provider.stream({
                systemPrompt: prompts.system,
                messages: [
                    { role: 'user', content: prompt }
                ],
                tools: []
            })) {
                events.push(event);
            }

            const textEvents = events.filter(e => e.type === 'text');
            const fullText = textEvents.map(e => e.content).join('');

            if (!fullText || fullText.trim().length === 0) {
                throw new Error('LLM returned empty response for synthesis phase');
            }

            // Clean and parse JSON response
            const cleanedJson = this._cleanJsonResponse(fullText);

            let content;
            try {
                content = JSON.parse(cleanedJson);
            } catch (parseError: any) {
                logger.error({ response: cleanedJson.substring(0, 500) }, 'Failed to parse LLM JSON response');
                throw new Error(`Invalid JSON from LLM: ${parseError.message}. Response preview: ${cleanedJson.substring(0, 200)}`);
            }

            return content;

        } catch (error: any) {
            logger.error({ err: error }, 'Error in Phase 3');
            throw new Error(`Failed to generate synthesis phase: ${error.message}`);
        }
    }

    /**
     * Get language-specific prompts
     */
    private _getLanguagePrompts(language: string): LanguagePrompts {
        const prompts: Record<string, LanguagePrompts> = {
            es: {
                system: 'Eres experto en First Principles. Generas contenido educativo en español que descompone conceptos a verdades fundamentales y reconstruye soluciones desde axiomas, sin asumir conocimiento previo.',
                phaseTitles: {
                    decomposition: 'FASE 1: DESCOMPOSICIÓN (10 min)',
                    reconstruction: 'FASE 2: RECONSTRUCCIÓN (10 min)',
                    synthesis: 'FASE 3: SÍNTESIS Y PROYECCIÓN (5 min)'
                },
                instructions: {
                    coreConcept: '1. Concepto Clave (2 min): Define "{topic}" en 1-2 oraciones sin jerga técnica',
                    fiveWhys: '2. 5 Porqués (5 min): Aplica iteración hasta revelar verdades fundamentales',
                    irreduciblePrinciples: '3. Axiomas (3 min): Define 2-3 Principios Irreductibles',
                    challenge: '4. Desafío Real (2 min): Problema complejo del mundo real',
                    modeling: '5. Modelado (8 min): Construir solución SOLO con principios',
                    verification: '6. Verificación Crítica (2 min): Experimentos mentales',
                    transfer: '7. Transferencia (2 min): 2 dominios diferentes',
                    closure: '8. Cierre (1 min): Recapitulación y metacognición'
                }
            },
            en: {
                system: 'You are an expert in First Principles. Generate educational content in English that breaks down concepts to fundamental truths and reconstructs solutions from axioms, without assuming prior knowledge.',
                phaseTitles: {
                    decomposition: 'PHASE 1: DECOMPOSITION (10 min)',
                    reconstruction: 'PHASE 2: RECONSTRUCTION (10 min)',
                    synthesis: 'PHASE 3: SYNTHESIS AND PROJECTION (5 min)'
                },
                instructions: {
                    coreConcept: '1. Core Concept (2 min): Define "{topic}" in 1-2 sentences without jargon',
                    fiveWhys: '2. Five Whys (5 min): Apply iteration until revealing fundamental truths',
                    irreduciblePrinciples: '3. Axioms (3 min): Define 2-3 Irreducible Principles',
                    challenge: '4. Real Challenge (2 min): Complex real-world problem',
                    modeling: '5. Modeling (8 min): Build solution ONLY with principles',
                    verification: '6. Critical Verification (2 min): Mental experiments',
                    transfer: '7. Transfer (2 min): 2 different domains',
                    closure: '8. Closure (1 min): Recap and metacognition'
                }
            },
            pt: {
                system: 'Você é especialista em Primeiros Princípios. Gera conteúdo educacional em português que decompõe conceitos a verdades fundamentais e reconstrói soluções a partir de axiomas, sem pressupor conhecimento prévio.',
                phaseTitles: {
                    decomposition: 'FASE 1: DECOMPOSIÇÃO (10 min)',
                    reconstruction: 'FASE 2: RECONSTRUÇÃO (10 min)',
                    synthesis: 'FASE 3: SÍNTESE E PROJEÇÃO (5 min)'
                },
                instructions: {
                    coreConcept: '1. Conceito Chave (2 min): Defina "{topic}" em 1-2 frases sem jargão técnico',
                    fiveWhys: '2. 5 Porquês (5 min): Aplique iteração até revelar verdades fundamentais',
                    irreduciblePrinciples: '3. Axiomas (3 min): Defina 2-3 Princípios Irredutíveis',
                    challenge: '4. Desafio Real (2 min): Problema complexo do mundo real',
                    modeling: '5. Modelagem (8 min): Construir solução APENAS com princípios',
                    verification: '6. Verificação Crítica (2 min): Experimentos mentais',
                    transfer: '7. Transferência (2 min): 2 domínios diferentes',
                    closure: '8. Encerramento (1 min): Recapitulação e metacognição'
                }
            }
        };

        return prompts[language] || prompts.en;
    }

    /**
     * Build prompt for core phases (1-2)
     */
    private _buildCorePhasePrompt(topic: string, sources: any[], prompts: LanguagePrompts): string {
        const lang = prompts.phaseTitles.decomposition.includes('FASE') ? 'es' : 'en';

        if (lang === 'es') {
            return `Genera Fases 1-2 de aprendizaje First Principles para "${topic}":

${prompts.phaseTitles.decomposition}
${prompts.instructions.coreConcept.replace('{topic}', topic)}
${prompts.instructions.fiveWhys}
   - ¿Por qué existe/funciona?
   - ¿Por qué es así?
   - ¿Por qué es necesario?
   - ¿Por qué no puede ser diferente?
   - ¿Cuál es la verdad fundamental?
${prompts.instructions.irreduciblePrinciples}
   - Enunciado formal (sin jerga)
   - Analogía concreta del mundo real
   - Por qué es inmutable (verdad universal)

${prompts.phaseTitles.reconstruction}
${prompts.instructions.challenge}
${prompts.instructions.modeling}
   - Paso 1: Aplicar Principio #1 → Primera inferencia
   - Paso 2: Agregar Principio #2 → Combinación lógica
   - Paso 3: Agregar Principio #3 (si existe) → Integración completa
   - Paso 4: Validación de la solución

Fuentes disponibles: ${JSON.stringify(sources)}

REGLAS CRÍTICAS:
❌ NO usar "así se hace normalmente"
❌ NO asumir conocimiento técnico especializado
✅ Fase 2 DEBE usar SOLO principios identificados en Fase 1
✅ Exactamente 2-3 principios irreductibles
✅ Cada paso derivable lógicamente del anterior
✅ 4000-5000 palabras total (~20 min lectura)

Responde en JSON con esta estructura:
{
  "decomposition": {
    "conceptoClave": {"titulo": "string", "definicion": "string", "objetivoReduccion": "string"},
    "cincoWhys": [{"pregunta": "string", "respuesta": "string", "nivel": 1}],
    "principiosIrreductibles": [{"id": "p1", "enunciado": "string", "analogia": "string", "inmutabilidad": "string", "tipoVerdad": "matematica|fisica|logica|ontologica"}],
    "estimatedReadingTime": "10 minutos"
  },
  "reconstruction": {
    "desafio": {"titulo": "string", "contexto": "string", "complejidadAparente": "string", "relevancia": "string"},
    "modeladoSolucion": {"pasos": [{"numero": 1, "principioUsado": "p1", "razonamiento": "string", "inferencia": "string", "validacion": "string"}], "solucionFinal": "string", "porQueEsOriginal": "string"},
    "demostracionCausal": "string",
    "estimatedReadingTime": "10 minutos"
  }
}`;
        } else {
            return `Generate Phases 1-2 of First Principles learning for "${topic}":

${prompts.phaseTitles.decomposition}
${prompts.instructions.coreConcept.replace('{topic}', topic)}
${prompts.instructions.fiveWhys}
   - Why does it exist/work?
   - Why is it this way?
   - Why is it necessary?
   - Why can't it be different?
   - What is the fundamental truth?
${prompts.instructions.irreduciblePrinciples}
   - Formal statement (without jargon)
   - Concrete real-world analogy
   - Why it is immutable (universal truth)

${prompts.phaseTitles.reconstruction}
${prompts.instructions.challenge}
${prompts.instructions.modeling}
   - Step 1: Apply Principle #1 → First inference
   - Step 2: Add Principle #2 → Logical combination
   - Step 3: Add Principle #3 (if exists) → Complete integration
   - Step 4: Solution validation

Available sources: ${JSON.stringify(sources)}

CRITICAL RULES:
❌ NO "this is how it's normally done"
❌ NO assuming specialized technical knowledge
✅ Phase 2 MUST use ONLY principles from Phase 1
✅ Exactly 2-3 irreducible principles
✅ Each step logically derivable from previous
✅ 4000-5000 words total (~20 min reading)

Respond in JSON with this structure:
{
  "decomposition": {
    "conceptoClave": {"titulo": "string", "definicion": "string", "objetivoReduccion": "string"},
    "cincoWhys": [{"pregunta": "string", "respuesta": "string", "nivel": 1}],
    "principiosIrreductibles": [{"id": "p1", "enunciado": "string", "analogia": "string", "inmutabilidad": "string", "tipoVerdad": "matematica|fisica|logica|ontologica"}],
    "estimatedReadingTime": "10 minutes"
  },
  "reconstruction": {
    "desafio": {"titulo": "string", "contexto": "string", "complejidadAparente": "string", "relevancia": "string"},
    "modeladoSolucion": {"pasos": [{"numero": 1, "principioUsado": "p1", "razonamiento": "string", "inferencia": "string", "validacion": "string"}], "solucionFinal": "string", "porQueEsOriginal": "string"},
    "demostracionCausal": "string",
    "estimatedReadingTime": "10 minutes"
  }
}`;
        }
    }

    /**
     * Build prompt for synthesis phase (3)
     */
    private _buildSynthesisPrompt(
        topic: string,
        principios: string,
        reconstruction: Reconstruction,
        prompts: LanguagePrompts
    ): string {
        const lang = prompts.phaseTitles.synthesis.includes('FASE') ? 'es' : 'en';

        if (lang === 'es') {
            return `Genera Fase 3 de síntesis para "${topic}":

CONTEXTO PREVIO:
- Principios identificados: ${principios}
- Solución construida: ${reconstruction.modeladoSolucion.solucionFinal}

${prompts.phaseTitles.synthesis}

${prompts.instructions.verification}
   Experimento 1: ¿Qué pasaría si uno de los principios fuera FALSO?
   Experimento 2: Cambiar una condición del problema → ¿Cómo afecta la solución?

${prompts.instructions.transfer}
   Identifica 2 dominios completamente diferentes donde aplicar los mismos principios

${prompts.instructions.closure}
   - Recapitulación de principios
   - Habilidad desarrollada
   - Reto intelectual provocador (sin respuesta única)
   - Metacognición: "¿Cómo cambió tu pensamiento sobre ${topic}?"

VALIDACIÓN:
✅ Experimentos mentales rigurosos (no triviales)
✅ Dominios de transferencia genuinamente diferentes
✅ Reto intelectual no obvio
✅ 1000-1250 palabras (~5 min lectura)

Responde en JSON con esta estructura:
{
  "verificacionCritica": {
    "experimento1": {"principioFalsificado": "string", "hipotesis": "string", "consecuencia": "string", "cadenaCausal": "string"},
    "experimento2": {"cambioContexto": "string", "principioAfectado": "string", "nuevaSolucion": "string"}
  },
  "transferencia": [
    {"dominio": "string", "problemaAnalogo": "string", "mapeoPrincipios": [{"principio": "string", "aplicacionNueva": "string"}], "innovacionPotencial": "string"}
  ],
  "cierre": {
    "recapitulacion": "string",
    "habilidadDesarrollada": "string",
    "retoIntelectual": "string",
    "preguntaMetacognitiva": "string"
  },
  "estimatedReadingTime": "5 minutos"
}`;
        } else {
            return `Generate Phase 3 synthesis for "${topic}":

PREVIOUS CONTEXT:
- Identified principles: ${principios}
- Built solution: ${reconstruction.modeladoSolucion.solucionFinal}

${prompts.phaseTitles.synthesis}

${prompts.instructions.verification}
   Experiment 1: What if one of the principles was FALSE?
   Experiment 2: Change a problem condition → How does it affect the solution?

${prompts.instructions.transfer}
   Identify 2 completely different domains to apply the same principles

${prompts.instructions.closure}
   - Recap of principles
   - Skill developed
   - Provocative intellectual challenge (no single answer)
   - Metacognition: "How did your thinking about ${topic} change?"

VALIDATION:
✅ Rigorous mental experiments (not trivial)
✅ Genuinely different transfer domains
✅ Non-obvious intellectual challenge
✅ 1000-1250 words (~5 min reading)

Respond in JSON with this structure:
{
  "verificacionCritica": {
    "experimento1": {"principioFalsificado": "string", "hipotesis": "string", "consecuencia": "string", "cadenaCausal": "string"},
    "experimento2": {"cambioContexto": "string", "principioAfectado": "string", "nuevaSolucion": "string"}
  },
  "transferencia": [
    {"dominio": "string", "problemaAnalogo": "string", "mapeoPrincipios": [{"principio": "string", "aplicacionNueva": "string"}], "innovacionPotencial": "string"}
  ],
  "cierre": {
    "recapitulacion": "string",
    "habilidadDesarrollada": "string",
    "retoIntelectual": "string",
    "preguntaMetacognitiva": "string"
  },
  "estimatedReadingTime": "5 minutes"
}`;
        }
    }

    /**
     * Validate core phases structure
     */
    private _validateCorePhases(content: { decomposition: Decomposition; reconstruction: Reconstruction }): void {
        const { decomposition, reconstruction } = content;

        // Validate decomposition
        if (!decomposition?.principiosIrreductibles) {
            throw new Error('Missing principiosIrreductibles in decomposition');
        }

        const numPrincipios = decomposition.principiosIrreductibles.length;
        if (numPrincipios < FIRST_PRINCIPLES.MIN_PRINCIPLES || numPrincipios > FIRST_PRINCIPLES.MAX_PRINCIPLES) {
            throw new Error(`Invalid number of principles: ${numPrincipios}. Must be ${FIRST_PRINCIPLES.MIN_PRINCIPLES}-${FIRST_PRINCIPLES.MAX_PRINCIPLES}.`);
        }

        if (!decomposition.cincoWhys || decomposition.cincoWhys.length !== FIRST_PRINCIPLES.REQUIRED_WHYS) {
            throw new Error(`Must have exactly ${FIRST_PRINCIPLES.REQUIRED_WHYS} Why iterations`);
        }

        // Validate each principle has required fields
        decomposition.principiosIrreductibles.forEach((p, i) => {
            if (!p.id || !p.enunciado || !p.analogia || !p.inmutabilidad) {
                throw new Error(`Principle ${i + 1} incomplete: missing required fields`);
            }
        });

        // Validate reconstruction
        if (!reconstruction?.modeladoSolucion?.pasos) {
            throw new Error('Missing pasos in modeladoSolucion');
        }

        if (reconstruction.modeladoSolucion.pasos.length < FIRST_PRINCIPLES.MIN_CONSTRUCTION_STEPS) {
            throw new Error(`Must have at least ${FIRST_PRINCIPLES.MIN_CONSTRUCTION_STEPS} construction step`);
        }

        // Verify each step uses an identified principle
        const principiosIds = decomposition.principiosIrreductibles.map(p => p.id);
        reconstruction.modeladoSolucion.pasos.forEach((paso, i) => {
            if (!principiosIds.includes(paso.principioUsado)) {
                throw new Error(`Step ${i + 1} uses unknown principle: ${paso.principioUsado}`);
            }
        });
    }
}
