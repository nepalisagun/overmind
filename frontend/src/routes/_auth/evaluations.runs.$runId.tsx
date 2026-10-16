import { useMemo, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { UsedVersionChip } from "@/components/datasets/badges";
import { EntityRef } from "@/components/entity-ref";
import { MetricBars } from "@/components/evaluations/metric-bars";
import { MetricList, metricResults } from "@/components/evaluations/metric-list";
import { formatPayload, renderPayload } from "@/components/evaluations/payload-format";
import { ProbabilityEvaluationPage } from "@/components/evaluations/probability-evaluation-page";
import {
  asRunSummary,
  metricEntries,
  RunComparison,
  ScoreChip,
} from "@/components/evaluations/run-comparison";
import { StatusBadge } from "@/components/evaluations/runs-table";
import { HeaderStat } from "@/components/finetuning/finetuning-chrome";
import { ModelProviderChip } from "@/components/model-provider-chip";
import { DetailErrorState } from "@/components/route-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { DateTime } from "@/components/ui/datetime";
import { Icon } from "@/components/ui/icons";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingState } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usedVersionOf } from "@/hooks/use-datasets";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import {
  isActiveRunStatus,
  useEvalRunGroupQuery,
  useEvalRunQuery,
  useEvalRunRowQuery,
  useEvalRunRowsQuery,
  useRelaunchEvalRunMutation,
} from "@/hooks/use-evaluations";
import { formatElapsed } from "@/lib/formatters";
import { evaluationRunSearchSchema } from "@/lib/schemas";
import { TITLE } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { EvalRun, EvalRunDetail, EvalRunRow } from "@/openapi";

export const Route = createFileRoute("/_auth/evaluations/runs/$runId")({
  component: EvaluationRunPage,
  validateSearch: evaluationRunSearchSchema,
});

const MODE_LABEL: Record<string, string> = {
  generate: "Generated",
  provided: "Provided",
  recorded: "Recorded",
};

const PHASE_LABEL: Record<string, string> = {
  generating: "Generating",
  preparing: "Preparing",
  scoring: "Scoring",
};

const targetLabel = (run: Pick<EvalRun, "label" | "mode">) =>
  run.label || MODE_LABEL[run.mode] || run.mode;

function EvaluationRunPage() {
  const { runId } = Route.useParams();
  const { format } = Route.useSearch();
  return format === "decision" ? <ProbabilityEvaluationPage id={runId} /> : <EvalRunDetailPage />;
}

