// `class_metrics` is stamped by the backend only when the eval dataset's
// references are labels — every panel here can legitimately have no data.

import { useMemo, useState } from "react";

import { type MetricSeries, MultiSeriesChart } from "@/components/finetuning/loss-chart";
import { Chip } from "@/components/ui/chip";
import { SortableHeader } from "@/components/ui/sortable-header";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import type {
  ClassMetrics,
  ConfusionMatrixData,
  FinetuningJudgeEvalRow,
} from "@/hooks/use-finetuning";
import { useTableSort } from "@/hooks/use-table-sort";
import { seriesColor } from "@/lib/colors";
import { PROSE } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Chart x-position for an eval row — same axis convention as the score chart. */
export function evalStepOf(row: FinetuningJudgeEvalRow, maxStep: number): number {
  if (row.kind === "baseline") return 0;
  if (typeof row.checkpoint_step === "number") return row.checkpoint_step;
  return row.kind === "final" || row.kind === "incumbent_after" ? maxStep + 1 : 0;
}

function rowsWithClassMetrics(rows: FinetuningJudgeEvalRow[]): FinetuningJudgeEvalRow[] {
  return rows.filter((r) => r.class_metrics?.classes?.length);
}

export const classColor = seriesColor;

export type ClassSeriesMetric = "precision" | "recall" | "f1";

export function buildClassSeries(
  rows: FinetuningJudgeEvalRow[],
  metric: ClassSeriesMetric
): MetricSeries[] {
  const scored = rowsWithClassMetrics(rows);
  if (scored.length === 0) return [];
  const maxStep = Math.max(
    0,
    ...scored.map((r) => (typeof r.checkpoint_step === "number" ? r.checkpoint_step : 0))
  );
  const labels = [...new Set(scored.flatMap((r) => r.class_metrics!.classes.map((c) => c.label)))];
  return labels.map((label, i) => ({
    color: classColor(i),
    id: label,
    name: label,
    points: scored
      .map((r) => {
        const cls = r.class_metrics!.classes.find((c) => c.label === label);
        return cls ? { step: evalStepOf(r, maxStep), value: cls[metric] } : null;
      })
      .filter((p): p is { step: number; value: number } => p != null)
      .sort((a, b) => a.step - b.step),
  }));
}

export function buildMacroSeries(rows: FinetuningJudgeEvalRow[]): MetricSeries[] {
  const scored = rowsWithClassMetrics(rows).filter((r) => r.class_metrics?.aggregates?.macro);
  if (scored.length === 0) return [];
  const maxStep = Math.max(
    0,
    ...scored.map((r) => (typeof r.checkpoint_step === "number" ? r.checkpoint_step : 0))
  );
  const metrics: ClassSeriesMetric[] = ["precision", "recall", "f1"];
  return metrics.map((metric, i) => ({
    color: classColor(i * 4),
    id: `macro-${metric}`,
    name: `macro ${metric === "f1" ? "F1" : metric}`,
    points: scored
      .map((r) => ({
        step: evalStepOf(r, maxStep),
        value: r.class_metrics!.aggregates!.macro![metric],
      }))
      .sort((a, b) => a.step - b.step),
  }));
}

type SortKey = "label" | "precision" | "recall" | "support" | "f1";

const fmt = (v: number | undefined) => (v != null ? v.toFixed(3) : "—");

