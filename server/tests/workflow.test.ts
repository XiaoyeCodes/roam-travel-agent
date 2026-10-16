import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Config } from "../src/config.js";
// Isolate persisted test records from the user's real trips and settings.
process.env.ROAM_TICKETS_DISABLED = "1";
fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "workflow-test-"),
);
const { runWorkflow } = await import("../src/workflow.js");
const { acceptProposalDecision, proposalSources, ProposalConflict } =
  await import("../src/proposals.js");
const { createJob, controllers } = await import("../src/store.js");
const { demoPlan, exampleRequest } = await import("../src/demo.js");
const { completion } = await import("../src/llm.js");
const { getMap } = await import("../src/maps.js");
const { publicConfig } = await import("../src/config.js");
const request = {
  ...exampleRequest(),
  mode: "live" as const,
  days: 2,
  budget: 700,
};
const fixture = demoPlan("mock", request);
fixture.days = fixture.days.slice(0, 2);
fixture.budget = [
  {
    category: "住宿",
    amount: 500,
    basis: "1间1晚的测试估算",
    status: "verified",
  },
  { category: "往返票务", amount: null, basis: "未知", status: "unknown" },
  {
    category: "餐饮",
    amount: 300,
    basis: "全体旅客测试估算",
    status: "estimate",
  },
];
fixture.days.forEach((d) => {
  d.weather = "模型编造晴天";
  d.stops.forEach((s) => {
    s.sourceIds = ["invented-id"];
    s.location = [1, 2];
    s.verified = true;
  });
});
let calls: any[] = [];
const mockServer = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  calls.push(data);
  const system = data.messages[0].content as string;
  if (data.model === "insufficient-balance") {
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "secret-value-must-not-be-reflected" }));
    return;
  }
  let message: any;
  let finishReason = "stop";
  if (system.includes("你是旅行提案规划师")) {
    const context = JSON.parse(data.messages[1].content);
    message = {
      role: "assistant",
      content: JSON.stringify(
        data.model === "bad-proposal"
          ? {}
          : {
              message: "请先选择旅行方向，也可以加入自己的想法。",
              options: ["经典人文", "轻松漫游"].map((title) => ({
                title,
                summary: "适合希望慢慢了解南京的旅客",
                highlights: ["人文与美食"],
                outline: Array.from(
                  { length: context.request.days },
                  (_, i) => ({
                    day: i + 1,
                    title: "城市漫游",
                    places: ["玄武湖"],
                  }),
                ),
                pace: "relaxed",
                costNote: "全程费用待专家核算",
                cautions: ["预约待核验"],
                sourceUrls: [
                  "https://travel.example/nanjing",
                  "https://invented.example/fake",
                  "javascript:alert(1)",
                ],
              })),
            },
      ),
    };
  } else if (system.includes("你是总规划师"))
    message = { role: "assistant", content: JSON.stringify(fixture) };
  else if (
    system.includes("id=budget") &&
    !data.messages.some((m: any) => m.role === "tool")
  ) {
    message = {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "budget-call",
          type: "function",
          function: {
            name: "calculate_budget",
            arguments: JSON.stringify({
              items: fixture.budget.map(({ category, amount }) => ({
                category,
                amount,
              })),
            }),
          },
        },
      ],
    };
  } else
    message = {
      role: "assistant",
      content: JSON.stringify({
        summary: "测试专家报告",
        findings: ["这是隔离测试结果"],
        warnings: [],
        messages: [
          {
            to: system.includes("id=route") ? "planner" : "route",
            content: system.includes("id=weather")
              ? "缺失天气的日期准备室内备选"
              : "请按预算调整路线",
          },
        ],
      }),
    };
  const proposalCall = system.includes("你是旅行提案规划师");
  const modelCalls = calls.filter(
    (c) => c.model === data.model && c.messages[0].content === system,
  ).length;
  if (proposalCall && data.model === "recover-fields") {
    const draft = JSON.parse(message.content);
    draft.message = null;
    for (const option of draft.options) {
      option.pace = "轻松";
      option.highlights = "人文与美食";
      option.cautions = null;
      option.costNote = null;
      for (const day of option.outline) {
        day.day = String(day.day);
        day.places = day.places[0];
      }
    }
    message.content = `以下是方案：\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``;
  }
  if (proposalCall && data.model === "recover-days" && modelCalls === 1) {
    const draft = JSON.parse(message.content);
    draft.options[0].outline.pop();
    message.content = JSON.stringify(draft);
  }
  if (proposalCall && data.model === "recover-field-path" && modelCalls === 1) {
    const draft = JSON.parse(message.content);
    delete draft.options[0].summary;
    message.content = JSON.stringify(draft);
  }
  if (proposalCall && data.model === "recover-length" && modelCalls === 1) {
    message.content = '{"message":"truncated';
    finishReason = "length";
  }
  if (proposalCall && data.model === "bad-json")
    message.content = "```json\n{broken";
  if (proposalCall && data.model === "empty-proposal") message.content = null;
  if (system.includes("你是总规划师") && data.model === "bad-plan")
    message.content = "{}";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ choices: [{ message, finish_reason: finishReason }] }),
  );
});
mockServer.listen(0, "127.0.0.1");
await once(mockServer, "listening");
const config: Config = {
  baseUrl: `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`,
  model: "mock-model",
  apiKey: "test-only-key",
  amapKey: "",
  unsplashKey: "",
  searchKey: "",
  mcpServers: [],
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith(config.baseUrl)) return originalFetch(input, init);
  if (url === "https://api.tavily.com/search")
    return Response.json({
      results: [
        {
          title: "南京经典旅行路线",
          url: "https://travel.example/nanjing",
          content: "玄武湖等经典景点，可按片区漫游。",
        },
      ],
    });
  if (url.startsWith("https://geocoding-api.open-meteo.com/"))
    return Response.json({
      results: [
        {
          name: "南京",
          country: "中国",
          country_code: "CN",
          latitude: 32.06,
          longitude: 118.79,
        },
      ],
    });
  if (url.startsWith("https://api.open-meteo.com/"))
    return Response.json({
      daily: {
        time: [request.startDate],
        weather_code: [2],
        temperature_2m_max: [23],
        temperature_2m_min: [14],
        precipitation_probability_max: [25],
      },
    });
  throw new Error("External network is disabled in workflow tests");
};
test.after(() => {
  globalThis.fetch = originalFetch;
  mockServer.closeAllConnections();
  mockServer.close();
});
test("live orchestration performs specialist calls, tools, two-way review and final synthesis", async () => {
  calls = [];
  const job = createJob(request);
  await runWorkflow(job, config);
  assert.equal(job.status, "awaiting_confirmation", job.error);
  assert.equal(job.plan, undefined);
  assert.ok(job.proposal);
  assert.ok(!controllers.has(job.id));
  assert.equal(
    calls.length,
    1,
    "only proposal synthesis runs before confirmation",
  );
  assert.ok(job.proposal.notices.some((n) => n.includes("未配置 Tavily")));
  assert.deepEqual(job.proposal.options[0].sourceUrls, []);
  assert.equal(
    job.proposal.evidence.filter((e) => e.tool === "search_web").length,
    2,
  );
  const paused = JSON.parse(
    fs.readFileSync(
      path.join(process.env.ROAM_DATA_DIR!, "trips", `${job.id}.json`),
      "utf8",
    ),
  );
  assert.equal(paused.status, "awaiting_confirmation");
  acceptProposalDecision(job, {
    proposalId: job.proposal.id,
    action: "confirm",
    optionId: "B",
    notes: "带父母少走路，不去商业街",
  });
  await runWorkflow(job, config);
  assert.equal(job.status, "complete", job.error);
  assert.ok(job.plan);
  assert.equal(job.plan.confirmedSelection?.option.id, "B");
  assert.equal(
    job.plan.confirmedSelection?.alternatives?.[0].id,
    "A",
    "preserve alternatives so requests to combine A and B remain interpretable",
  );
  assert.ok(
    calls
      .filter((c) => !c.messages[0].content.includes("你是旅行提案规划师"))
      .every((c) => c.messages[1].content.includes("带父母少走路，不去商业街")),
  );
  assert.equal(new Set(job.plan.reports.map((r) => r.agent)).size, 7);
  assert.equal(job.plan.reports.filter((r) => r.agent === "route").length, 2);
  assert.equal(job.plan.reports.filter((r) => r.agent === "weather").length, 2);
  assert.ok(calls.length >= 13);
  assert.ok(
    job.events.some(
      (e) => e.type === "message" && e.agent === "weather" && e.to === "route",
    ),
  );
  assert.ok(
    job.events.some(
      (e) => e.type === "message" && e.agent === "route" && e.to === "planner",
    ),
  );
  assert.ok(
    job.plan.evidence.some(
      (e) => e.tool === "calculate_budget" && e.status === "live",
    ),
  );
  assert.equal(job.plan.totalEstimate, 800);
  assert.equal(job.plan.unknownCosts, 1);
  assert.ok(job.plan.warnings.some((w) => w.includes("超过预算 ¥100")));
  assert.ok(job.plan.days[0].weather.includes("14–23"));
  assert.ok(job.plan.days[1].weather.includes("未取得有效预报"));
  assert.ok(job.plan.transport.outbound.includes("尚未取得实时票务"));
  assert.ok(
    job.plan.days.every((d) =>
      d.stops.every(
        (s) =>
          s.location === null &&
          !s.verified &&
          !s.sourceIds.includes("invented-id"),
      ),
    ),
  );
  assert.ok(job.plan.budget.every((b) => b.status !== "verified"));
  const routeCalls = calls.filter((c) =>
    c.messages[0].content.includes("id=route"),
  );
  assert.ok(
    routeCalls
      .at(-1)
      .messages[1].content.includes("缺失天气的日期准备室内备选"),
  );
  const saved = JSON.parse(
    fs.readFileSync(
      path.join(process.env.ROAM_DATA_DIR!, "trips", `${job.id}.json`),
      "utf8",
    ),
  );
  assert.equal(saved.status, "complete");
  const queryEvents = job.events.filter((e) => e.work?.kind === "query");
  const queryIds = new Set(queryEvents.map((e) => e.work!.id));
  assert.ok(
    queryIds.size >= 8,
    "proposal, seeded tools and budget calls expose query progress",
  );
  for (const id of queryIds) {
    const pair = queryEvents.filter((e) => e.work!.id === id);
    assert.equal(
      pair.length,
      2,
      "each query has a correlated start and finish",
    );
    assert.equal(pair[0].state, "running");
    assert.notEqual(pair[1].state, "running");
    assert.ok(pair[1].work?.summary);
  }
  assert.ok(queryEvents.some((e) => e.work?.query?.includes("南京")));
  assert.ok(queryEvents.some((e) => e.work?.outcome === "unconfigured"));
  assert.ok(
    job.events.some(
      (e) =>
        e.work?.kind === "analysis" &&
        e.work.findings?.includes("这是隔离测试结果"),
    ),
  );
  assert.ok(
    job.events.some(
      (e) =>
        e.agent === "planner" &&
        e.work?.warnings?.some((w) => w.includes("超过预算")),
    ),
  );
  const map = await getMap(job.plan, config, 1);
  assert.equal(map.kind, "unavailable");
});
test("revisions require a new explicit confirmation; stale and duplicate decisions cannot advance", async () => {
  calls = [];
  const job = createJob(request);
  await runWorkflow(job, { ...config, searchKey: "mock-search" });
  const first = job.proposal!.id;
  assert.deepEqual(job.proposal!.options[0].sourceUrls, [
    "https://travel.example/nanjing",
  ]);
  assert.throws(() =>
    acceptProposalDecision(job, {
      proposalId: first,
      action: "confirm",
      notes: "",
    }),
  );
  assert.throws(() =>
    acceptProposalDecision(job, {
      proposalId: first,
      action: "revise",
      notes: "  ",
    }),
  );
  assert.throws(
    () =>
      acceptProposalDecision(job, {
        proposalId: first,
        action: "confirm",
        optionId: "C",
        notes: "",
      }),
    ProposalConflict,
  );
  assert.equal(job.status, "awaiting_confirmation");
  acceptProposalDecision(job, {
    proposalId: first,
    action: "revise",
    optionId: "A",
    notes: "加上博物馆，不去商业街",
  });
  assert.throws(
    () =>
      acceptProposalDecision(job, {
        proposalId: first,
        action: "confirm",
        optionId: "A",
        notes: "",
      }),
    ProposalConflict,
  );
  await runWorkflow(job, config);
  assert.equal(job.status, "awaiting_confirmation");
  assert.equal(job.confirmedSelection, undefined);
  assert.equal(job.plan, undefined);
  assert.equal(job.proposal!.version, 2);
  assert.notEqual(job.proposal!.id, first);
  assert.ok(
    calls.at(-1).messages[1].content.includes("加上博物馆，不去商业街"),
  );
  assert.ok(
    calls.every((c) => c.messages[0].content.includes("你是旅行提案规划师")),
  );
  assert.throws(
    () =>
      acceptProposalDecision(job, {
        proposalId: first,
        action: "confirm",
        optionId: "A",
        notes: "",
      }),
    ProposalConflict,
  );
  const second = job.proposal!.id;
  acceptProposalDecision(job, {
    proposalId: second,
    action: "confirm",
    optionId: "B",
    notes: "博物馆安排在下午",
  });
  assert.deepEqual(job.confirmedSelection!.notes, [
    "加上博物馆，不去商业街",
    "博物馆安排在下午",
  ]);
  assert.throws(
    () =>
      acceptProposalDecision(job, {
        proposalId: second,
        action: "confirm",
        optionId: "B",
        notes: "",
      }),
    ProposalConflict,
  );
});
test("unusable proposal revision retains previous options and feedback without terminal error or silent confirmation", async () => {
  const job = createJob(request);
  await runWorkflow(job, config);
  const first = job.proposal!.id;
  acceptProposalDecision(job, {
    proposalId: first,
    action: "revise",
    notes: "希望增加公园",
  });
  await runWorkflow(job, { ...config, model: "bad-proposal" });
  assert.equal(job.status, "awaiting_confirmation");
  assert.equal(job.proposal!.id, first);
  assert.equal(job.proposalFeedback![0].notes, "希望增加公园");
  assert.equal(job.confirmedSelection, undefined);
  assert.equal(job.error, undefined);
  assert.ok(job.proposal!.notices.some((n) => n.includes("保留上一版")));
  assert.ok(!job.events.some((e) => e.type === "error"));
  assert.ok(!controllers.has(job.id));
});

