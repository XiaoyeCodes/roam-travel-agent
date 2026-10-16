import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import type {
  Evidence,
  Job,
  TripEvent,
  WorkDetail,
} from "../../shared/types.js";
import { progressView, workTasks } from "../../shared/work-progress.js";
import { agentWorkspace } from "../../shared/agent-workspace.js";

fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "work-progress-test-"),
);
const { describeQuery, queryOutcome } = await import("../src/work-progress.js");
const evidence = (
  tool: string,
  data: unknown,
  status: Evidence["status"] = "live",
): Evidence => ({
  id: "e1",
  tool,
  source: "测试来源",
  status,
  queriedAt: "2026-10-16T06:00:00Z",
  data,
});
const event = (
  id: number,
  work: WorkDetail,
  state: TripEvent["state"] = "running",
  agent: TripEvent["agent"] = "planner",
): TripEvent => ({
  id,
  at: `2026-10-16T06:00:${String(id).padStart(2, "0")}Z`,
  type: work.kind === "query" ? "tool" : "status",
  agent,
  message: work.summary || work.title,
  state,
  work,
});

test("public progress shows useful search conditions without copying arbitrary arguments or provider output", () => {
  const query = describeQuery("search_web", {
    query: "南京 博物院 sk-test-secret",
    source: "xiaohongshu",
    token: "never-copy-me",
    headers: { Authorization: "secret" },
  });
  assert.match(query.title, /小红书/);
  assert.match(query.query!, /南京 博物院/);
  assert.ok(!JSON.stringify(query).includes("sk-test-secret"));
  assert.ok(!JSON.stringify(query).includes("never-copy-me"));
  const remote = describeQuery(
    "maps_text_search",
    {
      city: "南京",
      keywords: "博物院",
      apiKey: "private-key",
      instructions: "private-instructions",
    },
    "地图 MCP",
  );
  assert.equal(remote.query, "南京 · 博物院");
  assert.ok(!JSON.stringify(remote).includes("private"));
  const output = queryOutcome(
    remote,
    evidence("maps_text_search", { content: "unparsed-private-output" }),
  );
  assert.equal(output.outcome, "partial");
  assert.ok(!JSON.stringify(output).includes("unparsed-private-output"));
  const blocks = queryOutcome(
    remote,
    evidence("maps_text_search", [
      { type: "text", text: "opaque content block" },
    ]),
  );
  assert.equal(
    blocks.outcome,
    "partial",
    "MCP content blocks are not counted as search results",
  );
});

test("parallel searches from the same agent remain paired when results arrive out of order", () => {
  const a = describeQuery("search_web", {
    query: "南京 博物院",
    source: "xiaohongshu",
  });
  const b = describeQuery("search_web", {
    query: "南京 雨天备选",
    source: "all",
  });
  const events = [
    event(1, a),
    event(2, b),
    event(
      3,
      queryOutcome(b, evidence("search_web", [{ title: "室内活动" }])),
      "done",
    ),
    event(4, queryOutcome(a, evidence("search_web", [])), "done"),
  ];
  const queries = progressView(events, "running").queries;
  assert.equal(queries.length, 2);
  assert.equal(queries.find((q) => q.id === a.id)?.outcome, "empty");
  assert.equal(queries.find((q) => q.id === b.id)?.findings?.[0], "室内活动");
  assert.equal(queries.find((q) => q.id === b.id)?.startedAt, events[1].at);
  assert.deepEqual(
    progressView(JSON.parse(JSON.stringify(events)), "running"),
    progressView(events, "running"),
    "persisted replay matches live state",
  );
});

test("empty, failed, unconfigured and partially covered results are not presented as verified successes", () => {
  const query = describeQuery("search_train_tickets", {
    origin: "上海",
    destination: "南京",
    date: "2026-10-23",
    passengers: 2,
  });
  assert.match(query.query!, /上海 → 南京 · 2026-10-23 · 2 人/);
  assert.equal(
    queryOutcome(query, evidence("search_train_tickets", { results: [] }))
      .outcome,
    "empty",
  );
  assert.equal(
    queryOutcome(
      query,
      evidence("search_train_tickets", { message: "超时" }, "error"),
    ).outcome,
    "error",
  );
  assert.equal(
    queryOutcome(query, evidence("search_places", {}, "unconfigured")).outcome,
    "unconfigured",
  );
  const weather = queryOutcome(
    query,
    evidence("weather_forecast", {
      days: [{ available: true }, { available: false }],
    }),
  );
  assert.equal(weather.outcome, "partial");
  assert.match(weather.summary!, /1\/2/);
  const budget = queryOutcome(
    query,
    evidence("calculate_budget", { totalKnown: 600, unknownItems: ["机票"] }),
  );
  assert.equal(budget.outcome, "partial");
  assert.match(budget.summary!, /600.*1 项金额未知/);
  assert.ok(budget.warnings?.some((s) => s.includes("机票")));
});

