// Isolated API + browser test. All model/search/weather responses are fixtures.
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { browserExecutable } from "../server/src/pdf.ts";
import { demoPlan, exampleRequest } from "../server/src/demo.ts";

fs.mkdirSync("tmp", { recursive: true });
fs.mkdirSync("output/qa", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("tmp", "confirmation-smoke-"));
const calls = [];
const mock = http.createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const data = JSON.parse(body);
  calls.push(data);
  const system = data.messages[0].content;
  const context = JSON.parse(data.messages[1].content);
  let result;
  if (system.includes("你是旅行提案规划师")) {
    result = {
      message: context.feedback.length
        ? "已加入博物馆和少走路的想法，请看看新版方向，再确认喜欢的一条。"
        : "先比较经典人文与轻松漫游，也可以把喜欢的部分组合起来。",
      options: ["金陵经典 · 人文与秦淮", "湖畔慢游 · 街巷与美食"].map(
        (title, i) => ({
          title,
          summary: i
            ? "步调更松，留时间逛街巷和尝当地小吃，适合带父母出行。"
            : "把南京经典的人文景点串起来，适合第一次来南京的旅客。",
          highlights: i
            ? ["湖边散步", "当地小吃", "留白休息"]
            : ["历史人文", "博物馆", "秦淮夜色"],
          outline: Array.from({ length: context.request.days }, (_, n) => ({
            day: n + 1,
            title: ["初见金陵", "读懂一座城", "湖畔慢时光"][n % 3],
            places: i ? ["玄武湖", "老门东"] : ["南京博物院", "夫子庙"],
          })),
          pace: i ? "relaxed" : "balanced",
          costNote: "全体旅客全程参考 3,000–3,500 元，交通和住宿待进一步核算。",
          cautions: ["博物馆需提前预约，开放日期待核验"],
          sourceUrls: ["https://travel.example/nanjing"],
        }),
      ),
    };
  } else if (system.includes("你是总规划师"))
    result = demoPlan("fixture", context.request);
  else
    result = {
      summary: "根据已确认的方向研究",
      findings: ["保留博物馆与休息时间"],
      warnings: [],
      messages: [],
    };
  // Leave enough time for the UI to observe the running state.
  await new Promise((resolve) => setTimeout(resolve, 80));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        { message: { role: "assistant", content: JSON.stringify(result) } },
      ],
    }),
  );
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const modelUrl = `http://127.0.0.1:${mock.address().port}`;
const portReservation = http.createServer();
portReservation.listen(0, "127.0.0.1");
await once(portReservation, "listening");
const port = portReservation.address().port;
await new Promise((resolve) => portReservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
const bootstrap = `
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith(process.env.LLM_BASE_URL)) return original(input, init);
  if (url === 'https://api.tavily.com/search') return Response.json({ results: [{ title: '南京经典路线参考（测试数据）', url: 'https://travel.example/nanjing', content: '玄武湖、南京博物院和秦淮片区。' }] });
  if (url.startsWith('https://geocoding-api.open-meteo.com/')) return Response.json({ results: [] });
  throw new Error('External network disabled in confirmation smoke');
};
await import('./server/src/index.ts');
`;
async function start() {
  server = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", bootstrap],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        ROAM_DATA_DIR: directory,
        ROAM_TICKETS_DISABLED: "1",
        APP_ACCESS_TOKEN: "",
        LLM_BASE_URL: modelUrl,
        LLM_MODEL: "fixture",
        LLM_API_KEY: "test-key",
        AMAP_KEY: "",
        UNSPLASH_ACCESS_KEY: "",
        TAVILY_API_KEY: "test-search",
        MCP_SERVERS_JSON: "[]",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("API startup timeout")),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Roam API ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API exited ${code}`));
    });
  });
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.kill();
  await exited;
}
const post = (url, body) =>
  fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const get = async (id) => (await fetch(`${base}/api/trips/${id}`)).json();
async function settled(id) {
  const stream = await (await fetch(`${base}/api/trips/${id}/events`)).text();
  return { stream, job: await get(id) };
}
try {
  await start();
  const request = { ...exampleRequest(), mode: "live" };
  const created = await (await post("/api/trips", request)).json();
  const initial = await settled(created.id);
  assert.equal(initial.job.status, "awaiting_confirmation");
  assert.ok(initial.stream.includes('"type":"proposal"'));
  assert.ok(!initial.stream.includes('"type":"complete"'));
  assert.equal(calls.length, 1);
  const proposalId = initial.job.proposal.id;
  assert.equal(
    (
      await post(`/api/trips/${created.id}/decision`, {
        proposalId,
        action: "confirm",
      })
    ).status,
    400,
  );
  // Restart the real API against the saved proposal before making a decision.
  await stop();
  await start();
  assert.equal((await get(created.id)).proposal.id, proposalId);
  assert.equal((await get(created.id)).status, "awaiting_confirmation");

  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await page.goto(base);
  await page.evaluate(
    (id) => localStorage.setItem("roam-active-id", id),
    created.id,
  );
  await page.reload();
  await page
    .getByRole("heading", { name: "先选一个方向，再安排每一天。" })
    .waitFor();
  const confirm = page.getByRole("button", { name: /确认.*生成详细行程/ });
  assert.ok(await confirm.isDisabled());
  await page.getByRole("button", { name: "选择方案 A", exact: true }).click();
  assert.equal(
    (await get(created.id)).status,
    "awaiting_confirmation",
    "selection alone cannot confirm",
  );
  await page
    .getByRole("textbox", { name: /补充想法/ })
    .fill("加上博物馆，带父母少走路");
  await page.screenshot({
    path: "output/qa/confirmation-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "按我的想法调整方案", exact: true })
    .click();
  await page.getByText("第 2 版 · 等待你确认", { exact: true }).waitFor();
  const revised = await get(created.id);
  assert.equal(revised.status, "awaiting_confirmation");
  assert.equal(revised.plan, undefined);
  assert.equal(
    (
      await post(`/api/trips/${created.id}/decision`, {
        proposalId,
        action: "confirm",
        optionId: "A",
      })
    ).status,
    409,
  );
  await page.reload();
  await page.getByText("第 2 版 · 等待你确认", { exact: true }).waitFor();
  assert.equal(
    (await get(created.id)).proposalFeedback[0].notes,
    "加上博物馆，带父母少走路",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/qa/confirmation-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "mobile page must not overflow",
  );
  await page.getByRole("button", { name: "选择方案 B", exact: true }).click();
  await page.getByRole("textbox", { name: /补充想法/ }).fill("早上不要太赶");
  await confirm.click();
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor({ timeout: 20000 });
  const complete = await get(created.id);
  assert.equal(complete.status, "complete");
  assert.equal(complete.plan.confirmedSelection.option.id, "B");
  assert.deepEqual(complete.plan.confirmedSelection.notes, [
    "加上博物馆，带父母少走路",
    "早上不要太赶",
  ]);
  assert.ok(
    calls
      .filter((c) => !c.messages[0].content.includes("你是旅行提案规划师"))
      .every((c) => c.messages[1].content.includes("早上不要太赶")),
  );
  assert.equal(
    (
      await post(`/api/trips/${created.id}/decision`, {
        proposalId: revised.proposal.id,
        action: "confirm",
        optionId: "B",
      })
    ).status,
    409,
  );

  const cancelled = await (await post("/api/trips", request)).json();
  await settled(cancelled.id);
  await post(`/api/trips/${cancelled.id}/cancel`, {});
  assert.equal((await get(cancelled.id)).status, "cancelled");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: proposal SSE, explicit confirmation, revision, stale/duplicate rejection, restart/refresh recovery, pending cancellation, desktop/mobile UI and expert context. No external services called.",
  );
} finally {
  if (browser) await browser.close();
  await stop();
  mock.closeAllConnections();
  mock.close();
}
