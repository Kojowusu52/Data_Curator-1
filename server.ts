import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

type AssistantRole = 'curation_architect' | 'regression_analyst' | 'rl_specialist';
type AllowedModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

const ROLE_INSTRUCTIONS: Record<AssistantRole, string> = {
  curation_architect:
    'You are the Stratum Data Curation Architect, a senior ML data engineer. Help users design leak-free entity-hash splits (FNV-1a), point-in-time feature cutoffs, canonical event schemas, and cross-paradigm parity across tabular regression, sequential tensors, and offline RL MDPs. Keep answers concise, technically grounded in the live workspace metrics provided, and directly actionable.',
  regression_analyst:
    'You are the Stratum Regression & Multicollinearity Analyst, an applied econometrician and tabular ML specialist. Help users interpret the Pearson correlation matrix, Variance Inflation Factors (VIF), predictor collinearity, winsorization caps, zero-inflation in LTV targets, and observation/horizon window trade-offs. Reference the exact feature pairs and numbers from the live workspace context.',
  rl_specialist:
    'You are the Stratum Sequence & Offline RL Specialist, a deep learning and Markov Decision Process engineer. Help users tune [B, L, D] sequence tensor padding/truncation/normalization, attention mask sparsity, discount factor gamma, inactivity terminal detection, reward scaling, and Conservative Q-Learning (CQL) out-of-distribution support diagnostics.',
};

interface ChatHistoryTurn {
  sender: 'user' | 'assistant';
  text: string;
}

interface WorkspaceContextPayload {
  datasetName?: string;
  datasetDomain?: string;
  totalEntities?: number;
  totalEvents?: number;
  globalConfig?: Record<string, unknown>;
  regSummary?: Record<string, unknown>;
  seqSummary?: Record<string, unknown>;
  mdpSummary?: Record<string, unknown>;
  highCollinearityPairs?: Array<{
    labelA: string;
    labelB: string;
    pearsonR: number;
    vifEstimate: number;
  }>;
  audits?: Array<{
    name: string;
    paradigm: string;
    status: string;
    metricValue: string;
  }>;
}

