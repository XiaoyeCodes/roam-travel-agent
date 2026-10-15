import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Config } from "../src/config.js";
// Isolate persisted test records from the user's real trips and settings.
fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "workflow-test-"),
);
const { runWorkflow } = await import("../src/workflow.js");
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
  if (system.includes("你是总规划师"))
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
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
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
  assert.equal(job.status, "complete", job.error);
  assert.ok(job.plan);
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
  const map = await getMap(job.plan, config, 1);
  assert.equal(map.kind, "unavailable");
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