test("interrupted and cancelled workflows never leave active work spinning, while review retains earlier findings", () => {
  const first: WorkDetail = {
    id: "weather-1",
    kind: "analysis",
    title: "查询天气",
    summary: "两天有预报",
    findings: ["第二天准备室内备选"],
    warnings: ["第三天待查"],
  };
  const review: WorkDetail = {
    id: "weather-review",
    kind: "analysis",
    title: "复核路线天气",
  };
  const query = describeQuery("weather_forecast", { city: "南京", days: 3 });
  const events = [
    event(1, first, "done", "weather"),
    event(2, review, "running", "weather"),
    event(3, query, "running", "weather"),
  ];
  const live = progressView(events, "running");
  assert.equal(live.current.length, 1);
  assert.equal(live.results[0].findings?.[0], "第二天准备室内备选");
  for (const status of ["cancelled", "error", "complete"] as const) {
    const tasks = workTasks(events, status);
    assert.ok(!tasks.some((t) => t.state === "running"));
    assert.equal(tasks.find((t) => t.id === query.id)?.state, "interrupted");
  }
  assert.equal(
    workTasks(events, "awaiting_confirmation").find((t) => t.id === query.id)
      ?.state,
    "waiting",
  );
});

test("successful retries clear the current query warning without deleting the failure history", () => {
  const a = describeQuery("search_web", { query: "南京 预约" });
  const b = describeQuery("search_web", { query: "南京 预约" });
  const events = [
    event(1, queryOutcome(a, evidence("search_web", {}, "error")), "error"),
    event(
      2,
      queryOutcome(b, evidence("search_web", [{ title: "预约指南" }])),
      "done",
    ),
  ];
  const view = progressView(events, "complete");
  assert.equal(view.queries.length, 2);
  assert.equal(view.warnings.length, 0);
});

test("legacy event records keep conclusions and mark stopped statuses without inventing searches", () => {
  const events: TripEvent[] = [
    {
      id: 1,
      at: "2026-10-16T06:00:00Z",
      type: "status",
      agent: "food",
      state: "running",
      message: "开始检索",
    },
    {
      id: 2,
      at: "2026-10-16T06:00:01Z",
      type: "report",
      agent: "weather",
      message: "已有雨天建议",
      data: { findings: ["准备雨具"], warnings: ["临行复核天气"] },
    },
  ];
  const view = progressView(events, "error");
  assert.equal(view.current[0].state, "interrupted");
  assert.equal(view.results[0].findings?.[0], "准备雨具");
  assert.deepEqual(view.queries, []);
});

const workspaceJob = (
  events: TripEvent[],
  status: Job["status"] = "running",
): Job => ({
  id: "workspace-test",
  status,
  events,
  createdAt: "2026-10-16T06:00:00Z",
  request: {
    origin: "上海",
    destination: "南京",
    startDate: "2026-10-23",
    days: 3,
    travelers: 2,
    budget: 6000,
    preferences: ["人文"],
    pace: "balanced",
    transport: "train",
    notes: "",
    mode: "live",
  },
});
const analysisWork = (id: string, title = "整理旅行资料"): WorkDetail => ({
  id,
  title,
  kind: "analysis",
});
const collaborationEvent = (
  id: number,
  agent: TripEvent["agent"],
  to: string,
  message = "按地理邻近安排路线",
): TripEvent => ({
  id,
  at: `2026-10-16T06:00:${String(id).padStart(2, "0")}Z`,
  type: "message",
  agent,
  to,
  message,
});

