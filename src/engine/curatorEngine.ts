import {
  CurationRuleId,
  CurationRuleSpec,
  CurationTransformResult,
  CuratorFinding,
  CuratorProfileReport,
  MdpResult,
  RawEvent,
  RegressionResult,
  SequenceResult,
} from '../types/curation';
import { computeDataHealthScorecard } from './curationEngine';

export const CURATION_RULE_META: Record<
  CurationRuleId,
  { label: string; category: string; description: string; action: 'removed' | 'modified' }
> = {
  deduplicate_events: {
    label: 'Deduplicate Same-Day Action Collisions',
    category: 'Uniqueness',
    description:
      'Collapses duplicate (entityId, timestampDay, actionId) collisions, keeping the highest-spend event record.',
    action: 'removed',
  },
  clip_negative_rewards: {
    label: 'Floor Negative Rewards at 0.0',
    category: 'Reward Integrity',
    description:
      'Clamps negative scalar rewards (< 0) to 0.00 to eliminate destabilizing Bellman penalties in CQL/MDP.',
    action: 'modified',
  },
  winsorize_spend_tail: {
    label: 'Winsorize P99 Spend Outliers',
    category: 'Tail Stability',
    description:
      'Caps extreme spendAmount values at the 99th percentile to reduce OLS leverage and gradient spikes.',
    action: 'modified',
  },
  clamp_propensity_bounds: {
    label: 'Clamp Policy Propensity to [0.05, 0.95]',
    category: 'Offline RL Support',
    description:
      'Enforces safe logging-policy propensity bounds [0.05, 0.95] to prevent inverse-propensity blowups.',
    action: 'modified',
  },
  filter_single_touch_entities: {
    label: 'Prune Single-Event Stub Entities',
    category: 'Trajectory Coverage',
    description:
      'Excludes entities with only 1 logged event that cannot form valid multi-step sequences or MDP transitions.',
    action: 'removed',
  },
  clamp_engagement_unit: {
    label: 'Repair Engagement & Recency Bounds',
    category: 'Schema Bounds',
    description:
      'Clamps engagementScore into [0, 1] and ensures non-negative recencyDays and spendAmount.',
    action: 'modified',
  },
};

function computePercentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * pct))
  );
  return sorted[idx];
}