function EvalRunDetailPage() {
  const { runId } = Route.useParams();
  const { projectId } = Route.useSearch();
  const { data: run, isLoading, error } = useEvalRunQuery(runId);
  const group = useEvalRunGroupQuery(projectId, run?.group || undefined);
  const [view, setView] = useState<"results" | "compare">("results");

  const header = <PageHeader title="Evaluations" />;

  if (error && !run) {
    return (
      <PageShell header={header} variant="full">
        <DetailErrorState
          action={
            <Button asChild size="sm" variant="secondary">
              {/* `search={true}` keeps the list's filters, which live only in this
                  URL. Not `(prev) => prev`: a cross-route `prev` is typed as every
                  route's search unioned, widening `run_status` past the enum. */}
              <Link search={true} to="/evaluations">
                Back to evaluations
              </Link>
            </Button>
          }
          error={error}
          fallback="Couldn't load this run."
        />
      </PageShell>
    );
  }

  if (isLoading || !run) {
    return (
      <PageShell header={header} variant="full">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton className="h-20" key={i} />
          ))}
        </div>
      </PageShell>
    );
  }

  const active = isActiveRunStatus(run.status);
  const siblings = group.data?.results ?? [];
  const hasBaseline = !run.isBaseline && siblings.some((r) => r.isBaseline && r.id !== run.id);

  return (
    <TooltipProvider delayDuration={200}>
      <PageShell header={header} variant="full">
        {run.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {run.error}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          <h2 className={TITLE.card}>{run.name || "Evaluation run"}</h2>
          <RunHeaderCard active={active} projectId={projectId} run={run} />

          {siblings.length > 1 && (
            <GroupStrip current={run.id} projectId={projectId} runs={siblings} />
          )}

          {!run.isBaseline && siblings.length > 1 && (
            <Tabs
              className="w-auto self-start"
              onValueChange={(v) => setView(v as "results" | "compare")}
              value={view}
            >
              <TabsList aria-label="Run view">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="compare">Baseline comparison</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {view === "compare" && !run.isBaseline ? (
            <RunComparison active={active} hasBaseline={hasBaseline} runId={runId} />
          ) : (
            <>
              <SummarySection run={run} />
              <RowsSection active={active} projectId={projectId} runId={runId} />
            </>
          )}
        </div>
      </PageShell>
    </TooltipProvider>
  );
}

function RunElapsed({ run }: { run: EvalRunDetail }) {
  const running = isActiveRunStatus(run.status);
  const live = useElapsedSeconds(running ? run.createdAt : undefined);
  const seconds = running
    ? live
    : Math.floor(((run.completedAt ?? run.updatedAt).getTime() - run.createdAt.getTime()) / 1000);
  if (seconds == null || seconds <= 0) return null;
  return (
    <span className="tabular-nums text-xs text-muted-foreground">{formatElapsed(seconds)}</span>
  );
}

function Divider() {
  return <span aria-hidden className="mx-5 w-px shrink-0 self-stretch bg-border/60" />;
}

function RelaunchButton({ runId, visible }: { runId: string; visible: boolean }) {
  const relaunch = useRelaunchEvalRunMutation();
  if (!visible) return null;
  return (
    <Button
      disabled={relaunch.isPending}
      onClick={() =>
        relaunch.mutate(runId, {
          onSuccess: () => toast.success("Re-running"),
        })
      }
      size="sm"
      variant="secondary"
    >
      <Icon.refresh />
      Re-run
    </Button>
  );
}

function RunHeaderCard({
  run,
  projectId,
  active,
}: {
  run: EvalRunDetail;
  projectId: string | undefined;
  active: boolean;
}) {
  const progress = run.progress;
  const model = run.resolvedModel || run.modelName;
  return (
    <Card aria-label="Run details" className="flex flex-col" role="region">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs text-foreground">Model</h3>
          <div className="flex flex-wrap items-center gap-2">
            {model ? (
              <ModelProviderChip model={model} />
            ) : (
              <span className="text-sm font-medium">{targetLabel(run)}</span>
            )}
            <Badge size="chip" variant="neutral">
              {MODE_LABEL[run.mode] ?? run.mode}
            </Badge>
            {run.isBaseline && (
              <Badge size="chip" variant="neutral">
                Baseline
              </Badge>
            )}
          </div>
        </div>
        <dl className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-medium">
              <DateTime value={run.createdAt} />
            </dd>
          </div>
          {run.completedAt && (
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="font-medium">
                <DateTime value={run.completedAt} />
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex flex-wrap items-stretch gap-y-3 border-t border-border/70 px-4 py-3.5">
        {run.capabilityId && (
          <>
            <HeaderStat label="Capability">
              <EntityRef id={run.capabilityId} kind="capability" name={run.capabilityName} />
            </HeaderStat>
            <Divider />
          </>
        )}
        {run.dataset && (
          <>
            <HeaderStat label="Dataset">
              <span className="inline-flex items-center gap-1.5">
                <EntityRef
                  id={run.dataset}
                  kind="dataset"
                  name={run.datasetName}
                  projectId={projectId}
                />
                <UsedVersionChip info={usedVersionOf(run.cellInfo)} />
              </span>
            </HeaderStat>
            <Divider />
          </>
        )}
        {run.maxItems > 0 && (
          <>
            <HeaderStat label="Max items">{run.maxItems}</HeaderStat>
            <Divider />
          </>
        )}
        <HeaderStat label="Matrix rows">
          {Array.isArray(run.matrix) ? run.matrix.length : 0}
        </HeaderStat>
        {run.judgeModel && (
          <>
            <Divider />
            <HeaderStat label="Judge">
              <span className="font-mono text-xs">{run.judgeModel}</span>
            </HeaderStat>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 border-t border-border/70 px-4 py-3">
        <StatusBadge status={run.status} />
        {active && progress && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {PHASE_LABEL[progress.phase] ?? progress.phase} · {progress.done}/{progress.rows}
            {progress.errored > 0 && ` · ${progress.errored} errored`}
          </span>
        )}
        <RunElapsed run={run} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <RelaunchButton runId={run.id} visible={!active} />
          {run.status === "completed" && (
            <Button asChild size="sm">
              <Link
                search={{
                  optimize: true,
                  projectId,
                  ...(run.capabilityId ? { capabilityId: run.capabilityId } : {}),
                  ...(run.dataset ? { datasetId: run.dataset } : {}),
                }}
                to="/optimiser"
              >
                <Icon.optimiser />
                Optimise
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function GroupStrip({
  runs,
  current,
  projectId,
}: {
  runs: EvalRun[];
  current: string;
  projectId: string | undefined;
}) {
  return (
    <section aria-label="Targets in this group" className="flex flex-wrap gap-2">
      {runs.map((r) => (
        <Link
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-wash-subtle",
            r.id === current ? "border-primary/60 bg-wash-subtle" : "border-border"
          )}
          key={r.id}
          params={{ runId: r.id }}
          search={{ projectId }}
          to="/evaluations/runs/$runId"
        >
          <span className="max-w-48 truncate">{targetLabel(r)}</span>
          {r.isBaseline && (
            <Badge size="chip" variant="neutral">
              Baseline
            </Badge>
          )}
          {isActiveRunStatus(r.status) ? (
            <StatusBadge status={r.status} />
          ) : (
            <ScoreChip value={asRunSummary(r.summary).score} />
          )}
        </Link>
      ))}
    </section>
  );
}

function SummarySection({ run }: { run: EvalRunDetail }) {
  const summary = asRunSummary(run.summary);
  const metrics = metricEntries(summary);
  const legacy = summary.migrated === true;
  const classMetrics = Object.entries(summary.class_metrics ?? {}).filter(
    ([, value]) => typeof value === "number"
  ) as [string, number][];
  if (!run.summary) {
    return isActiveRunStatus(run.status) ? <LoadingState label="Scoring…" /> : null;
  }
  return (
    <section aria-label="Summary" className="flex flex-col gap-3">
      {legacy && (summary.rows ?? 0) === 0 && (
        <p className="text-sm text-warning">
          This older run retains aggregate scores only. Individual inputs, outputs, and scores are
          unavailable.
        </p>
      )}
      {classMetrics.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
          {classMetrics.map(([name, value]) => (
            <div className="flex items-baseline gap-2" key={name}>
              <dt className="text-muted-foreground">{name.replaceAll("_", " ")}</dt>
              <dd className="font-mono tabular-nums">
                {value <= 1 ? `${Math.round(value * 100)}%` : value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {metrics.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {metrics.map(([name, metric]) => (
            <MetricBars
              benchmark={run.name || "Evaluation run"}
              description={`${metric.n} scored rows · Higher is better.`}
              emptyHint="No scored rows yet."
              key={name}
              percentage
              rows={
                metric.mean == null
                  ? []
                  : [{ colorIndex: 0, key: run.id, name: targetLabel(run), value: metric.mean }]
              }
              title={name}
            />
          ))}
        </div>
      )}
      {metrics.length > 0 && (
        <div className="overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Mean</TableHead>
                <TableHead className="text-center">Scored</TableHead>
                <TableHead className="text-center">Failed</TableHead>
                <TableHead className="text-center">Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map(([name, metric]) => (
                <TableRow key={name}>
                  <TableCell className="text-sm font-medium">{name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {metric.type === "llm"
                      ? "LLM judge"
                      : metric.type === "deterministic"
                        ? "Deterministic"
                        : "Historical"}
                  </TableCell>
                  <TableCell className="text-center">
                    <ScoreChip value={metric.mean} />
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs tabular-nums">
                    {metric.n}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs tabular-nums">
                    {metric.failed ?? (legacy ? "—" : 0)}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs tabular-nums">
                    {metric.errors ?? (legacy ? "—" : 0)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

type RowFilter = "all" | "failing" | "errored";

const FAIL_BELOW = 0.5;

function rowMatches(row: EvalRunRow, filter: RowFilter) {
  if (filter === "errored") return !!row.error || row.degraded;
  if (filter === "failing") return row.score != null && row.score < FAIL_BELOW;
  return true;
}

const rowColumns: ColumnDef<EvalRunRow>[] = [
  { accessorKey: "rowIndex", enableResizing: false, header: "Row", size: 64 },
  ...(["input", "reference", "output"] as const).map(
    (field): ColumnDef<EvalRunRow> => ({
      accessorKey: field,
      cell: ({ row }) => (
        <span className="block truncate text-xs">
          {row.original[field] == null
            ? "Not captured"
            : formatPayload(row.original[field]) || JSON.stringify(row.original[field])}
        </span>
      ),
      header: field === "input" ? "Input" : field === "reference" ? "Reference" : "Output",
      size: 260,
    })
  ),
  {
    cell: ({ row }) => <ScoreChip value={row.original.score} />,
    header: "Score",
    id: "score",
    size: 90,
  },
  {
    cell: ({ row }) => (
      <StatusBadge
        status={
          row.original.error
            ? "failed"
            : row.original.degraded
              ? "interrupted"
              : row.original.state === "done"
                ? "completed"
                : row.original.state
        }
      />
    ),
    header: "Status",
    id: "state",
    size: 110,
  },
  {
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.error ||
          metricResults(row.original.metrics)
            .filter(([, m]) => !!m.error || (m.score != null && m.score < FAIL_BELOW))
            .map(([name]) => name)
            .join(", ") ||
          "—"}
      </span>
    ),
    header: "Failing metrics",
    id: "failing",
    size: 240,
  },
];

function RowsSection({
  runId,
  active,
  projectId,
}: {
  runId: string;
  active: boolean;
  projectId: string | undefined;
}) {
  const { data, isLoading, error } = useEvalRunRowsQuery(runId, active);
  const [filter, setFilter] = useState<RowFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<number | undefined>();
  const rows = useMemo(
    () => (data?.results ?? []).filter((row) => rowMatches(row, filter)),
    [data, filter]
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  return (
    <section aria-label="Datapoints" className="flex min-h-96 flex-col gap-3">
      <DataTable
        columns={rowColumns}
        data={
          data
            ? {
                count: rows.length,
                results: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
              }
            : undefined
        }
        error={error}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        isRowActive={(row) => row.id === openId}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onRowClick={(row) => setOpenId(row.id)}
        page={currentPage}
        pageSize={pageSize}
        storageKey="evaluation-run-datapoints"
        toolbar={
          <ListToolbar
            filters={
              <Select
                onValueChange={(value) => {
                  setFilter(value as RowFilter);
                  setPage(1);
                }}
                value={filter}
              >
                <SelectTrigger aria-label="Filter rows" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rows</SelectItem>
                  <SelectItem value="failing">Failing</SelectItem>
                  <SelectItem value="errored">Errored or degraded</SelectItem>
                </SelectContent>
              </Select>
            }
            primary={
              <h3 className={TITLE.card}>
                Datapoints <span className="text-muted-foreground">{data?.count ?? ""}</span>
              </h3>
            }
          />
        }
      />
      <RowSheet id={openId} onClose={() => setOpenId(undefined)} projectId={projectId} />
    </section>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-wash-subtle p-3 font-mono text-xs">
        {renderPayload(text, "formatted")}
      </pre>
    </div>
  );
}

function RowSheet({
  id,
  projectId,
  onClose,
}: {
  id: number | undefined;
  projectId: string | undefined;
  onClose: () => void;
}) {
  const { data: row, isLoading } = useEvalRunRowQuery(id);
  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={id !== undefined}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Row {row?.rowIndex ?? ""}</SheetTitle>
          <SheetDescription>
            {row?.score != null ? `Score ${Math.round(row.score * 100)}%` : "Not scored"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {isLoading || !row ? (
            <LoadingState />
          ) : (
            <>
              {row.error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {row.error}
                </div>
              )}
              {row.degraded && row.degradedReason && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {row.degradedReason}
                </div>
              )}
              <MetricList metrics={row.metrics} />
              <Payload label="Input" value={row.input} />
              <Payload label="Reference" value={row.reference} />
              <Payload label="Output" value={row.output} />
              {row.sourceTraceId && (
                <EntityRef
                  id={row.sourceTraceId}
                  kind="trace"
                  name={row.sourceTraceId.slice(0, 12)}
                  projectId={projectId}
                />
              )}
              <span className="text-xs text-muted-foreground">
                {row.finishedAt ? <DateTime value={row.finishedAt} /> : null}
              </span>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
