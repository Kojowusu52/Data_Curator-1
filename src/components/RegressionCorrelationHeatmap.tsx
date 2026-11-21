import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { RegressionFeatureKey, RegressionResult } from '../types/curation';

interface HeatmapCellDatum {
  xIdx: number;
  yIdx: number;
  keyX: string;
  keyY: string;
  r: number;
  absR: number;
  rSquared: number;
  vif: number;
  labelX: string;
  labelY: string;
  shortX: string;
  shortY: string;
  isDiagonal: boolean;
  isHighCollinearity: boolean;
}

interface RegressionCorrelationHeatmapProps {
  result: RegressionResult;
  selectedFeatures?: RegressionFeatureKey[];
  onToggleFeature?: (key: RegressionFeatureKey) => void;
}

export const RegressionCorrelationHeatmap: React.FC<
  RegressionCorrelationHeatmapProps
> = ({ result, selectedFeatures, onToggleFeature }) => {
  const { features, matrix, highCollinearityPairs } = result.featureMatrix;
  const [triangleOnly, setTriangleOnly] = useState(false);
  const [containerWidth, setContainerWidth] = useState(640);
  const [hoveredCell, setHoveredCell] = useState<HeatmapCellDatum | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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

  const targetCorrByFeature = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of result.correlations) {
      map.set(c.feature, c.pearsonR);
    }
    return map;
  }, [result.correlations]);

  const cells = useMemo<HeatmapCellDatum[]>(() => {
    const out: HeatmapCellDatum[] = [];
    const n = features.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (triangleOnly && j > i) continue;
        const r = matrix[i]?.[j] ?? 0;
        const absR = Math.abs(r);
        const isDiagonal = i === j;
        out.push({
          xIdx: j,
          yIdx: i,
          keyX: String(features[j].key),
          keyY: String(features[i].key),
          r,
          absR,
          rSquared: Math.round(r * r * 1000) / 1000,
          vif: isDiagonal
            ? 1
            : Math.round((1 / Math.max(0.01, 1 - r * r)) * 100) / 100,
          labelX: features[j].label,
          labelY: features[i].label,
          shortX: features[j].shortLabel,
          shortY: features[i].shortLabel,
          isDiagonal,
          isHighCollinearity: !isDiagonal && absR >= 0.7,
        });
      }
    }
    return out;
  }, [features, matrix, triangleOnly]);

  const chartHeight = Math.max(270, features.length * 42 + 64);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (result.rows.length < 2 || features.length === 0) {
      return;
    }

    const margin = { top: 14, right: 16, bottom: 52, left: 96 };
    const totalWidth = Math.max(320, Math.floor(containerWidth - 40));
    const innerWidth = Math.max(180, totalWidth - margin.left - margin.right);
    const innerHeight = Math.max(160, chartHeight - margin.top - margin.bottom);

    svg.attr('width', totalWidth).attr('height', chartHeight);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const labels = features.map((f) => f.shortLabel);
    const xScale = d3
      .scaleBand<string>()
      .domain(labels)
      .range([0, innerWidth])
      .padding(0.08);

    const yScale = d3
      .scaleBand<string>()
      .domain(labels)
      .range([0, innerHeight])
      .padding(0.08);

    // D3 diverging color scale: -1 (crimson) -> 0 (off-white) -> +1 (cobalt blue)
    const negScale = d3
      .scaleLinear<string>()
      .domain([-1, -0.35, 0])
      .range(['#be123c', '#fda4af', '#f8fafc'])
      .clamp(true);
    const posScale = d3
      .scaleLinear<string>()
      .domain([0, 0.35, 1])
      .range(['#f8fafc', '#93c5fd', '#1d4ed8'])
      .clamp(true);

    const resolveFill = (d: HeatmapCellDatum): string => {
      if (d.isDiagonal) return '#f1f5f9';
      return d.r < 0 ? negScale(d.r) : posScale(d.r);
    };

    const resolveTextFill = (d: HeatmapCellDatum): string => {
      if (d.isDiagonal) return '#64748b';
      if (d.absR >= 0.52) return '#ffffff';
      return '#0f172a';
    };

    // X Axis
    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickSize(0));
    xAxis.select('.domain').remove();
    xAxis
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#475569')
      .style('font-family', 'DM Sans, sans-serif')
      .attr('dy', '1.1em')
      .attr('transform', features.length > 5 ? 'rotate(-16)' : null)
      .style('text-anchor', features.length > 5 ? 'end' : 'middle');

    // Y Axis
    const yAxis = g.append('g').call(d3.axisLeft(yScale).tickSize(0));
    yAxis.select('.domain').remove();
    yAxis
      .selectAll('text')
      .style('font-size', '11px')
      .style('fill', '#334155')
      .style('font-family', 'DM Sans, sans-serif')
      .attr('dx', '-0.45em');

    // Heatmap tiles via D3 data join
    const cellGroups = g
      .selectAll<SVGGElement, HeatmapCellDatum>('g.heatmap-cell')
      .data(cells, (d) => `${d.keyY}:${d.keyX}`)
      .enter()
      .append('g')
      .attr('class', 'heatmap-cell')
      .attr(
        'transform',
        (d) => `translate(${xScale(d.shortX) ?? 0},${yScale(d.shortY) ?? 0})`
      )
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent, d: HeatmapCellDatum) {
        d3.select(this)
          .select('rect')
          .attr('stroke', '#0f172a')
          .attr('stroke-width', 2);
        setHoveredCell(d);
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltipPos({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltipPos({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }
      })
      .on('mouseleave', function (_event: MouseEvent, d: HeatmapCellDatum) {
        d3.select(this)
          .select('rect')
          .attr('stroke', d.isHighCollinearity ? '#0f172a' : '#e2e8f0')
          .attr('stroke-width', d.isHighCollinearity ? 1.75 : 0.75);
        setHoveredCell(null);
        setTooltipPos(null);
      });

    cellGroups
      .append('rect')
      .attr('width', xScale.bandwidth())
      .attr('height', yScale.bandwidth())
      .attr('rx', 4)
      .attr('fill', (d) => resolveFill(d))
      .attr('stroke', (d) => (d.isHighCollinearity ? '#0f172a' : '#e2e8f0'))
      .attr('stroke-width', (d) => (d.isHighCollinearity ? 1.75 : 0.75));

    cellGroups
      .append('text')
      .attr('x', xScale.bandwidth() / 2)
      .attr('y', yScale.bandwidth() / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => resolveTextFill(d))
      .style('font-size', xScale.bandwidth() < 52 ? '10px' : '11px')
      .style('font-family', 'JetBrains Mono, monospace')
      .style('font-weight', (d) => (d.isHighCollinearity ? '600' : '500'))
      .style('pointer-events', 'none')
      .text((d) =>
        d.isDiagonal ? '1.00' : d.r >= 0 ? `+${d.r.toFixed(2)}` : d.r.toFixed(2)
      );
  }, [cells, features, containerWidth, chartHeight, result.rows.length]);

  const canDropFeatures =
    Boolean(onToggleFeature) && (selectedFeatures?.length ?? features.length) > 1;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Feature Correlation &amp; Redundancy Heatmap (D3)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pairwise Pearson correlation matrix across {features.length} selected predictors (n = {result.rows.length} rows). Dark-bordered tiles flag redundant pairs with |r| ≥ 0.70.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-xs bg-rose-700 inline-block"
                aria-hidden="true"
              />
              <span className="font-mono">-1.0</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-xs bg-slate-100 border border-slate-200 inline-block"
                aria-hidden="true"
              />
              <span className="font-mono">0.0</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-xs bg-blue-700 inline-block"
                aria-hidden="true"
              />
              <span className="font-mono">+1.0</span>
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
            <button
              type="button"
              onClick={() => setTriangleOnly(false)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                !triangleOnly
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Full Matrix
            </button>
            <button
              type="button"
              onClick={() => setTriangleOnly(true)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                triangleOnly
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lower Triangle
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
        <div className="xl:col-span-8 p-5 relative" ref={containerRef}>
          {result.rows.length < 2 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              At least 2 materialized rows are required to render the D3 correlation heatmap.
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <svg
                ref={svgRef}
                role="img"
                aria-label="D3 feature correlation heatmap"
                className="block select-none"
              />
              {hoveredCell && tooltipPos && (
                <div
                  style={{
                    left: Math.min(containerWidth - 220, Math.max(12, tooltipPos.x + 14)),
                    top: Math.max(8, tooltipPos.y - 54),
                  }}
                  className="pointer-events-none absolute z-20 bg-white border border-slate-200 rounded-md shadow-md px-3 py-2 text-xs space-y-1 min-w-[196px]"
                >
                  <div className="font-semibold text-slate-900">
                    {hoveredCell.labelY} × {hoveredCell.labelX}
                  </div>
                  <div className="font-mono text-slate-700 tabular-nums">
                    Pearson r:{' '}
                    <span className="font-semibold text-slate-900">
                      {hoveredCell.r >= 0 && !hoveredCell.isDiagonal
                        ? `+${hoveredCell.r.toFixed(3)}`
                        : hoveredCell.r.toFixed(3)}
                    </span>
                  </div>
                  {!hoveredCell.isDiagonal && (
                    <div className="font-mono text-slate-600 tabular-nums">
                      Shared R²: {(hoveredCell.rSquared * 100).toFixed(1)}% · VIF:{' '}
                      {hoveredCell.vif.toFixed(2)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Redundancy & Collinearity Diagnostics Summary */}
        <div className="xl:col-span-4 p-5 bg-slate-50/50 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Redundant Feature Pairs (|r| ≥ 0.70)
              </span>
              <span className="font-mono text-slate-600 tabular-nums">
                {highCollinearityPairs.length} flagged
              </span>
            </div>

            {highCollinearityPairs.length === 0 ? (
              <div className="mt-4 flex items-start gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  All active predictor pairs fall below |r| = 0.70 in the current observation window. No redundant predictors detected.
                </span>
              </div>
            ) : (
              <div className="mt-3 space-y-2.5 max-h-[260px] overflow-y-auto pr-0.5">
                {highCollinearityPairs.map((pair) => {
                  const rTargetA = Math.abs(
                    targetCorrByFeature.get(pair.featureA) ?? 0
                  );
                  const rTargetB = Math.abs(
                    targetCorrByFeature.get(pair.featureB) ?? 0
                  );
                  const weakerFeature =
                    rTargetA <= rTargetB
                      ? { key: pair.featureA as RegressionFeatureKey, label: pair.labelA }
                      : { key: pair.featureB as RegressionFeatureKey, label: pair.labelB };

                  return (
                    <div
                      key={`${pair.featureA}-${pair.featureB}`}
                      className="p-3 bg-white border border-slate-200 rounded-md text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {pair.labelA} × {pair.labelB}
                        </span>
                        <span className="inline-flex items-center gap-1 text-amber-700 font-mono font-semibold shrink-0 tabular-nums">
                          <AlertTriangle className="w-3 h-3" />
                          <span>r={pair.pearsonR.toFixed(2)}</span>
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        Pairwise VIF = {pair.vifEstimate.toFixed(2)} · Shared variance ={' '}
                        {(pair.pearsonR * pair.pearsonR * 100).toFixed(1)}%
                      </div>
                      {canDropFeatures && onToggleFeature && (
                        <div className="pt-1 flex items-center justify-between gap-2 border-t border-slate-100">
                          <span className="text-[11px] text-slate-500 truncate">
                            Weaker target signal: {weakerFeature.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => onToggleFeature(weakerFeature.key)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Exclude</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 text-[11px] text-slate-500 leading-relaxed">
            Pairwise VIF &gt; 5 (|r| ≥ 0.70) indicates feature redundancy that inflates OLS coefficient variance. Exclude the weaker predictor above or switch to Z-Score normalization.
          </div>
        </div>
      </div>
    </section>
  );
};