test("agent workspace discards proposal work after confirmation and starts the specialist phase", () => {
  const job = workspaceJob([
    event(1, analysisWork("proposal"), "done"),
    event(2, { id: "old-query", kind: "query", title: "查询候选方向" }),
    collaborationEvent(3, "system", "planner", "用户已确认方案 A「经典路线」"),
    event(
      4,
      analysisWork("planner", "正在并行研究景点、交通、天气、住宿与美食"),
    ),
    event(5, analysisWork("weather"), "running", "weather"),
  ]);
  job.confirmedSelection = {
    proposalId: "proposal",
    confirmedAt: job.events[2].at,
    notes: [],
    option: {
      id: "A",
      title: "经典路线",
      summary: "",
      highlights: [],
      outline: [],
      pace: "balanced",
      costNote: "",
      cautions: [],
      sourceUrls: [],
    },
  };
  const view = agentWorkspace(job);
  assert.equal(view.stage.index, 2);
  assert.equal(view.stage.id, "research");
  assert.equal(view.nodes.length, 8);
  assert.deepEqual(view.nodes[0].queries, []);
  assert.deepEqual(view.nodes[0].results, []);
  assert.equal(
    view.nodes.find((node) => node.id === "weather")?.state,
    "running",
  );
  assert.equal(view.nodes.find((node) => node.id === "route")?.state, "idle");
  assert.deepEqual(
    view.handoffs,
    [],
    "system instructions are not agent handoffs",
  );
});

test("a revised proposal clears obsolete running queries and preserves waiting status", () => {
  const job = workspaceJob([
    event(1, { id: "old-query", kind: "query", title: "旧查询" }),
    event(2, analysisWork("old-proposal"), "done"),
    collaborationEvent(3, "system", "planner", "用户希望调整：增加自然风光"),
    {
      ...event(4, analysisWork("new-proposal")),
      message: "先检索公开攻略，整理可供你选择的旅行方向",
    },
    event(5, { id: "new-query", kind: "query", title: "新查询" }),
  ]);
  const running = agentWorkspace(job);
  assert.equal(running.stage.index, 1);
  assert.deepEqual(
    running.nodes[0].queries.map((query) => query.id),
    ["new-query"],
  );
  assert.deepEqual(running.nodes[0].results, []);
  job.status = "awaiting_confirmation";
  const waiting = agentWorkspace(job);
  assert.equal(waiting.nodes[0].state, "paused");
  assert.ok(waiting.nodes.every((node) => node.state !== "running"));
  assert.match(waiting.stage.detail, /等待你选择/);
  assert.ok(
    waiting.nodes[0].queries.every((query) => query.state !== "running"),
  );
});

test("workspace handoffs require real valid messages and keep only the latest same-direction exchange", () => {
  const job = workspaceJob([
    collaborationEvent(1, "weather", "route", "第一轮天气建议"),
    collaborationEvent(2, "route", "weather", "请复核第三天"),
    collaborationEvent(3, "weather", "route", "第三天适合室内活动"),
    collaborationEvent(4, "system", "planner"),
    collaborationEvent(5, "hotel", "unknown"),
    collaborationEvent(6, "route", "route"),
    { ...collaborationEvent(7, "budget", "route"), type: "status" },
    collaborationEvent(8, "food", "route", "  "),
  ]);
  const view = agentWorkspace(job);
  assert.equal(view.handoffs.length, 2);
  assert.equal(
    view.handoffs.find((handoff) => handoff.from === "weather")?.message,
    "第三天适合室内活动",
  );
  assert.equal(
    view.nodes.find((node) => node.id === "route")?.messages.length,
    3,
  );
  assert.equal(
    view.nodes.find((node) => node.id === "weather")?.state,
    "idle",
    "a sent message alone does not invent an active task",
  );
});

test("repeated handoffs move to their latest event position for recent-activity displays", () => {
  const view = agentWorkspace(
    workspaceJob([
      collaborationEvent(1, "weather", "route", "第一次天气建议"),
      collaborationEvent(2, "budget", "route", "预算核算"),
      collaborationEvent(3, "hotel", "route", "住宿建议"),
      collaborationEvent(4, "food", "route", "餐厅建议"),
      collaborationEvent(5, "attractions", "route", "景点建议"),
      collaborationEvent(6, "transport", "route", "交通建议"),
      collaborationEvent(10, "weather", "route", "最新天气复核"),
    ]),
  );
  assert.deepEqual(
    view.handoffs.map((handoff) => handoff.id),
    ["2", "3", "4", "5", "6", "10"],
  );
  assert.equal(view.handoffs.at(-1)?.message, "最新天气复核");
  assert.deepEqual(
    view.handoffs.slice(-5).map((handoff) => handoff.id),
    ["3", "4", "5", "6", "10"],
  );
});