export function applyCurationRulesToEvents(
  rawEvents: RawEvent[],
  appliedRules: CurationRuleId[]
): CurationTransformResult {
  const ruleSet = new Set<CurationRuleId>(appliedRules);
  const ruleBreakdown: Record<
    CurationRuleId,
    { affected: number; action: 'removed' | 'modified' }
  > = {
    deduplicate_events: { affected: 0, action: 'removed' },
    clip_negative_rewards: { affected: 0, action: 'modified' },
    winsorize_spend_tail: { affected: 0, action: 'modified' },
    clamp_propensity_bounds: { affected: 0, action: 'modified' },
    filter_single_touch_entities: { affected: 0, action: 'removed' },
    clamp_engagement_unit: { affected: 0, action: 'modified' },
  };

  if (rawEvents.length === 0 || ruleSet.size === 0) {
    const rawEntities = new Set(rawEvents.map((e) => e.entityId)).size;
    return {
      events: rawEvents,
      appliedRules: [],
      rawEventCount: rawEvents.length,
      curatedEventCount: rawEvents.length,
      rawEntityCount: rawEntities,
      curatedEntityCount: rawEntities,
      removedEventCount: 0,
      modifiedEventCount: 0,
      ruleBreakdown,
    };
  }

  let working: RawEvent[] = rawEvents.map((ev) => ({ ...ev }));

  // 1. Deduplicate (entityId, timestampDay, actionId)
  if (ruleSet.has('deduplicate_events')) {
    const bestByKey = new Map<string, RawEvent>();
    for (const ev of working) {
      const key = `${ev.entityId}::${ev.timestampDay}::${ev.actionId}`;
      const existing = bestByKey.get(key);
      if (!existing || ev.spendAmount > existing.spendAmount) {
        bestByKey.set(key, ev);
      }
    }
    const deduped = Array.from(bestByKey.values());
    ruleBreakdown.deduplicate_events.affected = working.length - deduped.length;
    working = deduped;
  }

  // 2. Filter single-touch entities
  if (ruleSet.has('filter_single_touch_entities')) {
    const countByEntity = new Map<string, number>();
    for (const ev of working) {
      countByEntity.set(ev.entityId, (countByEntity.get(ev.entityId) ?? 0) + 1);
    }
    const filtered = working.filter((ev) => (countByEntity.get(ev.entityId) ?? 0) >= 2);
    ruleBreakdown.filter_single_touch_entities.affected = working.length - filtered.length;
    working = filtered;
  }

  // Compute P99 spend cap on working stream if winsorizing
  const sortedSpend = [...working.map((e) => e.spendAmount)].sort((a, b) => a - b);
  const p99SpendCap = computePercentile(sortedSpend, 0.99);

  const modifiedIds = new Set<string>();

  for (const ev of working) {
    if (ruleSet.has('clip_negative_rewards') && ev.reward < 0) {
      ev.reward = 0;
      ruleBreakdown.clip_negative_rewards.affected += 1;
      modifiedIds.add(ev.eventId);
    }

    if (
      ruleSet.has('winsorize_spend_tail') &&
      p99SpendCap > 0 &&
      ev.spendAmount > p99SpendCap
    ) {
      ev.spendAmount = Math.round(p99SpendCap * 100) / 100;
      ruleBreakdown.winsorize_spend_tail.affected += 1;
      modifiedIds.add(ev.eventId);
    }

    if (
      ruleSet.has('clamp_propensity_bounds') &&
      (ev.propensity < 0.05 || ev.propensity > 0.95)
    ) {
      ev.propensity = Math.round(Math.min(0.95, Math.max(0.05, ev.propensity)) * 1000) / 1000;
      ruleBreakdown.clamp_propensity_bounds.affected += 1;
      modifiedIds.add(ev.eventId);
    }

    if (
      ruleSet.has('clamp_engagement_unit') &&
      (ev.engagementScore < 0 ||
        ev.engagementScore > 1 ||
        ev.recencyDays < 0 ||
        ev.spendAmount < 0)
    ) {
      ev.engagementScore =
        Math.round(Math.min(1, Math.max(0, ev.engagementScore)) * 1000) / 1000;
      ev.recencyDays = Math.max(0, ev.recencyDays);
      ev.spendAmount = Math.max(0, ev.spendAmount);
      ruleBreakdown.clamp_engagement_unit.affected += 1;
      modifiedIds.add(ev.eventId);
    }
  }

  // Re-sort chronologically per entity & maintain sequence consistency if events were removed
  if (
    ruleBreakdown.deduplicate_events.affected > 0 ||
    ruleBreakdown.filter_single_touch_entities.affected > 0
  ) {
    const byEntity = new Map<string, RawEvent[]>();
    for (const ev of working) {
      const list = byEntity.get(ev.entityId) ?? [];
      list.push(ev);
      byEntity.set(ev.entityId, list);
    }
    const normalized: RawEvent[] = [];
    for (const list of byEntity.values()) {
      list.sort((a, b) => a.timestampDay - b.timestampDay);
      let prevDay = list[0]?.timestampDay ?? 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        item.frequencyCount = i + 1;
        item.recencyDays = i === 0 ? 0 : Math.max(0, item.timestampDay - prevDay);
        prevDay = item.timestampDay;
        normalized.push(item);
      }
    }
    working = normalized;
  }

  const rawEntities = new Set(rawEvents.map((e) => e.entityId)).size;
  const curatedEntities = new Set(working.map((e) => e.entityId)).size;

  return {
    events: working,
    appliedRules: Array.from(ruleSet),
    rawEventCount: rawEvents.length,
    curatedEventCount: working.length,
    rawEntityCount: rawEntities,
    curatedEntityCount: curatedEntities,
    removedEventCount: rawEvents.length - working.length,
    modifiedEventCount: modifiedIds.size,
    ruleBreakdown,
  };
}

