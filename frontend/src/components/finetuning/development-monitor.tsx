import { useQueries, useQuery } from "@tanstack/react-query";

import apiClient from "@/client";
import { MetricSeriesChart, MultiSeriesChart } from "@/components/finetuning/finetuning-charts";
import { isTerminalStatus } from "@/components/finetuning/job-snapshot";
import { MonitorChartCard } from "@/components/finetuning/monitor-chart-card";
import { Alert } from "@/components/ui/alert";
import { errorMessage } from "@/lib/notify";
import type { TrainingCheck } from "@/openapi";

async function fetchTrainingChecks(jobId: string, signal?: AbortSignal): Promise<TrainingCheck[]> {
  const checks: TrainingCheck[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await apiClient.finetuningJobs.finetuningJobsMonitoringRetrieve(
      { id: jobId, limit: 100, offset },
      { signal }
    );
    checks.push(...page.checks);
    offset = page.nextOffset;
  }
  return checks;
}

function developmentLossPoints(checks: TrainingCheck[]) {
  return checks
    .filter(
      (check) =>
        check.state === "completed" &&
        check.stream === "development" &&
        typeof check.metrics?.eval_loss === "number" &&
        Number.isFinite(check.metrics.eval_loss)
    )
    .map((check) => ({ step: check.step, value: check.metrics.eval_loss }));
}

export function DevelopmentMonitor({
  jobId,
  status,
  modelName,
  color,
}: {
  jobId: string;
  status: string;
  modelName: string;
  color: string;
}) {
  const history = useQuery({
    queryFn: ({ signal }) => fetchTrainingChecks(jobId, signal),
    queryKey: ["training-validation-loss", jobId],
    refetchInterval: isTerminalStatus(status) ? false : 5_000,
  });
  const loss = developmentLossPoints(history.data ?? []);

  return (
    <MonitorChartCard
      emptyHint="No development loss recorded"
      help="Loss on the same held-out development sample as training progresses. Lower is better. Final benchmark results are reported separately."
      isLoading={history.isPending}
      subtitle="fixed sample · per step"
      summary={
        history.error
          ? undefined
          : {
              kind: "loss",
              series: [{ color, id: jobId, name: modelName, points: loss }],
              terminal: isTerminalStatus(status),
            }
      }
      title="Development loss"
    >
      {history.error ? (
        <Alert variant="destructive">{errorMessage(history.error)}</Alert>
      ) : loss.length > 0 ? (
        <MetricSeriesChart color={color} data={loss} height={180} name={modelName} />
      ) : null}
    </MonitorChartCard>
  );
}

export function DevelopmentMonitorSeries({
  runs,
}: {
  runs: Array<{ color: string; jobId: string; modelName: string; status: string }>;
}) {
  const histories = useQueries({
    queries: runs.map((run) => ({
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchTrainingChecks(run.jobId, signal),
      queryKey: ["training-validation-loss", run.jobId],
      refetchInterval: isTerminalStatus(run.status) ? false : 5_000,
    })),
  });
  const firstError = histories.find((history) => history.error)?.error;
  const isLoading = histories.some((history) => history.isPending);
  const series = runs.map((run, index) => ({
    color: run.color,
    id: run.jobId,
    name: run.modelName,
    points: developmentLossPoints(histories[index]?.data ?? []),
    terminal: isTerminalStatus(run.status),
  }));

  return (
    <MonitorChartCard
      emptyHint="No development loss recorded"
      help="Loss on the same held-out development sample as training progresses. Lower is better. Final benchmark results are reported separately."
      isLoading={isLoading}
      subtitle="fixed sample · one line per experiment"
      summary={
        firstError ? undefined : { kind: "loss", series, terminal: series.every((s) => s.terminal) }
      }
      title="Development loss"
    >
      {firstError ? (
        <Alert variant="destructive">{errorMessage(firstError)}</Alert>
      ) : series.some((item) => item.points.length > 0) ? (
        <MultiSeriesChart height={180} series={series} />
      ) : null}
    </MonitorChartCard>
  );
}
