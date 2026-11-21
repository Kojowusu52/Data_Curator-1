import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { ArrowRight, GitBranch } from 'lucide-react';
import {
  GlobalCurationConfig,
  MdpConfig,
  MdpResult,
  RawEvent,
  RegressionConfig,
  RegressionResult,
  SequenceConfig,
  SequenceResult,
  WorkspaceTab,
} from '../types/curation';

interface DataLineageVisualizerProps {
  datasetName: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
  regConfig: RegressionConfig;
  seqConfig: SequenceConfig;
  mdpConfig: MdpConfig;
  regResult: RegressionResult;
  seqResult: SequenceResult;
  mdpResult: MdpResult;
  onNavigateTab: (tab: WorkspaceTab) => void;
}

type BranchKey = 'all' | 'ltv' | 'sequence' | 'mdp';

interface LineageNode {
  id: string;
  stageIndex: number; // 0..3
  laneIndex: number; // vertical ordering within stage
  branch: 'core' | 'ltv' | 'sequence' | 'mdp';
  stageLabel: string;
  title: string;
  primaryMetric: string;
  secondaryMetric: string;
  volumeCount: number;
  accentColor: string;
  badgeText: string;
  description: string;
  schemaFields: string[];
  paramsSummary: string;
  targetTab?: WorkspaceTab;
}

interface LineageEdge {
  id: string;
  sourceId: string;
  targetId: string;
  branch: 'core' | 'ltv' | 'sequence' | 'mdp';
  label: string;
  recordCount: number;
  retentionPct: number;
  color: string;
}