function buildSystemInstruction(
  role: AssistantRole,
  workspaceContext?: WorkspaceContextPayload
): string {
  const base = ROLE_INSTRUCTIONS[role] ?? ROLE_INSTRUCTIONS.curation_architect;
  if (!workspaceContext) return base;

  const lines: string[] = [
    base,
    '',
    'Live Stratum Workspace Context:',
    `- Dataset: ${workspaceContext.datasetName ?? 'Unknown'} (${workspaceContext.datasetDomain ?? 'N/A'})`,
    `- Entities: ${workspaceContext.totalEntities ?? 0} | Raw Events: ${workspaceContext.totalEvents ?? 0}`,
  ];

  if (workspaceContext.globalConfig) {
    lines.push(`- Global Split Config: ${JSON.stringify(workspaceContext.globalConfig)}`);
  }
  if (workspaceContext.regSummary) {
    lines.push(`- Regression Pipeline: ${JSON.stringify(workspaceContext.regSummary)}`);
  }
  if (workspaceContext.seqSummary) {
    lines.push(`- Sequence Pipeline: ${JSON.stringify(workspaceContext.seqSummary)}`);
  }
  if (workspaceContext.mdpSummary) {
    lines.push(`- Offline RL MDP Pipeline: ${JSON.stringify(workspaceContext.mdpSummary)}`);
  }
  if (workspaceContext.highCollinearityPairs && workspaceContext.highCollinearityPairs.length > 0) {
    lines.push(
      `- High Collinearity Pairs (|r| >= 0.70): ${workspaceContext.highCollinearityPairs
        .map((p) => `${p.labelA} vs ${p.labelB} (r=${p.pearsonR}, VIF=${p.vifEstimate})`)
        .join('; ')}`
    );
  } else {
    lines.push('- High Collinearity Pairs (|r| >= 0.70): None detected');
  }
  if (workspaceContext.audits && workspaceContext.audits.length > 0) {
    lines.push(
      `- Integrity Audits: ${workspaceContext.audits
        .map((a) => `[${a.status.toUpperCase()}] ${a.name}: ${a.metricValue}`)
        .join(' | ')}`
    );
  }

  return lines.join('\n');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/chat', async (req, res) => {
    const {
      message,
      history = [],
      role = 'curation_architect',
      model = 'gemini-4-hydrogen',
      workspaceContext,
    } = req.body as {
      message?: string;
      history?: ChatHistoryTurn[];
      role?: AssistantRole;
      model?: AllowedModel;
      workspaceContext?: WorkspaceContextPayload;
    };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    const safeRole: AssistantRole =
      role in ROLE_INSTRUCTIONS ? role : 'curation_architect';
    const safeModel: AllowedModel =
      model === 'gemini-3.1-flash-lite' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

    const formattedHistory = Array.isArray(history)
      ? history
          .filter(
            (turn) =>
              turn &&
              (turn.sender === 'user' || turn.sender === 'assistant') &&
              typeof turn.text === 'string' &&
              turn.text.trim().length > 0
          )
          .slice(-24)
          .map((turn) => ({
            role: turn.sender === 'user' ? ('user' as const) : ('model' as const),
            parts: [{ text: turn.text }],
          }))
      : [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const chat = ai.chats.create({
        model: safeModel,
        config: {
          systemInstruction: buildSystemInstruction(safeRole, workspaceContext),
        },
        history: formattedHistory,
      });

      const stream = await chat.sendMessageStream({
        message: message.trim(),
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, model: safeModel })}\n\n`);
      res.end();
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let friendly = rawMessage;
      if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('PERMISSION_DENIED')) {
        friendly = 'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        friendly = 'Gemini API quota exceeded. Please try again shortly or check your billing tier in Settings > Secrets.';
      }
      res.write(`data: ${JSON.stringify({ error: friendly })}\n\n`);
      res.end();
    }
  });

  app.post('/api/explain-ltv', async (req, res) => {
    const body = req.body as {
      datasetName?: string;
      datasetDomain?: string;
      audience?: 'executive' | 'growth' | 'technical';
      config?: {
        obsCutoffDay?: number;
        horizonDays?: number;
        winsorizePercentile?: number;
        featureNormalization?: string;
        splitFilter?: string;
        excludeZeroObsEntities?: boolean;
        excludeDetectedOutliers?: boolean;
      };
      modelMetrics?: {
        sampleSize?: number;
        rSquared?: number;
        rmse?: number;
        mae?: number;
        mape?: number | null;
        meanProjectedLtv?: number;
        meanTargetRaw?: number;
        meanTargetWinsorized?: number;
        winsorCapValue?: number;
        zeroTargetRate?: number;
        intercept?: number;
      };
      features?: Array<{
        feature: string;
        label: string;
        standardizedBeta: number;
        importanceShare: number;
        rawCoefficient: number;
        univariateR2: number;
        direction: string;
        pearsonR?: number;
      }>;
      driftSummary?: {
        tier?: string;
        klExceedsThreshold?: boolean;
        maxKlDivergence?: number;
        klThreshold?: number;
        flaggedFeatures?: string[];
      };
      collinearityPairs?: Array<{
        labelA: string;
        labelB: string;
        pearsonR: number;
        vifEstimate: number;
      }>;
      anomalySummary?: {
        outlierCount?: number;
        outlierRate?: number;
        excludeDetectedOutliers?: boolean;
        thresholdStd?: number;
      };
    };

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error:
          'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    if (!body || !Array.isArray(body.features) || body.features.length === 0) {
      res.status(400).json({
        error:
          'At least one active regression feature with fitted coefficients is required to generate an explanation.',
      });
      return;
    }

    const audience =
      body.audience === 'growth' || body.audience === 'technical'
        ? body.audience
        : 'executive';

    const audiencePrompt =
      audience === 'growth'
        ? 'Target audience: Growth, Lifecycle Marketing, and Retention leads. Emphasize behavioral levers, customer activation/engagement signals, promo sensitivity, and concrete retention campaigns.'
        : audience === 'technical'
          ? 'Target audience: Applied ML Engineers and Analytics Leads. Discuss standardized beta weights, coefficient stability under collinearity/VIF, out-of-sample generalization caveats, and feature engineering refinements alongside business meaning.'
          : 'Target audience: Executive Leadership, Finance, and Revenue Stakeholders. Avoid heavy math jargon; translate model weights into clear revenue drivers, portfolio risk caveats, and high-ROI strategic actions.';

    const contextPayload = {
      dataset: {
        name: body.datasetName ?? 'Active Cohort',
        domain: body.datasetDomain ?? 'Customer Analytics',
      },
      curationSetup: body.config ?? {},
      modelMetrics: body.modelMetrics ?? {},
      rankedFeatures: body.features.slice(0, 10),
      driftStatus: body.driftSummary ?? null,
      highCollinearityPairs: (body.collinearityPairs ?? []).slice(0, 6),
      anomalyStatus: body.anomalySummary ?? null,
    };

    const promptText = [
      `Analyze this OLS Lifetime Value (LTV) regression model and explain what drives LTV decisions for stakeholders.`,
      audiencePrompt,
      `Ground every statement strictly in the exact feature names, standardized betas, importance percentages, raw coefficients, and diagnostic numbers below:`,
      JSON.stringify(contextPayload, null, 2),
    ].join('\n\n');

    const explainSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description:
            'A crisp 8-14 word headline summarizing the primary LTV driver and model takeaway.',
        },
        executiveSummary: {
          type: Type.STRING,
          description:
            '2-3 clear sentences explaining what features primarily drive predicted LTV and what the baseline model predicts.',
        },
        modelConfidenceNote: {
          type: Type.STRING,
          description:
            '2 sentences interpreting R-squared, RMSE/MAE error margins, sample size, and whether predictions are reliable for decision-making.',
        },
        topDrivers: {
          type: Type.ARRAY,
          description:
            'Ranked explanation of the top 3 to 6 most influential features from rankedFeatures.',
          items: {
            type: Type.OBJECT,
            properties: {
              feature: {
                type: Type.STRING,
                description: 'Exact feature key from rankedFeatures.',
              },
              label: {
                type: Type.STRING,
                description: 'Human-readable feature label.',
              },
              impactRole: {
                type: Type.STRING,
                description:
                  'One of: Primary Lift, Secondary Driver, Negative Drag, or Neutral Signal.',
              },
              importanceSharePct: {
                type: Type.NUMBER,
                description: 'Importance share percentage (0-100).',
              },
              stakeholderExplanation: {
                type: Type.STRING,
                description:
                  '1-2 plain-English sentences explaining why this feature increases or decreases predicted LTV, citing its directional effect.',
              },
              businessAction: {
                type: Type.STRING,
                description:
                  '1 concise, actionable recommendation stakeholders can act on based on this driver.',
              },
            },
            required: [
              'feature',
              'label',
              'impactRole',
              'importanceSharePct',
              'stakeholderExplanation',
              'businessAction',
            ],
          },
        },
        riskCaveats: {
          type: Type.ARRAY,
          description:
            '2 to 4 concise stakeholder caveats referencing any observed feature drift, collinearity (VIF), zero-inflation, winsorization, or outlier exclusions.',
          items: { type: Type.STRING },
        },
        recommendedActions: {
          type: Type.ARRAY,
          description:
            '3 prioritized next steps for business stakeholders or modeling teams.',
          items: { type: Type.STRING },
        },
      },
      required: [
        'headline',
        'executiveSummary',
        'modelConfidenceNote',
        'topDrivers',
        'riskCaveats',
        'recommendedActions',
      ],
    };

    const callWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              systemInstruction:
                'You are an Explainable AI (XAI) advisor inside Stratum, translating tabular OLS Lifetime Value (LTV) regression coefficients and statistical diagnostics into clear, accurate, stakeholder-ready business narratives. Never invent metrics not present in the provided payload.',
              responseMimeType: 'application/json',
              responseSchema: explainSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isNonRetryable =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('NOT_FOUND');
          if (isNonRetryable || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    try {
      const response = await callWithRetry();
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try regenerating.',
        });
        return;
      }

      const parsed = JSON.parse(rawJson);
      res.json({
        explanation: parsed,
        model: 'gemini-4-hydrogen',
        audience,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let statusCode = 500;
      let friendly = rawMessage;
      if (
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        statusCode = 403;
        friendly =
          'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        statusCode = 429;
        friendly =
          'Gemini API quota exceeded. Please try again shortly or verify your billing tier in Settings > Secrets.';
      } else if (rawMessage.includes('NOT_FOUND')) {
        statusCode = 404;
        friendly =
          'Requested Gemini model (gemini-4-hydrogen) was not found or is unavailable.';
      }
      res.status(statusCode).json({ error: friendly });
    }
  });

  app.post('/api/generate-docs', async (req, res) => {
    const body = req.body as {
      template?: 'model_card' | 'data_dictionary' | 'executive_brief';
      datasetName?: string;
      datasetDomain?: string;
      datasetDescription?: string;
      entityCount?: number;
      eventCount?: number;
      dayRange?: [number, number];
      channels?: Array<{ name: string; sharePct: number }>;
      actionSpace?: Array<{ id: number; label: string; sharePct: number; meanReward: number }>;
      healthScore?: number;
      healthTier?: string;
      healthWarnings?: string[];
      regressionSpec?: Record<string, unknown>;
      sequenceSpec?: Record<string, unknown>;
      mdpSpec?: Record<string, unknown>;
      audits?: Array<{ name: string; paradigm: string; status: string; metricValue: string }>;
    };

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    if (!body || !body.datasetName) {
      res.status(400).json({
        error: 'Dataset documentation context is required to generate an AI narrative.',
      });
      return;
    }

    const template =
      body.template === 'data_dictionary' || body.template === 'executive_brief'
        ? body.template
        : 'model_card';

    const templateGuidance =
      template === 'executive_brief'
        ? 'Tone: Executive & Product Strategy stakeholders. Focus on business value, dataset reliability, strategic use cases, and portfolio risks without low-level math jargon.'
        : template === 'data_dictionary'
          ? 'Tone: Data Engineering & Governance leads. Focus on schema integrity, temporal cutoff discipline, PII sensitivity, missingness/skewness risks, and downstream pipeline readiness.'
          : 'Tone: Applied ML Scientists & Engineering Leads (Google Model Card / Datasheets for Datasets standard). Balance rigorous statistical interpretation across Regression, Sequence Transformers, and Offline RL with practical risk caveats.';

    const docSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description: 'A crisp 8-14 word title summarizing the dataset readiness and primary ML utility.',
        },
        executiveAbstract: {
          type: Type.STRING,
          description: '3-4 concise sentences summarizing the dataset provenance, scale, multi-paradigm readiness, and headline performance metrics.',
        },
        intendedUseCases: {
          type: Type.ARRAY,
          description: '3 concrete, well-scoped ML or analytical use cases supported by this dataset.',
          items: { type: Type.STRING },
        },
        outOfScopeUses: {
          type: Type.ARRAY,
          description: '2-3 out-of-scope or unsupported uses given temporal cutoffs, censoring, or OOD support limits.',
          items: { type: Type.STRING },
        },
        dataQualityFindings: {
          type: Type.ARRAY,
          description: '3 factual findings grounded in the health scorecard, zero-inflation, skewness, or audit results.',
          items: { type: Type.STRING },
        },
        biasAndRiskCaveats: {
          type: Type.ARRAY,
          description: '2-4 specific statistical caveats referencing KL drift, VIF collinearity, logging policy confounding, or low-support OOD rates.',
          items: { type: Type.STRING },
        },
        curationRecommendations: {
          type: Type.ARRAY,
          description: '3 actionable data curation or hyperparameter tuning steps to improve downstream stability.',
          items: { type: Type.STRING },
        },
        downstreamModelingGuidance: {
          type: Type.STRING,
          description: '2-3 sentences comparing suitability across OLS Regression, Sequence Transformers, and Offline RL (CQL) for this specific dataset.',
        },
      },
      required: [
        'headline',
        'executiveAbstract',
        'intendedUseCases',
        'outOfScopeUses',
        'dataQualityFindings',
        'biasAndRiskCaveats',
        'curationRecommendations',
        'downstreamModelingGuidance',
      ],
    };

    const promptText = [
      'Generate a structured Datasheets-for-Datasets / ML Model Card narrative for the following curated dataset.',
      templateGuidance,
      'Ground every claim strictly in the provided metrics and never invent columns or numbers not present in this context:',
      JSON.stringify(body, null, 2),
    ].join('\n\n');

    const callWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              systemInstruction:
                'You are an ML Data Governance & Model Card Architect inside Stratum. Produce crisp, accurate technical documentation grounded strictly in the provided dataset telemetry.',
              responseMimeType: 'application/json',
              responseSchema: docSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isNonRetryable =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('NOT_FOUND');
          if (isNonRetryable || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    try {
      const response = await callWithRetry();
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try regenerating.',
        });
        return;
      }

      const parsed = JSON.parse(rawJson);
      res.json({
        narrative: {
          ...parsed,
          model: 'gemini-4-hydrogen',
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let statusCode = 500;
      let friendly = rawMessage;
      if (
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        statusCode = 403;
        friendly =
          'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        statusCode = 429;
        friendly =
          'Gemini API quota exceeded. Please try again shortly or verify your billing tier in Settings > Secrets.';
      } else if (rawMessage.includes('NOT_FOUND')) {
        statusCode = 404;
        friendly =
          'Requested Gemini model (gemini-4-hydrogen) was not found or is unavailable.';
      }
      res.status(statusCode).json({ error: friendly });
    }
  });

  app.post('/api/curate-dataset', async (req, res) => {
    const body = req.body as {
      datasetName?: string;
      datasetDomain?: string;
      objective?: string;
      customGoal?: string;
      profileSummary?: Record<string, unknown>;
      currentConfigs?: Record<string, unknown>;
      pipelineTelemetry?: Record<string, unknown>;
      appliedRules?: string[];
    };

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    if (!body || !body.datasetName || !body.profileSummary) {
      res.status(400).json({
        error: 'Dataset profile summary is required to generate an AI curation plan.',
      });
      return;
    }

    const objectiveMap: Record<string, string> = {
      balanced_multi_paradigm:
        'Balanced Multi-Paradigm Parity: maximize Data Health score while preserving cross-paradigm consistency across OLS Regression, Sequence Transformers, and Offline RL (CQL).',
      regression_ltv_stability:
        'Regression LTV Stability: stabilize OLS coefficients, reduce heavy-tail leverage, control KL drift, and address outlier sensitivity.',
      sequence_transformer_cleanliness:
        'Sequential Tensor Cleanliness: minimize padding sparsity, clean duplicate/out-of-bounds sequence steps, and optimize normalization for Transformer convergence.',
      offline_rl_cql_safety:
        'Offline RL CQL Safety: eliminate negative reward spikes, enforce safe propensity bounds, prune single-step trajectories, and mitigate low-support OOD transitions.',
    };

    const selectedObjectiveText =
      body.customGoal && body.customGoal.trim().length > 0
        ? `Custom User Objective: ${body.customGoal.trim()}`
        : objectiveMap[body.objective ?? 'balanced_multi_paradigm'] ??
          objectiveMap.balanced_multi_paradigm;

    const curatorSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description: 'Crisp 8-14 word summary of the dataset quality diagnosis and curation plan.',
        },
        overallReadiness: {
          type: Type.STRING,
          enum: ['production_ready', 'needs_curation', 'critical_remediation'],
          description: 'Overall ML readiness tier based on health score, anomalies, drift, and OOD rate.',
        },
        executiveDiagnosis: {
          type: Type.STRING,
          description: '3-4 sentences explaining the exact quality bottlenecks and how the proposed curation plan resolves them.',
        },
        prioritizedFindings: {
          type: Type.ARRAY,
          description: 'Top 3 to 5 concrete data quality or modeling findings ordered by severity.',
          items: {
            type: Type.OBJECT,
            properties: {
              severity: { type: Type.STRING, enum: ['info', 'warn', 'critical'] },
              dimension: { type: Type.STRING, description: 'e.g., Reward Integrity, Tail Outliers, KL Drift, MDP Support.' },
              title: { type: Type.STRING },
              evidence: { type: Type.STRING, description: 'Exact counts, rates, or metric values from the payload.' },
              recommendedAction: { type: Type.STRING },
            },
            required: ['severity', 'dimension', 'title', 'evidence', 'recommendedAction'],
          },
        },
        recommendedEventRules: {
          type: Type.ARRAY,
          description:
            'Only recommend event rules whose ruleId matches an actual observed issue or improves the objective. Valid ruleIds: deduplicate_events, clip_negative_rewards, winsorize_spend_tail, clamp_propensity_bounds, filter_single_touch_entities, clamp_engagement_unit.',
          items: {
            type: Type.OBJECT,
            properties: {
              ruleId: {
                type: Type.STRING,
                enum: [
                  'deduplicate_events',
                  'clip_negative_rewards',
                  'winsorize_spend_tail',
                  'clamp_propensity_bounds',
                  'filter_single_touch_entities',
                  'clamp_engagement_unit',
                ],
              },
              priority: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
              rationale: { type: Type.STRING },
              expectedBenefit: { type: Type.STRING },
            },
            required: ['ruleId', 'priority', 'rationale', 'expectedBenefit'],
          },
        },
        recommendedConfigPatch: {
          type: Type.OBJECT,
          description: 'Concrete parameter adjustments across Regression, Sequence, and Offline RL pipelines.',
          properties: {
            regWinsorizePercentile: { type: Type.INTEGER, description: 'Recommended percentile: 0, 95, or 99.' },
            regNormalization: { type: Type.STRING, enum: ['none', 'zscore', 'minmax'] },
            regExcludeOutliers: { type: Type.BOOLEAN },
            seqNormalization: { type: Type.STRING, enum: ['zscore', 'minmax', 'log1p_zscore'] },
            seqMaxSeqLen: { type: Type.INTEGER, description: 'Recommended maxSeqLen between 6 and 24.' },
            mdpRewardScale: { type: Type.STRING, enum: ['raw', 'clipped_10', 'standardized'] },
            mdpMinTrajectorySteps: { type: Type.INTEGER, description: 'Recommended minTrajectorySteps between 1 and 4.' },
            rationale: { type: Type.STRING },
          },
          required: ['rationale'],
        },
        validationChecklist: {
          type: Type.ARRAY,
          description: '3 concise post-curation verification checks to confirm after applying the plan.',
          items: { type: Type.STRING },
        },
      },
      required: [
        'headline',
        'overallReadiness',
        'executiveDiagnosis',
        'prioritizedFindings',
        'recommendedEventRules',
        'recommendedConfigPatch',
        'validationChecklist',
      ],
    };

    const promptText = [
      'Analyze this Stratum dataset quality profile and multi-paradigm telemetry, then design a targeted, non-destructive curation plan.',
      `Curation Objective: ${selectedObjectiveText}`,
      'Important: Only recommend event rules from the enum when justified by the actual telemetry counts/distributions (do not recommend a rule with 0 affected events unless preventive). Reference exact numbers from the context.',
      JSON.stringify(body, null, 2),
    ].join('\n\n');

    const callWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              systemInstruction:
                'You are the Stratum AI Data Quality & Curator Engine. Diagnose real anomalies, drift, outliers, and RL support issues from the live telemetry, and emit a structured, executable curation plan.',
              responseMimeType: 'application/json',
              responseSchema: curatorSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isNonRetryable =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('NOT_FOUND');
          if (isNonRetryable || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    try {
      const response = await callWithRetry();
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try regenerating.',
        });
        return;
      }

      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      res.json({
        plan: {
          ...parsed,
          objectiveUsed: selectedObjectiveText,
          model: 'gemini-4-hydrogen',
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let statusCode = 500;
      let friendly = rawMessage;
      if (
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        statusCode = 403;
        friendly =
          'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        statusCode = 429;
        friendly =
          'Gemini API quota exceeded. Please try again shortly or verify your billing tier in Settings > Secrets.';
      } else if (rawMessage.includes('NOT_FOUND')) {
        statusCode = 404;
        friendly =
          'Requested Gemini model (gemini-4-hydrogen) was not found or is unavailable.';
      }
      res.status(statusCode).json({ error: friendly });
    }
  });

  app.post('/api/nl-query', async (req, res) => {
    const body = req.body as {
      question?: string;
      datasetName?: string;
      datasetDomain?: string;
      obsCutoffDay?: number;
      channels?: string[];
      actionLabels?: string[];
      entityCount?: number;
      eventCount?: number;
      regressionRowCount?: number;
      mdpTransitionCount?: number;
    };

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) {
      res.status(400).json({
        error: 'Please enter a natural language query to compile and execute.',
      });
      return;
    }

    const nlQuerySchema = {
      type: Type.OBJECT,
      properties: {
        targetTable: {
          type: Type.STRING,
          enum: ['events', 'regression_rows', 'mdp_transitions'],
          description:
            'Choose events for behavioral touchpoints/spend/channels/windowPhase, regression_rows for entity-level LTV predictions/actuals/RFM features, or mdp_transitions for Offline RL steps/returnToGo/OOD/terminalReason.',
        },
        intentSummary: {
          type: Type.STRING,
          description:
            '1 concise sentence explaining exactly what records, filters, groupings, and sorting are computed.',
        },
        sqlPreview: {
          type: Type.STRING,
          description:
            'Equivalent readable PostgreSQL SELECT query matching the compiled plan.',
        },
        filters: {
          type: Type.ARRAY,
          description: 'Structured WHERE filter predicates using exact camelCase field keys for the chosen targetTable.',
          items: {
            type: Type.OBJECT,
            properties: {
              field: { type: Type.STRING },
              op: {
                type: Type.STRING,
                enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'],
              },
              valueText: {
                type: Type.STRING,
                description: 'Filter comparison value serialized as string (numbers like "150", booleans like "true", strings like "val" or "Web").',
              },
            },
            required: ['field', 'op', 'valueText'],
          },
        },
        groupBy: {
          type: Type.STRING,
          enum: [
            'none',
            'channel',
            'actionLabel',
            'split',
            'windowPhase',
            'actionId',
            'terminalReason',
            'isLowSupportOod',
            'leakageVerified',
          ],
          description: 'Set to "none" for row-level queries or one valid categorical dimension for grouped aggregations.',
        },
        metrics: {
          type: Type.ARRAY,
          description: 'Aggregation metrics when groupBy is not "none" (empty array if ungrouped).',
          items: {
            type: Type.OBJECT,
            properties: {
              field: {
                type: Type.STRING,
                description: 'Exact camelCase numeric field key on targetTable, or "*" for count.',
              },
              agg: {
                type: Type.STRING,
                enum: ['count', 'sum', 'avg', 'min', 'max'],
              },
              alias: {
                type: Type.STRING,
                description: 'Short snake_case metric column alias, e.g. avg_spend, total_ltv, event_count.',
              },
            },
            required: ['field', 'agg', 'alias'],
          },
        },
        sortByField: {
          type: Type.STRING,
          description: 'Exact camelCase field key (ungrouped) or metric alias (grouped) to sort by.',
        },
        sortDirection: {
          type: Type.STRING,
          enum: ['asc', 'desc'],
        },
        limit: {
          type: Type.INTEGER,
          description: 'Number of rows to return (between 1 and 200; default 25 unless user specifies top N).',
        },
        chartType: {
          type: Type.STRING,
          enum: ['bar', 'none'],
          description: 'Use "bar" for grouped aggregations and "none" for ungrouped row listings.',
        },
      },
      required: [
        'targetTable',
        'intentSummary',
        'sqlPreview',
        'filters',
        'groupBy',
        'metrics',
        'sortByField',
        'sortDirection',
        'limit',
        'chartType',
      ],
    };

    const schemaDoc = `
Queryable Tables & Exact camelCase Fields:
1. events (canonical_events, ${body.eventCount ?? 'unknown'} rows):
   - Strings/Categories: eventId, entityId, split ("train"|"val"|"test"), windowPhase ("obs"|"horizon"), actionLabel, channel
   - Numbers: timestampDay, actionId, spendAmount, reward, engagementScore (0..1), propensity (0..1), recencyDays, frequencyCount
   - Groupable: channel, actionLabel, split, windowPhase, actionId
2. regression_rows (regression_ltv, ${body.regressionRowCount ?? 'unknown'} entity rows):
   - Strings/Categories: entityId, split ("train"|"val"|"test")
   - Booleans: leakageVerified
   - Numbers: txCountObs, monetarySumObs, avgOrderValueObs, recencyAtCutoff, tenureDaysObs, meanEngagementObs, promoShareObs, targetLtvRaw, targetLtvWinsorized, predictedHorizonLtv, currentObservedLtv, projectedFutureLtv, horizonEventsCount
   - Groupable: split, leakageVerified
3. mdp_transitions (offline_rl_mdp, ${body.mdpTransitionCount ?? 'unknown'} transitions):
   - Strings/Categories: transitionId, entityId, split ("train"|"val"|"test"), actionLabel, terminalReason ("none"|"inactivity_gap"|"horizon_end"|"absorbing")
   - Booleans: isLowSupportOod
   - Numbers: stepIdx, timestampDay, actionId, rewardRaw, rewardScaled, returnToGo, behaviorPropensity, supportCount, done (0|1), stateCumSpend, stateEngagement, stateFrequency, stateRecency
   - Groupable: split, actionLabel, terminalReason, isLowSupportOod

Active Dataset Context:
- Dataset: ${body.datasetName ?? 'Active Workspace'} (${body.datasetDomain ?? 'Behavioral ML'})
- Entities: ${body.entityCount ?? 'unknown'} | T_obs cutoff day: ${body.obsCutoffDay ?? 180}
- Available channels (use exact casing or "contains"): ${(body.channels ?? []).join(', ') || 'various'}
- Available actionLabels: ${(body.actionLabels ?? []).join(', ') || 'various'}
`.trim();

    const promptText = [
      'Translate the following natural language analytics question into a structured Stratum query plan.',
      schemaDoc,
      `User Question: "${question}"`,
    ].join('\n\n');

    const callWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              systemInstruction:
                'You are the Stratum Natural Language-to-Query Compiler. Accurately map English questions onto one of the 3 Stratum tables (events, regression_rows, mdp_transitions) using only valid camelCase field names from the schema.',
              responseMimeType: 'application/json',
              responseSchema: nlQuerySchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isNonRetryable =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('NOT_FOUND');
          if (isNonRetryable || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    try {
      const response = await callWithRetry();
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty query plan. Please try rephrasing.',
        });
        return;
      }

      const raw = JSON.parse(rawJson) as {
        targetTable: 'events' | 'regression_rows' | 'mdp_transitions';
        intentSummary: string;
        sqlPreview: string;
        filters: Array<{ field: string; op: string; valueText: string }>;
        groupBy: string;
        metrics: Array<{ field: string; agg: string; alias: string }>;
        sortByField: string;
        sortDirection: 'asc' | 'desc';
        limit: number;
        chartType: 'bar' | 'none';
      };

      const parsedFilters = (Array.isArray(raw.filters) ? raw.filters : []).map((f, idx) => {
        const vt = String(f.valueText ?? '').trim();
        let typedVal: string | number | boolean = vt;
        if (/^(true|false)$/i.test(vt)) {
          typedVal = vt.toLowerCase() === 'true';
        } else if (vt !== '' && !Number.isNaN(Number(vt))) {
          typedVal = Number(vt);
        }
        return {
          id: `nlf-${idx}-${Date.now().toString(36)}`,
          field: f.field,
          op: f.op,
          value: typedVal,
        };
      });

      res.json({
        plan: {
          question,
          targetTable: raw.targetTable,
          intentSummary: raw.intentSummary,
          sqlPreview: raw.sqlPreview,
          filters: parsedFilters,
          groupBy: raw.groupBy === 'none' ? null : raw.groupBy,
          metrics: Array.isArray(raw.metrics) ? raw.metrics : [],
          sortBy: {
            field: raw.sortByField,
            direction: raw.sortDirection === 'asc' ? 'asc' : 'desc',
          },
          limit: Math.max(1, Math.min(200, Math.round(raw.limit || 25))),
          chartType: raw.chartType === 'bar' ? 'bar' : 'none',
          model: 'gemini-4-hydrogen',
          compiledAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let statusCode = 500;
      let friendly = rawMessage;
      if (
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        statusCode = 403;
        friendly =
          'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        statusCode = 429;
        friendly =
          'Gemini API quota exceeded. Please try again shortly or verify your billing tier in Settings > Secrets.';
      } else if (rawMessage.includes('NOT_FOUND')) {
        statusCode = 404;
        friendly =
          'Requested Gemini model (gemini-4-hydrogen) was not found or is unavailable.';
      }
      res.status(statusCode).json({ error: friendly });
    }
  });

  app.post('/api/feature-engineering', async (req, res) => {
    const body = req.body as {
      datasetName?: string;
      datasetDomain?: string;
      goal?: string;
      targetParadigm?: string;
      baseLinearR2?: number;
      highCollinearityCount?: number;
      evaluatedCandidates?: Array<{
        id: string;
        label: string;
        pearsonR: number;
        univariateR2: number;
        maxExistingCollinearityR: number;
        mostCorrelatedWith: string;
        trainValKlDrift: number;
        recommendationTier: string;
      }>;
    };

    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({
        error: 'Gemini API key is not configured on the server. Check Settings > Secrets.',
      });
      return;
    }

    if (!body || !body.datasetName || !Array.isArray(body.evaluatedCandidates)) {
      res.status(400).json({
        error: 'Dataset context and evaluated candidate features are required.',
      });
      return;
    }

    const feSchema = {
      type: Type.OBJECT,
      properties: {
        headline: {
          type: Type.STRING,
          description: 'Crisp 8-14 word summary of the feature engineering recommendation.',
        },
        strategySummary: {
          type: Type.STRING,
          description: '3 sentences explaining which derived features add orthogonal signal without violating VIF collinearity or KL drift.',
        },
        recommendedFeatureIds: {
          type: Type.ARRAY,
          description: 'Subset of candidate feature IDs worth enabling now.',
          items: {
            type: Type.STRING,
            enum: [
              'spend_velocity_slope',
              'spend_volatility_std',
              'ema_to_mean_momentum',
              'peak_to_mean_ratio',
              'engagement_decay_slope',
              'log_tenure_freq_interaction',
              'action_weighted_reward_yield',
            ],
          },
        },
        candidateProposals: {
          type: Type.ARRAY,
          description: '3 to 5 specific feature engineering recommendations grounded in the evaluated metrics.',
          items: {
            type: Type.OBJECT,
            properties: {
              featureIdOrName: { type: Type.STRING },
              rationale: { type: Type.STRING },
              expectedLiftNote: { type: Type.STRING },
              leakageSafeCheck: { type: Type.STRING },
            },
            required: ['featureIdOrName', 'rationale', 'expectedLiftNote', 'leakageSafeCheck'],
          },
        },
        collinearityWarnings: {
          type: Type.ARRAY,
          description: '1 to 3 concrete warnings about redundant or high-KL-drift features.',
          items: { type: Type.STRING },
        },
      },
      required: [
        'headline',
        'strategySummary',
        'recommendedFeatureIds',
        'candidateProposals',
        'collinearityWarnings',
      ],
    };

    const promptText = [
      'Analyze these pre-cutoff derived feature evaluations and recommend an orthogonal, leak-free feature engineering bundle.',
      `Target Paradigm: ${body.targetParadigm ?? 'LTV Regression & RUL Modeling'}`,
      body.goal ? `User Goal: ${body.goal}` : '',
      JSON.stringify(body, null, 2),
    ]
      .filter(Boolean)
      .join('\n\n');

    const callWithRetry = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: promptText,
            config: {
              systemInstruction:
                'You are the Stratum Feature Engineering Assistant. Recommend derived temporal, volatility, momentum, and interaction features grounded strictly in the provided Pearson r, univariate R², collinearity, and KL drift metrics.',
              responseMimeType: 'application/json',
              responseSchema: feSchema,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isNonRetryable =
            msg.includes('API_KEY_INVALID') ||
            msg.includes('PERMISSION_DENIED') ||
            msg.includes('INVALID_ARGUMENT') ||
            msg.includes('NOT_FOUND');
          if (isNonRetryable || attempt === 1) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastErr;
    };

    try {
      const response = await callWithRetry();
      const rawJson = (response.text ?? '').trim();
      if (!rawJson) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try regenerating.',
        });
        return;
      }

      const parsed = JSON.parse(rawJson) as Record<string, unknown>;
      res.json({
        plan: {
          ...parsed,
          model: 'gemini-4-hydrogen',
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      let statusCode = 500;
      let friendly = rawMessage;
      if (
        rawMessage.includes('API_KEY_INVALID') ||
        rawMessage.includes('PERMISSION_DENIED')
      ) {
        statusCode = 403;
        friendly =
          'Gemini API key is invalid or unauthorized. Please verify your key in Settings > Secrets.';
      } else if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        statusCode = 429;
        friendly =
          'Gemini API quota exceeded. Please try again shortly or verify your billing tier in Settings > Secrets.';
      } else if (rawMessage.includes('NOT_FOUND')) {
        statusCode = 404;
        friendly =
          'Requested Gemini model (gemini-4-hydrogen) was not found or is unavailable.';
      }
      res.status(statusCode).json({ error: friendly });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Stratum server listening on http://localhost:${PORT}`);
  });
}

startServer();
