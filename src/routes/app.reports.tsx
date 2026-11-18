import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import {
  billingCsvRows,
  isoWeekNumber,
  reportsQuery,
  rowsToCsv,
  type ReportSnapshot,
} from "@/data/reports";
import { formatMinutes } from "@/data/time";
import { formatCents, formatDate } from "@/lib/utils-format";
import { ProjectChangeReport } from "@/features/reports/project-change-report";

export const Route = createFileRoute("/app/reports")({
  head: () => ({ meta: [{ title: "Reports · Boared" }] }),
  component: ReportsPage,
});

function downloadCsv(filename: string, rows: object[]) {
  if (rows.length === 0) return;
  const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReportsPage() {
  const { isAdmin, workspaceId } = useAuth();
  const report = useQuery(reportsQuery(workspaceId));

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Reports" description="Reports are visible to workspace admins." />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Admins only"
              description="Ask a workspace admin if you need these numbers."
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="The last 12 weeks of tickets, time, SLAs and money."
        action={
          report.data ? (
            <Button
              variant="outline"
              onClick={() => downloadCsv("boared-velocity.csv", report.data.weeks)}
            >
              <Download className="mr-1.5 h-4 w-4" aria-hidden />
              Export velocity
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-8 md:py-7">
        <ProjectChangeReport workspaceId={workspaceId} />
        <QueryState query={report} errorTitle="Couldn't load reports">
          {(data) => <ReportBody data={data} />}
        </QueryState>
      </div>
    </>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-5 max-md:p-4">
      <div className="mb-3 flex items-center justify-between gap-2 max-md:min-h-11">
        <h2 className="font-display text-[22px] leading-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ReportBody({ data }: { data: ReportSnapshot }) {
  const weeks = data.weeks.map((row) => ({ ...row, label: `W${isoWeekNumber(row.week)}` }));
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const selected = weeks.find((row) => row.week === selectedWeek) ?? weeks.at(-1);
  const maxTickets = Math.max(1, ...weeks.map((row) => Math.max(row.opened, row.closed)));
  const hoursLabel = (hours: number | null) => (hours == null ? "—" : `${hours}h`);

  return (
    <>
      <section className="rounded-[14px] border bg-card px-[22px] py-5 max-md:p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[22px] leading-tight">Ticket velocity</h2>
          <span className="flex gap-3.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-[9px] w-[9px] rounded-[2px] bg-primary" aria-hidden />
              Opened
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[9px] w-[9px] rounded-[2px] bg-muted-foreground/50" aria-hidden />
              Closed
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <div
            className="flex min-w-max gap-1 border-b"
            role="group"
            aria-label="Tickets opened and closed per week"
          >
            {weeks.map((week) => (
              <button
                type="button"
                key={week.week}
                className="flex min-w-11 flex-1 flex-col gap-1 rounded-t px-1 pb-1 text-xs hover:bg-muted focus-visible:ring-2 aria-pressed:bg-accent"
                aria-label={`Week of ${formatDate(week.week)}, ${week.opened} opened, ${week.closed} closed`}
                aria-pressed={selected?.week === week.week}
                onMouseEnter={() => setSelectedWeek(week.week)}
                onFocus={() => setSelectedWeek(week.week)}
                onClick={() => setSelectedWeek(week.week)}
              >
                <span className="flex h-32 w-full items-end justify-center gap-0.5" aria-hidden>
                  <span
                    className="w-1/3 max-w-5 rounded-t-sm bg-primary"
                    style={{ height: `${(week.opened / maxTickets) * 100}%` }}
                  />
                  <span
                    className="w-1/3 max-w-5 rounded-t-sm bg-muted-foreground/50"
                    style={{ height: `${(week.closed / maxTickets) * 100}%` }}
                  />
                </span>
                <span className="self-center">{week.label}</span>
              </button>
            ))}
          </div>
        </div>
        {selected && (
          <p className="mt-2 text-sm tabular-nums">
            Week of {formatDate(selected.week)} · {selected.opened} opened · {selected.closed}{" "}
            closed
          </p>
        )}
      </section>

      <div className="grid gap-3.5 max-md:grid-cols-2 max-md:gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="SLA overdue" value={data.sla.breached} tone="destructive" />
        <Tile label="SLA due soon" value={data.sla.atRisk} tone="warning" />
        <Tile label="SLA on track" value={data.sla.ok} />
        <Tile label="No SLA" value={data.sla.none} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        Average first reply {hoursLabel(data.sla.avgFirstResponseHours)}. Average resolution{" "}
        {hoursLabel(data.sla.avgResolutionHours)}.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Workload"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={data.workload.length === 0}
              onClick={() => downloadCsv("boared-workload.csv", data.workload)}
            >
              CSV
            </Button>
          }
        >
          <DataTable
            empty="No assignments or time in this window."
            head={["Person", "Open tickets", "Logged"]}
            rows={data.workload.map((row) => ({
              key: row.userId,
              cells: [row.name, String(row.openTickets), formatMinutes(row.minutes)],
            }))}
          />
        </Panel>

        <Panel
          title="Time by project"
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={data.timeByProject.length === 0}
              onClick={() => downloadCsv("boared-time.csv", data.timeByProject)}
            >
              CSV
            </Button>
          }
        >
          <DataTable
            empty="No finished time entries in this window."
            head={["Project", "Billable", "Total"]}
            rows={data.timeByProject.map((row) => ({
              key: row.projectId,
              cells: [row.title, formatMinutes(row.billableMinutes), formatMinutes(row.minutes)],
            }))}
          />
        </Panel>
      </div>

      <Panel
        title="Billing"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={data.billing.length === 0}
            onClick={() => downloadCsv("boared-billing.csv", billingCsvRows(data.billing))}
          >
            CSV
          </Button>
        }
      >
        {data.billing.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {data.billing.map((row) => (
              <BillingCurrency key={row.currency} row={row} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function BillingCurrency({ row }: { row: ReportSnapshot["billing"][number] }) {
  const buckets = [
    { name: "Current", value: row.aging.current, fill: "var(--chart-2)" },
    { name: "1–30 days", value: row.aging.d30, fill: "var(--chart-4)" },
    { name: "31–60 days", value: row.aging.d60, fill: "var(--chart-1)" },
    { name: "Older", value: row.aging.older, fill: "var(--destructive)" },
  ];
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.value));
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{row.currency}</div>
      <div className="text-muted-foreground">
        Outstanding {formatCents(row.outstandingCents, row.currency)} · Paid this month{" "}
        {formatCents(row.paidThisMonthCents, row.currency)}
      </div>
      <dl
        className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 pt-2"
        aria-label={`Outstanding ${row.currency} invoices by age`}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.name}
            className="col-span-full grid grid-cols-subgrid items-center text-xs"
          >
            <dt>{bucket.name}</dt>
            <dd className="col-span-2 grid grid-cols-subgrid items-center">
              <span aria-hidden className="h-2 overflow-hidden rounded bg-muted">
                <span
                  className="block h-full rounded"
                  style={{
                    backgroundColor: bucket.fill,
                    width: `${(bucket.value / maxBucket) * 100}%`,
                  }}
                />
              </span>
              <span className="text-right tabular-nums">
                {formatCents(bucket.value, row.currency)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DataTable({
  head,
  rows,
  empty,
}: {
  head: [string, string, string];
  rows: Array<{ key: string; cells: [string, string, string] }>;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[3fr_1fr_1fr] gap-3 bg-surface px-4 py-2.5 text-xs text-muted-foreground max-md:grid-cols-[minmax(0,1fr)_4.5rem_5rem] max-md:gap-2 max-md:px-3">
        <span>{head[0]}</span>
        <span className="text-right">{head[1]}</span>
        <span className="text-right">{head[2]}</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[3fr_1fr_1fr] items-center gap-3 border-t px-4 py-2.5 text-sm max-md:grid-cols-[minmax(0,1fr)_4.5rem_5rem] max-md:gap-2 max-md:px-3 max-md:py-3"
        >
          <span className="truncate font-medium max-md:whitespace-normal max-md:break-words">
            {row.cells[0]}
          </span>
          <span className="text-right tabular-nums">{row.cells[1]}</span>
          <span className="text-right font-mono text-xs tabular-nums">{row.cells[2]}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "destructive" | "warning";
}) {
  const ink =
    value > 0 && tone === "destructive"
      ? "text-destructive"
      : value > 0 && tone === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <div className="rounded-[14px] border bg-card px-[18px] py-4 max-md:px-4 max-md:py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-display text-[40px] leading-[1.1] tabular-nums max-md:text-[34px] ${ink}`}
      >
        {value}
      </div>
    </div>
  );
}