test("budget work starts itinerary planning before the route specialist is dispatched", () => {
  const events = [event(1, analysisWork("weather-first"), "done", "weather")];
  assert.equal(agentWorkspace(workspaceJob(events)).stage.index, 2);
  const view = agentWorkspace(
    workspaceJob([
      ...events,
      event(
        2,
        analysisWork("budget-first", "核算全程预算"),
        "running",
        "budget",
      ),
    ]),
  );
  assert.equal(view.stage.index, 3);
  assert.equal(view.stage.id, "itinerary");
  assert.equal(
    view.nodes.find((node) => node.id === "budget")?.state,
    "running",
  );
  assert.equal(view.nodes.find((node) => node.id === "route")?.state, "idle");
});

test("second review keeps previous findings and replay is stable across SSE duplicates and ordering", () => {
  const first = {
    ...analysisWork("weather-first"),
    findings: ["第二天准备室内备选"],
  };
  const job = workspaceJob([
    event(1, first, "done", "weather"),
    event(2, analysisWork("route-first"), "done", "route"),
    event(
      3,
      analysisWork("weather-review", "复核路线与天气是否冲突"),
      "running",
      "weather",
    ),
    event(
      4,
      { id: "review-query", kind: "query", title: "补查天气" },
      "running",
      "weather",
    ),
  ]);
  const view = agentWorkspace(job);
  const weather = view.nodes.find((node) => node.id === "weather")!;
  assert.equal(view.stage.index, 3);
  assert.equal(weather.state, "running");
  assert.equal(weather.current?.id, "weather-review");
  assert.deepEqual(weather.results[0].findings, ["第二天准备室内备选"]);
  assert.deepEqual(
    agentWorkspace({
      ...job,
      events: JSON.parse(
        JSON.stringify([...job.events].reverse().concat(job.events[1])),
      ),
    }),
    view,
  );
});

test("terminal jobs stop every node and query while keeping successful work and actual failures distinct", () => {
  const events = [
    event(1, analysisWork("planner")),
    event(2, analysisWork("food"), "done", "food"),
    event(3, analysisWork("weather"), "running", "weather"),
    event(
      4,
      { id: "query", kind: "query", title: "查询天气" },
      "running",
      "weather",
    ),
    event(5, analysisWork("hotel"), "error", "hotel"),
  ];
  for (const status of [
    "complete",
    "error",
    "cancelled",
    "awaiting_confirmation",
  ] as const) {
    const view = agentWorkspace(workspaceJob(events, status));
    assert.ok(view.nodes.every((node) => node.state !== "running"));
    assert.ok(
      view.nodes.every((node) =>
        node.queries.every((query) => query.state !== "running"),
      ),
    );
    assert.equal(view.nodes.find((node) => node.id === "food")?.state, "done");
    assert.equal(
      view.nodes.find((node) => node.id === "weather")?.state,
      "paused",
    );
    assert.equal(
      view.nodes.find((node) => node.id === "hotel")?.state,
      "error",
    );
    assert.equal(
      view.nodes[0].state,
      status === "complete" ? "done" : status === "error" ? "error" : "paused",
    );
  }
});

test("legacy work shows reports without inventing searches and delivery remains the final phase", () => {
  const job = workspaceJob([
    {
      id: 1,
      at: "2026-10-16T06:00:01Z",
      agent: "weather",
      type: "report",
      message: "已有雨天备选",
      data: { findings: ["第二天安排博物馆"] },
    },
    {
      id: 2,
      at: "2026-10-16T06:00:02Z",
      agent: "planner",
      type: "status",
      state: "running",
      message: "正在汇总最终行程、预算与待确认事项",
    },
    {
      id: 3,
      at: "2026-10-16T06:00:03Z",
      agent: "planner",
      type: "status",
      state: "running",
      message: "正在复核第 1 天交通时间",
    },
  ]);
  const view = agentWorkspace(job);
  assert.equal(view.stage.index, 4);
  assert.equal(view.stage.id, "delivery");
  assert.equal(view.stage.detail, "正在复核第 1 天交通时间");
  const weather = view.nodes.find((node) => node.id === "weather")!;
  assert.equal(weather.state, "done");
  assert.deepEqual(weather.results[0].findings, ["第二天安排博物馆"]);
  assert.deepEqual(weather.queries, []);
});