export function ClassMetricsTable({ metrics }: { metrics: ClassMetrics }) {
  const { sort, onSort, sortRows } = useTableSort<SortKey>({ dir: "desc", key: "support" });
  const rows = sortRows(metrics.classes, (row, key) => row[key]);
  const agg = metrics.aggregates;

  return (
    <div className="max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader label="Class" onSort={onSort} sort={sort} sortKey="label" />
            <SortableHeader
              centered
              label="Precision"
              onSort={onSort}
              sort={sort}
              sortKey="precision"
            />
            <SortableHeader centered label="Recall" onSort={onSort} sort={sort} sortKey="recall" />
            <SortableHeader centered label="F1" onSort={onSort} sort={sort} sortKey="f1" />
            <SortableHeader
              centered
              label="Support"
              onSort={onSort}
              sort={sort}
              sortKey="support"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.label}>
              <TableCell className="max-w-[220px] truncate font-medium" title={c.label}>
                {c.label}
              </TableCell>
              <TableCell className="text-center font-mono tabular-nums">
                {fmt(c.precision)}
              </TableCell>
              <TableCell className="text-center font-mono tabular-nums">{fmt(c.recall)}</TableCell>
              <TableCell className="text-center font-mono tabular-nums">{fmt(c.f1)}</TableCell>
              <TableCell className="text-center font-mono font-semibold tabular-nums">
                {c.support}
              </TableCell>
            </TableRow>
          ))}
          {(["macro", "weighted"] as const).map((kind) => {
            const a = agg?.[kind];
            if (!a) return null;
            return (
              <TableRow className="border-t border-border/70 bg-wash-subtle" key={kind}>
                <TableCell className="font-medium text-muted-foreground">{kind} avg</TableCell>
                <TableCell className="text-center font-mono tabular-nums">
                  {fmt(a.precision)}
                </TableCell>
                <TableCell className="text-center font-mono tabular-nums">
                  {fmt(a.recall)}
                </TableCell>
                <TableCell className="text-center font-mono tabular-nums">{fmt(a.f1)}</TableCell>
                <TableCell className="text-center font-mono tabular-nums text-muted-foreground">
                  {kind === "weighted" && agg?.n != null ? agg.n : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const MAX_PER_CLASS_LINES = 12;

export function ClassSeriesChart({ rows }: { rows: FinetuningJudgeEvalRow[] }) {
  const [metric, setMetric] = useState<ClassSeriesMetric>("f1");
  const labelCount = new Set(
    rowsWithClassMetrics(rows).flatMap((r) => r.class_metrics!.classes.map((c) => c.label))
  ).size;
  const macroOnly = labelCount > MAX_PER_CLASS_LINES;
  const series = useMemo(
    () => (macroOnly ? buildMacroSeries(rows) : buildClassSeries(rows, metric)),
    [rows, metric, macroOnly]
  );
  if (series.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {macroOnly ? (
        <p className={cn(PROSE, "text-xs text-muted-foreground")}>
          {labelCount} classes — showing macro averages to keep the chart readable.
        </p>
      ) : (
        <div aria-label="Metric" className="flex items-center gap-1" role="group">
          {(["precision", "recall", "f1"] as const).map((m) => (
            <Chip key={m} onClick={() => setMetric(m)} selected={metric === m} size="sm">
              {m === "f1" ? "F1" : m}
            </Chip>
          ))}
        </div>
      )}
      <MultiSeriesChart height={200} series={series} valueFormatter={(v) => v.toFixed(3)} />
    </div>
  );
}

const CELL_LABEL_MAX = 14;

export function ConfusionMatrixGrid({ data }: { data: ConfusionMatrixData }) {
  const { labels, matrix } = data;
  if (!labels?.length || !matrix?.length) return null;
  const maxCount = Math.max(1, ...matrix.flat());
  const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const short = (s: string) =>
    s.length > CELL_LABEL_MAX ? `${s.slice(0, CELL_LABEL_MAX - 1)}…` : s;

  return (
    <div className="overflow-x-auto">
      <div
        className="grid w-max min-w-full gap-px text-xs"
        style={{
          gridTemplateColumns: `minmax(4rem, auto) repeat(${labels.length}, minmax(2rem, 1fr))`,
        }}
      >
        <div className="flex items-end px-1 pb-1 text-muted-foreground">true ↓ pred →</div>
        {labels.map((l) => (
          <div
            className="truncate px-1 pb-1 text-center font-medium text-muted-foreground"
            key={`col-${l}`}
            title={l}
          >
            {short(l)}
          </div>
        ))}
        {matrix.map((row, i) => (
          <RowCells
            key={`row-${labels[i]}`}
            label={labels[i]}
            labels={labels}
            maxCount={maxCount}
            row={row}
            rowTotal={rowTotals[i]}
            short={short}
          />
        ))}
      </div>
    </div>
  );
}

function RowCells({
  label,
  labels,
  row,
  rowTotal,
  maxCount,
  short,
}: {
  label: string;
  labels: string[];
  row: number[];
  rowTotal: number;
  maxCount: number;
  short: (s: string) => string;
}) {
  return (
    <>
      <div
        className="truncate px-1 py-0.5 text-right font-medium text-muted-foreground"
        title={label}
      >
        {short(label)}
      </div>
      {row.map((count, j) => {
        const pct = rowTotal > 0 ? (100 * count) / rowTotal : 0;
        const diagonal = labels[j] === label;
        return (
          <div
            className={cn(
              "relative flex min-h-6 items-center justify-center rounded-sm",
              diagonal && "ring-1 ring-inset ring-border"
            )}
            key={`${label}-${labels[j]}`}
            title={`true ${label} → predicted ${labels[j]}: ${count} (${pct.toFixed(0)}% of ${label})`}
          >
            {/* Floor/ceiling on opacity keep the cell text legible in dark theme. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-sm bg-primary"
              style={{ opacity: count > 0 ? 0.12 + 0.68 * (count / maxCount) : 0.04 }}
            />
            <span className="relative font-mono tabular-nums">{count > 0 ? count : "·"}</span>
          </div>
        );
      })}
    </>
  );
}
