import {
  AutoDocAiNarrative,
  AutoDocBundle,
  AutoDocColumnStat,
  AutoDocTemplateMode,
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  PiiMaskingConfig,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
} from '../types/curation';
import {
  assignEntitySplit,
  buildMdpDataset,
  buildRegressionDataset,
  buildSequenceDataset,
  computeDataHealthScorecard,
  REGRESSION_FEATURE_CATALOG,
  runCrossParadigmAudit,
} from './curationEngine';
import { CANONICAL_AND_MATERIALIZED_FIELDS } from './datasetSearchEngine';

function fmtNum(val: number, decimals = 2): string {
  if (!Number.isFinite(val)) return '—';
  if (Math.abs(val) >= 10000) {
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return val.toFixed(decimals);
}

function computeNumericColumnStat(
  values: number[],
  columnName: string,
  sourceTable: AutoDocColumnStat['sourceTable'],
  dataType: 'integer' | 'float',
  description: string,
  piiHandling: string
): AutoDocColumnStat {
  const n = values.length;
  if (n === 0) {
    return {
      columnName,
      sourceTable,
      dataType,
      description,
      nonNullRatePct: 0,
      distinctCount: 0,
      zeroRatePct: 0,
      minVal: '—',
      p50Val: '—',
      maxVal: '—',
      meanVal: '—',
      stdVal: '—',
      sampleValues: [],
      piiHandling,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  let zeroCount = 0;
  const distinct = new Set<number>();
  for (const v of sorted) {
    sum += v;
    if (v === 0) zeroCount += 1;
    if (distinct.size < 2000) distinct.add(v);
  }
  const mean = sum / n;
  let sqDiff = 0;
  for (const v of sorted) {
    const d = v - mean;
    sqDiff += d * d;
  }
  const std = Math.sqrt(sqDiff / n);
  const p50 = sorted[Math.floor((n - 1) * 0.5)];
  const dec = dataType === 'integer' ? 0 : 2;

  const samples = Array.from(distinct)
    .slice(0, 3)
    .map((v) => fmtNum(v, dec));

  return {
    columnName,
    sourceTable,
    dataType,
    description,
    nonNullRatePct: 100,
    distinctCount: distinct.size,
    zeroRatePct: (zeroCount / n) * 100,
    minVal: fmtNum(sorted[0], dec),
    p50Val: fmtNum(p50, dec),
    maxVal: fmtNum(sorted[n - 1], dec),
    meanVal: fmtNum(mean, 2),
    stdVal: fmtNum(std, 2),
    sampleValues: samples,
    piiHandling,
  };
}

function computeStringColumnStat(
  values: string[],
  columnName: string,
  sourceTable: AutoDocColumnStat['sourceTable'],
  description: string,
  piiHandling: string
): AutoDocColumnStat {
  const n = values.length;
  let nonEmpty = 0;
  const distinct = new Set<string>();
  for (const v of values) {
    if (v && v.trim().length > 0) nonEmpty += 1;
    distinct.add(v);
  }

  return {
    columnName,
    sourceTable,
    dataType: 'string',
    description,
    nonNullRatePct: n > 0 ? (nonEmpty / n) * 100 : 0,
    distinctCount: distinct.size,
    zeroRatePct: null,
    minVal: '—',
    p50Val: '—',
    maxVal: '—',
    meanVal: '—',
    stdVal: '—',
    sampleValues: Array.from(distinct).slice(0, 3),
    piiHandling,
  };
}

export function buildAutoDocumentation(params: {
  datasetId: string;
  datasetName: string;
  datasetDomain: string;
  datasetDescription: string;
  isCustomDataset: boolean;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  piiMasking: PiiMaskingConfig;
  // Pass precomputed results when documenting active workspace to save work
  precomputed?: {
    regResult: RegressionResult;
    seqResult: SequenceResult;
    mdpResult: MdpResult;
  };
}): AutoDocBundle {
  const {
    datasetId,
    datasetName,
    datasetDomain,
    datasetDescription,
    isCustomDataset,
    events,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    piiMasking,
    precomputed,
  } = params;

  const regResult =
    precomputed?.regResult ?? buildRegressionDataset(events, regConfig, globalConfig);
  const seqResult =
    precomputed?.seqResult ?? buildSequenceDataset(events, seqConfig, globalConfig);
  const mdpResult =
    precomputed?.mdpResult ?? buildMdpDataset(events, mdpConfig, globalConfig);

  const healthScorecard = computeDataHealthScorecard(events);
  const audits = runCrossParadigmAudit(
    events,
    regResult,
    seqResult,
    mdpResult,
    globalConfig
  );

  const entitySplits = new Map<string, 'train' | 'val' | 'test'>();
  const channelCounts = new Map<string, number>();
  const actionStats = new Map<
    number,
    { label: string; count: number; rewardSum: number }
  >();
  let minDay = events.length > 0 ? Infinity : 0;
  let maxDay = events.length > 0 ? -Infinity : 0;

  for (const ev of events) {
    if (!entitySplits.has(ev.entityId)) {
      entitySplits.set(ev.entityId, assignEntitySplit(ev.entityId, globalConfig));
    }
    channelCounts.set(ev.channel, (channelCounts.get(ev.channel) ?? 0) + 1);
    const existingAction = actionStats.get(ev.actionId) ?? {
      label: ev.actionLabel,
      count: 0,
      rewardSum: 0,
    };
    existingAction.count += 1;
    existingAction.rewardSum += ev.reward;
    actionStats.set(ev.actionId, existingAction);

    if (ev.timestampDay < minDay) minDay = ev.timestampDay;
    if (ev.timestampDay > maxDay) maxDay = ev.timestampDay;
  }

  let trainEntities = 0;
  let valEntities = 0;
  let testEntities = 0;
  for (const sp of entitySplits.values()) {
    if (sp === 'train') trainEntities += 1;
    else if (sp === 'val') valEntities += 1;
    else testEntities += 1;
  }

  const totalEv = Math.max(1, events.length);
  const channels = Array.from(channelCounts.entries())
    .map(([name, count]) => ({
      name,
      count,
      sharePct: (count / totalEv) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const actionSpace = Array.from(actionStats.entries())
    .map(([id, st]) => ({
      id,
      label: st.label,
      count: st.count,
      sharePct: (st.count / totalEv) * 100,
      meanReward: st.rewardSum / Math.max(1, st.count),
    }))
    .sort((a, b) => a.id - b.id);

  const fieldDescMap = new Map(
    CANONICAL_AND_MATERIALIZED_FIELDS.map((f) => [f.columnName, f.description])
  );
  const idMaskNote = piiMasking.enabled
    ? `Masked (${piiMasking.mode.toUpperCase()})`
    : 'Raw identifier (masking optional)';

  const canonicalDictionary: AutoDocColumnStat[] = [
    computeStringColumnStat(
      events.map((e) => e.eventId),
      'event_id',
      'canonical_events',
      fieldDescMap.get('event_id') ?? '',
      idMaskNote
    ),
    computeStringColumnStat(
      events.map((e) => e.entityId),
      'entity_id',
      'canonical_events',
      fieldDescMap.get('entity_id') ?? '',
      idMaskNote
    ),
    computeNumericColumnStat(
      events.map((e) => e.timestampDay),
      'timestamp_day',
      'canonical_events',
      'integer',
      fieldDescMap.get('timestamp_day') ?? '',
      'Non-PII temporal index'
    ),
    computeNumericColumnStat(
      events.map((e) => e.actionId),
      'action_id',
      'canonical_events',
      'integer',
      fieldDescMap.get('action_id') ?? '',
      'Non-PII discrete action'
    ),
    computeStringColumnStat(
      events.map((e) => e.actionLabel),
      'action_label',
      'canonical_events',
      fieldDescMap.get('action_label') ?? '',
      'Non-PII label'
    ),
    computeStringColumnStat(
      events.map((e) => e.channel),
      'channel',
      'canonical_events',
      fieldDescMap.get('channel') ?? '',
      'Non-PII channel'
    ),
    computeNumericColumnStat(
      events.map((e) => e.recencyDays),
      'recency_days',
      'canonical_events',
      'integer',
      fieldDescMap.get('recency_days') ?? '',
      'Non-PII behavioral metric'
    ),
    computeNumericColumnStat(
      events.map((e) => e.frequencyCount),
      'frequency_count',
      'canonical_events',
      'integer',
      fieldDescMap.get('frequency_count') ?? '',
      'Non-PII behavioral metric'
    ),
    computeNumericColumnStat(
      events.map((e) => e.spendAmount),
      'spend_amount',
      'canonical_events',
      'float',
      fieldDescMap.get('spend_amount') ?? '',
      'Financial transaction metric'
    ),
    computeNumericColumnStat(
      events.map((e) => e.engagementScore),
      'engagement_score',
      'canonical_events',
      'float',
      fieldDescMap.get('engagement_score') ?? '',
      'Non-PII score [0, 1]'
    ),
    computeNumericColumnStat(
      events.map((e) => e.reward),
      'reward',
      'canonical_events',
      'float',
      fieldDescMap.get('reward') ?? '',
      'Non-PII scalar reward'
    ),
    computeNumericColumnStat(
      events.map((e) => e.propensity),
      'propensity',
      'canonical_events',
      'float',
      fieldDescMap.get('propensity') ?? '',
      'Logging policy probability'
    ),
  ];

  // Derived ML dictionary from materialized Regression & MDP tables
  const derivedDictionary: AutoDocColumnStat[] = [];
  for (const feat of REGRESSION_FEATURE_CATALOG) {
    const vals = regResult.rows.map((r) => Number(r[feat.key]));
    derivedDictionary.push(
      computeNumericColumnStat(
        vals,
        feat.csvColumn,
        'regression_ltv',
        feat.key === 'txCountObs' ? 'integer' : 'float',
        fieldDescMap.get(feat.csvColumn) ?? feat.label,
        'Point-in-time feature (<= T_obs)'
      )
    );
  }
  derivedDictionary.push(
    computeNumericColumnStat(
      regResult.rows.map((r) => r.targetLtvWinsorized),
      'target_ltv_winsorized',
      'regression_ltv',
      'float',
      fieldDescMap.get('target_ltv_winsorized') ?? '',
      'Future horizon target'
    )
  );
  derivedDictionary.push(
    computeNumericColumnStat(
      mdpResult.transitions.map((t) => t.returnToGo),
      'return_to_go',
      'offline_rl_mdp',
      'float',
      fieldDescMap.get('return_to_go') ?? '',
      'Discounted trajectory return'
    )
  );

  const topDrivers = [...regResult.linearFit.features]
    .sort((a, b) => b.importanceShare - a.importanceShare)
    .slice(0, 5)
    .map((f) => {
      const cat = REGRESSION_FEATURE_CATALOG.find((c) => c.key === f.feature);
      return {
        label: f.label,
        csvColumn: cat?.csvColumn ?? f.feature,
        importanceSharePct: f.importanceShare,
        direction: f.direction,
      };
    });

  return {
    generatedAtIso: new Date().toISOString(),
    datasetId,
    datasetName,
    datasetDomain,
    datasetDescription,
    isCustomDataset,
    entityCount: entitySplits.size,
    eventCount: events.length,
    dayRange: [Number.isFinite(minDay) ? minDay : 0, Number.isFinite(maxDay) ? maxDay : 0],
    channels,
    actionSpace,
    splitSummary: {
      trainRatio: globalConfig.trainRatio,
      valRatio: globalConfig.valRatio,
      testRatio: globalConfig.testRatio,
      seedSalt: globalConfig.seedSalt,
      trainEntities,
      valEntities,
      testEntities,
    },
    healthScorecard,
    audits,
    canonicalDictionary,
    derivedDictionary,
    regressionSpec: {
      obsCutoffDay: regConfig.obsCutoffDay,
      horizonDays: regConfig.horizonDays,
      winsorizePercentile: regConfig.winsorizePercentile,
      normalization: regConfig.featureNormalization,
      rowCount: regResult.rows.length,
      rSquared: regResult.linearFit.rSquared,
      rmse: regResult.linearFit.rmse,
      mae: regResult.linearFit.mae,
      meanProjectedLtv: regResult.linearFit.meanProjectedLtv,
      zeroTargetRatePct: regResult.zeroTargetRate * 100,
      maxKlDivergence: regResult.driftReport.maxKlDivergence,
      driftTier: regResult.driftReport.tier,
      outlierCount: regResult.anomalyReport.outlierCount,
      highCollinearityCount: regResult.featureMatrix.highCollinearityPairs.length,
      topDrivers,
    },
    sequenceSpec: {
      tensorShape: seqResult.tensorShape,
      maxSeqLen: seqConfig.maxSeqLen,
      padding: seqConfig.padding,
      truncation: seqConfig.truncation,
      normalization: seqConfig.normalization,
      paddingSparsityPct: seqResult.paddingSparsity * 100,
      meanActualLength: seqResult.meanActualLength,
      architectureLabel: seqResult.transformerEval.architectureLabel,
      dModel: seqResult.transformerEval.dModel,
      numHeads: seqResult.transformerEval.numHeads,
      numLayers: seqResult.transformerEval.numLayers,
      holdoutR2: seqResult.transformerEval.holdoutMetrics.rSquared,
      valLoss:
        seqResult.transformerEval.lossCurve.bestValLoss ??
        seqResult.transformerEval.lossCurve.finalValLoss,
      diagnosisLabel: seqResult.transformerEval.lossCurve.diagnosisLabel,
    },
    mdpSpec: {
      gamma: mdpConfig.gamma,
      terminalInactivityGapDays: mdpConfig.terminalInactivityGapDays,
      rewardScale: mdpConfig.rewardScale,
      trajectoryCount: mdpResult.trajectoryCount,
      transitionCount: mdpResult.transitions.length,
      terminalCount: mdpResult.terminalCount,
      meanTrajectoryLength: mdpResult.meanTrajectoryLength,
      meanInitialReturn: mdpResult.meanInitialReturn,
      lowSupportOodRatePct: mdpResult.lowSupportOodRate * 100,
    },
    piiMasking,
  };
}

export function formatAutoDocMarkdown(
  doc: AutoDocBundle,
  template: AutoDocTemplateMode,
  aiNarrative: AutoDocAiNarrative | null
): string {
  const lines: string[] = [];
  const docTitle =
    template === 'data_dictionary'
      ? `${doc.datasetName} — Data Dictionary & Schema Specification`
      : template === 'executive_brief'
        ? `${doc.datasetName} — Executive Data & Model Brief`
        : `${doc.datasetName} — ML Dataset & Model Card`;

  lines.push(`# ${docTitle}`);
  lines.push('');
  lines.push(
    `**Domain:** ${doc.datasetDomain} | **Entities:** ${doc.entityCount.toLocaleString()} | **Events:** ${doc.eventCount.toLocaleString()} | **Span:** Days ${doc.dayRange[0]}–${doc.dayRange[1]} | **Generated:** ${doc.generatedAtIso}`
  );
  lines.push('');
  lines.push(`> ${doc.datasetDescription}`);
  lines.push('');

  if (aiNarrative) {
    lines.push('## AI-Synthesized Model Card Narrative');
    lines.push('');
    lines.push(`### ${aiNarrative.headline}`);
    lines.push('');
    lines.push(aiNarrative.executiveAbstract);
    lines.push('');
    lines.push('**Intended Use Cases**');
    for (const u of aiNarrative.intendedUseCases) lines.push(`- ${u}`);
    lines.push('');
    lines.push('**Out-of-Scope / Cautionary Uses**');
    for (const o of aiNarrative.outOfScopeUses) lines.push(`- ${o}`);
    lines.push('');
    lines.push('**Key Data Quality & Risk Caveats**');
    for (const r of aiNarrative.biasAndRiskCaveats) lines.push(`- ${r}`);
    lines.push('');
    lines.push('**Recommended Curation Actions**');
    for (const a of aiNarrative.curationRecommendations) lines.push(`- ${a}`);
    lines.push('');
    lines.push(`**Downstream Modeling Guidance:** ${aiNarrative.downstreamModelingGuidance}`);
    lines.push('');
  }

  lines.push('## 1. Dataset Overview & Deterministic Split Parity');
  lines.push('');
  lines.push(
    `- **Entity-Hash Split (FNV-1a):** ${Math.round(doc.splitSummary.trainRatio * 100)}% Train (${doc.splitSummary.trainEntities} entities) / ${Math.round(doc.splitSummary.valRatio * 100)}% Val (${doc.splitSummary.valEntities} entities) / ${Math.round(doc.splitSummary.testRatio * 100)}% Test (${doc.splitSummary.testEntities} entities)`
  );
  lines.push(`- **Split Hash Salt:** \`${doc.splitSummary.seedSalt}\``);
  lines.push(
    `- **PII Governance:** ${doc.piiMasking.enabled ? `Enabled (${doc.piiMasking.mode})` : 'Disabled (raw entity_id & event_id)'}`
  );
  lines.push('');

  lines.push('### Channels');
  lines.push('| Channel | Events | Share |');
  lines.push('| --- | ---: | ---: |');
  for (const ch of doc.channels) {
    lines.push(`| ${ch.name} | ${ch.count.toLocaleString()} | ${ch.sharePct.toFixed(1)}% |`);
  }
  lines.push('');

  lines.push('### Action / Intervention Space');
  lines.push('| Action ID | Label | Events | Share | Mean Reward |');
  lines.push('| ---: | --- | ---: | ---: | ---: |');
  for (const act of doc.actionSpace) {
    lines.push(
      `| ${act.id} | ${act.label} | ${act.count.toLocaleString()} | ${act.sharePct.toFixed(1)}% | ${act.meanReward.toFixed(2)} |`
    );
  }
  lines.push('');

  lines.push('## 2. Data Health & Cross-Paradigm Audit');
  lines.push('');
  lines.push(
    `**Health Score:** ${doc.healthScorecard.score}/100 (${doc.healthScorecard.tierLabel}) — ${doc.healthScorecard.passCount} Pass, ${doc.healthScorecard.warnCount} Warn, ${doc.healthScorecard.failCount} Fail`
  );
  lines.push('');
  lines.push('| Check | Category | Status | Metric Summary |');
  lines.push('| --- | --- | --- | --- |');
  for (const chk of doc.healthScorecard.checks) {
    lines.push(
      `| ${chk.label} | ${chk.category} | ${chk.status.toUpperCase()} | ${chk.metricSummary} |`
    );
  }
  lines.push('');

  if (template !== 'executive_brief') {
    lines.push('## 3. Canonical Event Schema & Data Dictionary');
    lines.push('');
    lines.push(
      '| Column | Type | Non-Null | Distinct | Min | Median | Max | Mean ± Std | Description |'
    );
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
    for (const col of doc.canonicalDictionary) {
      const meanStd = col.meanVal === '—' ? '—' : `${col.meanVal} ± ${col.stdVal}`;
      lines.push(
        `| \`${col.columnName}\` | ${col.dataType} | ${col.nonNullRatePct.toFixed(1)}% | ${col.distinctCount.toLocaleString()} | ${col.minVal} | ${col.p50Val} | ${col.maxVal} | ${meanStd} | ${col.description} |`
      );
    }
    lines.push('');

    lines.push('### Materialized ML Feature Dictionary');
    lines.push('');
    lines.push('| Column | Table | Type | Min | Median | Max | Mean ± Std | Description |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | --- |');
    for (const col of doc.derivedDictionary) {
      const meanStd = col.meanVal === '—' ? '—' : `${col.meanVal} ± ${col.stdVal}`;
      lines.push(
        `| \`${col.columnName}\` | ${col.sourceTable} | ${col.dataType} | ${col.minVal} | ${col.p50Val} | ${col.maxVal} | ${meanStd} | ${col.description} |`
      );
    }
    lines.push('');
  }

  if (template !== 'data_dictionary') {
    lines.push('## 4. Materialized ML Paradigm Specifications');
    lines.push('');
    lines.push('### A. Traditional Regression (LTV)');
    lines.push(
      `- **Windowing:** \`T_obs = ${doc.regressionSpec.obsCutoffDay}d\`, \`Horizon H = ${doc.regressionSpec.horizonDays}d\`, Winsorization = \`P${doc.regressionSpec.winsorizePercentile}\`, Scaling = \`${doc.regressionSpec.normalization}\``
    );
    lines.push(
      `- **Model Fit (${doc.regressionSpec.rowCount} rows):** \`R² = ${doc.regressionSpec.rSquared.toFixed(4)}\`, \`RMSE = $${doc.regressionSpec.rmse.toFixed(2)}\`, \`MAE = $${doc.regressionSpec.mae.toFixed(2)}\`, Projected Mean LTV = \`$${doc.regressionSpec.meanProjectedLtv.toFixed(2)}\``
    );
    lines.push(
      `- **Diagnostics:** Zero-target rate = ${doc.regressionSpec.zeroTargetRatePct.toFixed(1)}%, Max KL Drift = ${doc.regressionSpec.maxKlDivergence.toFixed(3)} nats (${doc.regressionSpec.driftTier}), Outliers = ${doc.regressionSpec.outlierCount}, High Collinearity Pairs = ${doc.regressionSpec.highCollinearityCount}`
    );
    lines.push('');

    lines.push('### B. Deep Learning (Sequential Tensors)');
    lines.push(
      `- **Tensor Shape:** \`[${doc.sequenceSpec.tensorShape.join(', ')}]\` (maxSeqLen=${doc.sequenceSpec.maxSeqLen}, padding=${doc.sequenceSpec.padding}, truncation=${doc.sequenceSpec.truncation}, norm=${doc.sequenceSpec.normalization})`
    );
    lines.push(
      `- **Architecture:** ${doc.sequenceSpec.architectureLabel} (\`d_model=${doc.sequenceSpec.dModel}\`, \`heads=${doc.sequenceSpec.numHeads}\`, \`layers=${doc.sequenceSpec.numLayers}\`) · Holdout R² = ${doc.sequenceSpec.holdoutR2 !== null ? doc.sequenceSpec.holdoutR2.toFixed(4) : 'N/A'} · Fit Status: ${doc.sequenceSpec.diagnosisLabel}`
    );
    lines.push('');

    lines.push('### C. Offline RL (CQL / MDP)');
    lines.push(
      `- **MDP Spec:** \`γ = ${doc.mdpSpec.gamma.toFixed(2)}\`, Terminal Inactivity Gap = \`${doc.mdpSpec.terminalInactivityGapDays}d\`, Reward Scale = \`${doc.mdpSpec.rewardScale}\``
    );
    lines.push(
      `- **Replay Buffer:** ${doc.mdpSpec.trajectoryCount.toLocaleString()} trajectories, ${doc.mdpSpec.transitionCount.toLocaleString()} transitions, Mean Initial Return G₀ = ${doc.mdpSpec.meanInitialReturn.toFixed(2)}, Low-Support OOD Rate = ${doc.mdpSpec.lowSupportOodRatePct.toFixed(1)}%`
    );
    lines.push('');
  }

  lines.push('## 5. Cross-Paradigm Integrity Audits');
  lines.push('');
  lines.push('| Audit | Paradigm | Status | Metric | Detail |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const a of doc.audits) {
    lines.push(`| ${a.name} | ${a.paradigm} | ${a.status.toUpperCase()} | ${a.metricValue} | ${a.detail} |`);
  }

  return lines.join('\n');
}

export function formatAutoDocHtml(
  doc: AutoDocBundle,
  template: AutoDocTemplateMode,
  aiNarrative: AutoDocAiNarrative | null
): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const mdEscaped = esc(formatAutoDocMarkdown(doc, template, aiNarrative));
  const canonicalRows = doc.canonicalDictionary
    .map(
      (c) => `<tr>
        <td><code>${esc(c.columnName)}</code></td>
        <td>${esc(c.dataType)}</td>
        <td class="num">${c.nonNullRatePct.toFixed(1)}%</td>
        <td class="num">${c.distinctCount}</td>
        <td class="num">${esc(c.minVal)}</td>
        <td class="num">${esc(c.p50Val)}</td>
        <td class="num">${esc(c.maxVal)}</td>
        <td class="num">${c.meanVal === '—' ? '—' : `${esc(c.meanVal)} ± ${esc(c.stdVal)}`}</td>
        <td>${esc(c.description)}</td>
      </tr>`
    )
    .join('\n');

  const aiHtml = aiNarrative
    ? `<section>
        <h2>AI-Synthesized Model Card Narrative</h2>
        <h3>${esc(aiNarrative.headline)}</h3>
        <p>${esc(aiNarrative.executiveAbstract)}</p>
        <h4>Intended Use Cases</h4>
        <ul>${aiNarrative.intendedUseCases.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
        <h4>Bias &amp; Risk Caveats</h4>
        <ul>${aiNarrative.biasAndRiskCaveats.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <h4>Recommended Curation Actions</h4>
        <ul>${aiNarrative.curationRecommendations.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${esc(doc.datasetName)} — Stratum Auto Documentation</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; max-width: 980px; margin: 40px auto; padding: 0 24px; line-height: 1.6; }
    h1 { font-size: 26px; margin-bottom: 6px; }
    h2 { font-size: 18px; margin-top: 32px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .meta { color: #475569; font-size: 13px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${esc(doc.datasetName)}</h1>
  <div class="meta">${esc(doc.datasetDomain)} · ${doc.entityCount.toLocaleString()} entities · ${doc.eventCount.toLocaleString()} events · Days ${doc.dayRange[0]}–${doc.dayRange[1]} · Health ${doc.healthScorecard.score}/100</div>
  <p>${esc(doc.datasetDescription)}</p>
  ${aiHtml}
  <h2>Canonical Event Data Dictionary</h2>
  <table>
    <thead><tr><th>Column</th><th>Type</th><th>Non-Null</th><th>Distinct</th><th>Min</th><th>Median</th><th>Max</th><th>Mean ± Std</th><th>Description</th></tr></thead>
    <tbody>${canonicalRows}</tbody>
  </table>
  <h2>Full Markdown Specification</h2>
  <pre>${mdEscaped}</pre>
</body>
</html>`;
}

export function formatAutoDocJson(
  doc: AutoDocBundle,
  aiNarrative: AutoDocAiNarrative | null
): string {
  return JSON.stringify(
    {
      schemaVersion: 'stratum.datacard.v1',
      ...doc,
      aiNarrative,
    },
    null,
    2
  );
}
