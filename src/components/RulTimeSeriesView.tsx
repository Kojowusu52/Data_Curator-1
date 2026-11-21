import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Download,
  GitCompareArrows,
  LayoutGrid,
  Plus,
  SlidersHorizontal,
  Tags,
  TrendingDown,
  Upload,
  X,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  GlobalCurationConfig,
  NormalizationMode,
  RawEvent,
  RulConfig,
  SplitName,
} from '../types/curation';
import {
  analyzeRulSeasonality,
  AnomalyTrendBasis,
  buildFailureProbabilityDensity,
  buildPopulationDegradationHeatmap,
  buildRulDataset,
  computeEntityRulProjection,
  DegradationHeatmapCell,
  detectTrendLineAnomalies,
  EntityProjectionSummary,
  exportRulDatasetCsv,
  exportRulTensorBundle,
  extractRulCompareMetric,
  HeatmapAgeBasis,
  HeatmapDensityMode,
  RulCompareAxisMode,
  RulCompareMetricMode,
  RulForecastAnchor,
  RulProjectionMethod,
  SeasonalityMetricMode,
} from '../engine/rulEngine';

interface RulTimeSeriesViewProps {
  datasetName: string;
  datasetDomain: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  obsCutoffDay: number;
  config: RulConfig;
  onUpdateConfig: React.Dispatch<React.SetStateAction<RulConfig>>;
  onOpenSensorImport: () => void;
  onInspectEntityInExplorer: (entityId: string) => void;
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const COMPARE_PALETTE: Array<{ stroke: string; dash?: string; label: string }> = [
  { stroke: '#1d4ed8', label: 'Blue' },
  { stroke: '#0f766e', label: 'Teal' },
  { stroke: '#d97706', dash: '5 3', label: 'Amber (dashed)' },
  { stroke: '#dc2626', label: 'Red' },
  { stroke: '#7c3aed', dash: '3 3', label: 'Violet (dotted)' },
];

type CompareAxisMode = RulCompareAxisMode;
type CompareMetricMode = RulCompareMetricMode;

type BatchTagColorKey = 'red' | 'amber' | 'blue' | 'teal' | 'violet' | 'slate';

interface CustomBatchCategory {
  id: string;
  label: string;
  colorKey: BatchTagColorKey;
}

const DEFAULT_BATCH_CATEGORIES: CustomBatchCategory[] = [
  { id: 'high_wear', label: 'High Wear', colorKey: 'red' },
  { id: 'mid_life', label: 'Mid Life', colorKey: 'amber' },
  { id: 'early_cycle', label: 'Early Cycle', colorKey: 'teal' },
  { id: 'anomaly_watch', label: 'Anomaly Watch', colorKey: 'blue' },
];

const BATCH_COLOR_OPTIONS: Array<{ key: BatchTagColorKey; label: string }> = [
  { key: 'red', label: 'Red' },
  { key: 'amber', label: 'Amber' },
  { key: 'blue', label: 'Blue' },
  { key: 'teal', label: 'Teal' },
  { key: 'violet', label: 'Violet' },
  { key: 'slate', label: 'Slate' },
];

const BATCH_TAG_STYLES: Record<
  BatchTagColorKey,
  { swatch: string; text: string; activeBtn: string }
> = {
  red: {
    swatch: 'bg-red-600',
    text: 'text-red-700',
    activeBtn: 'bg-red-700 text-white border-red-700',
  },
  amber: {
    swatch: 'bg-amber-600',
    text: 'text-amber-700',
    activeBtn: 'bg-amber-700 text-white border-amber-700',
  },
  blue: {
    swatch: 'bg-blue-700',
    text: 'text-blue-700',
    activeBtn: 'bg-blue-700 text-white border-blue-700',
  },
  teal: {
    swatch: 'bg-teal-700',
    text: 'text-teal-700',
    activeBtn: 'bg-teal-700 text-white border-teal-700',
  },
  violet: {
    swatch: 'bg-violet-700',
    text: 'text-violet-700',
    activeBtn: 'bg-violet-700 text-white border-violet-700',
  },
  slate: {
    swatch: 'bg-slate-700',
    text: 'text-slate-700',
    activeBtn: 'bg-slate-800 text-white border-slate-800',
  },
};

function loadStoredBatchState(datasetName: string): {
  categories: CustomBatchCategory[];
  entityTags: Record<string, string[]>;
} {
  if (typeof window === 'undefined') {
    return { categories: DEFAULT_BATCH_CATEGORIES, entityTags: {} };
  }
  try {
    const raw = window.localStorage.getItem(`stratum_rul_batch_tags_v1_${datasetName}`);
    if (!raw) return { categories: DEFAULT_BATCH_CATEGORIES, entityTags: {} };
    const parsed = JSON.parse(raw) as {
      categories?: CustomBatchCategory[];
      entityTags?: Record<string, string[]>;
    };
    const categories =
      Array.isArray(parsed.categories) && parsed.categories.length > 0
        ? parsed.categories.filter(
            (c) =>
              c &&
              typeof c.id === 'string' &&
              typeof c.label === 'string' &&
              c.colorKey in BATCH_TAG_STYLES
          )
        : DEFAULT_BATCH_CATEGORIES;
    const entityTags =
      parsed.entityTags && typeof parsed.entityTags === 'object' ? parsed.entityTags : {};
    return {
      categories: categories.length > 0 ? categories : DEFAULT_BATCH_CATEGORIES,
      entityTags,
    };
  } catch {
    return { categories: DEFAULT_BATCH_CATEGORIES, entityTags: {} };
  }
}

const FailurePointShape = (props: {
  cx?: number;
  cy?: number;
  fill?: string;
}) => {
  const { cx, cy, fill = '#dc2626' } = props;
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="#ffffff" stroke={fill} strokeWidth={2} />
      <path
        d={`M ${cx - 2.8} ${cy - 2.8} L ${cx + 2.8} ${cy + 2.8} M ${cx + 2.8} ${cy - 2.8} L ${cx - 2.8} ${cy + 2.8}`}
        stroke={fill}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </g>
  );
};

const AnomalyMarkerShape = (props: {
  cx?: number;
  cy?: number;
  fill?: string;
}) => {
  const { cx, cy, fill = '#dc2626' } = props;
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={8.5} fill={fill} fillOpacity={0.18} stroke={fill} strokeWidth={1} strokeOpacity={0.5} />
      <circle cx={cx} cy={cy} r={4.5} fill={fill} stroke="#ffffff" strokeWidth={1.75} />
    </g>
  );
};

const CompareAnomalyShape = (props: {
  cx?: number;
  cy?: number;
  stroke?: string;
}) => {
  const { cx, cy, stroke = '#1d4ed8' } = props;
  if (
    typeof cx !== 'number' ||
    typeof cy !== 'number' ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return null;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={7.5} fill="#dc2626" fillOpacity={0.16} stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={3.8} fill={stroke} stroke="#ffffff" strokeWidth={1.5} />
    </g>
  );
};