export function buildCuratorProfileReport(params: {
  rawEvents: RawEvent[];
  curatedEvents: RawEvent[];
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
}): CuratorProfileReport {
  const { rawEvents, curatedEvents, regResult, seqResult, mdpResult } = params;

  const rawHealthScorecard = computeDataHealthScorecard(rawEvents);
  const curatedHealthScorecard = computeDataHealthScorecard(curatedEvents);

  const totalCurated = Math.max(1, curatedEvents.length);
  const rawEntitySet = new Set(rawEvents.map((e) => e.entityId));
  const curatedEntitySet = new Set(curatedEvents.map((e) => e.entityId));

  // Scan active (curated) events to see remaining actionable opportunities
  const dupBuckets = new Map<string, RawEvent[]>();
  const entityEventCounts = new Map<string, number>();
  const negRewardEvents: RawEvent[] = [];
  const lowPropEvents: RawEvent[] = [];
  const outOfBoundsEvents: RawEvent[] = [];

  for (const ev of curatedEvents) {
    const dupKey = `${ev.entityId}::${ev.timestampDay}::${ev.actionId}`;
    const bucket = dupBuckets.get(dupKey) ?? [];
    bucket.push(ev);
    dupBuckets.set(dupKey, bucket);

    entityEventCounts.set(ev.entityId, (entityEventCounts.get(ev.entityId) ?? 0) + 1);

    if (ev.reward < 0) negRewardEvents.push(ev);
    if (ev.propensity < 0.05 || ev.propensity > 0.95) lowPropEvents.push(ev);
    if (
      ev.engagementScore < 0 ||
      ev.engagementScore > 1 ||
      ev.recencyDays < 0 ||
      ev.spendAmount < 0
    ) {
      outOfBoundsEvents.push(ev);
    }
  }

  let duplicateEventCount = 0;
  const dupSamples: RawEvent[] = [];
  const dupEntities = new Set<string>();
  for (const bucket of dupBuckets.values()) {
    if (bucket.length > 1) {
      duplicateEventCount += bucket.length - 1;
      dupEntities.add(bucket[0].entityId);
      if (dupSamples.length < 4) dupSamples.push(bucket[1]);
    }
  }

  const singleTouchEntities = new Set<string>();
  const singleTouchSamples: RawEvent[] = [];
  for (const [eid, cnt] of entityEventCounts.entries()) {
    if (cnt < 2) {
      singleTouchEntities.add(eid);
    }
  }
  if (singleTouchEntities.size > 0) {
    for (const ev of curatedEvents) {
      if (singleTouchEntities.has(ev.entityId)) {
        singleTouchSamples.push(ev);
        if (singleTouchSamples.length >= 4) break;
      }
    }
  }

  const sortedSpend = [...curatedEvents.map((e) => e.spendAmount)].sort((a, b) => a - b);
  const p99SpendCap = computePercentile(sortedSpend, 0.99);
  const tailOutlierEvents = curatedEvents.filter(
    (e) => p99SpendCap > 0 && e.spendAmount > p99SpendCap
  );

  // Also examine low propensity < 0.15 for informational RL support
  const weakSupportEvents = curatedEvents.filter((e) => e.propensity < 0.15);

  const findings: CuratorFinding[] = [];

  if (negRewardEvents.length > 0) {
    findings.push({
      id: 'finding-neg-rewards',
      ruleId: 'clip_negative_rewards',
      category: 'Reward Integrity',
      severity: negRewardEvents.length / totalCurated > 0.03 ? 'critical' : 'warn',
      title: `${negRewardEvents.length} negative-reward events detected`,
      detail:
        'Negative scalar rewards can invert discounted Bellman backups in CQL/Offline RL and distort margin attribution.',
      affectedEvents: negRewardEvents.length,
      affectedEntities: new Set(negRewardEvents.map((e) => e.entityId)).size,
      affectedRatePct: (negRewardEvents.length / totalCurated) * 100,
      sampleRows: negRewardEvents.slice(0, 4).map((e) => ({
        eventId: e.eventId,
        entityId: e.entityId,
        timestampDay: e.timestampDay,
        metricLabel: 'Reward',
        metricValue: e.reward.toFixed(2),
      })),
    });
  }

  if (duplicateEventCount > 0) {
    findings.push({
      id: 'finding-duplicates',
      ruleId: 'deduplicate_events',
      category: 'Duplicates',
      severity: duplicateEventCount / totalCurated > 0.02 ? 'critical' : 'warn',
      title: `${duplicateEventCount} same-day action collision duplicates`,
      detail:
        'Multiple events share identical (entityId, timestampDay, actionId), inflating frequency_count and sequence length.',
      affectedEvents: duplicateEventCount,
      affectedEntities: dupEntities.size,
      affectedRatePct: (duplicateEventCount / totalCurated) * 100,
      sampleRows: dupSamples.map((e) => ({
        eventId: e.eventId,
        entityId: e.entityId,
        timestampDay: e.timestampDay,
        metricLabel: 'Action',
        metricValue: e.actionLabel,
      })),
    });
  }

  if (tailOutlierEvents.length > 0) {
    findings.push({
      id: 'finding-tail-spend',
      ruleId: 'winsorize_spend_tail',
      category: 'Tail Outliers',
      severity: 'warn',
      title: `${tailOutlierEvents.length} events exceed P99 spend ($${p99SpendCap.toFixed(2)})`,
      detail:
        'Heavy right-tail spend spikes exert high OLS leverage in LTV regression and skew sequence normalization.',
      affectedEvents: tailOutlierEvents.length,
      affectedEntities: new Set(tailOutlierEvents.map((e) => e.entityId)).size,
      affectedRatePct: (tailOutlierEvents.length / totalCurated) * 100,
      sampleRows: [...tailOutlierEvents]
        .sort((a, b) => b.spendAmount - a.spendAmount)
        .slice(0, 4)
        .map((e) => ({
          eventId: e.eventId,
          entityId: e.entityId,
          timestampDay: e.timestampDay,
          metricLabel: 'Spend',
          metricValue: `$${e.spendAmount.toFixed(2)}`,
        })),
    });
  }

  if (lowPropEvents.length > 0 || weakSupportEvents.length > 0) {
    const targetList = lowPropEvents.length > 0 ? lowPropEvents : weakSupportEvents;
    findings.push({
      id: 'finding-propensity',
      ruleId: lowPropEvents.length > 0 ? 'clamp_propensity_bounds' : null,
      category: 'Policy Propensity',
      severity: lowPropEvents.length > 0 ? 'warn' : 'info',
      title:
        lowPropEvents.length > 0
          ? `${lowPropEvents.length} events outside safe [0.05, 0.95] propensity bounds`
          : `${weakSupportEvents.length} low-propensity (< 0.15) RL transitions`,
      detail:
        'Near-zero logging propensities inflate off-policy importance weights and require conservative CQL regularization.',
      affectedEvents: targetList.length,
      affectedEntities: new Set(targetList.map((e) => e.entityId)).size,
      affectedRatePct: (targetList.length / totalCurated) * 100,
      sampleRows: targetList.slice(0, 4).map((e) => ({
        eventId: e.eventId,
        entityId: e.entityId,
        timestampDay: e.timestampDay,
        metricLabel: 'Propensity',
        metricValue: e.propensity.toFixed(3),
      })),
    });
  }

  if (singleTouchEntities.size > 0) {
    findings.push({
      id: 'finding-single-touch',
      ruleId: 'filter_single_touch_entities',
      category: 'Entity Coverage',
      severity: singleTouchEntities.size > 10 ? 'warn' : 'info',
      title: `${singleTouchEntities.size} single-event entities lack transition history`,
      detail:
        'Entities with fewer than 2 events cannot form MDP transitions (s, a, r, s′) and increase sequence padding sparsity.',
      affectedEvents: singleTouchEntities.size,
      affectedEntities: singleTouchEntities.size,
      affectedRatePct: (singleTouchEntities.size / Math.max(1, curatedEntitySet.size)) * 100,
      sampleRows: singleTouchSamples.map((e) => ({
        eventId: e.eventId,
        entityId: e.entityId,
        timestampDay: e.timestampDay,
        metricLabel: 'Spend',
        metricValue: `$${e.spendAmount.toFixed(2)}`,
      })),
    });
  }

  if (outOfBoundsEvents.length > 0) {
    findings.push({
      id: 'finding-bounds',
      ruleId: 'clamp_engagement_unit',
      category: 'Bounds & Schema',
      severity: 'critical',
      title: `${outOfBoundsEvents.length} events violate numeric unit bounds`,
      detail:
        'engagementScore outside [0, 1], negative recencyDays, or negative spendAmount detected.',
      affectedEvents: outOfBoundsEvents.length,
      affectedEntities: new Set(outOfBoundsEvents.map((e) => e.entityId)).size,
      affectedRatePct: (outOfBoundsEvents.length / totalCurated) * 100,
      sampleRows: outOfBoundsEvents.slice(0, 4).map((e) => ({
        eventId: e.eventId,
        entityId: e.entityId,
        timestampDay: e.timestampDay,
        metricLabel: 'Engagement',
        metricValue: e.engagementScore.toFixed(3),
      })),
    });
  }

  // Cross-paradigm pipeline diagnostics finding
  if (
    regResult.driftReport.klExceedsThreshold ||
    regResult.featureMatrix.highCollinearityPairs.length > 0 ||
    seqResult.paddingSparsity > 0.45 ||
    mdpResult.lowSupportOodRate > 0.15
  ) {
    const notes: string[] = [];
    if (regResult.driftReport.klExceedsThreshold) {
      notes.push(`KL drift=${regResult.driftReport.maxKlDivergence.toFixed(3)} nats`);
    }
    if (regResult.featureMatrix.highCollinearityPairs.length > 0) {
      notes.push(`${regResult.featureMatrix.highCollinearityPairs.length} high-VIF pairs`);
    }
    if (seqResult.paddingSparsity > 0.45) {
      notes.push(`seq padding ${(seqResult.paddingSparsity * 100).toFixed(1)}%`);
    }
    if (mdpResult.lowSupportOodRate > 0.15) {
      notes.push(`MDP OOD ${(mdpResult.lowSupportOodRate * 100).toFixed(1)}%`);
    }
    findings.push({
      id: 'finding-cross-paradigm',
      ruleId: null,
      category: 'Cross-Paradigm Drift',
      severity: regResult.driftReport.klExceedsThreshold ? 'warn' : 'info',
      title: 'Pipeline configuration tuning opportunity detected',
      detail: `Active materialized telemetry shows: ${notes.join(' · ')}. Use AI Curator recommendations to harmonize winsorization, scaling, sequence length, and reward scaling.`,
      affectedEvents: curatedEvents.length,
      affectedEntities: curatedEntitySet.size,
      affectedRatePct: 100,
      sampleRows: [],
    });
  }

  // Preview impact of each rule on rawEvents
  const availableRules: CurationRuleSpec[] = (
    Object.keys(CURATION_RULE_META) as CurationRuleId[]
  ).map((ruleId) => {
    const meta = CURATION_RULE_META[ruleId];
    const sim = applyCurationRulesToEvents(rawEvents, [ruleId]);
    const simHealth = computeDataHealthScorecard(sim.events);
    const affectedEventsCount = sim.ruleBreakdown[ruleId].affected;
    const affectedEntitiesCount =
      ruleId === 'filter_single_touch_entities'
        ? Math.max(0, sim.rawEntityCount - sim.curatedEntityCount)
        : ruleId === 'deduplicate_events'
          ? dupEntities.size
          : ruleId === 'clip_negative_rewards'
            ? new Set(rawEvents.filter((e) => e.reward < 0).map((e) => e.entityId)).size
            : ruleId === 'clamp_propensity_bounds'
              ? new Set(
                  rawEvents
                    .filter((e) => e.propensity < 0.05 || e.propensity > 0.95)
                    .map((e) => e.entityId)
                ).size
              : ruleId === 'clamp_engagement_unit'
                ? new Set(
                    rawEvents
                      .filter(
                        (e) =>
                          e.engagementScore < 0 ||
                          e.engagementScore > 1 ||
                          e.recencyDays < 0 ||
                          e.spendAmount < 0
                      )
                      .map((e) => e.entityId)
                  ).size
                : new Set(tailOutlierEvents.map((e) => e.entityId)).size;

    return {
      id: ruleId,
      label: meta.label,
      category: meta.category,
      description: meta.description,
      affectedEventsCount,
      affectedEntitiesCount,
      estimatedScoreDelta: simHealth.score - rawHealthScorecard.score,
    };
  });

  return {
    rawEventCount: rawEvents.length,
    rawEntityCount: rawEntitySet.size,
    curatedEventCount: curatedEvents.length,
    curatedEntityCount: curatedEntitySet.size,
    rawHealthScorecard,
    curatedHealthScorecard,
    scoreDelta: curatedHealthScorecard.score - rawHealthScorecard.score,
    findings,
    availableRules,
    p99SpendCap,
    negativeRewardCount: negRewardEvents.length,
    duplicateEventCount,
    lowPropensityCount: lowPropEvents.length,
    singleTouchEntityCount: singleTouchEntities.size,
    outOfBoundsCount: outOfBoundsEvents.length,
  };
}