test("proposal formatting is normalized locally, including fenced JSON and nullable optional fields", async () => {
  calls = [];
  const job = createJob(request);
  await runWorkflow(job, { ...config, model: "recover-fields" });
  assert.equal(job.status, "awaiting_confirmation", job.error);
  assert.equal(
    calls.length,
    1,
    "no extra paid request for safely fixable fields",
  );
  assert.equal(job.proposal!.options[0].pace, "relaxed");
  assert.deepEqual(
    job.proposal!.options[0].outline.map((d) => d.day),
    [1, 2],
  );
  assert.deepEqual(job.proposal!.options[0].outline[0].places, ["玄武湖"]);
  assert.equal(job.error, undefined);
});

test("proposal repairs receive exact day/field feedback; truncated answers increase the output allowance", async () => {
  for (const model of [
    "recover-days",
    "recover-field-path",
    "recover-length",
  ]) {
    calls = [];
    const job = createJob(request);
    await runWorkflow(job, { ...config, model });
    assert.equal(job.status, "awaiting_confirmation", job.error);
    assert.equal(calls.length, 2);
    assert.equal(job.error, undefined);
    assert.ok(job.events.some((e) => e.message.includes("自动整理")));
    const correction = calls[1].messages.at(-1).content;
    assert.match(
      correction,
      model === "recover-days"
        ? /outline.*2 天/
        : model === "recover-field-path"
          ? /options\.0\.summary/
          : /截断/,
    );
    assert.ok(calls[1].max_tokens > calls[0].max_tokens);
  }
});

