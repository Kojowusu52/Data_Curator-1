import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CalendarRange, Filter, Layers, TrendingUp, Users } from 'lucide-react';
import { computeRetentionCohortAnalysis } from '../engine/curationEngine';
import {
  GlobalCurationConfig,
  RawEvent,
  RetentionCohortAnalysis,
  RetentionCohortCell,
  RetentionCohortMetricMode,
  RetentionPeriodSummary,
  SplitName,
} from '../types/curation';

interface RetentionCohortViewProps {
  datasetName: string;
  events: RawEvent[];
  globalConfig: GlobalCurationConfig;
}

const PERIOD_OPTIONS: { value: 14 | 30 | 60; label: string }[] = [
  { value: 14, label: '14d Bi-Weekly' },
  { value: 30, label: '30d Monthly' },
  { value: 60, label: '60d Bi-Monthly' },
];

const METRIC_MODE_OPTIONS: { value: RetentionCohortMetricMode; label: string }[] = [
  { value: 'retention_pct', label: 'Retention %' },
  { value: 'revenue_per_user', label: 'Spend / User ($)' },
  { value: 'events_per_user', label: 'Events / User' },
];

function formatCellValue(cell: RetentionCohortCell, mode: RetentionCohortMetricMode): string {
  if (mode === 'retention_pct') return `${cell.retentionPct.toFixed(1)}%`;
  if (mode === 'revenue_per_user') return `$${cell.revenuePerUser.toFixed(0)}`;
  return `${cell.eventsPerUser.toFixed(1)}`;
}

function formatMetricNumber(val: number, mode: RetentionCohortMetricMode): string {
  if (mode === 'retention_pct') return `${val.toFixed(1)}%`;
  if (mode === 'revenue_per_user') return `$${val.toFixed(2)}`;
  return `${val.toFixed(1)} ev`;
}

function getCellMetricNumber(cell: RetentionCohortCell, mode: RetentionCohortMetricMode): number {
  if (mode === 'retention_pct') return cell.retentionPct;
  if (mode === 'revenue_per_user') return cell.revenuePerUser;
  return cell.eventsPerUser;
}

function getPeriodWeightedMetric(
  period: RetentionPeriodSummary,
  mode: RetentionCohortMetricMode
): number {
  if (mode === 'retention_pct') return period.weightedRetentionPct;
  if (mode === 'revenue_per_user') return period.weightedRevenuePerUser;
  return period.weightedEventsPerUser;
}