export const RulTimeSeriesView: React.FC<RulTimeSeriesViewProps> = ({
  datasetName,
  datasetDomain,
  events,
  globalConfig,
  obsCutoffDay,
  config,
  onUpdateConfig,
  onOpenSensorImport,
  onInspectEntityInExplorer,
}) => {
  const result = useMemo(
    () => buildRulDataset(events, config, globalConfig),
    [events, config, globalConfig]
  );

  const [chartMode, setChartMode] = useState<'unit' | 'compare' | 'cohort'>('unit');
  const [trendMode, setTrendMode] = useState<'chronological' | 'split_parity' | 'risk_surge'>('chronological');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [compareUnitIds, setCompareUnitIds] = useState<string[]>([]);
  const [compareCandidateId, setCompareCandidateId] = useState<string>('');
  const [compareAxisMode, setCompareAxisMode] = useState<CompareAxisMode>('relative_age');
  const [compareMetricMode, setCompareMetricMode] = useState<CompareMetricMode>('rul_capped');
  const [projectionMethod, setProjectionMethod] = useState<RulProjectionMethod>('off');
  const [forecastAnchor, setForecastAnchor] = useState<RulForecastAnchor>('mid_life_65');
  const [emaAlpha, setEmaAlpha] = useState<number>(0.45);
  const [forecastHorizonDays, setForecastHorizonDays] = useState<number>(150);
  const [ttfRange, setTtfRange] = useState<[number, number] | null>(null);
  const [pdfScope, setPdfScope] = useState<'cohort' | 'compare' | 'unit'>('cohort');
  const [pdfMethod, setPdfMethod] = useState<'ema' | 'linear'>('ema');
  const [pdfAnchor, setPdfAnchor] = useState<'obs_cutoff' | 'mid_life_65'>('obs_cutoff');
  const [pdfWindowStart, setPdfWindowStart] = useState<number>(0);
  const [pdfWindowEnd, setPdfWindowEnd] = useState<number>(60);
  const [anomalyDetectionEnabled, setAnomalyDetectionEnabled] = useState<boolean>(true);
  const [anomalySigmaThreshold, setAnomalySigmaThreshold] = useState<number>(1.75);
  const [anomalyTrendBasis, setAnomalyTrendBasis] = useState<AnomalyTrendBasis>('ema');
  const [seasonalityEnabled, setSeasonalityEnabled] = useState<boolean>(false);
  const [seasonalityScope, setSeasonalityScope] = useState<'cohort' | 'unit'>('cohort');
  const [seasonalityMetric, setSeasonalityMetric] = useState<SeasonalityMetricMode>('rul_capped');
  const [seasonalityHarmonics, setSeasonalityHarmonics] = useState<number>(3);
  const [heatmapScope, setHeatmapScope] = useState<'all' | 'filtered'>('all');
  const [heatmapAgeBasis, setHeatmapAgeBasis] = useState<HeatmapAgeBasis>('fleet_span');
  const [heatmapDensityMode, setHeatmapDensityMode] = useState<HeatmapDensityMode>('failure_hazard');
  const [pinnedHeatmapCoords, setPinnedHeatmapCoords] = useState<{ ageIdx: number; damageIdx: number } | null>(null);
  const [hoveredHeatmapCoords, setHoveredHeatmapCoords] = useState<{ ageIdx: number; damageIdx: number } | null>(null);

  const initialBatchState = useMemo(() => loadStoredBatchState(datasetName), [datasetName]);
  const [customCategories, setCustomCategories] = useState<CustomBatchCategory[]>(
    initialBatchState.categories
  );
  const [entityTags, setEntityTags] = useState<Record<string, string[]>>(
    initialBatchState.entityTags
  );
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [activeTagFilterIds, setActiveTagFilterIds] = useState<string[]>([]);
  const [filterUntaggedOnly, setFilterUntaggedOnly] = useState<boolean>(false);
  const [tagFilterMatchMode, setTagFilterMatchMode] = useState<'any' | 'all'>('any');
  const [batchTargetCategoryId, setBatchTargetCategoryId] = useState<string>(
    initialBatchState.categories[0]?.id ?? DEFAULT_BATCH_CATEGORIES[0].id
  );
  const [newCategoryLabel, setNewCategoryLabel] = useState<string>('');
  const [newCategoryColor, setNewCategoryColor] = useState<BatchTagColorKey>('violet');
  const [rosterLimit, setRosterLimit] = useState<number>(25);

  useEffect(() => {
    const loaded = loadStoredBatchState(datasetName);
    setCustomCategories(loaded.categories);
    setEntityTags(loaded.entityTags);
    setSelectedBatchIds([]);
    setActiveTagFilterIds([]);
    setFilterUntaggedOnly(false);
    setBatchTargetCategoryId(loaded.categories[0]?.id ?? DEFAULT_BATCH_CATEGORIES[0].id);
  }, [datasetName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `stratum_rul_batch_tags_v1_${datasetName}`,
        JSON.stringify({ categories: customCategories, entityTags })
      );
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [datasetName, customCategories, entityTags]);

  const categoryById = useMemo(() => {
    const map = new Map<string, CustomBatchCategory>();
    for (const cat of customCategories) {
      map.set(cat.id, cat);
    }
    return map;
  }, [customCategories]);

  const effectiveBatchTargetId = useMemo(() => {
    if (batchTargetCategoryId && categoryById.has(batchTargetCategoryId)) {
      return batchTargetCategoryId;
    }
    return customCategories[0]?.id ?? '';
  }, [batchTargetCategoryId, categoryById, customCategories]);

  const tagStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of customCategories) {
      counts.set(cat.id, 0);
    }
    let taggedUnitsCount = 0;
    let untaggedUnitsCount = 0;
    for (const u of result.unitSummaries) {
      const validTags = (entityTags[u.entityId] ?? []).filter((tid) => categoryById.has(tid));
      if (validTags.length === 0) {
        untaggedUnitsCount += 1;
      } else {
        taggedUnitsCount += 1;
        for (const tid of validTags) {
          counts.set(tid, (counts.get(tid) ?? 0) + 1);
        }
      }
    }
    return { counts, taggedUnitsCount, untaggedUnitsCount };
  }, [result.unitSummaries, customCategories, entityTags, categoryById]);

  const validUnitIdSet = useMemo(
    () => new Set(result.unitSummaries.map((u) => u.entityId)),
    [result.unitSummaries]
  );

  const validSelectedBatchIds = useMemo(
    () => selectedBatchIds.filter((id) => validUnitIdSet.has(id)),
    [selectedBatchIds, validUnitIdSet]
  );

  const validActiveTagFilterIds = useMemo(
    () => activeTagFilterIds.filter((id) => categoryById.has(id)),
    [activeTagFilterIds, categoryById]
  );

  const isTagFiltered = filterUntaggedOnly || validActiveTagFilterIds.length > 0;

  const getEntityTtfDays = (u: (typeof result.unitSummaries)[number]) =>
    Math.max(0, u.eolDay - obsCutoffDay);

  const ttfBounds = useMemo(() => {
    if (result.unitSummaries.length === 0) return { min: 0, max: 180 };
    const maxVal = result.unitSummaries.reduce(
      (acc, u) => Math.max(acc, Math.max(0, u.eolDay - obsCutoffDay)),
      0
    );
    return { min: 0, max: Math.max(10, Math.ceil(maxVal / 5) * 5) };
  }, [result.unitSummaries, obsCutoffDay]);

  const effectiveMinTtf = useMemo(() => {
    if (!ttfRange) return ttfBounds.min;
    return Math.min(ttfBounds.max, Math.max(ttfBounds.min, ttfRange[0]));
  }, [ttfRange, ttfBounds]);

  const effectiveMaxTtf = useMemo(() => {
    if (!ttfRange) return ttfBounds.max;
    return Math.max(effectiveMinTtf, Math.min(ttfBounds.max, ttfRange[1]));
  }, [ttfRange, ttfBounds, effectiveMinTtf]);

  const isTtfFiltered =
    effectiveMinTtf > ttfBounds.min || effectiveMaxTtf < ttfBounds.max;

  const filteredUnitSummaries = useMemo(() => {
    const matched = result.unitSummaries.filter((u) => {
      const ttf = Math.max(0, u.eolDay - obsCutoffDay);
      if (ttf < effectiveMinTtf || ttf > effectiveMaxTtf) return false;
      const unitTags = (entityTags[u.entityId] ?? []).filter((tid) => categoryById.has(tid));
      if (filterUntaggedOnly) {
        return unitTags.length === 0;
      }
      if (validActiveTagFilterIds.length > 0) {
        if (tagFilterMatchMode === 'all') {
          return validActiveTagFilterIds.every((tid) => unitTags.includes(tid));
        }
        return validActiveTagFilterIds.some((tid) => unitTags.includes(tid));
      }
      return true;
    });
    if (!isTtfFiltered && !isTagFiltered) return matched;
    return [...matched].sort((a, b) => {
      const ttfA = Math.max(0, a.eolDay - obsCutoffDay);
      const ttfB = Math.max(0, b.eolDay - obsCutoffDay);
      return ttfA - ttfB || a.degradationSlope - b.degradationSlope;
    });
  }, [
    result.unitSummaries,
    obsCutoffDay,
    effectiveMinTtf,
    effectiveMaxTtf,
    isTtfFiltered,
    entityTags,
    categoryById,
    filterUntaggedOnly,
    validActiveTagFilterIds,
    tagFilterMatchMode,
    isTagFiltered,
  ]);

  const handleCreateCategory = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newCategoryLabel.trim();
    if (!trimmed) return;
    const duplicate = customCategories.find(
      (c) => c.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setBatchTargetCategoryId(duplicate.id);
      setNewCategoryLabel('');
      return;
    }
    const baseSlug =
      trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'category';
    let nextId = baseSlug;
    let suffix = 2;
    while (categoryById.has(nextId)) {
      nextId = `${baseSlug}_${suffix}`;
      suffix += 1;
    }
    const created: CustomBatchCategory = {
      id: nextId,
      label: trimmed.slice(0, 28),
      colorKey: newCategoryColor,
    };
    setCustomCategories((prev) => [...prev, created]);
    setBatchTargetCategoryId(created.id);
    setNewCategoryLabel('');
  };

  const handleDeleteCategory = (catId: string) => {
    if (customCategories.length <= 1) return;
    setCustomCategories((prev) => prev.filter((c) => c.id !== catId));
    setActiveTagFilterIds((prev) => prev.filter((id) => id !== catId));
    setEntityTags((prev) => {
      const next: Record<string, string[]> = {};
      for (const [eid, tags] of Object.entries(prev)) {
        const cleaned = tags.filter((id) => id !== catId);
        if (cleaned.length > 0) next[eid] = cleaned;
      }
      return next;
    });
  };

  const handleToggleTagFilter = (catId: string) => {
    setFilterUntaggedOnly(false);
    setActiveTagFilterIds((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const handleToggleUntaggedFilter = () => {
    setFilterUntaggedOnly((prev) => {
      const next = !prev;
      if (next) setActiveTagFilterIds([]);
      return next;
    });
  };

  const handleClearAllFilters = () => {
    setTtfRange(null);
    setActiveTagFilterIds([]);
    setFilterUntaggedOnly(false);
  };

  const handleToggleBatchSelectEntity = (entityId: string) => {
    setSelectedBatchIds((prev) =>
      prev.includes(entityId) ? prev.filter((id) => id !== entityId) : [...prev, entityId]
    );
  };

  const handleBatchAssignCategory = (catId: string) => {
    if (!catId || validSelectedBatchIds.length === 0) return;
    setEntityTags((prev) => {
      const next = { ...prev };
      for (const eid of validSelectedBatchIds) {
        const existing = (next[eid] ?? []).filter((id) => categoryById.has(id));
        if (!existing.includes(catId)) {
          next[eid] = [...existing, catId];
        }
      }
      return next;
    });
  };

  const handleBatchRemoveCategory = (catId: string) => {
    if (!catId || validSelectedBatchIds.length === 0) return;
    setEntityTags((prev) => {
      const next = { ...prev };
      for (const eid of validSelectedBatchIds) {
        const cleaned = (next[eid] ?? []).filter((id) => id !== catId && categoryById.has(id));
        if (cleaned.length > 0) {
          next[eid] = cleaned;
        } else {
          delete next[eid];
        }
      }
      return next;
    });
  };

  const handleBatchClearTags = () => {
    if (validSelectedBatchIds.length === 0) return;
    setEntityTags((prev) => {
      const next = { ...prev };
      for (const eid of validSelectedBatchIds) {
        delete next[eid];
      }
      return next;
    });
  };

  const handleRemoveSingleEntityTag = (entityId: string, catId: string) => {
    setEntityTags((prev) => {
      const cleaned = (prev[entityId] ?? []).filter((id) => id !== catId && categoryById.has(id));
      const next = { ...prev };
      if (cleaned.length > 0) {
        next[entityId] = cleaned;
      } else {
        delete next[entityId];
      }
      return next;
    });
  };

  const handleQuickSelectCriteria = (
    criteria: 'filtered' | 'critical' | 'eol60' | 'spikes' | 'steep_slope' | 'untagged'
  ) => {
    const pool = filteredUnitSummaries;
    let picked: string[] = [];
    if (criteria === 'filtered') {
      picked = pool.map((u) => u.entityId);
    } else if (criteria === 'critical') {
      picked = pool.filter((u) => u.riskTier === 'critical').map((u) => u.entityId);
    } else if (criteria === 'eol60') {
      picked = pool
        .filter((u) => {
          const ttf = u.eolDay - obsCutoffDay;
          return ttf >= 1 && ttf <= 60;
        })
        .map((u) => u.entityId);
    } else if (criteria === 'spikes') {
      picked = pool.filter((u) => u.anomalousSpikeCount >= 2).map((u) => u.entityId);
    } else if (criteria === 'steep_slope') {
      picked = pool
        .filter((u) => u.degradationSlope * 10000 < -15)
        .map((u) => u.entityId);
    } else if (criteria === 'untagged') {
      picked = pool
        .filter((u) => (entityTags[u.entityId] ?? []).filter((tid) => categoryById.has(tid)).length === 0)
        .map((u) => u.entityId);
    }
    setSelectedBatchIds(picked);
  };

  const handleCompareFilteredGroup = () => {
    const picked = filteredUnitSummaries.slice(0, 5).map((u) => u.entityId);
    if (picked.length > 0) {
      setCompareUnitIds(picked);
      setChartMode('compare');
    }
  };

  const eolCohortStats = useMemo(() => {
    let approaching60 = 0;
    let imminent30 = 0;
    let alreadyEol = 0;
    for (const u of result.unitSummaries) {
      const ttf = u.eolDay - obsCutoffDay;
      if (ttf <= 0) {
        alreadyEol += 1;
      } else {
        if (ttf <= 60) approaching60 += 1;
        if (ttf <= 30) imminent30 += 1;
      }
    }
    return { approaching60, imminent30, alreadyEol };
  }, [result.unitSummaries, obsCutoffDay]);

  const defaultContrastIds = useMemo(() => {
    const pool = filteredUnitSummaries.length > 0 ? filteredUnitSummaries : result.unitSummaries;
    if (pool.length === 0) return [];
    const bySlope = [...pool].sort(
      (a, b) => a.degradationSlope - b.degradationSlope || b.anomalousSpikeCount - a.anomalousSpikeCount
    );
    const picked: string[] = [];
    if (bySlope[0]) picked.push(bySlope[0].entityId);
    const mid = bySlope[Math.floor(bySlope.length / 2)];
    if (mid && !picked.includes(mid.entityId)) picked.push(mid.entityId);
    const stable = bySlope[bySlope.length - 1];
    if (stable && !picked.includes(stable.entityId)) picked.push(stable.entityId);
    for (const u of pool) {
      if (picked.length >= 3) break;
      if (!picked.includes(u.entityId)) picked.push(u.entityId);
    }
    return picked;
  }, [filteredUnitSummaries, result.unitSummaries]);

  const effectiveCompareIds = useMemo(() => {
    const visibleSet = new Set(filteredUnitSummaries.map((u) => u.entityId));
    const valid = compareUnitIds.filter((id) => visibleSet.has(id));
    if (valid.length > 0) return valid.slice(0, 5);
    if (filteredUnitSummaries.length === 0) return [];
    return defaultContrastIds;
  }, [compareUnitIds, filteredUnitSummaries, defaultContrastIds]);

  const effectiveCompareSummaries = useMemo(
    () =>
      effectiveCompareIds
        .map((id) => result.unitSummaries.find((u) => u.entityId === id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u)),
    [effectiveCompareIds, result.unitSummaries]
  );

  const availableAddCandidates = useMemo(
    () =>
      filteredUnitSummaries
        .filter((u) => !effectiveCompareIds.includes(u.entityId))
        .slice(0, 120),
    [filteredUnitSummaries, effectiveCompareIds]
  );

  const effectiveCandidateId = useMemo(() => {
    if (
      compareCandidateId &&
      availableAddCandidates.some((u) => u.entityId === compareCandidateId)
    ) {
      return compareCandidateId;
    }
    return availableAddCandidates[0]?.entityId ?? '';
  }, [compareCandidateId, availableAddCandidates]);

  const handleAddCompareUnit = (unitId: string) => {
    if (!unitId) return;
    setCompareUnitIds((prev) => {
      const base = prev.filter((id) => filteredUnitSummaries.some((u) => u.entityId === id));
      const seed = base.length > 0 ? base : defaultContrastIds;
      if (seed.includes(unitId) || seed.length >= 5) return seed;
      return [...seed, unitId];
    });
  };

  const handleRemoveCompareUnit = (unitId: string) => {
    setCompareUnitIds((prev) => {
      const base = prev.filter((id) => filteredUnitSummaries.some((u) => u.entityId === id));
      const seed = base.length > 0 ? base : defaultContrastIds;
      return seed.filter((id) => id !== unitId);
    });
  };

  const handleCompareClosestToEol = () => {
    const ranked = [...filteredUnitSummaries].sort((a, b) => {
      const tA = Math.max(0, a.eolDay - obsCutoffDay);
      const tB = Math.max(0, b.eolDay - obsCutoffDay);
      return tA - tB || a.degradationSlope - b.degradationSlope;
    });
    const picked = ranked.slice(0, 3).map((u) => u.entityId);
    if (picked.length > 0) {
      setCompareUnitIds(picked);
      setChartMode('compare');
    }
  };

  const handleToggleCompareUnit = (unitId: string) => {
    const isSelected = effectiveCompareIds.includes(unitId);
    if (isSelected) {
      handleRemoveCompareUnit(unitId);
    } else {
      handleAddCompareUnit(unitId);
      setChartMode('compare');
    }
  };

  const signalFailureCeiling = useMemo(() => {
    const signals = result.unitSummaries
      .map((u) => u.meanSignal * 1.65)
      .sort((a, b) => a - b);
    if (signals.length === 0) return 150;
    const p85 = signals[Math.floor((signals.length - 1) * 0.85)];
    return Math.round(Math.max(80, p85));
  }, [result.unitSummaries]);

  const effectiveHorizonX = useMemo(
    () =>
      compareAxisMode === 'lifecycle_pct'
        ? Math.max(20, Math.min(80, Math.round(forecastHorizonDays / 3)))
        : forecastHorizonDays,
    [compareAxisMode, forecastHorizonDays]
  );

  const compareProjections = useMemo(() => {
    const map = new Map<string, EntityProjectionSummary>();
    for (const id of effectiveCompareIds) {
      const summary = result.unitSummaries.find((u) => u.entityId === id);
      if (!summary) continue;
      const uRows = result.cycleRows
        .filter((r) => r.entityId === id)
        .sort((a, b) => a.timestampDay - b.timestampDay);
      if (uRows.length === 0) continue;

      map.set(
        id,
        computeEntityRulProjection({
          entityId: id,
          unitRows: uRows,
          summary,
          axisMode: compareAxisMode,
          metricMode: compareMetricMode,
          method: projectionMethod,
          anchorMode: forecastAnchor,
          obsCutoffDay,
          emaAlpha,
          horizonX: effectiveHorizonX,
          rulCap: config.rulCap,
          signalFailureCeiling,
        })
      );
    }
    return map;
  }, [
    effectiveCompareIds,
    result.unitSummaries,
    result.cycleRows,
    compareAxisMode,
    compareMetricMode,
    projectionMethod,
    forecastAnchor,
    obsCutoffDay,
    emaAlpha,
    effectiveHorizonX,
    config.rulCap,
    signalFailureCeiling,
  ]);

  const compareAnomalyBundle = useMemo(() => {
    const emptyCounts = new Map<string, number>();
    if (effectiveCompareIds.length === 0) {
      return { series: [] as Array<Record<string, string | number | null>>, anomalyCounts: emptyCounts };
    }

    const formatXLabel = (xVal: number) => {
      const rounded = Math.round(xVal * 10) / 10;
      if (compareAxisMode === 'lifecycle_pct') return `${rounded}%`;
      if (compareAxisMode === 'relative_age') return `+${rounded}d`;
      return `d${rounded}`;
    };

    if (projectionMethod === 'off' && compareAxisMode === 'lifecycle_pct') {
      const rowsByEntity = new Map<string, (typeof result.cycleRows)>();
      for (const id of effectiveCompareIds) {
        rowsByEntity.set(
          id,
          result.cycleRows
            .filter((r) => r.entityId === id)
            .sort((a, b) => a.timestampDay - b.timestampDay)
        );
      }

      const gridPcts = Array.from({ length: 21 }, (_, idx) => idx * 5);
      const basePoints = gridPcts.map((pct) => {
        const point: Record<string, string | number | null> = {
          xLabel: `${pct}%`,
          xValue: pct,
        };
        for (const id of effectiveCompareIds) {
          const uRows = rowsByEntity.get(id) ?? [];
          const summary = result.unitSummaries.find((u) => u.entityId === id);
          if (uRows.length === 0 || !summary) {
            point[id] = null;
            continue;
          }
          if (uRows.length === 1) {
            point[id] = extractRulCompareMetric(uRows[0], compareMetricMode);
            continue;
          }
          const span = Math.max(1, summary.eolDay - summary.firstDay);
          const targetPct = pct / 100;
          const pts = uRows.map((r) => ({
            p: Math.min(1, Math.max(0, (r.timestampDay - summary.firstDay) / span)),
            val: extractRulCompareMetric(r, compareMetricMode),
          }));
          if (targetPct <= pts[0].p) {
            point[id] = pts[0].val;
          } else if (targetPct >= pts[pts.length - 1].p) {
            point[id] = pts[pts.length - 1].val;
          } else {
            let interpolated = pts[pts.length - 1].val;
            for (let i = 1; i < pts.length; i++) {
              if (pts[i].p >= targetPct) {
                const segSpan = Math.max(1e-6, pts[i].p - pts[i - 1].p);
                const t = (targetPct - pts[i - 1].p) / segSpan;
                interpolated =
                  Math.round((pts[i - 1].val + t * (pts[i].val - pts[i - 1].val)) * 10) / 10;
                break;
              }
            }
            point[id] = interpolated;
          }
        }
        return point;
      });

      if (anomalyDetectionEnabled) {
        for (const id of effectiveCompareIds) {
          const entityPts: Array<{ x: number; y: number }> = [];
          for (const row of basePoints) {
            const val = row[id];
            if (typeof val === 'number' && typeof row.xValue === 'number') {
              entityPts.push({ x: row.xValue, y: val });
            }
          }
          const analysis = detectTrendLineAnomalies({
            points: entityPts,
            trendBasis: anomalyTrendBasis,
            thresholdSigma: anomalySigmaThreshold,
            emaAlpha,
          });
          emptyCounts.set(id, analysis.anomalyCount);
          const anomByX = new Map<number, number>();
          for (const ap of analysis.points) {
            if (ap.isAnomaly) anomByX.set(ap.x, ap.y);
          }
          for (const row of basePoints) {
            const xVal = typeof row.xValue === 'number' ? row.xValue : -1;
            const hit = anomByX.get(xVal);
            row[`${id}__anom`] = hit !== undefined ? hit : null;
          }
        }
      }

      return { series: basePoints, anomalyCounts: emptyCounts };
    }

    const allX = new Set<number>();
    const observedMaps = new Map<string, Map<number, number>>();
    const projectedMaps = new Map<string, Map<number, number>>();
    const failureMaps = new Map<string, Map<number, number>>();
    const anomalyMaps = new Map<string, Map<number, number>>();

    for (const id of effectiveCompareIds) {
      const proj = compareProjections.get(id);
      if (!proj) continue;

      const obsMap = new Map<number, number>();
      for (const pt of proj.anchorObservedPoints) {
        allX.add(pt.x);
        obsMap.set(pt.x, pt.y);
      }
      observedMaps.set(id, obsMap);

      if (anomalyDetectionEnabled) {
        const analysis = detectTrendLineAnomalies({
          points: proj.anchorObservedPoints,
          trendBasis: anomalyTrendBasis,
          thresholdSigma: anomalySigmaThreshold,
          emaAlpha,
        });
        emptyCounts.set(id, analysis.anomalyCount);
        const aMap = new Map<number, number>();
        for (const ap of analysis.points) {
          if (ap.isAnomaly) aMap.set(ap.x, ap.y);
        }
        anomalyMaps.set(id, aMap);
      }

      if (projectionMethod !== 'off') {
        const pMap = new Map<number, number>();
        for (const pt of proj.projectedPoints) {
          allX.add(pt.x);
          pMap.set(pt.x, pt.y);
        }
        projectedMaps.set(id, pMap);

        if (
          proj.projectedFailureX !== null &&
          proj.projectedFailureX <= proj.anchorX + effectiveHorizonX + 0.1
        ) {
          const fMap = new Map<number, number>();
          allX.add(proj.projectedFailureX);
          fMap.set(proj.projectedFailureX, proj.failureThreshold);
          failureMaps.set(id, fMap);
        }
      }
    }

    const series = Array.from(allX)
      .sort((a, b) => a - b)
      .map((xVal) => {
        const point: Record<string, string | number | null> = {
          xLabel: formatXLabel(xVal),
          xValue: xVal,
        };
        for (const id of effectiveCompareIds) {
          const obs = observedMaps.get(id)?.get(xVal);
          point[id] = obs !== undefined ? obs : null;
          if (anomalyDetectionEnabled) {
            const aVal = anomalyMaps.get(id)?.get(xVal);
            point[`${id}__anom`] = aVal !== undefined ? aVal : null;
          }
          if (projectionMethod !== 'off') {
            const pVal = projectedMaps.get(id)?.get(xVal);
            point[`${id}__proj`] = pVal !== undefined ? pVal : null;
            const fVal = failureMaps.get(id)?.get(xVal);
            point[`${id}__fail`] = fVal !== undefined ? fVal : null;
          }
        }
        return point;
      });

    return { series, anomalyCounts: emptyCounts };
  }, [
    effectiveCompareIds,
    result.cycleRows,
    result.unitSummaries,
    compareAxisMode,
    compareMetricMode,
    projectionMethod,
    compareProjections,
    effectiveHorizonX,
    anomalyDetectionEnabled,
    anomalyTrendBasis,
    anomalySigmaThreshold,
    emaAlpha,
  ]);

  const compareSeries = compareAnomalyBundle.series;
  const compareAnomalyCounts = compareAnomalyBundle.anomalyCounts;

  const effectiveUnitId = useMemo(() => {
    if (selectedUnitId && filteredUnitSummaries.some((u) => u.entityId === selectedUnitId)) {
      return selectedUnitId;
    }
    const withSpikes = [...filteredUnitSummaries].sort(
      (a, b) => b.anomalousSpikeCount - a.anomalousSpikeCount || b.eventCount - a.eventCount
    );
    return withSpikes[0]?.entityId ?? '';
  }, [selectedUnitId, filteredUnitSummaries]);

  const activeUnitSummary = useMemo(
    () => result.unitSummaries.find((u) => u.entityId === effectiveUnitId) ?? null,
    [result.unitSummaries, effectiveUnitId]
  );

  const unitAnomalyBundle = useMemo(() => {
    if (!effectiveUnitId) {
      return {
        series: [] as Array<{
          day: number;
          signal: number;
          rollingMean: number;
          healthPct: number;
          rulCapped: number;
          trendLine: number;
          upperThreshold: number;
          lowerThreshold: number;
          bandBase: number;
          bandSpan: number;
          anomalyPoint: number | null;
          zScore: number;
          residual: number;
          isTrendAnomaly: boolean;
        }>,
        residualStd: 0,
        anomalyCount: 0,
        maxAbsZScore: 0,
        flaggedPoints: [] as Array<{ day: number; signal: number; trendY: number; zScore: number }>,
      };
    }

    const rows = result.cycleRows
      .filter((r) => r.entityId === effectiveUnitId)
      .sort((a, b) => a.timestampDay - b.timestampDay);

    const analysis = detectTrendLineAnomalies({
      points: rows.map((r) => ({ x: r.timestampDay, y: r.spendAmount })),
      trendBasis: anomalyTrendBasis,
      thresholdSigma: anomalySigmaThreshold,
      emaAlpha,
    });

    const flaggedPoints: Array<{ day: number; signal: number; trendY: number; zScore: number }> = [];
    const series = rows.map((r, idx) => {
      const pt = analysis.points[idx];
      const lowerClamped = Math.round(Math.max(0, pt.lowerBand) * 100) / 100;
      const upperVal = Math.round(pt.upperBand * 100) / 100;
      if (pt.isAnomaly) {
        flaggedPoints.push({
          day: r.timestampDay,
          signal: r.spendAmount,
          trendY: pt.trendY,
          zScore: pt.zScore,
        });
      }
      return {
        day: r.timestampDay,
        signal: r.spendAmount,
        rollingMean: r.rollingMeanSpend,
        healthPct: Math.round(r.engagementScore * 1000) / 10,
        rulCapped: r.rulCapped,
        trendLine: pt.trendY,
        upperThreshold: upperVal,
        lowerThreshold: lowerClamped,
        bandBase: lowerClamped,
        bandSpan: Math.round(Math.max(0, upperVal - lowerClamped) * 100) / 100,
        anomalyPoint: anomalyDetectionEnabled && pt.isAnomaly ? r.spendAmount : null,
        zScore: pt.zScore,
        residual: pt.residual,
        isTrendAnomaly: pt.isAnomaly,
      };
    });

    return {
      series,
      residualStd: analysis.residualStd,
      anomalyCount: analysis.anomalyCount,
      maxAbsZScore: analysis.maxAbsZScore,
      flaggedPoints,
    };
  }, [
    result.cycleRows,
    effectiveUnitId,
    anomalyTrendBasis,
    anomalySigmaThreshold,
    anomalyDetectionEnabled,
    emaAlpha,
  ]);

  const unitTimeSeries = unitAnomalyBundle.series;

  const sampleWindow = useMemo(
    () =>
      result.windowSamples.find((s) => s.entityId === effectiveUnitId) ??
      result.windowSamples[0] ??
      null,
    [result.windowSamples, effectiveUnitId]
  );

  const pdfTargetUnits = useMemo(() => {
    if (pdfScope === 'compare') {
      return effectiveCompareSummaries;
    }
    if (pdfScope === 'unit') {
      return activeUnitSummary ? [activeUnitSummary] : [];
    }
    return filteredUnitSummaries;
  }, [pdfScope, effectiveCompareSummaries, activeUnitSummary, filteredUnitSummaries]);

  const failurePdf = useMemo(
    () =>
      buildFailureProbabilityDensity({
        unitSummaries: pdfTargetUnits,
        cycleRows: result.cycleRows,
        method: pdfMethod,
        anchorMode: pdfAnchor,
        obsCutoffDay,
        emaAlpha,
        rulCap: config.rulCap,
        windowStartDays: pdfWindowStart,
        windowEndDays: pdfWindowEnd,
        maxHorizonDays: 240,
      }),
    [
      pdfTargetUnits,
      result.cycleRows,
      pdfMethod,
      pdfAnchor,
      obsCutoffDay,
      emaAlpha,
      config.rulCap,
      pdfWindowStart,
      pdfWindowEnd,
    ]
  );

  const seasonalityTargetIds = useMemo(() => {
    if (seasonalityScope === 'unit') {
      return effectiveUnitId ? [effectiveUnitId] : [];
    }
    return filteredUnitSummaries.map((u) => u.entityId);
  }, [seasonalityScope, effectiveUnitId, filteredUnitSummaries]);

  const seasonalityAnalysis = useMemo(() => {
    if (!seasonalityEnabled) return null;
    return analyzeRulSeasonality({
      cycleRows: result.cycleRows,
      unitIds: seasonalityTargetIds,
      metric: seasonalityMetric,
      topHarmonics: seasonalityHarmonics,
    });
  }, [
    seasonalityEnabled,
    result.cycleRows,
    seasonalityTargetIds,
    seasonalityMetric,
    seasonalityHarmonics,
  ]);

  const heatmapTargetUnits = useMemo(
    () => (heatmapScope === 'filtered' ? filteredUnitSummaries : result.unitSummaries),
    [heatmapScope, filteredUnitSummaries, result.unitSummaries]
  );

  const populationHeatmap = useMemo(
    () =>
      buildPopulationDegradationHeatmap({
        unitSummaries: heatmapTargetUnits,
        cycleRows: result.cycleRows,
        ageBasis: heatmapAgeBasis,
        densityMode: heatmapDensityMode,
      }),
    [heatmapTargetUnits, result.cycleRows, heatmapAgeBasis, heatmapDensityMode]
  );

  const activeHeatmapCell = useMemo<DegradationHeatmapCell | null>(() => {
    const coords = hoveredHeatmapCoords ?? pinnedHeatmapCoords;
    if (coords) {
      for (const row of populationHeatmap.rows) {
        if (row.damageIdx === coords.damageIdx) {
          const found = row.cells.find((c) => c.ageIdx === coords.ageIdx);
          if (found) return found;
        }
      }
    }
    let best: DegradationHeatmapCell | null = null;
    for (const row of populationHeatmap.rows) {
      for (const cell of row.cells) {
        if (!best || cell.intensity > best.intensity) {
          best = cell;
        }
      }
    }
    return best;
  }, [populationHeatmap, hoveredHeatmapCoords, pinnedHeatmapCoords]);

  const handleExportCsv = () => {
    const csv = exportRulDatasetCsv(result);
    triggerDownload('stratum_rul_cycles.csv', csv, 'text/csv');
  };

  const handleExportRulTensorJson = () => {
    const bundle = exportRulTensorBundle(result, config, datasetName);
    triggerDownload(
      'stratum_rul_sliding_windows.json',
      JSON.stringify(bundle, null, 2),
      'application/json'
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Time-Series Visualization &amp; RUL Preparation
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Inspect multi-cycle sensor or behavioral trajectories, detect rolling Z-score signal spikes,
            and materialize piecewise-linear Remaining Useful Life (RUL) sliding windows for Transformers.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
            <span>{datasetName}</span>
            <span aria-hidden="true">·</span>
            <span>{datasetDomain}</span>
            <span aria-hidden="true">·</span>
            <span>Tensor [{result.tensorShape.join(', ')}]</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSensorImport}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>Ingest Sensor CSV / MAT</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={result.cycleRows.length === 0}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export RUL CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportRulTensorJson}
            disabled={result.windowSamples.length === 0}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export RUL Tensors JSON</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Sliding Window Samples</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {result.windowCount.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Shape [{result.tensorShape.join(', ')}]
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Mean Capped RUL</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {result.meanRulCapped.toFixed(1)} cycles
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Raw mean {result.meanRulRaw.toFixed(1)} · Cap {config.rulCap}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Tracked Assets / Units</div>
          <div className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {result.unitCount.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Median EOL Day {result.medianEolDay}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5">
          <div className="text-xs text-slate-500">Signal Anomaly Spikes</div>
          <div className="mt-1 text-lg font-bold text-amber-700 font-mono tabular-nums">
            {result.anomalySpikeCount.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
            Rolling |Z| ≥ 1.75 across {result.cycleRowCount.toLocaleString()} steps
          </div>
        </div>
      </section>

      {/* RUL Trends & Split Trajectory Section */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                RUL Trends &amp; Split Trajectory
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {trendMode === 'chronological'
                ? 'Fleet-wide capped vs. raw RUL trajectory with P25–P75 interquartile band and mean health index across calendar cycles.'
                : trendMode === 'split_parity'
                ? 'Normalized lifecycle RUL decay across Train, Validation, and Test splits (0% start to 100% EOL) to verify zero cohort drift.'
                : 'Pre-EOL anomaly spike surge vs. health decay across lifecycle deciles paired with unit risk-tier segmentation.'}
            </p>
          </div>

          <div className="inline-flex p-1 bg-slate-100 rounded-lg self-start lg:self-auto">
            <button
              type="button"
              onClick={() => setTrendMode('chronological')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                trendMode === 'chronological'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Chronological RUL Trend
            </button>
            <button
              type="button"
              onClick={() => setTrendMode('split_parity')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                trendMode === 'split_parity'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Split Parity (Train/Val/Test)
            </button>
            <button
              type="button"
              onClick={() => setTrendMode('risk_surge')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                trendMode === 'risk_surge'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Risk Tiers &amp; Spike Surge
            </button>
          </div>
        </div>

        {/* Fleet Trend Telemetry Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50/70 border border-slate-200/80 rounded-md px-4 py-2.5 text-xs">
          <div className="flex items-center justify-between sm:block">
            <span className="text-slate-500">Temporal RUL Slope</span>
            <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
              {result.rulTrendSlopePerDay >= 0 ? '+' : ''}
              {result.rulTrendSlopePerDay.toFixed(3)} cycles/day
            </div>
          </div>
          <div className="flex items-center justify-between sm:block">
            <span className="text-slate-500">Fleet Health Velocity</span>
            <div
              className={`font-mono tabular-nums font-semibold mt-0.5 ${
                result.fleetDecayRatePctPer100d < 0 ? 'text-amber-700' : 'text-teal-700'
              }`}
            >
              {result.fleetDecayRatePctPer100d >= 0 ? '+' : ''}
              {result.fleetDecayRatePctPer100d.toFixed(1)}% / 100d
            </div>
          </div>
          <div className="flex items-center justify-between sm:block">
            <span className="text-slate-500">Late-Stage Anomaly Surge (70–100% vs 0–30%)</span>
            <div
              className={`font-mono tabular-nums font-semibold mt-0.5 ${
                result.anomalyTrendDeltaPct > 0 ? 'text-red-700' : 'text-slate-800'
              }`}
            >
              {result.anomalyTrendDeltaPct >= 0 ? '+' : ''}
              {result.anomalyTrendDeltaPct.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Seasonality Analysis (Fourier Transform) Toggle Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/70 border border-slate-200/80 rounded-md px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={seasonalityEnabled}
              onClick={() => setSeasonalityEnabled((prev) => !prev)}
              className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md whitespace-nowrap shrink-0"
            >
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  seasonalityEnabled ? 'bg-violet-700' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                    seasonalityEnabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </span>
              <span>Seasonality Analysis (Fourier Transform)</span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  seasonalityEnabled ? 'text-violet-700' : 'text-slate-500'
                }`}
              >
                {seasonalityEnabled ? 'ON' : 'OFF'}
              </span>
            </button>

            {seasonalityEnabled && (
              <>
                <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                  |
                </span>
                <div className="inline-flex p-0.5 bg-slate-200/70 rounded-md">
                  <button
                    type="button"
                    onClick={() => setSeasonalityScope('cohort')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      seasonalityScope === 'cohort'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Filtered Cohort ({filteredUnitSummaries.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeasonalityScope('unit')}
                    disabled={!effectiveUnitId}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap disabled:opacity-45 ${
                      seasonalityScope === 'unit'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Unit ({effectiveUnitId || 'None'})
                  </button>
                </div>
              </>
            )}
          </div>

          {seasonalityEnabled ? (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <select
                aria-label="Seasonality Fourier signal basis"
                value={seasonalityMetric}
                onChange={(e) => setSeasonalityMetric(e.target.value as SeasonalityMetricMode)}
                className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="rul_capped">Series: Detrended Capped RUL (cycles)</option>
                <option value="health_pct">Series: Detrended Health Index (%)</option>
                <option value="signal">Series: Detrended Primary Signal</option>
              </select>

              <div className="inline-flex items-center gap-1">
                <span className="text-slate-600 font-medium mr-1 whitespace-nowrap">
                  Top Harmonics
                </span>
                {[1, 2, 3, 5].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSeasonalityHarmonics(k)}
                    className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                      seasonalityHarmonics === k
                        ? 'bg-violet-700 text-white border-violet-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    K={k}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">
              Toggle on to apply a Discrete Fourier Transform (DFT) and detect periodic degradation cycles.
            </span>
          )}
        </div>

        {/* Expanded Fourier Spectral & Harmonic Decomposition */}
        {seasonalityEnabled && seasonalityAnalysis && (
          <div className="pt-2 pb-4 border-b border-slate-200 space-y-4">
            {!seasonalityAnalysis.hasEnoughData ? (
              <div className="py-6 text-center text-xs text-slate-500 bg-slate-50/50 border border-slate-200 rounded-md">
                At least 4 distinct cycle days are required to compute a Discrete Fourier Transform
                for this selection.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-md divide-y lg:divide-y-0 lg:divide-x divide-slate-200 bg-white text-xs">
                  <div className="px-3.5 py-2.5">
                    <div className="text-slate-500">Dominant Cycle Period</div>
                    <div className="mt-0.5 text-sm font-bold text-violet-700 font-mono tabular-nums">
                      {seasonalityAnalysis.dominantPeriodDays !== null
                        ? `${seasonalityAnalysis.dominantPeriodDays.toFixed(1)} days`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {seasonalityAnalysis.dominantCycleLabel}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5">
                    <div className="text-slate-500">Peak Frequency &amp; Amplitude</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900 font-mono tabular-nums">
                      {seasonalityAnalysis.dominantFrequencyPerDay !== null
                        ? `${seasonalityAnalysis.dominantFrequencyPerDay.toFixed(4)} cyc/d`
                        : '—'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      Amplitude ±{seasonalityAnalysis.dominantAmplitude.toFixed(2)}{' '}
                      {seasonalityMetric === 'health_pct'
                        ? '%'
                        : seasonalityMetric === 'rul_capped'
                        ? 'cycles'
                        : 'units'}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5">
                    <div className="text-slate-500">Periodic Variance Explained</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900 font-mono tabular-nums">
                      {seasonalityAnalysis.periodicVarianceExplainedPct.toFixed(1)}%
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      Top {seasonalityAnalysis.harmonics.length} harmonics · Detrended σ ={' '}
                      {seasonalityAnalysis.residualStd.toFixed(2)}
                    </div>
                  </div>
                  <div className="px-3.5 py-2.5">
                    <div className="text-slate-500">Uniform DFT Sampling Grid</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-900 font-mono tabular-nums">
                      {seasonalityAnalysis.sampleCount} samples
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                      Δt = {seasonalityAnalysis.stepDays}d · Span {seasonalityAnalysis.spanDays}d
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* Left: Fourier Power Spectrum Periodogram */}
                  <div className="lg:col-span-6 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Fourier Power Spectrum (Periodogram)
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500">
                        Period (days) vs. Spectral Power
                      </span>
                    </div>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={seasonalityAnalysis.spectrum}
                          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="periodLabel"
                            tick={{ fontSize: 10, fill: '#475569' }}
                            interval="preserveStartEnd"
                          />
                          <YAxis tick={{ fontSize: 10, fill: '#475569' }} width={44} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const bin = payload[0]?.payload as
                                | (typeof seasonalityAnalysis.spectrum)[number]
                                | undefined;
                              if (!bin) return null;
                              return (
                                <div className="bg-white border border-slate-300 rounded-md px-3 py-2 shadow-sm text-xs space-y-1 font-mono tabular-nums">
                                  <div className="font-semibold text-slate-900">
                                    Period: {bin.periodDays.toFixed(1)} days (k={bin.binIndex})
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Frequency:</span>
                                    <span className="text-slate-900">
                                      {bin.frequencyPerDay.toFixed(4)} cyc/d
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-violet-700">Spectral Power:</span>
                                    <span className="font-semibold text-violet-700">
                                      {bin.power.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Amplitude:</span>
                                    <span className="text-slate-900">±{bin.amplitude.toFixed(3)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Energy Share:</span>
                                    <span className="text-slate-900">
                                      {bin.energySharePct.toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <Bar dataKey="power" name="Spectral Power" radius={[3, 3, 0, 0]}>
                            {seasonalityAnalysis.spectrum.map((entry) => (
                              <Cell
                                key={`dft-bin-${entry.binIndex}`}
                                fill={entry.isDominant ? '#6d28d9' : '#cbd5e1'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 bg-violet-700 rounded-xs inline-block" />
                        <span>Top-{seasonalityHarmonics} Dominant Harmonics</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 bg-slate-300 rounded-xs inline-block" />
                        <span>Background Spectral Bins</span>
                      </span>
                    </div>
                  </div>

                  {/* Right: Detrended Residual vs Fourier Periodic Wave */}
                  <div className="lg:col-span-6 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Detrended Oscillation &amp; Fourier Harmonic Fit
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500">
                        Linear slope removed
                      </span>
                    </div>
                    <div className="h-56 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={seasonalityAnalysis.reconstructedSeries}
                          margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis
                            dataKey="dayLabel"
                            tick={{ fontSize: 10, fill: '#475569' }}
                            interval="preserveStartEnd"
                          />
                          <YAxis tick={{ fontSize: 10, fill: '#475569' }} width={44} />
                          <Tooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload || payload.length === 0) return null;
                              const pt = payload[0]?.payload as
                                | (typeof seasonalityAnalysis.reconstructedSeries)[number]
                                | undefined;
                              if (!pt) return null;
                              return (
                                <div className="bg-white border border-slate-300 rounded-md px-3 py-2 shadow-sm text-xs space-y-1 font-mono tabular-nums">
                                  <div className="font-semibold text-slate-900">Cycle Day {label}</div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-600">Observed Residual:</span>
                                    <span className="text-slate-900">
                                      {pt.detrendedResidual >= 0 ? '+' : ''}
                                      {pt.detrendedResidual.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-violet-700">Fourier Periodic Wave:</span>
                                    <span className="font-semibold text-violet-700">
                                      {pt.fourierPeriodic >= 0 ? '+' : ''}
                                      {pt.fourierPeriodic.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4 pt-1 border-t border-slate-100">
                                    <span className="text-slate-500">Observed Value:</span>
                                    <span className="text-slate-800">
                                      {pt.observedValue.toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-slate-500">Trend + Periodic:</span>
                                    <span className="text-slate-800">
                                      {pt.fourierCombined.toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          />
                          <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                          <Line
                            type="monotone"
                            dataKey="detrendedResidual"
                            name="Observed Detrended Residual"
                            stroke="#64748b"
                            strokeWidth={1.5}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="fourierPeriodic"
                            name={`Fourier Top-${seasonalityHarmonics} Wave`}
                            stroke="#6d28d9"
                            strokeWidth={2.25}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-slate-500 inline-block" />
                        <span>Detrended Degradation Residual</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-0.5 bg-violet-700 inline-block" />
                        <span>Fourier Harmonic Reconstruction (K={seasonalityHarmonics})</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Detected Periodic Degradation Harmonics Table */}
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">
                      Identified Periodic Degradation Cycles (Ranked by Spectral Power)
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-500">
                      DFT Top-{seasonalityAnalysis.harmonics.length} Modes
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                          <th className="px-3.5 py-2 text-left font-semibold">Harmonic</th>
                          <th className="px-3.5 py-2 text-right font-semibold">Period (days)</th>
                          <th className="px-3.5 py-2 text-right font-semibold">Frequency (cyc/d)</th>
                          <th className="px-3.5 py-2 text-right font-semibold">Amplitude</th>
                          <th className="px-3.5 py-2 text-right font-semibold">Spectral Power</th>
                          <th className="px-3.5 py-2 text-right font-semibold">Energy Share</th>
                          <th className="px-3.5 py-2 text-left font-semibold">Cycle Classification</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                        {seasonalityAnalysis.harmonics.map((h) => (
                          <tr key={h.binIndex} className="hover:bg-slate-50">
                            <td className="px-3.5 py-2 text-slate-900 font-semibold">
                              #{h.rank} (k={h.binIndex})
                            </td>
                            <td className="px-3.5 py-2 text-right text-violet-700 font-semibold">
                              {h.periodDays.toFixed(1)}d
                            </td>
                            <td className="px-3.5 py-2 text-right text-slate-700">
                              {h.frequencyPerDay.toFixed(4)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-slate-800">
                              ±{h.amplitude.toFixed(2)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-slate-800">
                              {h.power.toFixed(2)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-slate-900">
                              {h.energySharePct.toFixed(1)}%
                            </td>
                            <td className="px-3.5 py-2 font-sans text-slate-700">
                              {h.cycleLabel}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {trendMode === 'chronological' && (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={result.temporalTrends}
                  margin={{ top: 10, right: 20, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="dayRange" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    width={48}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#1d4ed8' }}
                    tickFormatter={(v) => `${v}%`}
                    width={46}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    y={config.rulCap}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{
                      value: `RUL Cap (${config.rulCap})`,
                      position: 'insideTopRight',
                      fontSize: 10,
                      fill: '#64748b',
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="p25Base"
                    stackId="iqr"
                    stroke="none"
                    fill="transparent"
                    legendType="none"
                    tooltipType="none"
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="iqrSpan"
                    stackId="iqr"
                    name="Capped RUL IQR Spread (P75-P25)"
                    stroke="none"
                    fill="#99f6e4"
                    fillOpacity={0.4}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="meanRulRaw"
                    name="Mean Raw RUL (cycles)"
                    stroke="#64748b"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="meanRulCapped"
                    name="Mean Capped RUL (cycles)"
                    stroke="#0f766e"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="meanHealthPct"
                    name="Mean Health Index (%)"
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600 pt-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                <span>Mean Capped RUL</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-2 bg-teal-200 border border-teal-300 inline-block" />
                <span>P25–P75 Capped RUL IQR Band</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-slate-500 inline-block" />
                <span>Mean Raw RUL</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-700 inline-block" />
                <span>Mean Health Index (%)</span>
              </span>
            </div>
          </>
        )}

        {trendMode === 'split_parity' && (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={result.degradationCurve}
                  margin={{ top: 10, right: 20, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="cycleBucket" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={48} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="trainMeanRul"
                    name="Train Capped RUL"
                    stroke="#1d4ed8"
                    strokeWidth={2.5}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="valMeanRul"
                    name="Validation Capped RUL"
                    stroke="#0f766e"
                    strokeWidth={2}
                    connectNulls
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="testMeanRul"
                    name="Test Capped RUL"
                    stroke="#b45309"
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    connectNulls
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600 pt-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-700 inline-block" />
                <span>Train Split RUL ({result.splitCounts.train} units)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                <span>Validation Split RUL ({result.splitCounts.val} units)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-amber-700 inline-block" />
                <span>Test Split RUL ({result.splitCounts.test} units)</span>
              </span>
            </div>
          </>
        )}

        {trendMode === 'risk_surge' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-7 space-y-2">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={result.degradationCurve}
                    margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="cycleBucket" tick={{ fontSize: 10, fill: '#475569' }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: '#b45309' }}
                      tickFormatter={(v) => `${v}%`}
                      width={42}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#1d4ed8' }}
                      tickFormatter={(v) => `${v}%`}
                      width={42}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#cbd5e1',
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="anomalyRatePct"
                      name="Z-Score Spike Rate (%)"
                      fill="#f59e0b"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="meanHealthPct"
                      name="Mean Health Index (%)"
                      stroke="#1d4ed8"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-xs inline-block" />
                  <span>Anomaly Spike Rate (%) per Lifecycle Decile</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-blue-700 inline-block" />
                  <span>Mean Health Index (%)</span>
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-900">
                Fleet Degradation Risk Tiers
              </div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                    <th className="px-3 py-2 text-left font-semibold">Tier</th>
                    <th className="px-3 py-2 text-right font-semibold">Units</th>
                    <th className="px-3 py-2 text-right font-semibold">Slope/100d</th>
                    <th className="px-3 py-2 text-right font-semibold">Mean RUL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.riskTierBreakdown.map((tier) => (
                    <tr key={tier.tier} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <div
                          className={`font-semibold ${
                            tier.tier === 'critical'
                              ? 'text-red-700'
                              : tier.tier === 'warning'
                              ? 'text-amber-700'
                              : 'text-teal-700'
                          }`}
                        >
                          {tier.label}
                        </div>
                        <div className="text-[11px] text-slate-500">{tier.criteriaLabel}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-900">
                        {tier.unitCount} ({tier.sharePct.toFixed(0)}%)
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                        {tier.meanSlopePctPer100d >= 0 ? '+' : ''}
                        {tier.meanSlopePctPer100d.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                        {tier.meanRulCapped.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Time-to-Failure Range Filter Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Time-to-Failure (TTF) Range Filter
              </h2>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span className="text-xs font-mono tabular-nums text-slate-700">
                Showing <strong className="text-slate-900">{filteredUnitSummaries.length}</strong> /{' '}
                {result.unitSummaries.length} units
              </span>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span className="text-xs font-mono tabular-nums text-amber-700">
                {eolCohortStats.approaching60} approaching EOL (1–60d)
              </span>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {eolCohortStats.alreadyEol} at/past EOL (≤T_obs d{obsCutoffDay})
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Slide the minimum and maximum remaining days to failure relative to T_obs (d
              {obsCutoffDay}) to isolate units approaching End-of-Life across selectors, overlays,
              and roster tables.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setTtfRange(null)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                !isTtfFiltered
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All ({result.unitSummaries.length})
            </button>
            <button
              type="button"
              onClick={() => setTtfRange([1, Math.min(30, ttfBounds.max)])}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                effectiveMinTtf === 1 && effectiveMaxTtf === Math.min(30, ttfBounds.max)
                  ? 'bg-red-700 text-white border-red-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Imminent 1–30d ({eolCohortStats.imminent30})
            </button>
            <button
              type="button"
              onClick={() => setTtfRange([1, Math.min(60, ttfBounds.max)])}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                effectiveMinTtf === 1 && effectiveMaxTtf === Math.min(60, ttfBounds.max)
                  ? 'bg-amber-700 text-white border-amber-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Approaching 1–60d ({eolCohortStats.approaching60})
            </button>
            <button
              type="button"
              onClick={() => setTtfRange([0, 0])}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                effectiveMinTtf === 0 && effectiveMaxTtf === 0
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              At EOL 0d ({eolCohortStats.alreadyEol})
            </button>
            <button
              type="button"
              onClick={handleCompareClosestToEol}
              disabled={filteredUnitSummaries.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-45"
            >
              Compare Closest 3
            </button>
          </div>
        </div>

        {/* Dual-Thumb Time-to-Failure Range Slider */}
        <div className="pt-1 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-3 flex items-center justify-between md:justify-start gap-2 text-xs">
            <span className="text-slate-500 font-medium">Active Window:</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900">
              {effectiveMinTtf}d – {effectiveMaxTtf}d
            </span>
          </div>

          <div className="md:col-span-9 flex items-center gap-3">
            <span className="text-[11px] font-mono tabular-nums text-slate-500 w-8 text-right shrink-0">
              {ttfBounds.min}d
            </span>

            <div className="relative flex-1 h-7 flex items-center">
              <div className="w-full h-1.5 bg-slate-200 rounded-full relative">
                <div
                  className="absolute h-full bg-blue-700 rounded-full"
                  style={{
                    left: `${
                      ((effectiveMinTtf - ttfBounds.min) /
                        Math.max(1, ttfBounds.max - ttfBounds.min)) *
                      100
                    }%`,
                    right: `${
                      100 -
                      ((effectiveMaxTtf - ttfBounds.min) /
                        Math.max(1, ttfBounds.max - ttfBounds.min)) *
                        100
                    }%`,
                  }}
                />
              </div>
              <input
                type="range"
                aria-label="Minimum time to failure in days"
                min={ttfBounds.min}
                max={ttfBounds.max}
                step={1}
                value={effectiveMinTtf}
                onChange={(e) => {
                  const nextMin = Math.min(Number(e.target.value), effectiveMaxTtf);
                  setTtfRange([nextMin, effectiveMaxTtf]);
                }}
                className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-700 [&::-webkit-slider-thumb]:shadow-xs [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-700 [&::-moz-range-thumb]:cursor-pointer ${
                  effectiveMinTtf > ttfBounds.max * 0.8 ? 'z-20' : 'z-10'
                }`}
              />
              <input
                type="range"
                aria-label="Maximum time to failure in days"
                min={ttfBounds.min}
                max={ttfBounds.max}
                step={1}
                value={effectiveMaxTtf}
                onChange={(e) => {
                  const nextMax = Math.max(Number(e.target.value), effectiveMinTtf);
                  setTtfRange([effectiveMinTtf, nextMax]);
                }}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none z-10 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-teal-700 [&::-webkit-slider-thumb]:shadow-xs [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-teal-700 [&::-moz-range-thumb]:cursor-pointer"
              />
            </div>

            <span className="text-[11px] font-mono tabular-nums text-slate-500 w-10 shrink-0">
              {ttfBounds.max}d
            </span>
          </div>
        </div>
      </section>

      {/* Batch Tagging & Comparative Category Filter */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Tags className="w-4 h-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Batch Tagging &amp; Comparative Categories
              </h2>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span className="text-xs font-mono tabular-nums text-slate-700">
                <strong className="text-slate-900">{tagStats.taggedUnitsCount}</strong> tagged ·{' '}
                {tagStats.untaggedUnitsCount} untagged
              </span>
              {isTagFiltered && (
                <>
                  <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                  <span className="text-xs font-mono tabular-nums font-semibold text-blue-700">
                    Active view: {filteredUnitSummaries.length} units
                  </span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Group units into custom lifecycle or wear categories for instant comparative filtering
              and overlay loading across trajectories, PDF forecasts, and the roster.
            </p>
          </div>

          {/* Inline Custom Category Creator */}
          <form onSubmit={handleCreateCategory} className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              type="text"
              aria-label="New custom category name"
              value={newCategoryLabel}
              onChange={(e) => setNewCategoryLabel(e.target.value)}
              placeholder="New category (e.g. Bearing Wear)"
              maxLength={28}
              className="h-8 w-52 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="inline-flex items-center gap-1 px-1.5 h-8 bg-slate-50 border border-slate-200 rounded-md">
              {BATCH_COLOR_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  title={`Color: ${c.label}`}
                  aria-label={`Category color ${c.label}`}
                  onClick={() => setNewCategoryColor(c.key)}
                  className={`w-3.5 h-3.5 rounded-xs transition-transform ${
                    BATCH_TAG_STYLES[c.key].swatch
                  } ${
                    newCategoryColor === c.key
                      ? 'ring-2 ring-offset-1 ring-slate-900 scale-110'
                      : 'opacity-65 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
            <button
              type="submit"
              disabled={!newCategoryLabel.trim()}
              className="h-8 px-3 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Category</span>
            </button>
          </form>
        </div>

        {/* Comparative Category Filter Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 mr-0.5">Filter by Category:</span>
            <button
              type="button"
              onClick={() => {
                setActiveTagFilterIds([]);
                setFilterUntaggedOnly(false);
              }}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap font-mono tabular-nums ${
                !isTagFiltered
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              All ({result.unitSummaries.length})
            </button>

            {customCategories.map((cat) => {
              const count = tagStats.counts.get(cat.id) ?? 0;
              const isActive = !filterUntaggedOnly && validActiveTagFilterIds.includes(cat.id);
              const style = BATCH_TAG_STYLES[cat.colorKey];
              return (
                <div key={cat.id} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => handleToggleTagFilter(cat.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
                      customCategories.length > 1 ? 'rounded-l-md border-r-0' : 'rounded-md'
                    } ${
                      isActive
                        ? style.activeBtn
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-xs shrink-0 ${
                        isActive ? 'bg-white' : style.swatch
                      }`}
                    />
                    <span>{cat.label}</span>
                    <span className="font-mono tabular-nums opacity-80">({count})</span>
                  </button>
                  {customCategories.length > 1 && (
                    <button
                      type="button"
                      title={`Delete category "${cat.label}"`}
                      aria-label={`Delete category ${cat.label}`}
                      onClick={() => handleDeleteCategory(cat.id)}
                      className={`px-1.5 py-1.5 text-xs border rounded-r-md transition-colors ${
                        isActive
                          ? `${style.activeBtn} opacity-90 hover:opacity-100`
                          : 'bg-white text-slate-400 border-slate-200 hover:text-red-700 hover:bg-slate-50'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={handleToggleUntaggedFilter}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap font-mono tabular-nums ${
                filterUntaggedOnly
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Untagged ({tagStats.untaggedUnitsCount})
            </button>

            {validActiveTagFilterIds.length >= 2 && (
              <div className="inline-flex p-0.5 bg-slate-100 rounded-md ml-1">
                <button
                  type="button"
                  onClick={() => setTagFilterMatchMode('any')}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    tagFilterMatchMode === 'any'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Match Any
                </button>
                <button
                  type="button"
                  onClick={() => setTagFilterMatchMode('all')}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    tagFilterMatchMode === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Match All
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {(isTagFiltered || isTtfFiltered) && (
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md transition-colors whitespace-nowrap"
              >
                Reset Filters
              </button>
            )}
            <button
              type="button"
              onClick={handleCompareFilteredGroup}
              disabled={filteredUnitSummaries.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-45"
            >
              <GitCompareArrows className="w-3.5 h-3.5" />
              <span>
                Compare Filtered ({Math.min(5, filteredUnitSummaries.length)})
              </span>
            </button>
          </div>
        </div>

        {/* Batch Selection & Category Assignment Workbench */}
        <div className="pt-3 border-t border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/70 border border-slate-200/80 rounded-md px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600 mr-1 whitespace-nowrap">
              Quick-Select:
            </span>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('filtered')}
              disabled={filteredUnitSummaries.length === 0}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors whitespace-nowrap disabled:opacity-45"
            >
              Visible ({filteredUnitSummaries.length})
            </button>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('critical')}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-red-700 border border-slate-200 rounded transition-colors whitespace-nowrap"
            >
              Critical Tier
            </button>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('eol60')}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-amber-700 border border-slate-200 rounded transition-colors whitespace-nowrap"
            >
              EOL 1–60d
            </button>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('spikes')}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors whitespace-nowrap"
            >
              Spikes ≥2
            </button>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('steep_slope')}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors whitespace-nowrap"
            >
              Slope &lt;-15%
            </button>
            <button
              type="button"
              onClick={() => handleQuickSelectCriteria('untagged')}
              className="px-2 py-1 text-[11px] font-medium bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded transition-colors whitespace-nowrap"
            >
              Untagged
            </button>
            {validSelectedBatchIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedBatchIds([])}
                className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 underline whitespace-nowrap"
              >
                Clear Selection
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-mono tabular-nums text-slate-700 whitespace-nowrap">
              <strong
                className={
                  validSelectedBatchIds.length > 0 ? 'text-blue-700' : 'text-slate-900'
                }
              >
                {validSelectedBatchIds.length}
              </strong>{' '}
              selected
            </span>

            <select
              aria-label="Target batch tagging category"
              value={effectiveBatchTargetId}
              onChange={(e) => setBatchTargetCategoryId(e.target.value)}
              className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {customCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => handleBatchAssignCategory(effectiveBatchTargetId)}
              disabled={validSelectedBatchIds.length === 0 || !effectiveBatchTargetId}
              className="h-8 px-3 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap disabled:opacity-40"
            >
              Apply Category
            </button>
            <button
              type="button"
              onClick={() => handleBatchRemoveCategory(effectiveBatchTargetId)}
              disabled={validSelectedBatchIds.length === 0 || !effectiveBatchTargetId}
              className="h-8 px-2.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-40"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={handleBatchClearTags}
              disabled={validSelectedBatchIds.length === 0}
              className="h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-red-700 bg-white hover:bg-red-50 border border-slate-200 rounded-md transition-colors whitespace-nowrap disabled:opacity-40"
            >
              Clear Tags
            </button>
          </div>
        </div>
      </section>

      {/* Interactive Time-Series Signal & Degradation Visualizer */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Multi-Channel Time-Series &amp; Anomaly Trajectory
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {chartMode === 'unit'
                ? 'Inspect per-unit signal amplitude, rolling baseline, health/engagement index (%), and capped RUL countdown relative to T_obs.'
                : chartMode === 'compare'
                ? 'Overlay up to 5 entities on a shared axis to compare RUL countdowns, health decay slopes, and degradation onset.'
                : 'Aggregate lifecycle degradation profile across normalized asset lifetime deciles (0% start to 100% EOL).'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setChartMode('unit')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'unit'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Unit Trajectory
              </button>
              <button
                type="button"
                onClick={() => setChartMode('compare')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  chartMode === 'compare'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <GitCompareArrows className="w-3.5 h-3.5" />
                <span>Compare Entities ({effectiveCompareIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setChartMode('cohort')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  chartMode === 'cohort'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Lifecycle Degradation
              </button>
            </div>

            {chartMode === 'unit' && (
              <select
                aria-label="Select asset or entity trajectory"
                value={effectiveUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                disabled={filteredUnitSummaries.length === 0}
                className="h-9 px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
              >
                {filteredUnitSummaries.length === 0 ? (
                  <option value="">No units in {effectiveMinTtf}d–{effectiveMaxTtf}d TTF</option>
                ) : (
                  filteredUnitSummaries.slice(0, 120).map((u) => {
                    const ttf = getEntityTtfDays(u);
                    return (
                      <option key={u.entityId} value={u.entityId}>
                        {u.entityId} ({u.eolDay <= obsCutoffDay ? 'At EOL' : `TTF +${ttf}d`} ·{' '}
                        {u.split} · {u.anomalousSpikeCount} spikes)
                      </option>
                    );
                  })
                )}
              </select>
            )}
          </div>
        </div>

        {/* Real-Time Trend-Line Anomaly Detection Control Bar */}
        {chartMode !== 'cohort' && (
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/70 border border-slate-200/80 rounded-md px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={anomalyDetectionEnabled}
                onClick={() => setAnomalyDetectionEnabled((prev) => !prev)}
                className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md whitespace-nowrap shrink-0"
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    anomalyDetectionEnabled ? 'bg-red-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-xs transition-transform ${
                      anomalyDetectionEnabled ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </span>
                <span>Real-Time Anomaly Detection</span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    anomalyDetectionEnabled ? 'text-red-700' : 'text-slate-500'
                  }`}
                >
                  {anomalyDetectionEnabled ? 'ON' : 'OFF'}
                </span>
              </button>

              {anomalyDetectionEnabled && (
                <>
                  <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                    |
                  </span>
                  <div className="inline-flex p-0.5 bg-slate-200/70 rounded-md">
                    <button
                      type="button"
                      onClick={() => setAnomalyTrendBasis('ema')}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        anomalyTrendBasis === 'ema'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      EMA Trend
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnomalyTrendBasis('linear')}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        anomalyTrendBasis === 'linear'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Linear Trend
                    </button>
                  </div>
                </>
              )}
            </div>

            {anomalyDetectionEnabled ? (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-2 text-slate-700 whitespace-nowrap">
                  <span className="font-medium">Deviation Threshold</span>
                  <input
                    type="range"
                    aria-label="Anomaly standard deviation threshold"
                    min={1.0}
                    max={3.0}
                    step={0.25}
                    value={anomalySigmaThreshold}
                    onChange={(e) => setAnomalySigmaThreshold(Number(e.target.value))}
                    className="w-28 accent-red-700"
                  />
                  <span className="font-mono tabular-nums font-semibold text-red-700 w-13">
                    ±{anomalySigmaThreshold.toFixed(2)}σ
                  </span>
                </label>

                <div className="inline-flex items-center gap-1">
                  {[1.5, 2.0, 2.5].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAnomalySigmaThreshold(preset)}
                      className={`px-2 py-0.5 text-[11px] font-mono tabular-nums rounded border transition-colors whitespace-nowrap ${
                        Math.abs(anomalySigmaThreshold - preset) < 0.01
                          ? 'bg-red-700 text-white border-red-700'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {preset.toFixed(1)}σ
                    </button>
                  ))}
                </div>

                {chartMode === 'unit' && activeUnitSummary && (
                  <span className="font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                    <strong
                      className={
                        unitAnomalyBundle.anomalyCount > 0 ? 'text-red-700' : 'text-slate-900'
                      }
                    >
                      {unitAnomalyBundle.anomalyCount}
                    </strong>{' '}
                    flagged · σ = {unitAnomalyBundle.residualStd.toFixed(2)} · Max |Z|{' '}
                    {unitAnomalyBundle.maxAbsZScore.toFixed(2)}σ
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-slate-500">
                Toggle on to overlay the entity trend line, ±σ threshold band, and live outlier markers.
              </span>
            )}
          </div>
        )}

        {chartMode === 'unit' && activeUnitSummary && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 font-mono tabular-nums">
            <div className="flex flex-wrap items-center gap-3">
              <span>Unit: <strong className="text-slate-900">{activeUnitSummary.entityId}</strong></span>
              <span aria-hidden="true">·</span>
              <span>Split: {activeUnitSummary.split}</span>
              <span aria-hidden="true">·</span>
              <span>EOL Day: {activeUnitSummary.eolDay}</span>
              <span aria-hidden="true">·</span>
              <span>Health Slope: {activeUnitSummary.degradationSlope.toFixed(4)}/day</span>
              <span aria-hidden="true">·</span>
              <span>Spikes: {activeUnitSummary.anomalousSpikeCount}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleToggleCompareUnit(activeUnitSummary.entityId)}
                className="text-xs font-sans font-medium text-slate-700 hover:text-blue-700 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <GitCompareArrows className="w-3.5 h-3.5" />
                <span>
                  {effectiveCompareIds.includes(activeUnitSummary.entityId)
                    ? 'In Comparison Overlay'
                    : 'Add to Compare'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onInspectEntityInExplorer(activeUnitSummary.entityId)}
                className="text-xs font-sans font-medium text-blue-700 hover:underline inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span>Inspect in Explorer</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {chartMode === 'compare' && (
          <div className="space-y-3 bg-slate-50/70 border border-slate-200/80 rounded-md p-3.5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {effectiveCompareIds.map((id, idx) => {
                  const style = COMPARE_PALETTE[idx % COMPARE_PALETTE.length];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleRemoveCompareUnit(id)}
                      disabled={effectiveCompareIds.length <= 1}
                      title={
                        effectiveCompareIds.length <= 1
                          ? 'Keep at least 1 entity in comparison'
                          : `Remove ${id} from comparison`
                      }
                      className="px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 hover:border-slate-300 rounded-md text-slate-800 inline-flex items-center gap-2 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
                    >
                      <span
                        className="w-3 h-0.5 inline-block shrink-0"
                        style={{ backgroundColor: style.stroke }}
                      />
                      <span>{id}</span>
                      {effectiveCompareIds.length > 1 && (
                        <X className="w-3 h-3 text-slate-400 hover:text-slate-700" />
                      )}
                    </button>
                  );
                })}

                {effectiveCompareIds.length < 5 && availableAddCandidates.length > 0 && (
                  <div className="inline-flex items-center gap-1.5">
                    <select
                      aria-label="Choose entity to add to RUL comparison"
                      value={effectiveCandidateId}
                      onChange={(e) => setCompareCandidateId(e.target.value)}
                      className="h-8 px-2 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {availableAddCandidates.map((u) => (
                        <option key={u.entityId} value={u.entityId}>
                          {u.entityId} ({u.riskTier} · EOL d{u.eolDay})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleAddCompareUnit(effectiveCandidateId)}
                      className="h-8 px-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Overlay</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setCompareUnitIds(defaultContrastIds)}
                  className="h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  Auto-Pick Contrasting 3
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Comparison X-axis alignment"
                  value={compareAxisMode}
                  onChange={(e) => setCompareAxisMode(e.target.value as CompareAxisMode)}
                  className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="lifecycle_pct">Axis: Normalized Lifecycle (0–100%)</option>
                  <option value="relative_age">Axis: Cycle Age (+Days)</option>
                  <option value="calendar_day">Axis: Calendar Day (d)</option>
                </select>

                <select
                  aria-label="Comparison overlaid metric"
                  value={compareMetricMode}
                  onChange={(e) => setCompareMetricMode(e.target.value as CompareMetricMode)}
                  className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="rul_capped">Metric: Capped RUL (cycles)</option>
                  <option value="rul_raw">Metric: Raw RUL (cycles)</option>
                  <option value="health_pct">Metric: Health Index (%)</option>
                  <option value="signal">Metric: Primary Signal / Spend</option>
                </select>
              </div>
            </div>

            {/* RUL Trend Projection & Expected Failure Controls */}
            <div className="pt-3 border-t border-slate-200/80 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
                  Trend Extrapolation
                </span>
                <div className="inline-flex p-0.5 bg-slate-200/70 rounded-md">
                  <button
                    type="button"
                    onClick={() => setProjectionMethod('off')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      projectionMethod === 'off'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Observed Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectionMethod('ema')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      projectionMethod === 'ema'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    EMA Trend
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectionMethod('linear')}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      projectionMethod === 'linear'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Linear Extrapolation
                  </button>
                </div>

                {projectionMethod !== 'off' && (
                  <select
                    aria-label="Forecast observation anchor"
                    value={forecastAnchor}
                    onChange={(e) => setForecastAnchor(e.target.value as RulForecastAnchor)}
                    className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="mid_life_65">Anchor: 65% Observed Prefix (Backtest EOL)</option>
                    <option value="obs_cutoff">Anchor: Pre-T_obs Cutoff (d{obsCutoffDay})</option>
                    <option value="latest_observed">Anchor: Full Observed Tail (Beyond EOL)</option>
                  </select>
                )}
              </div>

              {projectionMethod !== 'off' && (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  {projectionMethod === 'ema' && (
                    <label className="inline-flex items-center gap-2 text-slate-700 whitespace-nowrap">
                      <span>EMA α</span>
                      <input
                        type="range"
                        aria-label="EMA smoothing alpha"
                        min={0.2}
                        max={0.85}
                        step={0.05}
                        value={emaAlpha}
                        onChange={(e) => setEmaAlpha(Number(e.target.value))}
                        className="w-24 accent-blue-700"
                      />
                      <span className="font-mono tabular-nums font-semibold text-slate-900 w-9">
                        {emaAlpha.toFixed(2)}
                      </span>
                    </label>
                  )}

                  <label className="inline-flex items-center gap-2 text-slate-700 whitespace-nowrap">
                    <span>Forecast Horizon</span>
                    <input
                      type="range"
                      aria-label="Projection horizon"
                      min={60}
                      max={240}
                      step={15}
                      value={forecastHorizonDays}
                      onChange={(e) => setForecastHorizonDays(Number(e.target.value))}
                      className="w-28 accent-blue-700"
                    />
                    <span className="font-mono tabular-nums font-semibold text-slate-900 w-14">
                      +{effectiveHorizonX}
                      {compareAxisMode === 'lifecycle_pct' ? '%' : 'd'}
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === 'unit' ? (
              <ComposedChart
                data={unitTimeSeries}
                margin={{ top: 10, right: 20, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickFormatter={(v) => `d${v}`}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11, fill: '#475569' }}
                  width={48}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#0f766e' }}
                  width={44}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0]?.payload as (typeof unitTimeSeries)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div className="bg-white border border-slate-300 rounded-md px-3 py-2 shadow-sm text-xs space-y-1">
                        <div className="font-semibold text-slate-900 font-mono">
                          Cycle Day d{label}
                        </div>
                        <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                          <span className="text-blue-700">Signal / Spend:</span>
                          <span className="font-semibold text-slate-900">{row.signal.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                          <span className="text-slate-500">Rolling Mean:</span>
                          <span className="text-slate-700">{row.rollingMean.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                          <span className="text-teal-700">Capped RUL:</span>
                          <span className="text-slate-900">{row.rulCapped} cycles</span>
                        </div>
                        {anomalyDetectionEnabled && (
                          <div className="pt-1 mt-1 border-t border-slate-100 space-y-0.5 font-mono tabular-nums">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-600">
                                {anomalyTrendBasis === 'ema' ? 'EMA Trend:' : 'Linear Trend:'}
                              </span>
                              <span className="text-slate-900">{row.trendLine.toFixed(2)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-500">
                                ±{anomalySigmaThreshold.toFixed(2)}σ Band:
                              </span>
                              <span className="text-slate-700">
                                {row.lowerThreshold.toFixed(1)}–{row.upperThreshold.toFixed(1)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-600">Deviation:</span>
                              <span
                                className={
                                  row.isTrendAnomaly
                                    ? 'font-bold text-red-700'
                                    : 'text-slate-700'
                                }
                              >
                                {row.zScore >= 0 ? '+' : ''}
                                {row.zScore.toFixed(2)}σ ({row.residual >= 0 ? '+' : ''}
                                {row.residual.toFixed(2)})
                              </span>
                            </div>
                            {row.isTrendAnomaly && (
                              <div className="text-[11px] font-sans font-semibold text-red-700 pt-0.5">
                                Anomaly: exceeds ±{anomalySigmaThreshold.toFixed(2)}σ threshold
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceLine
                  yAxisId="left"
                  x={obsCutoffDay}
                  stroke="#64748b"
                  strokeDasharray="4 4"
                  label={{ value: `T_obs (${obsCutoffDay}d)`, position: 'top', fontSize: 10, fill: '#475569' }}
                />
                {anomalyDetectionEnabled && (
                  <>
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="bandBase"
                      stackId="anomBand"
                      stroke="none"
                      fill="transparent"
                      legendType="none"
                      tooltipType="none"
                    />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="bandSpan"
                      stackId="anomBand"
                      name={`±${anomalySigmaThreshold.toFixed(2)}σ Threshold Band`}
                      stroke="none"
                      fill="#dbeafe"
                      fillOpacity={0.35}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="upperThreshold"
                      name={`Upper +${anomalySigmaThreshold.toFixed(2)}σ`}
                      stroke="#94a3b8"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      dot={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="lowerThreshold"
                      name={`Lower -${anomalySigmaThreshold.toFixed(2)}σ`}
                      stroke="#94a3b8"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      dot={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="trendLine"
                      name={anomalyTrendBasis === 'ema' ? 'EMA Trend Line' : 'Linear Trend Line'}
                      stroke="#334155"
                      strokeWidth={1.75}
                      strokeDasharray="5 3"
                      dot={false}
                    />
                  </>
                )}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="signal"
                  name="Signal / Spend"
                  stroke="#1d4ed8"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="rollingMean"
                  name="Rolling Baseline"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="rulCapped"
                  name="Capped RUL (cycles)"
                  stroke="#0f766e"
                  strokeWidth={2}
                  dot={false}
                />
                {anomalyDetectionEnabled && (
                  <Scatter
                    yAxisId="left"
                    dataKey="anomalyPoint"
                    name={`Trend Anomaly (|Z| ≥ ${anomalySigmaThreshold.toFixed(2)}σ)`}
                    fill="#dc2626"
                    shape={<AnomalyMarkerShape />}
                  />
                )}
              </ComposedChart>
            ) : chartMode === 'compare' ? (
              <ComposedChart
                data={compareSeries}
                margin={{ top: 14, right: 24, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                {projectionMethod === 'off' && compareAxisMode === 'lifecycle_pct' ? (
                  <XAxis dataKey="xLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                ) : (
                  <XAxis
                    dataKey="xValue"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickFormatter={(v) =>
                      compareAxisMode === 'lifecycle_pct'
                        ? `${Math.round(Number(v))}%`
                        : compareAxisMode === 'relative_age'
                        ? `+${Math.round(Number(v))}d`
                        : `d${Math.round(Number(v))}`
                    }
                  />
                )}
                <YAxis
                  tick={{ fontSize: 11, fill: '#475569' }}
                  width={48}
                  tickFormatter={(v) => (compareMetricMode === 'health_pct' ? `${v}%` : `${v}`)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#cbd5e1',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  labelFormatter={(val, payload) => {
                    const row = payload?.[0]?.payload as { xLabel?: string } | undefined;
                    return row?.xLabel ? `Axis: ${row.xLabel}` : `X: ${val}`;
                  }}
                  formatter={(value, name) => {
                    const label = String(name);
                    if (label.endsWith('__anom')) {
                      return [
                        `${value}${compareMetricMode === 'health_pct' ? '%' : ''}`,
                        `${label.replace('__anom', '')} Anomaly (≥±${anomalySigmaThreshold.toFixed(2)}σ)`,
                      ];
                    }
                    if (label.endsWith('__proj')) {
                      return [
                        `${value}${compareMetricMode === 'health_pct' ? '%' : ''}`,
                        `${label.replace('__proj', '')} (${
                          projectionMethod === 'ema' ? 'EMA Proj' : 'Linear Proj'
                        })`,
                      ];
                    }
                    if (label.endsWith('__fail')) {
                      return [
                        `${value}${compareMetricMode === 'health_pct' ? '%' : ''}`,
                        `${label.replace('__fail', '')} Expected Failure`,
                      ];
                    }
                    return [
                      `${value}${compareMetricMode === 'health_pct' ? '%' : ''}`,
                      `${label} (Observed)`,
                    ];
                  }}
                />
                {compareMetricMode === 'rul_capped' && (
                  <ReferenceLine
                    y={config.rulCap}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    label={{
                      value: `RUL Cap (${config.rulCap})`,
                      position: 'insideTopRight',
                      fontSize: 10,
                      fill: '#64748b',
                    }}
                  />
                )}
                {projectionMethod !== 'off' && (
                  <ReferenceLine
                    y={
                      compareMetricMode === 'health_pct'
                        ? 25
                        : compareMetricMode === 'signal'
                        ? signalFailureCeiling
                        : 0
                    }
                    stroke="#dc2626"
                    strokeDasharray="4 4"
                    label={{
                      value:
                        compareMetricMode === 'health_pct'
                          ? 'Failure Threshold (25%)'
                          : compareMetricMode === 'signal'
                          ? `Critical Load (${signalFailureCeiling})`
                          : 'Expected Failure (RUL = 0)',
                      position: 'insideBottomRight',
                      fontSize: 10,
                      fill: '#b91c1c',
                    }}
                  />
                )}
                {effectiveCompareIds.map((id, idx) => {
                  const style = COMPARE_PALETTE[idx % COMPARE_PALETTE.length];
                  return (
                    <React.Fragment key={id}>
                      <Line
                        type="monotone"
                        dataKey={id}
                        name={id}
                        stroke={style.stroke}
                        strokeWidth={2.2}
                        strokeDasharray={style.dash}
                        connectNulls
                        dot={{ r: 2.5 }}
                        activeDot={{ r: 4.5 }}
                      />
                      {anomalyDetectionEnabled && (
                        <Scatter
                          dataKey={`${id}__anom`}
                          name={`${id}__anom`}
                          fill={style.stroke}
                          shape={<CompareAnomalyShape stroke={style.stroke} />}
                        />
                      )}
                      {projectionMethod !== 'off' && (
                        <>
                          <Line
                            type="linear"
                            dataKey={`${id}__proj`}
                            name={`${id}__proj`}
                            stroke={style.stroke}
                            strokeWidth={1.8}
                            strokeDasharray="4 4"
                            strokeOpacity={0.85}
                            connectNulls
                            dot={false}
                            activeDot={{ r: 3.5 }}
                          />
                          <Scatter
                            dataKey={`${id}__fail`}
                            name={`${id}__fail`}
                            fill={style.stroke}
                            shape={<FailurePointShape fill={style.stroke} />}
                          />
                        </>
                      )}
                    </React.Fragment>
                  );
                })}
              </ComposedChart>
            ) : (
              <ComposedChart
                data={result.degradationCurve}
                margin={{ top: 10, right: 20, left: 4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="cycleBucket"
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#475569' }} width={48} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#0f766e' }}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#cbd5e1',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="meanSignal"
                  name="Mean Signal / Spend"
                  stroke="#1d4ed8"
                  strokeWidth={2}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="meanRulCapped"
                  name="Mean Capped RUL"
                  stroke="#0f766e"
                  strokeWidth={2}
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>

        {chartMode === 'compare' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600 pt-1">
              {effectiveCompareSummaries.map((u, idx) => {
                const style = COMPARE_PALETTE[idx % COMPARE_PALETTE.length];
                return (
                  <span key={u.entityId} className="inline-flex items-center gap-1.5 font-mono">
                    <span
                      className="w-3.5 h-0.5 inline-block"
                      style={{
                        backgroundColor: style.stroke,
                        borderTop: style.dash ? `2px dashed ${style.stroke}` : undefined,
                      }}
                    />
                    <span className="text-slate-800 font-medium">{u.entityId}</span>
                    <span className="text-slate-500">({u.riskTier})</span>
                  </span>
                );
              })}
              {anomalyDetectionEnabled && (
                <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-red-600 bg-red-100 inline-block" />
                  <span>Trend Anomaly (≥±{anomalySigmaThreshold.toFixed(2)}σ)</span>
                </span>
              )}
              {projectionMethod !== 'off' && (
                <>
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <span className="w-4 border-t-2 border-dashed border-slate-500 inline-block" />
                    <span>
                      {projectionMethod === 'ema'
                        ? `EMA Trend (α=${emaAlpha.toFixed(2)})`
                        : 'Linear Extrapolation'}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full border-2 border-red-600 bg-white inline-block" />
                    <span>Expected Failure Point</span>
                  </span>
                </>
              )}
            </div>

            {effectiveCompareSummaries.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/70">
                      <th className="px-3 py-2 text-left font-semibold">Compared Entity</th>
                      <th className="px-3 py-2 text-left font-semibold">Split</th>
                      <th className="px-3 py-2 text-right font-semibold">Span (d)</th>
                      <th className="px-3 py-2 text-right font-semibold">Mean Capped RUL</th>
                      <th className="px-3 py-2 text-right font-semibold">Final Health</th>
                      <th className="px-3 py-2 text-right font-semibold">Slope/100d</th>
                      {projectionMethod !== 'off' && (
                        <>
                          <th className="px-3 py-2 text-right font-semibold">Projected Rate</th>
                          <th className="px-3 py-2 text-right font-semibold">Expected Failure</th>
                          <th className="px-3 py-2 text-right font-semibold">vs. Actual EOL</th>
                        </>
                      )}
                      {anomalyDetectionEnabled && (
                        <th className="px-3 py-2 text-right font-semibold">
                          Trend Anom (≥{anomalySigmaThreshold.toFixed(2)}σ)
                        </th>
                      )}
                      <th className="px-3 py-2 text-right font-semibold">Spikes</th>
                      <th className="px-3 py-2 text-left font-semibold">Risk Tier</th>
                      <th className="px-3 py-2 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {effectiveCompareSummaries.map((u, idx) => {
                      const style = COMPARE_PALETTE[idx % COMPARE_PALETTE.length];
                      const slopePct = Math.round(u.degradationSlope * 10000 * 10) / 10;
                      const proj = compareProjections.get(u.entityId);
                      const unitSuffix = compareAxisMode === 'lifecycle_pct' ? '%' : 'd';
                      const formatAxisPoint = (v: number) =>
                        compareAxisMode === 'lifecycle_pct'
                          ? `${v}%`
                          : compareAxisMode === 'relative_age'
                          ? `+${v}d`
                          : `d${v}`;

                      return (
                        <tr key={u.entityId} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono font-medium text-slate-900">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                                style={{ backgroundColor: style.stroke }}
                              />
                              <span>{u.entityId}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-600">{u.split}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                            d{u.firstDay}–d{u.eolDay} ({u.cycleSpanDays}d)
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 font-medium">
                            {u.meanRulCapped.toFixed(1)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                            {u.finalHealthPct.toFixed(1)}%
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums ${
                              slopePct < -15 ? 'text-amber-700' : 'text-slate-700'
                            }`}
                          >
                            {slopePct >= 0 ? '+' : ''}
                            {slopePct.toFixed(1)}%
                          </td>
                          {projectionMethod !== 'off' && (
                            <>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                {proj
                                  ? `${proj.slopePerX >= 0 ? '+' : ''}${proj.slopePerX.toFixed(
                                      2
                                    )}/${unitSuffix}`
                                  : '—'}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums">
                                {!proj ? (
                                  '—'
                                ) : proj.status === 'already_failed' ? (
                                  <span className="text-red-700 font-semibold">
                                    At {formatAxisPoint(proj.anchorX)} (EOL)
                                  </span>
                                ) : proj.projectedFailureX !== null ? (
                                  <span
                                    className={
                                      proj.status === 'imminent'
                                        ? 'text-red-700 font-semibold'
                                        : proj.status === 'projected'
                                        ? 'text-blue-700 font-semibold'
                                        : 'text-slate-600'
                                    }
                                  >
                                    {formatAxisPoint(proj.projectedFailureX)} (in{' '}
                                    {proj.remainingToFailureX}
                                    {unitSuffix})
                                  </span>
                                ) : (
                                  <span className="text-slate-500">No failure trend</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                                {proj && proj.errorVsActualX !== null
                                  ? `${proj.errorVsActualX >= 0 ? '+' : ''}${
                                      proj.errorVsActualX
                                    }${unitSuffix}`
                                  : '—'}
                              </td>
                            </>
                          )}
                          {anomalyDetectionEnabled && (
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {(compareAnomalyCounts.get(u.entityId) ?? 0) > 0 ? (
                                <span className="font-semibold text-red-700">
                                  {compareAnomalyCounts.get(u.entityId)}
                                </span>
                              ) : (
                                <span className="text-slate-400">0</span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">
                            {u.anomalousSpikeCount}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] font-semibold uppercase">
                            <span
                              className={
                                u.riskTier === 'critical'
                                  ? 'text-red-700'
                                  : u.riskTier === 'warning'
                                  ? 'text-amber-700'
                                  : 'text-teal-700'
                              }
                            >
                              {u.riskTier}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedUnitId(u.entityId);
                                setChartMode('unit');
                              }}
                              className="text-blue-700 hover:underline font-medium whitespace-nowrap"
                            >
                              Focus Single
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 pt-1">
            <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-700 inline-block" />
                <span>Primary Signal / Spend</span>
              </span>
              {chartMode === 'unit' && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                    <span>Rolling 4-Step Mean</span>
                  </span>
                  {anomalyDetectionEnabled && (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3.5 border-t-2 border-dashed border-slate-700 inline-block" />
                        <span>
                          {anomalyTrendBasis === 'ema' ? 'EMA Trend Line' : 'Linear Trend Line'}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3 h-2 bg-blue-100 border border-slate-400 border-dashed inline-block" />
                        <span>±{anomalySigmaThreshold.toFixed(2)}σ Band</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-red-200 inline-block" />
                        <span>Highlighted Anomaly (|Z| ≥ {anomalySigmaThreshold.toFixed(2)}σ)</span>
                      </span>
                    </>
                  )}
                </>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                <span>Piecewise Capped RUL Target</span>
              </span>
            </div>

            {chartMode === 'unit' && anomalyDetectionEnabled && (
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 font-mono tabular-nums">
                <span className="font-sans font-medium text-slate-700">
                  Flagged Points (&gt;±{anomalySigmaThreshold.toFixed(2)}σ from trend):
                </span>
                {unitAnomalyBundle.flaggedPoints.length === 0 ? (
                  <span className="font-sans text-slate-500">
                    None — all {unitTimeSeries.length} observed points fall within ±
                    {anomalySigmaThreshold.toFixed(2)}σ (σ ={' '}
                    {unitAnomalyBundle.residualStd.toFixed(2)}).
                  </span>
                ) : (
                  unitAnomalyBundle.flaggedPoints.map((fp, idx) => (
                    <React.Fragment key={`${fp.day}-${idx}`}>
                      {idx > 0 && (
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span className="text-red-700 font-semibold">
                        d{fp.day}: {fp.signal.toFixed(1)} vs {fp.trendY.toFixed(1)} (
                        {fp.zScore >= 0 ? '+' : ''}
                        {fp.zScore.toFixed(2)}σ)
                      </span>
                    </React.Fragment>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Failure Probability Density Function (PDF) Section */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-red-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Failure Probability Density Function (PDF) &amp; Window Risk
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Estimates continuous failure-time probability density f(t) from active{' '}
              {pdfMethod === 'ema' ? 'EMA' : 'Linear'} degradation trends and residual volatility,
              integrating expected failure likelihood inside the shaded upcoming window.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setPdfScope('cohort')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  pdfScope === 'cohort'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Filtered Cohort ({filteredUnitSummaries.length})
              </button>
              <button
                type="button"
                onClick={() => setPdfScope('compare')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  pdfScope === 'compare'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Compare Set ({effectiveCompareSummaries.length})
              </button>
              <button
                type="button"
                onClick={() => setPdfScope('unit')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  pdfScope === 'unit'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Focused Unit
              </button>
            </div>

            <div className="inline-flex p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setPdfMethod('ema')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  pdfMethod === 'ema'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EMA Trend
              </button>
              <button
                type="button"
                onClick={() => setPdfMethod('linear')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  pdfMethod === 'linear'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Linear Fit
              </button>
            </div>

            <select
              aria-label="Failure PDF observation anchor"
              value={pdfAnchor}
              onChange={(e) => setPdfAnchor(e.target.value as 'obs_cutoff' | 'mid_life_65')}
              className="h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="obs_cutoff">Anchor: Active at T_obs (d{obsCutoffDay})</option>
              <option value="mid_life_65">Anchor: 65% Lifecycle Prefix</option>
            </select>
          </div>
        </div>

        {/* Upcoming Window Range Controls */}
        <div className="pb-4 border-b border-slate-100 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-700">Upcoming Evaluation Window:</span>
              <span className="font-mono tabular-nums font-semibold text-red-700">
                +{pdfWindowStart}d to +{pdfWindowEnd}d
              </span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                {failurePdf.activeUnitCount} active assets evaluated
                {failurePdf.alreadyEolCount > 0
                  ? ` (${failurePdf.alreadyEolCount} already EOL)`
                  : ''}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: 'Next 30d', s: 0, e: 30 },
                { label: 'Next 60d', s: 0, e: 60 },
                { label: '30–90d', s: 30, e: 90 },
                { label: 'Next 90d', s: 0, e: 90 },
                { label: '60–150d', s: 60, e: 150 },
              ].map((preset) => {
                const active = pdfWindowStart === preset.s && pdfWindowEnd === preset.e;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setPdfWindowStart(preset.s);
                      setPdfWindowEnd(preset.e);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-red-700 text-white border-red-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono tabular-nums text-slate-500 w-8 text-right shrink-0">
              +0d
            </span>
            <div className="relative flex-1 h-7 flex items-center">
              <div className="w-full h-1.5 bg-slate-200 rounded-full relative">
                <div
                  className="absolute h-full bg-red-600 rounded-full"
                  style={{
                    left: `${(pdfWindowStart / 240) * 100}%`,
                    right: `${100 - (pdfWindowEnd / 240) * 100}%`,
                  }}
                />
              </div>
              <input
                type="range"
                aria-label="Failure PDF evaluation window start in days"
                min={0}
                max={240}
                step={5}
                value={pdfWindowStart}
                onChange={(e) => {
                  const nextS = Math.min(Number(e.target.value), pdfWindowEnd);
                  setPdfWindowStart(nextS);
                }}
                className={`absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-red-700 [&::-webkit-slider-thumb]:shadow-xs [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-red-700 [&::-moz-range-thumb]:cursor-pointer ${
                  pdfWindowStart > 190 ? 'z-20' : 'z-10'
                }`}
              />
              <input
                type="range"
                aria-label="Failure PDF evaluation window end in days"
                min={0}
                max={240}
                step={5}
                value={pdfWindowEnd}
                onChange={(e) => {
                  const nextE = Math.max(Number(e.target.value), pdfWindowStart);
                  setPdfWindowEnd(nextE);
                }}
                className="absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none z-10 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-red-700 [&::-webkit-slider-thumb]:shadow-xs [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-red-700 [&::-moz-range-thumb]:cursor-pointer"
              />
            </div>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 w-11 shrink-0">
              +240d
            </span>
          </div>
        </div>

        {/* Window Likelihood Metrics Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-0 lg:divide-x lg:divide-slate-200 text-xs border-b border-slate-100 pb-4">
          <div className="lg:pr-4">
            <div className="text-red-800 font-medium">Window Failure Likelihood</div>
            <div className="mt-0.5 text-lg font-bold text-red-700 font-mono tabular-nums">
              {failurePdf.windowProbabilityPct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-red-700/90 font-mono tabular-nums">
              P(+{pdfWindowStart}d ≤ T ≤ +{pdfWindowEnd}d)
            </div>
          </div>

          <div className="lg:px-4">
            <div className="text-slate-600 font-medium">Expected Failures in Window</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {failurePdf.expectedFailureUnits.toFixed(1)} units
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              of {failurePdf.activeUnitCount} active assets
            </div>
          </div>

          <div className="lg:px-4">
            <div className="text-slate-600 font-medium">Peak Density Horizon</div>
            <div className="mt-0.5 text-lg font-bold text-blue-700 font-mono tabular-nums">
              +{failurePdf.peakDay}d
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              {failurePdf.peakDensityPctPer10d.toFixed(1)}% per 10d band
            </div>
          </div>

          <div className="lg:pl-4">
            <div className="text-slate-600 font-medium">Median / P90 Failure Horizon</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {failurePdf.medianTtfDay !== null ? `+${failurePdf.medianTtfDay}d` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              P90 {failurePdf.p90TtfDay !== null ? `+${failurePdf.p90TtfDay}d` : '>240d'} · σ̄ ±
              {failurePdf.meanUncertaintyDays.toFixed(1)}d
            </div>
          </div>
        </div>

        {failurePdf.activeUnitCount === 0 ? (
          <div className="h-60 flex flex-col items-center justify-center text-center px-6 bg-slate-50/60 border border-slate-200/70 rounded-md space-y-2.5">
            <div className="text-xs font-medium text-slate-700">
              No active non-EOL assets remain at T_obs (d{obsCutoffDay}) inside the current filter.
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPdfAnchor('mid_life_65')}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors"
              >
                Use 65% Lifecycle Prefix
              </button>
              {isTtfFiltered && (
                <button
                  type="button"
                  onClick={() => setTtfRange(null)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors"
                >
                  Reset TTF Filter
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={failurePdf.points}
                  margin={{ top: 12, right: 20, left: 4, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="dayOffset"
                    type="number"
                    domain={[0, 240]}
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickFormatter={(v) => `+${v}d`}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    tickFormatter={(v) => `${v}%`}
                    width={46}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: '#0f766e' }}
                    tickFormatter={(v) => `${v}%`}
                    width={46}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                    labelFormatter={(val) => `Horizon: +${val} days ahead`}
                    formatter={(value, name) => {
                      const label = String(name);
                      if (label === 'Window Failure Density') {
                        return [`${value}% / 10d`, label];
                      }
                      if (label === 'Failure Density f(t)') {
                        return [`${value}% / 10d`, label];
                      }
                      return [`${value}%`, label];
                    }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    x={pdfWindowStart}
                    stroke="#dc2626"
                    strokeDasharray="3 3"
                    label={{
                      value: `Start +${pdfWindowStart}d`,
                      position: 'insideTopLeft',
                      fontSize: 10,
                      fill: '#b91c1c',
                    }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    x={pdfWindowEnd}
                    stroke="#dc2626"
                    strokeDasharray="3 3"
                    label={{
                      value: `End +${pdfWindowEnd}d`,
                      position: 'insideTopRight',
                      fontSize: 10,
                      fill: '#b91c1c',
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="densityPctPer10d"
                    name="Failure Density f(t)"
                    stroke="#1d4ed8"
                    strokeWidth={2}
                    fill="#dbeafe"
                    fillOpacity={0.55}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="windowDensityPctPer10d"
                    name="Window Failure Density"
                    stroke="#dc2626"
                    strokeWidth={2.2}
                    fill="#fca5a5"
                    fillOpacity={0.65}
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePct"
                    name="Cumulative Failure CDF (%)"
                    stroke="#0f766e"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600 pt-1">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-2 bg-blue-100 border border-blue-700 inline-block" />
                <span>Failure Probability Density f(t) (% per 10-day band)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-2 bg-red-300 border border-red-600 inline-block" />
                <span>
                  Target Window Mass (+{pdfWindowStart}d–+{pdfWindowEnd}d:{' '}
                  {failurePdf.windowProbabilityPct.toFixed(1)}%)
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-teal-700 inline-block" />
                <span>Cumulative Failure CDF F(t) (%)</span>
              </span>
            </div>
          </>
        )}
      </section>

      {/* Population Degradation Heatmap */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-red-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Population Degradation Heatmap
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Maps failure density across all active entities by normalized age (0–100%) and
              cumulative damage score (0–100) derived from health loss, signal load, and anomaly shocks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="inline-flex p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setHeatmapScope('all')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  heatmapScope === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Active ({result.unitSummaries.length})
              </button>
              <button
                type="button"
                onClick={() => setHeatmapScope('filtered')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  heatmapScope === 'filtered'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Filtered Cohort ({filteredUnitSummaries.length})
              </button>
            </div>

            <select
              aria-label="Heatmap density metric"
              value={heatmapDensityMode}
              onChange={(e) => setHeatmapDensityMode(e.target.value as HeatmapDensityMode)}
              className="h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="failure_hazard">Density: Failure Hazard Mass</option>
              <option value="eol_endpoints">Density: EOL Failure Endpoints</option>
              <option value="occupancy">Density: Active Entity Occupancy</option>
            </select>

            <select
              aria-label="Heatmap normalized age axis basis"
              value={heatmapAgeBasis}
              onChange={(e) => setHeatmapAgeBasis(e.target.value as HeatmapAgeBasis)}
              className="h-8 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="fleet_span">X-Axis: Fleet-Normalized Age (%)</option>
              <option value="unit_lifecycle">X-Axis: Unit Lifecycle Progress (%)</option>
            </select>
          </div>
        </div>

        {/* Summary Telemetry Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-0 lg:divide-x lg:divide-slate-200 text-xs border-b border-slate-100 pb-4">
          <div className="lg:pr-4">
            <div className="text-red-800 font-medium">Peak Failure Hotspot</div>
            <div className="mt-0.5 text-sm font-bold text-red-700 font-mono tabular-nums">
              Age {populationHeatmap.hotspotAgeLabel} · Dmg {populationHeatmap.hotspotDamageLabel}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
              {populationHeatmap.hotspotDensityPct.toFixed(1)}% density ·{' '}
              {populationHeatmap.hotspotEolCount} EOL failures
            </div>
          </div>

          <div className="lg:px-4">
            <div className="text-slate-600 font-medium">High-Damage Failure Share (≥62.5)</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {populationHeatmap.highDamageEolSharePct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              of {populationHeatmap.totalEolEvents} terminal EOL events
            </div>
          </div>

          <div className="lg:px-4">
            <div className="text-slate-600 font-medium">Mean Cumulative Damage at EOL</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {populationHeatmap.meanDamageAtFailure.toFixed(1)} / 100
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              Spread σ = ±{populationHeatmap.stdDamageAtFailure.toFixed(1)}
            </div>
          </div>

          <div className="lg:pl-4">
            <div className="text-slate-600 font-medium">Active Population Mapped</div>
            <div className="mt-0.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {populationHeatmap.totalEntities} units
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
              {populationHeatmap.totalCycles.toLocaleString()} lifecycle state samples
            </div>
          </div>
        </div>

        {populationHeatmap.totalEntities === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500 bg-slate-50/50 border border-slate-200 rounded-md">
            No active entities match the current selection to map onto the degradation heatmap.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Left: 2D Heatmap Matrix */}
            <div className="xl:col-span-8 space-y-3">
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="flex items-stretch gap-2">
                    {/* Y-Axis Vertical Title */}
                    <div className="w-5 shrink-0 flex items-center justify-center">
                      <span className="text-[11px] font-medium text-slate-500 -rotate-90 whitespace-nowrap">
                        Cumulative Damage Score
                      </span>
                    </div>

                    <div className="flex-1 space-y-1">
                      {populationHeatmap.rows.map((row) => (
                        <div key={row.damageIdx} className="grid grid-cols-12 gap-1 items-center">
                          <div className="col-span-1 text-right pr-1.5 text-[11px] font-mono tabular-nums text-slate-600 whitespace-nowrap">
                            {row.damageLabel}
                          </div>

                          <div className="col-span-10 grid grid-cols-10 gap-1">
                            {row.cells.map((cell) => {
                              const isSelected =
                                activeHeatmapCell?.ageIdx === cell.ageIdx &&
                                activeHeatmapCell?.damageIdx === cell.damageIdx;
                              const isPinned =
                                pinnedHeatmapCoords?.ageIdx === cell.ageIdx &&
                                pinnedHeatmapCoords?.damageIdx === cell.damageIdx;
                              const isEmpty = cell.cycleCount === 0 && cell.eolCount === 0;

                              let colorClass = 'bg-slate-50 text-slate-300 border-slate-100';
                              if (!isEmpty) {
                                if (cell.intensity > 0.8) {
                                  colorClass = 'bg-red-700 text-white border-red-800';
                                } else if (cell.intensity > 0.6) {
                                  colorClass = 'bg-red-500 text-white border-red-600';
                                } else if (cell.intensity > 0.4) {
                                  colorClass = 'bg-orange-300 text-slate-900 border-orange-400/70';
                                } else if (cell.intensity > 0.2) {
                                  colorClass = 'bg-amber-200 text-slate-900 border-amber-300/70';
                                } else if (cell.intensity > 0) {
                                  colorClass = 'bg-amber-50 text-amber-900 border-amber-200/80';
                                } else {
                                  colorClass = 'bg-slate-100 text-slate-500 border-slate-200/80';
                                }
                              }

                              const cellText = isEmpty
                                ? ''
                                : heatmapDensityMode === 'eol_endpoints'
                                ? cell.eolCount > 0
                                  ? `${cell.eolCount}`
                                  : '·'
                                : heatmapDensityMode === 'occupancy'
                                ? `${cell.activeEntityCount}`
                                : cell.failureDensityPct > 0
                                ? `${cell.failureDensityPct.toFixed(1)}`
                                : '·';

                              return (
                                <button
                                  key={`${cell.damageIdx}-${cell.ageIdx}`}
                                  type="button"
                                  onMouseEnter={() =>
                                    setHoveredHeatmapCoords({
                                      ageIdx: cell.ageIdx,
                                      damageIdx: cell.damageIdx,
                                    })
                                  }
                                  onMouseLeave={() => setHoveredHeatmapCoords(null)}
                                  onClick={() =>
                                    setPinnedHeatmapCoords((prev) =>
                                      prev?.ageIdx === cell.ageIdx &&
                                      prev?.damageIdx === cell.damageIdx
                                        ? null
                                        : { ageIdx: cell.ageIdx, damageIdx: cell.damageIdx }
                                    )
                                  }
                                  title={`Age ${cell.ageLabel} · Damage ${cell.damageLabel} · Density ${cell.failureDensityPct.toFixed(1)}% · ${cell.eolCount} EOL · ${cell.activeEntityCount} entities`}
                                  className={`h-8 rounded-xs border text-[10px] font-mono tabular-nums font-medium flex items-center justify-center transition-all cursor-pointer ${colorClass} ${
                                    isPinned
                                      ? 'ring-2 ring-slate-900 ring-offset-1 z-10'
                                      : isSelected
                                      ? 'ring-1 ring-slate-700 z-10'
                                      : 'hover:ring-1 hover:ring-slate-500'
                                  }`}
                                >
                                  {cellText}
                                </button>
                              );
                            })}
                          </div>

                          <div className="col-span-1 text-right pl-1 text-[10px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {row.rowSharePct > 0 ? `${row.rowSharePct.toFixed(0)}%` : '0%'}
                          </div>
                        </div>
                      ))}

                      {/* X-Axis Labels */}
                      <div className="grid grid-cols-12 gap-1 pt-1.5">
                        <div className="col-span-1" />
                        <div className="col-span-10 grid grid-cols-10 gap-1">
                          {populationHeatmap.ageLabels.map((lbl) => (
                            <div
                              key={lbl}
                              className="text-center text-[10px] font-mono tabular-nums text-slate-600"
                            >
                              {lbl}
                            </div>
                          ))}
                        </div>
                        <div className="col-span-1 text-right pl-1 text-[10px] font-medium text-slate-500">
                          Row %
                        </div>
                      </div>

                      <div className="text-center text-[11px] font-medium text-slate-500 pt-0.5">
                        {heatmapAgeBasis === 'fleet_span'
                          ? 'Normalized Fleet Age (% of P95 Operational Lifespan)'
                          : 'Normalized Unit Lifecycle Age (0% Start → 100% EOL)'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Heat Scale Legend */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-slate-600">
                <div className="flex items-center gap-2">
                  <span>Density Scale:</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-4 h-3 rounded-xs bg-slate-50 border border-slate-200 inline-block" />
                    <span>0</span>
                  </span>
                  <span className="w-4 h-3 rounded-xs bg-amber-50 border border-amber-200 inline-block" />
                  <span className="w-4 h-3 rounded-xs bg-amber-200 border border-amber-300 inline-block" />
                  <span className="w-4 h-3 rounded-xs bg-orange-300 border border-orange-400 inline-block" />
                  <span className="w-4 h-3 rounded-xs bg-red-500 border border-red-600 inline-block" />
                  <span className="inline-flex items-center gap-1">
                    <span className="w-4 h-3 rounded-xs bg-red-700 border border-red-800 inline-block" />
                    <span>Peak Hotspot</span>
                  </span>
                </div>
                <span className="text-slate-500">
                  Hover any cell to inspect · Click cell to pin entities
                </span>
              </div>
            </div>

            {/* Right: Selected Cell Telemetry Inspector */}
            <div className="xl:col-span-4 border border-slate-200 rounded-md overflow-hidden bg-slate-50/40">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900">
                  {pinnedHeatmapCoords ? 'Pinned Cell Inspector' : 'Active Cell Inspector'}
                </span>
                {pinnedHeatmapCoords ? (
                  <button
                    type="button"
                    onClick={() => setPinnedHeatmapCoords(null)}
                    className="text-[11px] font-medium text-blue-700 hover:underline"
                  >
                    Unpin
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">Auto-Peak / Hover</span>
                )}
              </div>

              {activeHeatmapCell ? (
                <div className="p-4 space-y-3.5 text-xs">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/80">
                    <div>
                      <div className="text-slate-500 text-[11px]">Grid Coordinate</div>
                      <div className="font-mono font-semibold text-slate-900 mt-0.5">
                        Age {activeHeatmapCell.ageLabel} · Damage {activeHeatmapCell.damageLabel}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="text-slate-500 text-[11px]">Density Share</div>
                      <div className="font-bold text-red-700 text-sm mt-0.5">
                        {activeHeatmapCell.failureDensityPct.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
                    <div>
                      <div className="text-[11px] font-sans text-slate-500">EOL Failures in Cell</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {activeHeatmapCell.eolCount} units
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-slate-500">Active Entities</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {activeHeatmapCell.activeEntityCount} units
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-slate-500">Mean Remaining RUL</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {activeHeatmapCell.meanRulRaw !== null
                          ? `${activeHeatmapCell.meanRulRaw.toFixed(1)} cycles`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-slate-500">State Samples</div>
                      <div className="font-semibold text-slate-900 mt-0.5">
                        {activeHeatmapCell.cycleCount} cycles
                      </div>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">
                        Entities in Cell ({activeHeatmapCell.entityIds.length})
                      </span>
                      {activeHeatmapCell.entityIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const top5 = activeHeatmapCell.entityIds.slice(0, 5);
                            if (
                              top5.some(
                                (id) => !filteredUnitSummaries.some((u) => u.entityId === id)
                              )
                            ) {
                              handleClearAllFilters();
                            }
                            setCompareUnitIds(top5);
                            setChartMode('compare');
                          }}
                          className="text-[11px] font-medium text-blue-700 hover:underline inline-flex items-center gap-1"
                        >
                          <GitCompareArrows className="w-3 h-3" />
                          <span>Compare Top {Math.min(5, activeHeatmapCell.entityIds.length)}</span>
                        </button>
                      )}
                    </div>

                    {activeHeatmapCell.entityIds.length === 0 ? (
                      <div className="text-[11px] text-slate-500 py-2">
                        No entity trajectories intersect this age/damage region.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                        {activeHeatmapCell.entityIds.slice(0, 18).map((eid) => (
                          <button
                            key={eid}
                            type="button"
                            onClick={() => {
                              if (!filteredUnitSummaries.some((u) => u.entityId === eid)) {
                                handleClearAllFilters();
                              }
                              setSelectedUnitId(eid);
                              setChartMode('unit');
                            }}
                            className="px-2 py-1 text-[11px] font-mono bg-white hover:bg-blue-50 text-slate-800 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded transition-colors whitespace-nowrap"
                          >
                            {eid}
                          </button>
                        ))}
                        {activeHeatmapCell.entityIds.length > 18 && (
                          <span className="px-1.5 py-1 text-[11px] font-mono text-slate-500">
                            +{activeHeatmapCell.entityIds.length - 18} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-xs text-slate-500">No cell selected.</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Two-Column RUL Controls + Distribution & Tensor Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: RUL Preparation Controls */}
        <section className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <SlidersHorizontal className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              RUL &amp; Sliding-Window Config
            </h2>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Piecewise Linear RUL Cap (cycles)</span>
                <span className="font-mono tabular-nums">{config.rulCap}</span>
              </div>
              <input
                type="range"
                aria-label="Piecewise linear RUL cap"
                min={30}
                max={250}
                step={5}
                value={config.rulCap}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({ ...prev, rulCap: Number(e.target.value) }))
                }
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Sliding Window Length (W)</span>
                <span className="font-mono tabular-nums">{config.windowLength} steps</span>
              </div>
              <input
                type="range"
                aria-label="Sliding window length"
                min={3}
                max={16}
                step={1}
                value={config.windowLength}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    windowLength: Number(e.target.value),
                  }))
                }
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>Window Stride</span>
                <span className="font-mono tabular-nums">{config.stride} step(s)</span>
              </div>
              <input
                type="range"
                aria-label="Window stride"
                min={1}
                max={5}
                step={1}
                value={config.stride}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({ ...prev, stride: Number(e.target.value) }))
                }
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium text-slate-700 mb-1">
                <span>EOL Inactivity Gap Threshold</span>
                <span className="font-mono tabular-nums">{config.eolInactivityGapDays}d</span>
              </div>
              <input
                type="range"
                aria-label="EOL inactivity gap days"
                min={30}
                max={180}
                step={5}
                value={config.eolInactivityGapDays}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    eolInactivityGapDays: Number(e.target.value),
                  }))
                }
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Train-Fitted Normalization
              </label>
              <select
                aria-label="RUL normalization mode"
                value={config.normalization}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    normalization: e.target.value as NormalizationMode,
                  }))
                }
                className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
              >
                <option value="zscore">Z-Score (Train-fit)</option>
                <option value="minmax">Min-Max [0, 1] (Train-fit)</option>
                <option value="log1p_zscore">Log1p + Z-Score (Train-fit)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Cohort Split Filter
              </label>
              <select
                aria-label="RUL split filter"
                value={config.splitFilter}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    splitFilter: e.target.value as 'all' | SplitName,
                  }))
                }
                className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-md text-slate-800"
              >
                <option value="all">All Splits</option>
                <option value="train">Train Only</option>
                <option value="val">Validation Only</option>
                <option value="test">Test Only</option>
              </select>
            </div>
          </div>
        </section>

        {/* Right: RUL Histogram & Sliding Window Sample Matrix */}
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Capped RUL Target Distribution
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Train {result.splitCounts.train} · Val {result.splitCounts.val} · Test{' '}
                {result.splitCounts.test} units
              </span>
            </div>

            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.rulHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={40} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#cbd5e1',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Cycle Rows" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {sampleWindow && (
            <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900">
                  Normalized Sliding-Window Tensor Sample: {sampleWindow.sampleId}
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  Window d{sampleWindow.startDay}–d{sampleWindow.endDay} · Target RUL ={' '}
                  {sampleWindow.rulTargetCapped} (raw {sampleWindow.rulTargetRaw})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                      <th className="px-3.5 py-2 text-left font-semibold">Step</th>
                      {result.featureScalerStats.map((fs) => (
                        <th key={fs.name} className="px-3.5 py-2 text-right font-semibold font-mono">
                          {fs.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {sampleWindow.tensor.map((vec, tIdx) => (
                      <tr key={tIdx} className="hover:bg-slate-50">
                        <td className="px-3.5 py-2 text-slate-500">t-{sampleWindow.tensor.length - 1 - tIdx}</td>
                        {vec.map((val, cIdx) => (
                          <td key={cIdx} className="px-3.5 py-2 text-right text-slate-800">
                            {val.toFixed(4)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Unit RUL Readiness Summary Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-sm font-semibold text-slate-900">
              Unit Lifecycle &amp; Anomaly Roster
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Showing {Math.min(rosterLimit, filteredUnitSummaries.length)} of{' '}
              {filteredUnitSummaries.length} matching ({result.unitSummaries.length} total)
              {isTtfFiltered ? ` · TTF ${effectiveMinTtf}d–${effectiveMaxTtf}d` : ''}
              {isTagFiltered ? ' · Category Filter Active' : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {validSelectedBatchIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pr-2.5 border-r border-slate-200 text-xs">
                <span className="font-mono tabular-nums font-semibold text-blue-700">
                  {validSelectedBatchIds.length} checked
                </span>
                <select
                  aria-label="Roster batch target category"
                  value={effectiveBatchTargetId}
                  onChange={(e) => setBatchTargetCategoryId(e.target.value)}
                  className="h-7 px-2 text-xs bg-white border border-slate-200 rounded text-slate-800"
                >
                  {customCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleBatchAssignCategory(effectiveBatchTargetId)}
                  className="h-7 px-2.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded transition-colors whitespace-nowrap"
                >
                  Tag Checked
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedBatchIds([])}
                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 whitespace-nowrap"
                >
                  Uncheck
                </button>
              </div>
            )}

            <div className="inline-flex p-0.5 bg-slate-200/70 rounded-md text-[11px] font-mono tabular-nums">
              {[
                { label: '25', value: 25 },
                { label: '100', value: 100 },
                { label: 'All', value: Number.MAX_SAFE_INTEGER },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setRosterLimit(opt.value)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    rosterLimit === opt.value
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {(() => {
            const visibleRosterUnits = filteredUnitSummaries.slice(0, rosterLimit);
            const allVisibleChecked =
              visibleRosterUnits.length > 0 &&
              visibleRosterUnits.every((u) => validSelectedBatchIds.includes(u.entityId));
            return (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/40">
                    <th className="pl-4 pr-2 py-2.5 text-left w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all visible units for batch tagging"
                        checked={allVisibleChecked}
                        disabled={visibleRosterUnits.length === 0}
                        onChange={() => {
                          const visibleIds = visibleRosterUnits.map((u) => u.entityId);
                          if (allVisibleChecked) {
                            setSelectedBatchIds((prev) =>
                              prev.filter((id) => !visibleIds.includes(id))
                            );
                          } else {
                            setSelectedBatchIds((prev) =>
                              Array.from(new Set([...prev, ...visibleIds]))
                            );
                          }
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-700 cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-semibold">Unit ID</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Categories</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Split</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Start–EOL</th>
                    <th className="px-3 py-2.5 text-right font-semibold">TTF (vs T_obs)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Steps</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Windows</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Mean Signal</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Final Health</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Slope/100d</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Spikes</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Risk Tier</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Overlay</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRosterUnits.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-4 py-10 text-center text-xs text-slate-500">
                        No assets match the active{' '}
                        {isTtfFiltered ? `${effectiveMinTtf}d–${effectiveMaxTtf}d TTF range` : ''}
                        {isTtfFiltered && isTagFiltered ? ' and ' : ''}
                        {isTagFiltered ? 'selected category filter' : ''}.{' '}
                        <button
                          type="button"
                          onClick={handleClearAllFilters}
                          className="text-blue-700 hover:underline font-medium"
                        >
                          Reset All Filters
                        </button>
                      </td>
                    </tr>
                  ) : (
                    visibleRosterUnits.map((u) => {
                      const slopePct = Math.round(u.degradationSlope * 10000 * 10) / 10;
                      const isComparing = effectiveCompareIds.includes(u.entityId);
                      const isBatchChecked = validSelectedBatchIds.includes(u.entityId);
                      const assignedCats = (entityTags[u.entityId] ?? [])
                        .map((tid) => categoryById.get(tid))
                        .filter((c): c is CustomBatchCategory => Boolean(c));
                      const ttfDays = getEntityTtfDays(u);
                      const atEol = u.eolDay <= obsCutoffDay;
                      return (
                        <tr
                          key={u.entityId}
                          className={
                            isBatchChecked ? 'bg-blue-50/40 hover:bg-blue-50/60' : 'hover:bg-slate-50'
                          }
                        >
                          <td className="pl-4 pr-2 py-2.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${u.entityId} for batch tagging`}
                              checked={isBatchChecked}
                              onChange={() => handleToggleBatchSelectEntity(u.entityId)}
                              className="h-3.5 w-3.5 rounded border-slate-300 accent-blue-700 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-mono font-medium text-slate-900">
                            <button
                              type="button"
                              onClick={() => {
                                setChartMode('unit');
                                setSelectedUnitId(u.entityId);
                              }}
                              className="text-blue-700 hover:underline"
                            >
                              {u.entityId}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            {assignedCats.length === 0 ? (
                              <span className="text-slate-300 font-mono">—</span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                {assignedCats.map((cat) => {
                                  const style = BATCH_TAG_STYLES[cat.colorKey];
                                  return (
                                    <span
                                      key={cat.id}
                                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 whitespace-nowrap"
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-xs ${style.swatch}`} />
                                      <span>{cat.label}</span>
                                      <button
                                        type="button"
                                        title={`Remove "${cat.label}" from ${u.entityId}`}
                                        aria-label={`Remove ${cat.label} from ${u.entityId}`}
                                        onClick={() =>
                                          handleRemoveSingleEntityTag(u.entityId, cat.id)
                                        }
                                        className="text-slate-400 hover:text-red-700 transition-colors"
                                      >
                                        <X className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 font-mono">{u.split}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            d{u.firstDay}–d{u.eolDay}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium">
                            {atEol ? (
                              <span className="text-slate-500">At EOL (0d)</span>
                            ) : (
                              <span
                                className={
                                  ttfDays <= 30
                                    ? 'text-red-700 font-semibold'
                                    : ttfDays <= 60
                                    ? 'text-amber-700 font-semibold'
                                    : 'text-slate-700'
                                }
                              >
                                +{ttfDays}d
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            {u.eventCount}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                            {u.windowCount}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                            {u.meanSignal.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-800">
                            {u.finalHealthPct.toFixed(1)}%
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              slopePct < -15 ? 'text-amber-700' : 'text-slate-700'
                            }`}
                          >
                            {slopePct >= 0 ? '+' : ''}
                            {slopePct.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            {u.anomalousSpikeCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{u.anomalousSpikeCount}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[11px] font-semibold uppercase">
                            <span
                              className={
                                u.riskTier === 'critical'
                                  ? 'text-red-700'
                                  : u.riskTier === 'warning'
                                  ? 'text-amber-700'
                                  : 'text-teal-700'
                              }
                            >
                              {u.riskTier}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleCompareUnit(u.entityId)}
                              disabled={!isComparing && effectiveCompareIds.length >= 5}
                              className={`font-medium whitespace-nowrap ${
                                isComparing
                                  ? 'text-teal-700 hover:text-red-700'
                                  : 'text-slate-600 hover:text-blue-700 disabled:opacity-40'
                              }`}
                            >
                              {isComparing ? 'In Overlay' : '+ Compare'}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => onInspectEntityInExplorer(u.entityId)}
                              className="text-blue-700 hover:underline font-medium"
                            >
                              Explorer
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            );
          })()}
        </div>
      </section>
    </div>
  );
};