test("repeated invalid or empty answers yield honest selectable directions for 1 and 14 days", async () => {
  for (const [model, days] of [
    ["bad-proposal", 14],
    ["bad-json", 1],
    ["empty-proposal", 4],
  ] as const) {
    calls = [];
    const job = createJob({
      ...request,
      days,
      notes: "带老人，少走路",
      preferences: ["", "  ", ...request.preferences],
    });
    await runWorkflow(job, { ...config, model, searchKey: "mock-search" });
    assert.equal(job.status, "awaiting_confirmation", job.error);
    assert.equal(job.error, undefined);
    assert.equal(calls.length, 3, "repairs are bounded");
    assert.ok(
      calls.every((c) =>
        c.messages.every(
          (m: any) =>
            m.role !== "assistant" ||
            (typeof m.content === "string" && m.content.trim()),
        ),
      ),
      "empty model replies must not produce invalid repair requests",
    );
    assert.equal(job.confirmedSelection, undefined);
    assert.equal(job.plan, undefined);
    assert.ok(job.proposal!.sources.length > 0, "keep actual search results");
    assert.ok(job.proposal!.notices.some((n) => n.includes("基础规划方向")));
    assert.ok(!job.events.some((e) => e.type === "error"));
    for (const option of job.proposal!.options) {
      assert.equal(option.outline.length, days);
      assert.deepEqual(
        option.sourceUrls,
        [],
        "do not claim sources support fallback directions",
      );
      assert.match(option.costNote, /待核算/);
    }
    acceptProposalDecision(job, {
      proposalId: job.proposal!.id,
      action: "confirm",
      optionId: "B",
      notes: "不要太赶",
    });
    assert.equal(job.confirmedSelection!.option.id, "B");
    assert.equal(job.confirmedSelection!.notes[0], "不要太赶");
  }
});