function getPeriodEnvelopeBounds(
  analysis: RetentionCohortAnalysis,
  period: RetentionPeriodSummary,
  mode: RetentionCohortMetricMode
): { min: number; max: number } {
  if (mode === 'retention_pct') {
    return {
      min: period.minCohortRetentionPct,
      max: period.maxCohortRetentionPct,
    };
  }
  const vals = analysis.cohorts
    .map((c) => c.cells[period.offsetPeriod])
    .filter((cell): cell is RetentionCohortCell => Boolean(cell))
    .map((cell) => getCellMetricNumber(cell, mode));
  if (vals.length === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

export const RetentionCohortView: React.FC<RetentionCohortViewProps> = ({
  datasetName,
  events,
  globalConfig,
}) => {
  const [periodDays, setPeriodDays] = useState<14 | 30 | 60>(30);
  const [metricMode, setMetricMode] = useState<RetentionCohortMetricMode>('retention_pct');
  const [splitFilter, setSplitFilter] = useState<'all' | SplitName>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [selectedCohortIndex, setSelectedCohortIndex] = useState<number>(0);
  const [inspectedCell, setInspectedCell] = useState<RetentionCohortCell | null>(null);
  const [showAllCohorts, setShowAllCohorts] = useState<boolean>(false);
  const [heatmapTooltip, setHeatmapTooltip] = useState<{
    cell: RetentionCohortCell;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredCurvePeriod, setHoveredCurvePeriod] = useState<number | null>(null);

  const heatmapContainerRef = useRef<HTMLDivElement | null>(null);
  const heatmapSvgRef = useRef<SVGSVGElement | null>(null);
  const curveContainerRef = useRef<HTMLDivElement | null>(null);
  const curveSvgRef = useRef<SVGSVGElement | null>(null);

  const [heatmapWidth, setHeatmapWidth] = useState(720);
  const [curveWidth, setCurveWidth] = useState(520);

  const analysis = useMemo(
    () =>
      computeRetentionCohortAnalysis(events, globalConfig, {
        periodDays,
        splitFilter,
        channelFilter,
      }),
    [events, globalConfig, periodDays, splitFilter, channelFilter]
  );

  const lifecycleInsights = useMemo(() => {
    const p1 = analysis.period1RetentionPct;
    const p3 = analysis.period3RetentionPct;
    const earlyDropOffPct = p1 !== null ? Math.max(0, 100 - p1) : null;
    const midStabilizationPct =
      p1 !== null && p1 > 0 && p3 !== null ? (p3 / p1) * 100 : null;
    const cohortsWithP1 = analysis.cohorts
      .map((c) => ({
        label: c.cohortLabel,
        p1: c.cells[1]?.retentionPct ?? null,
      }))
      .filter((x): x is { label: string; p1: number } => x.p1 !== null);
    const maxP1 =
      cohortsWithP1.length > 0
        ? cohortsWithP1.reduce((a, b) => (b.p1 > a.p1 ? b : a))
        : null;
    const minP1 =
      cohortsWithP1.length > 0
        ? cohortsWithP1.reduce((a, b) => (b.p1 < a.p1 ? b : a))
        : null;
    return {
      earlyDropOffPct,
      midStabilizationPct,
      spreadPct: maxP1 && minP1 ? maxP1.p1 - minP1.p1 : null,
      maxP1,
      minP1,
    };
  }, [analysis]);

  useEffect(() => {
    if (
      analysis.cohorts.length > 0 &&
      !analysis.cohorts.some((c) => c.cohortIndex === selectedCohortIndex)
    ) {
      setSelectedCohortIndex(analysis.cohorts[0].cohortIndex);
    }
    setInspectedCell(null);
    setHeatmapTooltip(null);
    setHoveredCurvePeriod(null);
  }, [analysis.cohorts, selectedCohortIndex]);

  useEffect(() => {
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      if (heatmapContainerRef.current) {
        const obs1 = new ResizeObserver((entries) => {
          for (const e of entries) {
            if (e.contentRect.width > 0) setHeatmapWidth(e.contentRect.width);
          }
        });
        obs1.observe(heatmapContainerRef.current);
        observers.push(obs1);
      }
      if (curveContainerRef.current) {
        const obs2 = new ResizeObserver((entries) => {
          for (const e of entries) {
            if (e.contentRect.width > 0) setCurveWidth(e.contentRect.width);
          }
        });
        obs2.observe(curveContainerRef.current);
        observers.push(obs2);
      }
    }
    return () => {
      for (const obs of observers) obs.disconnect();
    };
  }, []);

  // D3 Triangular Retention Heatmap
  useEffect(() => {
    const svgEl = heatmapSvgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (analysis.cohorts.length === 0 || analysis.maxOffsetPeriods === 0) return;

    const cohorts = analysis.cohorts.slice(0, 14);
    const maxCols = Math.min(12, analysis.maxOffsetPeriods);
    const margin = { top: 44, right: 16, bottom: 16, left: 132 };
    const minChartWidth = Math.max(heatmapWidth, margin.left + margin.right + maxCols * 54);
    const rowHeight = 36;
    const innerWidth = minChartWidth - margin.left - margin.right;
    const innerHeight = cohorts.length * rowHeight;
    const totalHeight = margin.top + innerHeight + margin.bottom;

    svg.attr('width', minChartWidth).attr('height', totalHeight);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xDomain = Array.from({ length: maxCols }, (_, i) => i);
    const yDomain = cohorts.map((c) => c.cohortLabel);

    const xScale = d3
      .scaleBand<number>()
      .domain(xDomain)
      .range([0, innerWidth])
      .padding(0.08);

    const yScale = d3
      .scaleBand<string>()
      .domain(yDomain)
      .range([0, innerHeight])
      .padding(0.1);

    const allCells = cohorts.flatMap((c) => c.cells.filter((cell) => cell.offsetPeriod < maxCols));
    const maxMetricVal =
      metricMode === 'retention_pct'
        ? 100
        : Math.max(1, d3.max(allCells, (c) => getCellMetricNumber(c, metricMode)) ?? 1);

    const colorInterpolator =
      metricMode === 'revenue_per_user'
        ? d3.interpolateBuGn
        : metricMode === 'events_per_user'
        ? d3.interpolatePuBu
        : d3.interpolateYlGnBu;

    const colorScale = d3.scaleSequential(colorInterpolator).domain([0, maxMetricVal]);

    // Top X Axis Labels (+0P, +1P, ...)
    const xAxisGroup = g.append('g').attr('transform', 'translate(0, -10)');
    xAxisGroup
      .selectAll('text.col-head')
      .data(xDomain)
      .enter()
      .append('text')
      .attr('class', 'col-head')
      .attr('x', (d) => (xScale(d) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', -12)
      .attr('text-anchor', 'middle')
      .attr('fill', '#334155')
      .attr('font-size', '11px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-weight', '600')
      .text((d) => (d === 0 ? 'P0' : `+${d}P`));

    xAxisGroup
      .selectAll('text.col-sub')
      .data(xDomain)
      .enter()
      .append('text')
      .attr('class', 'col-sub')
      .attr('x', (d) => (xScale(d) ?? 0) + xScale.bandwidth() / 2)
      .attr('y', 1)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', '9.5px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .text((d) => `+${d * periodDays}d`);

    // Left Cohort Labels (clickable to select cohort curve)
    const yLabels = g
      .selectAll('g.cohort-label-row')
      .data(cohorts)
      .enter()
      .append('g')
      .attr('class', 'cohort-label-row')
      .attr(
        'transform',
        (d) => `translate(-10, ${(yScale(d.cohortLabel) ?? 0) + yScale.bandwidth() / 2})`
      )
      .style('cursor', 'pointer')
      .on('click', (_, d) => {
        setSelectedCohortIndex(d.cohortIndex);
      });

    yLabels
      .append('text')
      .attr('x', 0)
      .attr('y', -2)
      .attr('text-anchor', 'end')
      .attr('font-size', '11px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-weight', (d) => (d.cohortIndex === selectedCohortIndex ? '700' : '500'))
      .attr('fill', (d) => (d.cohortIndex === selectedCohortIndex ? '#1d4ed8' : '#0f172a'))
      .text((d) => d.cohortLabel);

    yLabels
      .append('text')
      .attr('x', 0)
      .attr('y', 10)
      .attr('text-anchor', 'end')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', '#64748b')
      .text((d) => `n=${d.cohortSize}`);

    // Selected cohort row highlight backdrop
    const selectedRow = cohorts.find((c) => c.cohortIndex === selectedCohortIndex);
    if (selectedRow) {
      g.append('rect')
        .attr('x', -4)
        .attr('y', (yScale(selectedRow.cohortLabel) ?? 0) - 2)
        .attr('width', innerWidth + 8)
        .attr('height', yScale.bandwidth() + 4)
        .attr('rx', 5)
        .attr('fill', 'none')
        .attr('stroke', '#1d4ed8')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '3 2');
    }

    const updateTooltipPos = (event: MouseEvent, d: RetentionCohortCell) => {
      const container = heatmapContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const rawX = event.clientX - rect.left + container.scrollLeft;
      const rawY = event.clientY - rect.top;
      setHeatmapTooltip({
        cell: d,
        x: Math.min(Math.max(12, rawX + 12), Math.max(12, minChartWidth - 210)),
        y: Math.max(8, rawY - 64),
      });
    };

    // Cells
    const cellGroups = g
      .selectAll('g.cohort-cell')
      .data(allCells)
      .enter()
      .append('g')
      .attr('class', 'cohort-cell')
      .attr(
        'transform',
        (d) => `translate(${xScale(d.offsetPeriod) ?? 0}, ${yScale(d.cohortLabel) ?? 0})`
      )
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => {
        setInspectedCell(d);
        updateTooltipPos(event as MouseEvent, d);
      })
      .on('mousemove', (event, d) => {
        updateTooltipPos(event as MouseEvent, d);
      })
      .on('mouseleave', () => {
        setHeatmapTooltip(null);
      })
      .on('click', (_, d) => {
        setSelectedCohortIndex(d.cohortIndex);
        setInspectedCell(d);
      });

    cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => {
        const val = getCellMetricNumber(d, metricMode);
        return val === 0 ? '#f8fafc' : colorScale(val);
      })
      .attr('stroke', (d) =>
        inspectedCell &&
        inspectedCell.cohortIndex === d.cohortIndex &&
        inspectedCell.offsetPeriod === d.offsetPeriod
          ? '#0f172a'
          : '#e2e8f0'
      )
      .attr('stroke-width', (d) =>
        inspectedCell &&
        inspectedCell.cohortIndex === d.cohortIndex &&
        inspectedCell.offsetPeriod === d.offsetPeriod
          ? 1.75
          : 0.75
      );

    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('font-weight', '600')
      .attr('fill', (d) => {
        const val = getCellMetricNumber(d, metricMode);
        const norm = val / maxMetricVal;
        return norm >= 0.55 ? '#ffffff' : '#0f172a';
      })
      .text((d) => formatCellValue(d, metricMode));
  }, [analysis, heatmapWidth, metricMode, periodDays, selectedCohortIndex, inspectedCell]);

  // D3 Lifecycle Curve (synchronized with metricMode, supporting Selected vs All Cohorts overlay + interactive crosshair)
  useEffect(() => {
    const svgEl = curveSvgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const curve = analysis.periodCurve.slice(0, 12);
    if (curve.length === 0) return;

    const width = Math.max(320, curveWidth);
    const height = 290;
    const margin = { top: 20, right: 20, bottom: 38, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const maxPeriod = Math.max(1, curve[curve.length - 1].offsetPeriod);
    const xScale = d3.scaleLinear().domain([0, maxPeriod]).range([0, innerWidth]);

    const visibleCohorts = analysis.cohorts.slice(0, 10);
    const envelopePoints = curve.map((p) => ({
      ...p,
      ...getPeriodEnvelopeBounds(analysis, p, metricMode),
      weightedMetric: getPeriodWeightedMetric(p, metricMode),
    }));

    const maxObservedMetric =
      metricMode === 'retention_pct'
        ? 100
        : Math.max(
            metricMode === 'revenue_per_user' ? 10 : 2,
            d3.max(envelopePoints, (p) => Math.max(p.max, p.weightedMetric)) ?? 10
          ) * 1.15;

    const yScale = d3.scaleLinear().domain([0, maxObservedMetric]).range([innerHeight, 0]);
    const yTickValues =
      metricMode === 'retention_pct' ? [0, 25, 50, 75, 100] : yScale.ticks(5);

    // Horizontal Gridlines
    g.append('g')
      .selectAll('line.grid')
      .data(yTickValues)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', (d) =>
        metricMode === 'retention_pct' && d === 50 ? '#94a3b8' : '#e2e8f0'
      )
      .attr('stroke-dasharray', (d) =>
        metricMode === 'retention_pct' && d === 50 ? '4 3' : '2 2'
      );

    if (metricMode === 'retention_pct') {
      g.append('text')
        .attr('x', innerWidth - 4)
        .attr('y', yScale(50) - 5)
        .attr('text-anchor', 'end')
        .attr('font-size', '10px')
        .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
        .attr('fill', '#64748b')
        .text('50% Half-Life');
    }

    // Axes
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(Math.min(curve.length, 8))
      .tickFormat((d) => (Number(d) === 0 ? 'P0' : `+${d}P`));

    const yAxis = d3
      .axisLeft(yScale)
      .tickValues(yTickValues)
      .tickFormat((d) => {
        const num = Number(d);
        if (metricMode === 'retention_pct') return `${num}%`;
        if (metricMode === 'revenue_per_user') return `$${Math.round(num)}`;
        return num.toFixed(1);
      });

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', '#64748b');

    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'ui-monospace, SFMono-Regular, Menlo, monospace')
      .attr('fill', '#64748b');

    g.selectAll('.domain').attr('stroke', '#cbd5e1');
    g.selectAll('.tick line').attr('stroke', '#cbd5e1');

    if (!showAllCohorts) {
      // Cohort Min–Max Envelope Band
      const areaGen = d3
        .area<typeof envelopePoints[number]>()
        .x((d) => xScale(d.offsetPeriod))
        .y0((d) => yScale(d.min))
        .y1((d) => yScale(d.max))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(envelopePoints)
        .attr('d', areaGen)
        .attr('fill', '#dbeafe')
        .attr('opacity', 0.55);
    } else {
      // Multi-cohort trajectory lines
      const palette = d3.schemeTableau10;
      const cohortLineGen = d3
        .line<RetentionCohortCell>()
        .x((d) => xScale(d.offsetPeriod))
        .y((d) => yScale(getCellMetricNumber(d, metricMode)))
        .curve(d3.curveMonotoneX);

      visibleCohorts.forEach((cohort, idx) => {
        const cCells = cohort.cells.filter((c) => c.offsetPeriod <= maxPeriod);
        if (cCells.length === 0) return;
        const isSel = cohort.cohortIndex === selectedCohortIndex;
        g.append('path')
          .datum(cCells)
          .attr('d', cohortLineGen)
          .attr('fill', 'none')
          .attr('stroke', isSel ? '#1d4ed8' : palette[idx % palette.length])
          .attr('stroke-width', isSel ? 2.5 : 1.35)
          .attr('opacity', isSel ? 1 : 0.65);
      });
    }

    // Weighted Average Line
    const avgLine = d3
      .line<typeof envelopePoints[number]>()
      .x((d) => xScale(d.offsetPeriod))
      .y((d) => yScale(d.weightedMetric))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(envelopePoints)
      .attr('d', avgLine)
      .attr('fill', 'none')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2.25)
      .attr('stroke-dasharray', showAllCohorts ? '5 3' : 'none');

    // Selected Cohort Curve (always rendered crisp on top when not already highlighted)
    const selCohort = analysis.cohorts.find((c) => c.cohortIndex === selectedCohortIndex);
    if (selCohort && selCohort.cells.length > 0) {
      const selCells = selCohort.cells.filter((c) => c.offsetPeriod <= maxPeriod);
      if (!showAllCohorts) {
        const cohortLine = d3
          .line<RetentionCohortCell>()
          .x((d) => xScale(d.offsetPeriod))
          .y((d) => yScale(getCellMetricNumber(d, metricMode)))
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(selCells)
          .attr('d', cohortLine)
          .attr('fill', 'none')
          .attr('stroke', '#1d4ed8')
          .attr('stroke-width', 2.25);
      }

      g.selectAll('circle.sel-pt')
        .data(selCells)
        .enter()
        .append('circle')
        .attr('cx', (d) => xScale(d.offsetPeriod))
        .attr('cy', (d) => yScale(getCellMetricNumber(d, metricMode)))
        .attr('r', (d) => (hoveredCurvePeriod === d.offsetPeriod ? 5 : 3.5))
        .attr('fill', '#1d4ed8')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 1.25);
    }

    // Weighted Average Nodes
    g.selectAll('circle.avg-pt')
      .data(envelopePoints)
      .enter()
      .append('circle')
      .attr('cx', (d) => xScale(d.offsetPeriod))
      .attr('cy', (d) => yScale(d.weightedMetric))
      .attr('r', (d) => (hoveredCurvePeriod === d.offsetPeriod ? 4.5 : 3))
      .attr('fill', '#0f172a');

    // Hover Crosshair Line
    if (hoveredCurvePeriod !== null && hoveredCurvePeriod <= maxPeriod) {
      const cx = xScale(hoveredCurvePeriod);
      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', innerHeight)
        .attr('stroke', '#64748b')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 3');
    }

    // Interactive Column Hover Overlay
    const colSpan = curve.length > 1 ? innerWidth / (curve.length - 1) : innerWidth;
    g.selectAll('rect.period-hit')
      .data(curve)
      .enter()
      .append('rect')
      .attr('class', 'period-hit')
      .attr('x', (d) => Math.max(0, xScale(d.offsetPeriod) - colSpan / 2))
      .attr('width', (d) => {
        const leftEdge = Math.max(0, xScale(d.offsetPeriod) - colSpan / 2);
        const rightEdge = Math.min(innerWidth, xScale(d.offsetPeriod) + colSpan / 2);
        return Math.max(8, rightEdge - leftEdge);
      })
      .attr('y', 0)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mouseenter', (_, d) => setHoveredCurvePeriod(d.offsetPeriod))
      .on('mouseleave', () => setHoveredCurvePeriod(null));
  }, [analysis, curveWidth, selectedCohortIndex, metricMode, showAllCohorts, hoveredCurvePeriod]);

  const selectedCohort =
    analysis.cohorts.find((c) => c.cohortIndex === selectedCohortIndex) ?? null;
  const hoveredPeriodSummary =
    hoveredCurvePeriod !== null
      ? analysis.periodCurve.find((p) => p.offsetPeriod === hoveredCurvePeriod) ?? null
      : null;
  const hoveredSelectedCell =
    hoveredCurvePeriod !== null && selectedCohort
      ? selectedCohort.cells.find((c) => c.offsetPeriod === hoveredCurvePeriod) ?? null
      : null;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              Retention Cohort Analysis (D3)
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Acquisition cohort survival, repeat engagement, and revenue retention over {analysis.maxObservedDay} observed days in {datasetName}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Period Granularity */}
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPeriodDays(opt.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    periodDays === opt.value
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Metric Mode */}
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {METRIC_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMetricMode(opt.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    metricMode === opt.value
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Split Filter */}
            <select
              aria-label="Filter cohorts by hash split"
              value={splitFilter}
              onChange={(e) => setSplitFilter(e.target.value as 'all' | SplitName)}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="all">All Splits</option>
              <option value="train">Train Split</option>
              <option value="val">Validation Split</option>
              <option value="test">Test Split</option>
            </select>

            {/* Channel Filter */}
            <select
              aria-label="Filter cohorts by acquisition channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-md text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <option value="all">All Channels ({analysis.availableChannels.length})</option>
              {analysis.availableChannels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 4 KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Active Cohorts</span>
              <CalendarRange className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {analysis.cohorts.length}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
              {analysis.totalEntities.toLocaleString()} entities · {analysis.totalEvents.toLocaleString()} events
            </div>
          </div>

          <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Period +1 Retention</span>
              <Users className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
              {analysis.period1RetentionPct !== null
                ? `${analysis.period1RetentionPct.toFixed(1)}%`
                : 'N/A'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              At +{periodDays} days post-entry
            </div>
          </div>

          <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Period +3 Retention</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
              {analysis.period3RetentionPct !== null
                ? `${analysis.period3RetentionPct.toFixed(1)}%`
                : 'N/A'}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              At +{periodDays * 3} days post-entry
            </div>
          </div>

          <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>50% Retention Half-Life</span>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {analysis.halfLifePeriod !== null
                ? `${analysis.halfLifePeriod.toFixed(2)}P`
                : `>${Math.max(1, analysis.maxOffsetPeriods - 1)}P`}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5 tabular-nums">
              {analysis.halfLifePeriod !== null
                ? `~${Math.round(analysis.halfLifePeriod * periodDays)} days`
                : 'Above 50% across window'}
            </div>
          </div>
        </div>

        {/* Concise Lifecycle Stage Engagement Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <span className="text-slate-600">Early Churn (P0 → +1P)</span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {lifecycleInsights.earlyDropOffPct !== null
                ? `-${lifecycleInsights.earlyDropOffPct.toFixed(1)}%`
                : 'N/A'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <span className="text-slate-600">Mid-Lifecycle Stickiness (+1P → +3P)</span>
            <span className="font-mono font-semibold text-emerald-700 tabular-nums">
              {lifecycleInsights.midStabilizationPct !== null
                ? `${lifecycleInsights.midStabilizationPct.toFixed(1)}% retained`
                : 'N/A'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <span className="text-slate-600">+1P Cohort Spread</span>
            <span className="font-mono font-semibold text-blue-700 tabular-nums">
              {lifecycleInsights.spreadPct !== null && lifecycleInsights.maxP1 && lifecycleInsights.minP1
                ? `${lifecycleInsights.spreadPct.toFixed(1)} pts (${lifecycleInsights.minP1.p1.toFixed(0)}%–${lifecycleInsights.maxP1.p1.toFixed(0)}%)`
                : 'N/A'}
            </span>
          </div>
        </div>
      </section>

      {/* Main D3 Visualizations Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: D3 Triangular Retention Heatmap */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Cohort Retention Matrix (D3 Heatmap)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hover or click any cohort cell to inspect retention counts and highlight its survival trajectory.
              </p>
            </div>
            {analysis.bestPeriod1Cohort && (
              <div className="text-[11px] font-mono text-slate-600">
                Top +1P: <strong className="text-emerald-700">{analysis.bestPeriod1Cohort.label}</strong> ({analysis.bestPeriod1Cohort.retentionPct.toFixed(1)}%)
              </div>
            )}
          </div>

          <div ref={heatmapContainerRef} className="relative overflow-x-auto">
            {analysis.cohorts.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No cohort events match the active split/channel filter.
              </div>
            ) : (
              <svg ref={heatmapSvgRef} className="block" role="img" aria-label="D3 retention cohort matrix heatmap" />
            )}

            {heatmapTooltip && (
              <div
                style={{ left: heatmapTooltip.x, top: heatmapTooltip.y }}
                className="pointer-events-none absolute z-20 w-52 rounded-md border border-slate-200 bg-white/95 px-2.5 py-2 shadow-sm text-[11px]"
              >
                <div className="font-mono font-semibold text-slate-900">
                  {heatmapTooltip.cell.cohortLabel} · {heatmapTooltip.cell.offsetLabel}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono tabular-nums text-slate-600">
                  <span>Active:</span>
                  <span className="text-right font-semibold text-slate-900">
                    {heatmapTooltip.cell.activeEntities}/{heatmapTooltip.cell.cohortSize}
                  </span>
                  <span>Retention:</span>
                  <span className="text-right font-semibold text-blue-700">
                    {heatmapTooltip.cell.retentionPct.toFixed(1)}%
                  </span>
                  <span>Spend/User:</span>
                  <span className="text-right text-slate-800">
                    ${heatmapTooltip.cell.revenuePerUser.toFixed(2)}
                  </span>
                  <span>Events/User:</span>
                  <span className="text-right text-slate-800">
                    {heatmapTooltip.cell.eventsPerUser.toFixed(1)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Cell Inspector Footer */}
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            {inspectedCell ? (
              <>
                <div className="font-mono text-slate-800 tabular-nums">
                  <strong>{inspectedCell.cohortLabel}</strong> · {inspectedCell.offsetLabel}:{' '}
                  <span className="text-blue-700 font-semibold">
                    {inspectedCell.activeEntities}/{inspectedCell.cohortSize} active ({inspectedCell.retentionPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="font-mono text-slate-500 tabular-nums">
                  Spend ${inspectedCell.totalSpend.toFixed(0)} (${inspectedCell.revenuePerUser.toFixed(2)}/entity) · {inspectedCell.totalEvents} events
                </div>
              </>
            ) : (
              <div className="text-slate-500 flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <span>Select or hover a matrix cell to inspect period-level entity retention &amp; spend.</span>
              </div>
            )}
          </div>
        </section>

        {/* Right: D3 Lifecycle Retention Curve Comparison */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                Lifecycle Trajectory ({METRIC_MODE_OPTIONS.find((m) => m.value === metricMode)?.label})
              </h2>
              <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => setShowAllCohorts(false)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    !showAllCohorts
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Selected vs Mean
                </button>
                <button
                  type="button"
                  onClick={() => setShowAllCohorts(true)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                    showAllCohorts
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Overlay All Cohorts
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {showAllCohorts
                ? 'Comparing all visible cohort trajectories against the dashed weighted average benchmark.'
                : 'Weighted cohort mean (slate) vs selected cohort (blue) within the min–max cohort spread band.'}
            </p>
          </div>

          <div ref={curveContainerRef} className="relative w-full overflow-x-auto">
            <svg ref={curveSvgRef} className="block" role="img" aria-label="D3 lifecycle retention curve chart" />

            {hoveredPeriodSummary && (
              <div className="pointer-events-none absolute top-2 right-2 z-10 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-xs text-[11px] font-mono tabular-nums">
                <div className="font-semibold text-slate-900">
                  {hoveredPeriodSummary.offsetLabel} (+{hoveredPeriodSummary.offsetPeriod * periodDays}d)
                </div>
                <div className="text-slate-700 mt-0.5">
                  Mean: <strong>{formatMetricNumber(getPeriodWeightedMetric(hoveredPeriodSummary, metricMode), metricMode)}</strong>
                </div>
                {hoveredSelectedCell && selectedCohort && (
                  <div className="text-blue-700">
                    {selectedCohort.cohortLabel}:{' '}
                    <strong>{formatMetricNumber(getCellMetricNumber(hoveredSelectedCell, metricMode), metricMode)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-600">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-slate-900 inline-block" />
                Weighted Mean
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-blue-700 inline-block" />
                {selectedCohort ? selectedCohort.cohortLabel : 'Selected Cohort'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                {showAllCohorts ? (
                  <>
                    <span className="w-3 h-0.5 bg-amber-600 inline-block" />
                    All Cohorts
                  </>
                ) : (
                  <>
                    <span className="w-3 h-2 bg-blue-100 border border-blue-200 inline-block" />
                    Cohort Spread
                  </>
                )}
              </span>
            </div>
            {selectedCohort && (
              <span className="tabular-nums">
                ARPU ${selectedCohort.arpu.toFixed(2)}
              </span>
            )}
          </div>
        </section>
      </div>

      {/* Detailed Cohort Breakdown Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Cohort Retention &amp; Monetization Summary
          </h2>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {analysis.cohorts.length} cohort windows ({periodDays}d buckets)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Cohort</th>
                <th className="py-2.5 px-3 text-right">Size (n)</th>
                <th className="py-2.5 px-3 text-right">+1P Retention</th>
                <th className="py-2.5 px-3 text-right">+2P Retention</th>
                <th className="py-2.5 px-3 text-right">+3P Retention</th>
                <th className="py-2.5 px-3 text-right">Cumulative Spend</th>
                <th className="py-2.5 px-4 text-right">Cohort ARPU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
              {analysis.cohorts.map((c) => {
                const isSel = c.cohortIndex === selectedCohortIndex;
                const p1 = c.cells[1]?.retentionPct ?? null;
                const p2 = c.cells[2]?.retentionPct ?? null;
                const p3 = c.cells[3]?.retentionPct ?? null;
                return (
                  <tr
                    key={c.cohortIndex}
                    onClick={() => setSelectedCohortIndex(c.cohortIndex)}
                    className={`cursor-pointer transition-colors ${
                      isSel ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2 px-4 font-semibold text-slate-900">
                      {c.cohortLabel}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">{c.cohortSize}</td>
                    <td className="py-2 px-3 text-right text-slate-800">
                      {p1 !== null ? `${p1.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-800">
                      {p2 !== null ? `${p2.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-800">
                      {p3 !== null ? `${p3.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-700">
                      ${c.cumulativeSpend.toFixed(2)}
                    </td>
                    <td className="py-2 px-4 text-right font-semibold text-emerald-700">
                      ${c.arpu.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
