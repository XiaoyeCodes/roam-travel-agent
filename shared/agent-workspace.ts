import { AGENTS, type AgentId, type Job, type TripEvent } from "./types.js";
import { workTasks, type WorkTask } from "./work-progress.js";

export type AgentWorkspaceId = AgentId | "planner";
export type AgentWorkspaceNode = {
  id: AgentWorkspaceId;
  name: string;
  short: string;
  color: string;
  state: "idle" | "running" | "done" | "error" | "paused";
  current?: WorkTask;
  queries: WorkTask[];
  results: WorkTask[];
  messages: TripEvent[];
  events: TripEvent[];
  summary: string;
};
export type AgentWorkspace = {
  nodes: AgentWorkspaceNode[];
  stage: {
    id: "direction" | "research" | "itinerary" | "delivery";
    label: string;
    index: number;
    total: number;
    detail: string;
  };
  handoffs: {
    id: string;
    from: AgentWorkspaceId;
    to: AgentWorkspaceId;
    message: string;
    at: string;
  }[];
};

const members = [
  {
    id: "planner" as const,
    name: "总规划师",
    short: "总规划师",
    color: "#5d8061",
    description: "整理你的旅行方向，协调各位专家",
  },
  ...AGENTS,
];
const memberIds = new Set<string>(members.map((member) => member.id));
const isMember = (id: string | undefined): id is AgentWorkspaceId =>
  !!id && memberIds.has(id);

/** A new proposal attempt or confirmed itinerary must not inherit stale activity. */
function currentEvents(job: Job): TripEvent[] {
  const events = [
    ...new Map(job.events.map((event) => [event.id, event])).values(),
  ].sort((a, b) => a.id - b.id);
  if (job.confirmedSelection) {
    const confirmation = [...events]
      .reverse()
      .find(
        (event) =>
          event.agent === "system" &&
          event.type === "message" &&
          event.to === "planner" &&
          event.message.startsWith("用户已确认方案"),
      );
    if (confirmation)
      return events.filter((event) => event.id > confirmation.id);
    const boundary = Date.parse(job.confirmedSelection.confirmedAt);
    if (Number.isFinite(boundary))
      return events.filter((event) => Date.parse(event.at) >= boundary);
    return events;
  }
  const attempt = [...events]
    .reverse()
    .find(
      (event) =>
        event.agent === "planner" &&
        event.type === "status" &&
        event.message === "先检索公开攻略，整理可供你选择的旅行方向",
    );
  const revision = [...events]
    .reverse()
    .find(
      (event) =>
        event.agent === "system" &&
        event.type === "message" &&
        event.to === "planner" &&
        event.message.startsWith("用户希望"),
    );
  const boundary = Math.max(attempt?.id || 0, revision?.id || 0);
  return events.filter((event) => event.id >= boundary);
}

function stageFor(job: Job, events: TripEvent[]): AgentWorkspace["stage"] {
  const planner = [...events]
    .reverse()
    .find(
      (event) =>
        event.agent === "planner" &&
        ["status", "proposal", "complete"].includes(event.type),
    );
  const itineraryStarted = events.some(
    (event) =>
      (event.agent === "budget" || event.agent === "route") &&
      (event.type === "status" || event.type === "report"),
  );
  const specialistsStarted = events.some(
    (event) => isMember(event.agent) && event.agent !== "planner",
  );
  const delivering =
    !!job.plan ||
    events.some(
      (event) =>
        event.agent === "planner" &&
        /汇总最终行程|使用专家检索的 POI|匹配景点封面|生成第 \d+ \/ \d+ 天|生成全程路线总览|生成检查完成|行程已生成/.test(
          event.message,
        ),
    );
  const index =
    job.status === "complete" || delivering
      ? 4
      : itineraryStarted
        ? 3
        : job.confirmedSelection ||
            specialistsStarted ||
            job.request.mode === "demo"
          ? 2
          : 1;
  const stages = [
    { id: "direction", label: "方向准备", detail: "总规划师正在准备旅行方向" },
    {
      id: "research",
      label: "专家检索",
      detail: "专家正在整理各自负责的旅行资料",
    },
    {
      id: "itinerary",
      label: "行程编排",
      detail: "专家正在核算预算、编排行程与整合审阅意见",
    },
    { id: "delivery", label: "整理交付", detail: "正在整理每日行程与旅行手册" },
  ] as const;
  const stage = stages[index - 1];
  const detail =
    job.status === "awaiting_confirmation"
      ? job.error || "旅行方向已准备好，等待你选择后继续"
      : job.status === "cancelled"
        ? "规划已停止，已完成的工作仍可查看"
        : job.status === "error"
          ? job.error || "规划暂时中断，已完成的工作仍可查看"
          : job.status === "complete"
            ? "行程已生成，专家协作记录已保留"
            : planner?.message || stage.detail;
  return { ...stage, index, total: stages.length, detail };
}