test("final formatting failure preserves confirmed direction, expert reports and evidence as an explicit draft", async () => {
  calls = [];
  const job = createJob(request);
  await runWorkflow(job, config);
  const chosen = job.proposal!.options[0];
  acceptProposalDecision(job, {
    proposalId: job.proposal!.id,
    action: "confirm",
    optionId: "A",
    notes: "少走路",
  });
  await runWorkflow(job, { ...config, model: "bad-plan" });
  assert.equal(job.status, "complete", job.error);
  assert.equal(job.error, undefined);
  assert.match(job.plan!.title, /待完善草案/);
  assert.ok(job.plan!.warnings.some((w) => w.includes("当前为待完善草案")));
  assert.equal(job.plan!.days.length, request.days);
  assert.deepEqual(
    job.plan!.days[0].stops.map((s) => s.name),
    chosen.outline[0].places,
  );
  assert.ok(job.plan!.reports.length > 0);
  assert.ok(job.plan!.evidence.length > 0);
  assert.ok(
    job.plan!.budget.every((b) => b.amount === null && b.status === "unknown"),
  );
  assert.ok(
    job.plan!.days.every((d) =>
      d.stops.every((s) => s.time === "待安排" && !s.verified),
    ),
  );
  assert.equal(
    calls.filter(
      (c) =>
        c.model === "bad-plan" &&
        c.messages[0].content.includes("你是总规划师"),
    ).length,
    3,
  );
});

