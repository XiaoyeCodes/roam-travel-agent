import type { Job, TripEvent, WorkDetail } from "./types.js";

export type WorkTask = WorkDetail & {
  agent: TripEvent["agent"];
  state: "running" | "done" | "error" | "interrupted" | "waiting";
  startedAt: string;
  at: string;
  eventId: number;
  message: string;
};

/** Replay persisted/SSE events identically; one query start and finish share one id. */
export function workTasks(
  events: TripEvent[],
  status: Job["status"],
): WorkTask[] {
  const tasks = new Map<string, WorkTask>();
  const structuredAgents = new Set(
    events.filter((e) => e.work?.kind === "analysis").map((e) => e.agent),
  );
  for (const event of events) {
    let work = event.work;
    if (
      !work &&
      event.agent !== "system" &&
      !structuredAgents.has(event.agent)
    ) {
      if (event.type === "status" && event.state)
        work = {
          id: `legacy-${event.agent}`,
          kind: "analysis",
          title: "已记录的阶段工作",
          ...(event.state === "done" ? { summary: event.message } : {}),
        };
      if (
        event.type === "report" &&
        event.data &&
        typeof event.data === "object"
      ) {
        const report = event.data as Record<string, unknown>;
        const strings = (v: unknown) =>
          Array.isArray(v)
            ? v.filter((x): x is string => typeof x === "string")
            : [];
        work = {
          id: `legacy-${event.agent}`,
          kind: "analysis",
          title: "已记录的专家建议",
          summary: event.message,
          findings: strings(report.findings),
          warnings: strings(report.warnings),
        };
      }
    }
    if (!work) continue;
    const previous = tasks.get(work.id);
    tasks.set(work.id, {
      ...previous,
      ...work,
      agent: event.agent,
      state:
        event.state ||
        (event.type === "report" ? "done" : previous?.state || "running"),
      startedAt: previous?.startedAt || event.at,
      at: event.at,
      eventId: event.id,
      message: event.message,
    });
  }
  return [...tasks.values()].map((task) =>
    task.state === "running" && status !== "running"
      ? {
          ...task,
          state:
            status === "awaiting_confirmation"
              ? ("waiting" as const)
              : ("interrupted" as const),
        }
      : task,
  );
}

export function progressView(events: TripEvent[], status: Job["status"]) {
  const tasks = workTasks(events, status);
  const analysis = tasks.filter((t) => t.kind === "analysis");
  const latest = new Map<string, WorkTask>();
  for (const task of analysis.sort((a, b) => a.eventId - b.eventId))
    latest.set(task.agent, task);
  const queries = tasks
    .filter((t) => t.kind === "query")
    .sort((a, b) => b.eventId - a.eventId);
  const current = [...latest.values()].filter((t) => t.state !== "done");
  const results = [...latest.values()]
    .filter((t) => t.state === "done")
    .sort((a, b) => b.eventId - a.eventId);
  // Keep preceding findings available while a specialist starts a new review.
  const previousResults = analysis.filter(
    (t) => t.state === "done" && latest.get(t.agent)?.state !== "done",
  );
  for (const task of previousResults) {
    const i = results.findIndex((r) => r.agent === task.agent);
    if (i < 0) results.push(task);
    else if (results[i].eventId < task.eventId) results[i] = task;
  }
  const latestQueries = new Map<string, WorkTask>();
  for (const task of queries) {
    const key = JSON.stringify([task.agent, task.title, task.query]);
    if (!latestQueries.has(key)) latestQueries.set(key, task);
  }
  const warnings = [
    ...new Set([
      ...results.flatMap((t) => t.warnings || []),
      ...current
        .filter((t) => t.state === "error")
        .flatMap((t) => t.warnings || [t.message]),
      ...[...latestQueries.values()]
        .filter((t) =>
          ["error", "empty", "unconfigured", "partial"].includes(
            t.outcome || "",
          ),
        )
        .flatMap((t) => [
          `${t.title}${t.query ? `（${t.query}）` : ""}：${t.summary || "待确认"}`,
        ]),
    ]),
  ];
  return { current, results, queries, warnings };
}
