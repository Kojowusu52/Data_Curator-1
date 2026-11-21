import React, { useMemo, useState } from 'react';
import { RawEvent } from '../types/curation';

type CohortMetricMode = 'cumulative_ltv' | 'incremental_spend';

interface CohortCell {
  tenureMonth: number;
  observable: boolean;
  incrementalAvg: number;
  cumulativeAvgLtv: number;
  activeUsers: number;
  totalCohortUsers: number;
}

interface CohortRow {
  acqMonth: number;
  label: string;
  dayRangeLabel: string;
  userCount: number;
  finalAvgLtv: number;
  cells: CohortCell[];
}

interface CohortLtvHeatmapProps {
  events: RawEvent[];
}

export const CohortLtvHeatmap: React.FC<CohortLtvHeatmapProps> = ({ events }) => {
  const [metricMode, setMetricMode] = useState<CohortMetricMode>('cumulative_ltv');
  const [hoveredCell, setHoveredCell] = useState<{
    acqMonth: number;
    tenureMonth: number;
  } | null>(null);

  const cohortData = useMemo(() => {
    if (events.length === 0) {
      return {
        rows: [] as CohortRow[],
        maxTenureMonths: 0,
        maxCellValue: 1,
        maxDay: 0,
      };
    }

    let maxDay = 0;
    const byEntity = new Map<string, RawEvent[]>();
    for (const ev of events) {
      if (ev.timestampDay > maxDay) maxDay = ev.timestampDay;
      const list = byEntity.get(ev.entityId);
      if (list) list.push(ev);
      else byEntity.set(ev.entityId, [ev]);
    }

    const maxMonthIndex = Math.floor(Math.max(0, maxDay - 1) / 30);

    // Group entities by acquisition month (month of earliest event)
    const cohortsMap = new Map<
      number,
      {
        users: number;
        incrementalByTenure: Map<number, number>;
        activeUsersByTenure: Map<number, Set<string>>;
      }
    >();

    for (const [entityId, evs] of byEntity.entries()) {
      let minDay = Infinity;
      for (const e of evs) {
        if (e.timestampDay < minDay) minDay = e.timestampDay;
      }
      const acqMonth = Math.floor(Math.max(0, minDay - 1) / 30);
      let cohort = cohortsMap.get(acqMonth);
      if (!cohort) {
        cohort = {
          users: 0,
          incrementalByTenure: new Map(),
          activeUsersByTenure: new Map(),
        };
        cohortsMap.set(acqMonth, cohort);
      }
      cohort.users += 1;

      for (const e of evs) {
        const evMonth = Math.floor(Math.max(0, e.timestampDay - 1) / 30);
        const tenureMonth = Math.max(0, evMonth - acqMonth);
        cohort.incrementalByTenure.set(
          tenureMonth,
          (cohort.incrementalByTenure.get(tenureMonth) ?? 0) + e.spendAmount
        );
        let activeSet = cohort.activeUsersByTenure.get(tenureMonth);
        if (!activeSet) {
          activeSet = new Set<string>();
          cohort.activeUsersByTenure.set(tenureMonth, activeSet);
        }
        activeSet.add(entityId);
      }
    }

    const sortedMonths = Array.from(cohortsMap.keys()).sort((a, b) => a - b);
    const earliestAcq = sortedMonths[0] ?? 0;
    const maxTenureSpan = Math.min(11, Math.max(0, maxMonthIndex - earliestAcq));

    let maxCellValue = 1;
    const rows: CohortRow[] = sortedMonths.map((acqMonth) => {
      const cohort = cohortsMap.get(acqMonth)!;
      const observableLimit = Math.max(0, maxMonthIndex - acqMonth);
      let runningCumSum = 0;
      let finalAvgLtv = 0;

      const cells: CohortCell[] = [];
      for (let t = 0; t <= maxTenureSpan; t++) {
        const observable = t <= observableLimit;
        if (!observable) {
          cells.push({
            tenureMonth: t,
            observable: false,
            incrementalAvg: 0,
            cumulativeAvgLtv: 0,
            activeUsers: 0,
            totalCohortUsers: cohort.users,
          });
          continue;
        }

        const incSpend = cohort.incrementalByTenure.get(t) ?? 0;
        runningCumSum += incSpend;
        const incrementalAvg = Math.round((incSpend / cohort.users) * 100) / 100;
        const cumulativeAvgLtv =
          Math.round((runningCumSum / cohort.users) * 100) / 100;
        const activeUsers = cohort.activeUsersByTenure.get(t)?.size ?? 0;

        finalAvgLtv = cumulativeAvgLtv;

        const valForScale =
          metricMode === 'cumulative_ltv' ? cumulativeAvgLtv : incrementalAvg;
        if (valForScale > maxCellValue) maxCellValue = valForScale;

        cells.push({
          tenureMonth: t,
          observable: true,
          incrementalAvg,
          cumulativeAvgLtv,
          activeUsers,
          totalCohortUsers: cohort.users,
        });
      }

      const dayStart = acqMonth * 30 + 1;
      const dayEnd = (acqMonth + 1) * 30;
      return {
        acqMonth,
        label: `Month ${acqMonth + 1}`,
        dayRangeLabel: `d${dayStart}–${dayEnd}`,
        userCount: cohort.users,
        finalAvgLtv,
        cells,
      };
    });

    return {
      rows,
      maxTenureMonths: maxTenureSpan,
      maxCellValue,
      maxDay,
    };
  }, [events, metricMode]);

  const activeHoverInfo = useMemo(() => {
    if (!hoveredCell) return null;
    const row = cohortData.rows.find((r) => r.acqMonth === hoveredCell.acqMonth);
    const cell = row?.cells[hoveredCell.tenureMonth];
    if (!row || !cell || !cell.observable) return null;
    return { row, cell };
  }, [hoveredCell, cohortData.rows]);

  const getHeatClasses = (value: number, observable: boolean) => {
    if (!observable) {
      return 'bg-slate-50 text-slate-300 border border-dashed border-slate-200';
    }
    const ratio = value / Math.max(1, cohortData.maxCellValue);
    if (ratio >= 0.8) return 'bg-blue-800 text-white';
    if (ratio >= 0.6) return 'bg-blue-700 text-white';
    if (ratio >= 0.42) return 'bg-blue-600 text-white';
    if (ratio >= 0.25) return 'bg-blue-200 text-slate-900';
    if (ratio >= 0.1) return 'bg-blue-100 text-slate-800';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Acquisition Cohort LTV Progression Heatmap
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Aggregates entities by acquisition month (30-day windows) across tenure months M+0 through M+{cohortData.maxTenureMonths} to surface seasonal shifts or cohort quality decay.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="tablist"
            aria-label="Cohort heatmap metric mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={metricMode === 'cumulative_ltv'}
              onClick={() => setMetricMode('cumulative_ltv')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'cumulative_ltv'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cumulative Avg LTV
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={metricMode === 'incremental_spend'}
              onClick={() => setMetricMode('incremental_spend')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                metricMode === 'incremental_spend'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly Spend / User
            </button>
          </div>
        </div>
      </div>

      {cohortData.rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500">
          No canonical events available to build acquisition cohorts.
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="py-2 pr-3 text-left font-semibold text-slate-600 text-[11px] whitespace-nowrap">
                    Acquisition Cohort
                  </th>
                  <th className="py-2 px-2 text-right font-semibold text-slate-600 text-[11px] whitespace-nowrap">
                    Users
                  </th>
                  {Array.from(
                    { length: cohortData.maxTenureMonths + 1 },
                    (_, t) => (
                      <th
                        key={t}
                        className="py-2 px-1 text-center font-mono font-semibold text-slate-600 text-[11px] whitespace-nowrap"
                      >
                        M+{t}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {cohortData.rows.map((row) => (
                  <tr key={row.acqMonth}>
                    <th
                      scope="row"
                      className="py-1.5 pr-3 text-left font-medium text-slate-800 whitespace-nowrap"
                    >
                      <span>{row.label}</span>
                      <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                        {row.dayRangeLabel}
                      </span>
                    </th>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {row.userCount}
                    </td>
                    {row.cells.map((cell) => {
                      const val =
                        metricMode === 'cumulative_ltv'
                          ? cell.cumulativeAvgLtv
                          : cell.incrementalAvg;
                      const isHovered =
                        hoveredCell?.acqMonth === row.acqMonth &&
                        hoveredCell?.tenureMonth === cell.tenureMonth;

                      return (
                        <td key={cell.tenureMonth} className="p-0.5 min-w-[60px]">
                          <button
                            type="button"
                            disabled={!cell.observable}
                            onMouseEnter={() =>
                              cell.observable &&
                              setHoveredCell({
                                acqMonth: row.acqMonth,
                                tenureMonth: cell.tenureMonth,
                              })
                            }
                            onFocus={() =>
                              cell.observable &&
                              setHoveredCell({
                                acqMonth: row.acqMonth,
                                tenureMonth: cell.tenureMonth,
                              })
                            }
                            aria-label={
                              cell.observable
                                ? `${row.label} tenure M+${cell.tenureMonth}: $${val.toFixed(0)}`
                                : `${row.label} tenure M+${cell.tenureMonth}: unobserved`
                            }
                            className={`w-full h-9 rounded-xs font-mono text-[11px] tabular-nums flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${getHeatClasses(
                              val,
                              cell.observable
                            )} ${
                              isHovered ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                            }`}
                          >
                            {cell.observable ? `$${Math.round(val)}` : '—'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend & Hovered Cell Details */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div className="text-slate-600 font-mono tabular-nums">
              {activeHoverInfo ? (
                <span>
                  <strong className="text-slate-900">
                    {activeHoverInfo.row.label} · M+{activeHoverInfo.cell.tenureMonth}
                  </strong>
                  {' — '}
                  Cum. LTV: <strong>${activeHoverInfo.cell.cumulativeAvgLtv.toFixed(2)}</strong>
                  {' · '}
                  Month Spend: <strong>${activeHoverInfo.cell.incrementalAvg.toFixed(2)}</strong>
                  {' · '}
                  Active: {activeHoverInfo.cell.activeUsers}/{activeHoverInfo.cell.totalCohortUsers} users (
                  {Math.round(
                    (activeHoverInfo.cell.activeUsers /
                      Math.max(1, activeHoverInfo.cell.totalCohortUsers)) *
                      100
                  )}
                  %)
                </span>
              ) : (
                <span>
                  Hover any cohort cell to inspect cumulative LTV, monthly spend per user, and active retention rate.
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-600 shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-slate-100 border border-slate-200 inline-block" aria-hidden="true" />
                <span>Low ($0)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-blue-200 inline-block" aria-hidden="true" />
                <span>Mid</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-blue-800 inline-block" aria-hidden="true" />
                <span className="font-mono tabular-nums">
                  Peak (${Math.round(cohortData.maxCellValue)})
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