test("provider failures produce usable directions with honest notices; explicit cancellation still stops", async () => {
  const failed = createJob(request);
  await runWorkflow(failed, { ...config, model: "insufficient-balance" });
  assert.equal(failed.status, "awaiting_confirmation");
  assert.equal(failed.error, undefined);
  assert.ok(failed.proposal!.notices.some((n) => /账户余额不足/.test(n)));
  assert.ok(!JSON.stringify(failed.proposal).includes("secret-value"));
  const { bus } = await import("../src/store.js");
  const job = createJob(request);
  const stop = (event: any) => {
    if (event.message.includes("自动整理")) controllers.get(job.id)?.abort();
  };
  bus.on(job.id, stop);
  try {
    await runWorkflow(job, { ...config, model: "bad-proposal" });
  } finally {
    bus.off(job.id, stop);
  }
  assert.equal(job.status, "cancelled");
  assert.equal(job.proposal, undefined);
  assert.ok(!job.events.some((e) => e.type === "proposal"));
});

test("even if every specialist and final model call fails, confirmed travel still produces a viewable draft", async () => {
  const job = createJob(request);
  await runWorkflow(job, config);
  acceptProposalDecision(job, {
    proposalId: job.proposal!.id,
    action: "confirm",
    optionId: "B",
    notes: "少走路",
  });
  await runWorkflow(job, { ...config, model: "insufficient-balance" });
  assert.equal(job.status, "complete", job.error);
  assert.equal(job.error, undefined);
  assert.equal(job.plan!.days.length, request.days);
  assert.equal(job.plan!.confirmedSelection!.option.id, "B");
  assert.ok(job.plan!.warnings.some((w) => w.includes("账户余额不足")));
  assert.ok(job.plan!.budget.every((b) => b.amount === null));
});