export const DataLineageVisualizer: React.FC<DataLineageVisualizerProps> = ({
  datasetName,
  events,
  globalConfig,
  regConfig,
  seqConfig,
  mdpConfig,
  regResult,
  seqResult,
  mdpResult,
  onNavigateTab,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [containerWidth, setContainerWidth] = useState(960);
  const [branchFocus, setBranchFocus] = useState<BranchKey>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('art_ltv');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [showEdgeMetrics, setShowEdgeMetrics] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const uniqueEntities = useMemo(
    () => new Set(events.map((e) => e.entityId)).size,
    [events]
  );

  const { nodes, edges } = useMemo<{
    nodes: LineageNode[];
    edges: LineageEdge[];
  }>(() => {
    const totalEvents = events.length;
    const activeFeatCount = Math.max(
      1,
      regConfig.selectedFeatures?.length ?? 7
    );
    const seqR2 =
      seqResult.transformerEval.holdoutMetrics.rSquared ??
      seqResult.transformerEval.allMetrics.rSquared;
    const totalTensorSteps =
      seqResult.tensorShape[0] * seqResult.tensorShape[1];

    const builtNodes: LineageNode[] = [
      {
        id: 'raw_events',
        stageIndex: 0,
        laneIndex: 1,
        branch: 'core',
        stageLabel: '01 · Ingestion',
        title: 'Raw Event Logs',
        primaryMetric: `${totalEvents.toLocaleString()} events`,
        secondaryMetric: `${uniqueEntities.toLocaleString()} unique entities`,
        volumeCount: totalEvents,
        accentColor: '#0f172a',
        badgeText: 'SOURCE',
        description: `Canonical immutable event stream loaded from "${datasetName}". Contains chronological spend, engagement, policy actions, rewards, and logging propensities.`,
        schemaFields: [
          'entity_id',
          'timestamp_day',
          'spend_amount',
          'engagement_score',
          'action_id',
          'reward',
          'propensity',
        ],
        paramsSummary: `Time Span: Day 0–${regResult.maxObservedDay}`,
        targetTab: 'data_explorer',
      },
      {
        id: 'split_gate',
        stageIndex: 1,
        laneIndex: 1,
        branch: 'core',
        stageLabel: '02 · Isolation',
        title: 'FNV-1a Entity Split Gate',
        primaryMetric: `${Math.round(globalConfig.trainRatio * 100)}/${Math.round(globalConfig.valRatio * 100)}/${Math.round(globalConfig.testRatio * 100)} T/V/Te`,
        secondaryMetric: `Salt: ${globalConfig.seedSalt}`,
        volumeCount: uniqueEntities,
        accentColor: '#334155',
        badgeText: 'HASH SPLIT',
        description:
          'Deterministic FNV-1a entity hashing assigns every customer/entity to exactly one split (Train, Validation, or Test) before paradigm transforms to guarantee zero cross-split entity leakage.',
        schemaFields: ['entity_id', 'split', 'timestamp_day'],
        paramsSummary: `Train ${regResult.splitCounts.train} · Val ${regResult.splitCounts.val} · Test ${regResult.splitCounts.test}`,
        targetTab: 'audit_export',
      },
      {
        id: 'tx_regression',
        stageIndex: 2,
        laneIndex: 0,
        branch: 'ltv',
        stageLabel: '03 · Tabular Transform',
        title: 'Point-in-Time RFM Agg.',
        primaryMetric: `T_obs=${regConfig.obsCutoffDay}d · H=${regConfig.horizonDays}d`,
        secondaryMetric: `Scale: ${regConfig.featureNormalization} · Win: P${regConfig.winsorizePercentile}`,
        volumeCount: regResult.rows.length,
        accentColor: '#1d4ed8',
        badgeText: 'TABULAR',
        description:
          'Separates observation features (t <= T_obs) from future LTV target spend (T_obs < t <= T_obs + H), fits scalers strictly on Train, and applies percentile winsorization.',
        schemaFields: [
          'recency_days',
          'tx_count_obs',
          'monetary_sum_obs',
          'target_ltv_winsorized',
        ],
        paramsSummary: `Zero-Obs Filter: ${regConfig.excludeZeroObsEntities ? 'On' : 'Off'} · Outlier Exclusion: ${regConfig.excludeDetectedOutliers ? 'On' : 'Off'}`,
        targetTab: 'regression',
      },
      {
        id: 'tx_sequence',
        stageIndex: 2,
        laneIndex: 1,
        branch: 'sequence',
        stageLabel: '03 · Tensor Transform',
        title: 'Chronological Packing',
        primaryMetric: `${seqConfig.truncation} / ${seqConfig.padding}-pad`,
        secondaryMetric: `L=${seqConfig.maxSeqLen} · ${seqConfig.normalization}`,
        volumeCount: seqResult.samples.length,
        accentColor: '#0284c7',
        badgeText: 'TENSOR',
        description:
          'Pads or truncates chronological entity event histories into fixed-length [B, L, 4] sequences with boolean validity masks and inter-event delta times Δt.',
        schemaFields: ['X[b,t,0..3]', 'mask[b,t]', 'delta_days[b,t]', 'y_ltv'],
        paramsSummary: `Mask Sparsity: ${(seqResult.paddingSparsity * 100).toFixed(1)}% · Mean Len: ${seqResult.meanActualLength.toFixed(1)}`,
        targetTab: 'sequence',
      },
      {
        id: 'tx_mdp',
        stageIndex: 2,
        laneIndex: 2,
        branch: 'mdp',
        stageLabel: '03 · Trajectory Transform',
        title: 'MDP Episode Builder',
        primaryMetric: `γ=${mdpConfig.gamma} · Gap=${mdpConfig.terminalInactivityGapDays}d`,
        secondaryMetric: `Reward: ${mdpConfig.rewardScale}`,
        volumeCount: mdpResult.transitions.length,
        accentColor: '#047857',
        badgeText: 'OFFLINE RL',
        description:
          'Materializes consecutive (s_t, a_t, r_t, s_t+1, done) Markov tuples, infers terminal boundaries from inactivity gaps, computes discounted G_t returns, and flags CQL low-support actions.',
        schemaFields: ['state_t', 'action_id', 'reward_scaled', 'next_state', 'done', 'return_g'],
        paramsSummary: `Min Steps: ${mdpConfig.minTrajectorySteps} · Absorbing Step: ${mdpConfig.includeAbsorbingStep ? 'Yes' : 'No'}`,
        targetTab: 'offline_rl',
      },
      {
        id: 'art_ltv',
        stageIndex: 3,
        laneIndex: 0,
        branch: 'ltv',
        stageLabel: '04 · Processed Artifact',
        title: 'LTV Matrix',
        primaryMetric: `${regResult.rows.length.toLocaleString()} rows × ${activeFeatCount} feats`,
        secondaryMetric: `OLS R²=${regResult.linearFit.rSquared.toFixed(3)} · ${regResult.batchCount} batches`,
        volumeCount: regResult.rows.length,
        accentColor: '#1d4ed8',
        badgeText: 'CSV / SQL',
        description:
          'Leak-free tabular feature matrix ready for Ridge/OLS LTV forecasting, PostgreSQL export, and stakeholder explainability.',
        schemaFields: ['entity_id', 'split', 'batch_id', 'predicted_horizon_ltv', 'target_ltv_winsorized'],
        paramsSummary: `Mean Winsor LTV: $${regResult.meanTargetWinsorized.toFixed(2)}`,
        targetTab: 'regression',
      },
      {
        id: 'art_tensor',
        stageIndex: 3,
        laneIndex: 1,
        branch: 'sequence',
        stageLabel: '04 · Processed Artifact',
        title: 'Sequence Tensors',
        primaryMetric: `[${seqResult.tensorShape.join(', ')}]`,
        secondaryMetric: `Holdout R²=${seqR2 !== null ? seqR2.toFixed(3) : '—'} · ${seqResult.batchCount} batches`,
        volumeCount: totalTensorSteps,
        accentColor: '#0284c7',
        badgeText: 'PYTORCH JSON',
        description:
          '3D batched event tensors with attention masks prepared for TransformerEncoder, CausalGPT, and Temporal Fusion architectures.',
        schemaFields: ['X (float32)', 'mask (bool)', 'deltaDays', 'y_ltv'],
        paramsSummary: `Arch: ${seqResult.transformerEval.architectureLabel} (d=${seqResult.transformerEval.dModel})`,
        targetTab: 'sequence',
      },
      {
        id: 'art_mdp',
        stageIndex: 3,
        laneIndex: 2,
        branch: 'mdp',
        stageLabel: '04 · Processed Artifact',
        title: 'MDP Transitions',
        primaryMetric: `${mdpResult.transitions.length.toLocaleString()} tuples`,
        secondaryMetric: `G₀=${mdpResult.meanInitialReturn.toFixed(2)} · ${(mdpResult.lowSupportOodRate * 100).toFixed(1)}% OOD`,
        volumeCount: mdpResult.transitions.length,
        accentColor: '#047857',
        badgeText: 'CQL REPLAY',
        description:
          'Offline Reinforcement Learning replay dataset with behavior policy propensities μ(a|s) and OOD support diagnostics for d3rlpy CQL.',
        schemaFields: ['observations', 'actions', 'rewards', 'terminals', 'propensity'],
        paramsSummary: `Trajectories: ${mdpResult.trajectoryCount.toLocaleString()} · Terminal Transitions: ${mdpResult.terminalCount.toLocaleString()} (${mdpResult.transitions.length > 0 ? ((mdpResult.terminalCount / mdpResult.transitions.length) * 100).toFixed(1) : '0.0'}%)`,
        targetTab: 'offline_rl',
      },
    ];

    const denomEntities = Math.max(1, uniqueEntities);
    const denomEvents = Math.max(1, totalEvents);

    const builtEdges: LineageEdge[] = [
      {
        id: 'e_raw_split',
        sourceId: 'raw_events',
        targetId: 'split_gate',
        branch: 'core',
        label: `${totalEvents.toLocaleString()} ev → ${uniqueEntities.toLocaleString()} ent`,
        recordCount: uniqueEntities,
        retentionPct: 100,
        color: '#475569',
      },
      {
        id: 'e_split_reg',
        sourceId: 'split_gate',
        targetId: 'tx_regression',
        branch: 'ltv',
        label: `${regResult.rows.length.toLocaleString()} entities`,
        recordCount: regResult.rows.length,
        retentionPct: Math.round((regResult.rows.length / denomEntities) * 1000) / 10,
        color: '#1d4ed8',
      },
      {
        id: 'e_split_seq',
        sourceId: 'split_gate',
        targetId: 'tx_sequence',
        branch: 'sequence',
        label: `${seqResult.samples.length.toLocaleString()} sequences`,
        recordCount: seqResult.samples.length,
        retentionPct: Math.round((seqResult.samples.length / denomEntities) * 1000) / 10,
        color: '#0284c7',
      },
      {
        id: 'e_split_mdp',
        sourceId: 'split_gate',
        targetId: 'tx_mdp',
        branch: 'mdp',
        label: `${mdpResult.trajectoryCount.toLocaleString()} episodes`,
        recordCount: mdpResult.trajectoryCount,
        retentionPct: Math.round((mdpResult.trajectoryCount / denomEntities) * 1000) / 10,
        color: '#047857',
      },
      {
        id: 'e_reg_art',
        sourceId: 'tx_regression',
        targetId: 'art_ltv',
        branch: 'ltv',
        label: `${regResult.batchCount} batches`,
        recordCount: regResult.rows.length,
        retentionPct: Math.round((regResult.rows.length / denomEntities) * 1000) / 10,
        color: '#1d4ed8',
      },
      {
        id: 'e_seq_art',
        sourceId: 'tx_sequence',
        targetId: 'art_tensor',
        branch: 'sequence',
        label: `[${seqResult.tensorShape.join(',')}]`,
        recordCount: totalTensorSteps,
        retentionPct: Math.round((seqResult.samples.length / denomEntities) * 1000) / 10,
        color: '#0284c7',
      },
      {
        id: 'e_mdp_art',
        sourceId: 'tx_mdp',
        targetId: 'art_mdp',
        branch: 'mdp',
        label: `${mdpResult.transitions.length.toLocaleString()} steps`,
        recordCount: mdpResult.transitions.length,
        retentionPct: Math.round((mdpResult.transitions.length / denomEvents) * 1000) / 10,
        color: '#047857',
      },
    ];

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    events.length,
    uniqueEntities,
    datasetName,
    globalConfig,
    regConfig,
    seqConfig,
    mdpConfig,
    regResult,
    seqResult,
    mdpResult,
  ]);

  const activeHighlightNodeId = hoveredNodeId ?? selectedNodeId;

  // Determine which nodes/edges belong to the active branch filter or hovered/selected path
  const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
    const nodeSet = new Set<string>();
    const edgeSet = new Set<string>();

    if (branchFocus !== 'all') {
      for (const n of nodes) {
        if (n.branch === 'core' || n.branch === branchFocus) {
          nodeSet.add(n.id);
        }
      }
      for (const e of edges) {
        if (e.branch === 'core' || e.branch === branchFocus) {
          edgeSet.add(e.id);
        }
      }
      return { highlightedNodeIds: nodeSet, highlightedEdgeIds: edgeSet };
    }

    const focusNode = nodes.find((n) => n.id === activeHighlightNodeId);
    if (!focusNode || focusNode.branch === 'core') {
      nodes.forEach((n) => nodeSet.add(n.id));
      edges.forEach((e) => edgeSet.add(e.id));
      return { highlightedNodeIds: nodeSet, highlightedEdgeIds: edgeSet };
    }

    for (const n of nodes) {
      if (n.branch === 'core' || n.branch === focusNode.branch) {
        nodeSet.add(n.id);
      }
    }
    for (const e of edges) {
      if (e.branch === 'core' || e.branch === focusNode.branch) {
        edgeSet.add(e.id);
      }
    }
    return { highlightedNodeIds: nodeSet, highlightedEdgeIds: edgeSet };
  }, [nodes, edges, branchFocus, activeHighlightNodeId]);

  // Render interactive D3 DAG SVG
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const width = Math.max(680, Math.floor(containerWidth - 40));
    const height = 356;
    const padX = 18;
    const padTop = 36;
    const nodeW = Math.min(208, Math.max(152, Math.floor((width - padX * 2 - 150) / 4)));
    const nodeH = 78;

    const stageXs = [0, 1, 2, 3].map((s) => {
      const usable = width - padX * 2 - nodeW;
      return padX + (s / 3) * usable;
    });

    const laneYs = [padTop, padTop + 104, padTop + 208];

    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

    const defs = svg.append('defs');
    const markerColors: Record<string, string> = {
      core: '#64748b',
      ltv: '#1d4ed8',
      sequence: '#0284c7',
      mdp: '#047857',
    };
    Object.entries(markerColors).forEach(([key, color]) => {
      defs
        .append('marker')
        .attr('id', `lineage-arrow-${key}`)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 8)
        .attr('refY', 5)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 1.5 L 8.5 5 L 0 8.5 z')
        .attr('fill', color);
    });

    // Stage column headers
    const stageHeaders = [
      '01 · Raw Ingestion',
      '02 · Split Isolation',
      '03 · Paradigm Transforms',
      '04 · Output Artifacts',
    ];
    svg
      .append('g')
      .selectAll('text.stage-hdr')
      .data(stageHeaders)
      .join('text')
      .attr('class', 'stage-hdr')
      .attr('x', (_d, i) => stageXs[i] + nodeW / 2)
      .attr('y', 18)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', '10.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => d.toUpperCase());

    const nodePos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      nodePos.set(n.id, {
        x: stageXs[n.stageIndex],
        y: laneYs[n.laneIndex],
      });
    }

    const strokeScale = d3
      .scaleSqrt()
      .domain([1, Math.max(10, d3.max(edges, (e) => e.recordCount) ?? 100)])
      .range([2, 5.5]);

    const linkGen = d3.linkHorizontal<
      { source: [number, number]; target: [number, number] },
      [number, number]
    >();

    // Draw D3 curved Sankey/DAG links
    const edgeGroup = svg.append('g').attr('class', 'lineage-edges');
    edges.forEach((edge) => {
      const s = nodePos.get(edge.sourceId);
      const t = nodePos.get(edge.targetId);
      if (!s || !t) return;

      const sx = s.x + nodeW;
      const sy = s.y + nodeH / 2;
      const tx = t.x - 4;
      const ty = t.y + nodeH / 2;
      const pathData = linkGen({ source: [sx, sy], target: [tx, ty] }) ?? '';
      const isActive = highlightedEdgeIds.has(edge.id);

      edgeGroup
        .append('path')
        .attr('d', pathData)
        .attr('fill', 'none')
        .attr('stroke', edge.color)
        .attr('stroke-width', strokeScale(Math.max(1, edge.recordCount)))
        .attr('stroke-opacity', isActive ? 0.72 : 0.14)
        .attr('marker-end', `url(#lineage-arrow-${edge.branch})`)
        .style('transition', 'stroke-opacity 150ms ease');

      if (showEdgeMetrics) {
        const mx = (sx + tx) / 2;
        const my = (sy + ty) / 2 - 7;
        const labelGroup = edgeGroup
          .append('g')
          .attr('opacity', isActive ? 1 : 0.28);

        const labelText = edge.label;
        const boxW = Math.max(58, labelText.length * 6.2 + 12);

        labelGroup
          .append('rect')
          .attr('x', mx - boxW / 2)
          .attr('y', my - 10)
          .attr('width', boxW)
          .attr('height', 16)
          .attr('rx', 3)
          .attr('fill', '#ffffff')
          .attr('stroke', '#e2e8f0')
          .attr('stroke-width', 1);

        labelGroup
          .append('text')
          .attr('x', mx)
          .attr('y', my + 1.5)
          .attr('text-anchor', 'middle')
          .attr('fill', '#334155')
          .attr('font-size', '9.5px')
          .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
          .text(labelText);
      }
    });

    // Draw D3 Node Cards
    const nodeGroups = svg
      .append('g')
      .selectAll<SVGGElement, LineageNode>('g.lineage-node')
      .data(nodes, (d) => d.id)
      .join('g')
      .attr('class', 'lineage-node')
      .attr('transform', (d) => {
        const p = nodePos.get(d.id)!;
        return `translate(${p.x},${p.y})`;
      })
      .style('cursor', 'pointer')
      .attr('opacity', (d) => (highlightedNodeIds.has(d.id) ? 1 : 0.34))
      .on('mouseenter', (_ev, d) => setHoveredNodeId(d.id))
      .on('mouseleave', () => setHoveredNodeId(null))
      .on('click', (_ev, d) => setSelectedNodeId(d.id));

    // Card background
    nodeGroups
      .append('rect')
      .attr('width', nodeW)
      .attr('height', nodeH)
      .attr('rx', 6)
      .attr('fill', (d) => (d.id === selectedNodeId ? '#f8fafc' : '#ffffff'))
      .attr('stroke', (d) =>
        d.id === selectedNodeId ? d.accentColor : '#cbd5e1'
      )
      .attr('stroke-width', (d) => (d.id === selectedNodeId ? 2 : 1));

    // Top accent bar
    nodeGroups
      .append('rect')
      .attr('x', 1)
      .attr('y', 1)
      .attr('width', nodeW - 2)
      .attr('height', 4)
      .attr('rx', 2)
      .attr('fill', (d) => d.accentColor);

    // Stage badge text
    nodeGroups
      .append('text')
      .attr('x', 10)
      .attr('y', 19)
      .attr('fill', (d) => d.accentColor)
      .attr('font-size', '9.5px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => d.badgeText);

    // Node Title
    nodeGroups
      .append('text')
      .attr('x', 10)
      .attr('y', 36)
      .attr('fill', '#0f172a')
      .attr('font-size', '12px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .text((d) => d.title);

    // Primary Metric
    nodeGroups
      .append('text')
      .attr('x', 10)
      .attr('y', 53)
      .attr('fill', '#1e293b')
      .attr('font-size', '10.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => d.primaryMetric);

    // Secondary Metric
    nodeGroups
      .append('text')
      .attr('x', 10)
      .attr('y', 68)
      .attr('fill', '#64748b')
      .attr('font-size', '9.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => d.secondaryMetric);
  }, [
    nodes,
    edges,
    containerWidth,
    selectedNodeId,
    highlightedNodeIds,
    highlightedEdgeIds,
    showEdgeMetrics,
  ]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? nodes[0],
    [nodes, selectedNodeId]
  );

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header & Branch Filter Controls */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-700 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Data Lineage Visualizer (D3 Transformation DAG)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Interactive end-to-end provenance from canonical event logs through FNV-1a entity isolation to LTV Matrix, Sequence Tensors, and MDP Transitions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Filter data lineage branch"
          >
            {(
              [
                { id: 'all', label: 'All Branches' },
                { id: 'ltv', label: 'LTV Matrix' },
                { id: 'sequence', label: 'Sequence Tensors' },
                { id: 'mdp', label: 'MDP Transitions' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setBranchFocus(opt.id);
                  if (opt.id === 'ltv') setSelectedNodeId('art_ltv');
                  else if (opt.id === 'sequence') setSelectedNodeId('art_tensor');
                  else if (opt.id === 'mdp') setSelectedNodeId('art_mdp');
                }}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  branchFocus === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowEdgeMetrics((prev) => !prev)}
            aria-pressed={showEdgeMetrics}
            className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
              showEdgeMetrics
                ? 'bg-blue-50 text-blue-800 border-blue-200'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Edge Counts: {showEdgeMetrics ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* D3 SVG Canvas */}
      <div
        ref={containerRef}
        className="px-5 py-4 bg-slate-50/40 overflow-x-auto border-b border-slate-200"
      >
        <svg
          ref={svgRef}
          className="block mx-auto select-none"
          role="img"
          aria-label="D3 Data Lineage graph from raw events to LTV Matrix, Sequence Tensors, and MDP Transitions"
        />
      </div>

      {/* Selected Node Provenance Inspector */}
      {selectedNode && (
        <div className="px-6 py-4 bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className="font-mono font-bold uppercase"
                style={{ color: selectedNode.accentColor }}
              >
                {selectedNode.stageLabel}
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-slate-900">
                {selectedNode.title}
              </span>
              <span className="text-slate-300">·</span>
              <span className="font-mono text-slate-600 tabular-nums">
                {selectedNode.primaryMetric}
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {selectedNode.description}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500 pt-0.5">
              <span>
                Fields:{' '}
                <strong className="text-slate-700 font-medium">
                  {selectedNode.schemaFields.join(', ')}
                </strong>
              </span>
              <span className="text-slate-300">|</span>
              <span>{selectedNode.paramsSummary}</span>
            </div>
          </div>

          {selectedNode.targetTab && (
            <button
              type="button"
              onClick={() => onNavigateTab(selectedNode.targetTab!)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
            >
              <span>Inspect Node Output</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