/** Pure persisted-event projection: no invented searches, handoffs, or completions. */
export function agentWorkspace(job: Job): AgentWorkspace {
  const events = currentEvents(job);
  const tasks = workTasks(events, job.status);
  const messages = events.filter(
    (event) =>
      event.type === "message" &&
      isMember(event.agent) &&
      isMember(event.to) &&
      event.agent !== event.to &&
      !!event.message.trim(),
  );
  const nodes = members.map((member): AgentWorkspaceNode => {
    const ownEvents = events.filter((event) => event.agent === member.id);
    const ownTasks = tasks
      .filter((task) => task.agent === member.id)
      .sort((a, b) => b.eventId - a.eventId);
    const analysis = ownTasks.filter((task) => task.kind === "analysis");
    const queries = ownTasks.filter((task) => task.kind === "query");
    const lastAnalysis = analysis[0];
    const lifecycle = [...ownEvents]
      .reverse()
      .find(
        (event) =>
          event.type === "report" ||
          event.type === "proposal" ||
          event.type === "complete" ||
          event.type === "error" ||
          (event.type === "status" && !!event.state),
      );
    const rawState =
      lifecycle?.state ||
      (lifecycle?.type === "report" ||
      lifecycle?.type === "proposal" ||
      lifecycle?.type === "complete"
        ? "done"
        : undefined) ||
      lastAnalysis?.state ||
      queries[0]?.state;
    let state: AgentWorkspaceNode["state"] =
      rawState === "running"
        ? "running"
        : rawState === "done"
          ? "done"
          : rawState === "error"
            ? "error"
            : rawState === "interrupted" || rawState === "waiting"
              ? "paused"
              : queries.some((query) => query.state === "running")
                ? "running"
                : "idle";
    if (state === "running" && job.status !== "running") state = "paused";
    if (member.id === "planner") {
      if (job.status === "awaiting_confirmation") state = "paused";
      if (job.status === "complete") state = "done";
      if (job.status === "error") state = "error";
    }
    const current =
      lastAnalysis && lastAnalysis.state !== "done"
        ? lastAnalysis
        : queries.find((query) =>
            ["running", "interrupted", "waiting"].includes(query.state),
          );
    let summary =
      current?.summary ||
      current?.title ||
      lifecycle?.message ||
      member.description;
    if (state === "idle") summary = "等待总规划师安排";
    if (member.id === "planner" && job.status === "awaiting_confirmation")
      summary = job.error || "旅行方向已准备好，等待你的选择";
    else if (member.id === "planner" && job.status === "error")
      summary = job.error || "规划暂时中断";
    else if (state === "paused") summary = "工作已暂停，已取得的资料仍可查看";
    return {
      id: member.id,
      name: member.name,
      short: member.short,
      color: member.color,
      state,
      current,
      queries,
      results: analysis.filter((task) => task.state === "done"),
      messages: messages.filter(
        (event) => event.agent === member.id || event.to === member.id,
      ),
      events: ownEvents,
      summary,
    };
  });
  const handoffs = new Map<string, AgentWorkspace["handoffs"][number]>();
  for (const event of messages) {
    const from = event.agent as AgentWorkspaceId;
    const to = event.to as AgentWorkspaceId;
    handoffs.set(`${from}:${to}`, {
      id: String(event.id),
      from,
      to,
      message: event.message,
      at: event.at,
    });
  }
  return {
    nodes,
    stage: stageFor(job, events),
    handoffs: [...handoffs.values()].sort(
      (a, b) => Number(a.id) - Number(b.id),
    ),
  };
}