test("a restart resumes completed expert stages and raw evidence instead of repeating their model calls", async () => {
  const { RESTART_REASON } = await import("../src/workflow-checkpoint.js");
  const { publicJob, bus } = await import("../src/store.js");
  const job = createJob(request);
  await runWorkflow(job, config);
  acceptProposalDecision(job, {
    proposalId: job.proposal!.id,
    action: "confirm",
    optionId: "A",
    notes: "少走路",
  });
  const stop = (event: any) => {
    if (event.message === "正在根据天气与预算审阅意见修订路线")
      controllers.get(job.id)?.abort(RESTART_REASON);
  };
  bus.on(job.id, stop);
  try {
    await runWorkflow(job, config);
  } finally {
    bus.off(job.id, stop);
  }
  assert.equal(job.status, "running");
  assert.equal(job.error, undefined);
  const saved = JSON.parse(
    fs.readFileSync(
      path.join(process.env.ROAM_DATA_DIR!, "trips", `${job.id}.json`),
      "utf8",
    ),
  );
  assert.equal(saved.status, "running");
  assert.equal(Object.keys(saved.workflow.reports).length, 9);
  assert.ok(saved.workflow.evidence.length > 2);
  assert.ok(
    !("workflow" in publicJob(job)),
    "checkpoint must not inflate public responses",
  );
  const ids = saved.workflow.evidence.map((e: any) => e.id);
  calls = [];
  await runWorkflow(saved, config);
  assert.equal(saved.status, "complete", saved.error);
  assert.equal(
    calls.length,
    2,
    "only remaining route review and final synthesis run",
  );
  assert.ok(calls[0].messages[0].content.includes("id=route"));
  assert.ok(
    ids.every((id: string) =>
      saved.plan.evidence.some((e: any) => e.id === id),
    ),
  );
});

test("a saved final plan resumes asset preparation without any more model calls", async () => {
  const { RESTART_REASON } = await import("../src/workflow-checkpoint.js");
  const { bus } = await import("../src/store.js");
  const job = createJob(request);
  await runWorkflow(job, config);
  acceptProposalDecision(job, {
    proposalId: job.proposal!.id,
    action: "confirm",
    optionId: "A",
    notes: "",
  });
  const stop = (event: any) => {
    if (event.message.includes("正在使用专家检索的 POI"))
      controllers.get(job.id)?.abort(RESTART_REASON);
  };
  bus.on(job.id, stop);
  try {
    await runWorkflow(job, config);
  } finally {
    bus.off(job.id, stop);
  }
  assert.equal(job.status, "running");
  assert.ok(job.plan);
  calls = [];
  await runWorkflow(job, config);
  assert.equal(job.status, "complete", job.error);
  assert.equal(calls.length, 0);
  assert.ok(job.plan.assets);
});
test("proposal sources reject failed evidence and unsafe or malformed links", () => {
  const evidence = {
    id: "source",
    tool: "search_web",
    source: "test",
    status: "live" as const,
    queriedAt: "now",
    data: [
      { url: "https://travel.example/guide", title: "有效攻略" },
      { url: "javascript:alert(1)" },
      { url: "not a url" },
      { url: "https://user:pass@travel.example/" },
    ],
  };
  assert.equal(proposalSources([evidence]).length, 1);
  assert.deepEqual(proposalSources([{ ...evidence, status: "error" }]), []);
});
test("model 402 is actionable and does not expose provider response or API key", async () => {
  await assert.rejects(
    completion({ ...config, model: "insufficient-balance" }, [
      { role: "user", content: "ping" },
    ]),
    (e) => {
      assert.ok(e instanceof Error);
      assert.match(e.message, /账户余额不足/);
      assert.ok(!e.message.includes("test-only-key"));
      assert.ok(!e.message.includes("secret-value"));
      return true;
    },
  );
  const publicValues = JSON.stringify(publicConfig());
  assert.ok(!publicValues.includes("apiKey"));
  assert.ok(!publicValues.includes("sk-"));
});
test("cancel stops a running workflow and never emits completion", async () => {
  const job = createJob({ ...exampleRequest(), mode: "demo" });
  const pending = runWorkflow(job, config);
  controllers.get(job.id)?.abort();
  await pending;
  assert.equal(job.status, "cancelled");
  assert.equal(job.plan, undefined);
  assert.ok(!job.events.some((e) => e.type === "complete"));
  assert.ok(!controllers.has(job.id));
});

test("a new live workflow completes with photos and every daily map already generated, without UI repair", async (t) => {
  const baseFetch = globalThis.fetch;
  let staticRequests = 0,
    placeRequests = 0;
  const pois = fixture.days
    .flatMap((d) => d.stops)
    .map((s, i) => ({
      id: `BTEST${i}`,
      name: s.name,
      address: "南京市测试地址",
      cityname: "南京市",
      adcode: "320102",
      typecode: s.type === "food" ? "050000" : "110000",
      location: `${118.78 + i * 0.001},32.06`,
      photos: [{ url: `https://store.is.autonavi.com/showpic/test-${i}` }],
    }));
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "restapi.amap.com") return baseFetch(input, init);
    if (url.pathname.endsWith("/geocode/geo"))
      return Response.json({
        status: "1",
        geocodes: [{ city: "南京市", adcode: "320100" }],
      });
    if (url.pathname.endsWith("/place/text")) {
      placeRequests++;
      return Response.json({ status: "1", pois });
    }
    if (url.pathname.endsWith("/place/detail"))
      return Response.json({
        status: "1",
        pois: pois.map((p) => ({
          ...p,
          biz_ext: { open_time: "09:00-22:00", opentime2: "每天09:00-22:00" },
        })),
      });
    if (url.pathname.includes("/direction/"))
      return Response.json({
        status: "1",
        route: { paths: [{ duration: "600", distance: "500" }] },
      });
    if (url.pathname.endsWith("/staticmap")) {
      staticRequests++;
      return new Response(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=",
          "base64",
        ),
        { headers: { "content-type": "image/png;charset=UTF-8" } },
      );
    }
    throw Error("Unexpected Amap endpoint");
  });
  const live = { ...config, amapKey: "workflow-assets-test-key" };
  const job = createJob(request);
  await runWorkflow(job, live);
  assert.equal(job.status, "awaiting_confirmation");
  acceptProposalDecision(job, {
    proposalId: job.proposal!.id,
    action: "confirm",
    optionId: "A",
    notes: "",
  });
  await runWorkflow(job, live);
  assert.equal(job.status, "complete", job.error);
  const plan = job.plan!;
  assert.equal(plan.assets?.status, "ready");
  assert.equal(plan.assets?.maps.length, request.days + 1);
  for (const day of plan.days) {
    assert.ok(
      day.check,
      "new plans include time and traffic checks before completion",
    );
    assert.equal(day.check.queriedLegs, day.stops.length - 1);
    assert.ok(
      day.stops.every(
        (s) =>
          s.facts?.location.status === "verified" &&
          s.facts?.price.status !== "verified" &&
          s.facts?.opening.status === "verified" &&
          s.facts?.reservation.status === "unknown",
      ),
    );
  }
  assert.equal(
    staticRequests,
    request.days + 1,
    "all daily maps and overview prepared before completion",
  );
  assert.equal(
    placeRequests,
    3,
    "reuse the three specialist POI searches, no post-generation name searches",
  );
  assert.ok(
    plan.days
      .flatMap((d) => d.stops)
      .every(
        (s) =>
          s.poiId &&
          s.verified &&
          s.location?.[0] !== 1 &&
          s.photo?.source === "amap-poi",
      ),
  );
  const done = job.events.findIndex((e) => e.type === "complete");
  assert.ok(
    job.events.slice(0, done).some((e) => e.message.includes("生成检查完成")),
  );
  const saved = JSON.parse(
    fs.readFileSync(
      path.join(process.env.ROAM_DATA_DIR!, "trips", `${job.id}.json`),
      "utf8",
    ),
  );
  assert.equal(saved.plan.assets.status, "ready");
  assert.equal(
    saved.plan.costs.version,
    1,
    "generation includes structured costs before completion",
  );
  assert.ok(
    saved.plan.days[0].check.issues.some(
      (i: { code: string }) => i.code === "arrival_missing",
    ),
    "unconfirmed ticket time cannot pass silently",
  );
  const { browserMapData } = await import("../src/browser-map.js");
  for (const day of saved.plan.days) {
    const interactive = browserMapData(
      saved.plan,
      { ...live, amapJsKey: "browser-map-test" },
      day.day,
    );
    assert.equal(
      interactive.points.length,
      day.stops.length,
      "freshly generated plans already have every interactive marker",
    );
    assert.deepEqual(
      interactive.points.map((p) => p.index),
      day.stops.map((_: unknown, i: number) => i + 1),
    );
  }
  assert.ok(
    fs.readdirSync(path.join(process.env.ROAM_DATA_DIR!, "maps")).length >=
      request.days + 1,
  );
  for (const day of plan.days)
    assert.equal((await getMap(plan, live, day.day)).kind, "amap");
  assert.equal(
    staticRequests,
    request.days + 1,
    "opening generated maps only reads prepared assets",
  );
});

test("cancelling map preparation cannot emit a completed itinerary", async (t) => {
  const { preparePlanAssets } = await import("../src/plan-assets.js");
  const plan = demoPlan("cancel-preparation");
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    return new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
      headers: { "content-type": "image/png" },
    });
  });
  await assert.rejects(
    preparePlanAssets(
      plan,
      { ...config, amapKey: "cancel-map-test-key" },
      { signal: controller.signal },
    ),
  );
  assert.equal(plan.assets, undefined);
});
