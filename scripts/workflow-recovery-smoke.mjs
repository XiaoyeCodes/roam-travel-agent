// Isolated API process restart, queue and cancellation regression. No live keys or network.
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { demoPlan, exampleRequest } from "../server/src/demo.ts";

fs.mkdirSync("tmp", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("tmp", "workflow-recovery-"));
const calls = [];
let hold = "route-review",
  release = [];
const mock = http.createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const data = JSON.parse(body),
    system = data.messages[0].content;
  const context = JSON.parse(data.messages[1].content);
  const kind = system.includes("你是旅行提案规划师")
    ? "proposal"
    : system.includes("你是总规划师")
      ? "final"
      : system.includes("id=route") && context.extra
        ? "route-review"
        : `${system.match(/id=(\w+)/)?.[1]}:${context.extra ? "review" : "research"}`;
  calls.push(kind);
  if (hold === kind) await new Promise((resolve) => release.push(resolve));
  const result =
    kind === "proposal"
      ? {
          message: "比较旅行方向后确认",
          options: ["人文路线", "轻松路线"].map((title) => ({
            title,
            summary: "隔离测试方案",
            highlights: ["城市漫游"],
            pace: "relaxed",
            outline: Array.from({ length: context.request.days }, (_, i) => ({
              day: i + 1,
              title: "城市漫游",
              places: ["玄武湖"],
            })),
            costNote: "费用待核算",
            cautions: [],
            sourceUrls: [],
          })),
        }
      : kind === "final"
        ? {
            ...demoPlan("fixture", context.request),
            days: demoPlan("fixture", context.request).days.slice(
              0,
              context.request.days,
            ),
          }
        : {
            summary: "专家阶段已完成",
            findings: ["保留湖畔散步与休息"],
            warnings: [],
            messages: [],
          };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: { role: "assistant", content: JSON.stringify(result) },
          finish_reason: "stop",
        },
      ],
    }),
  );
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
const reservation = http.createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`,
  model = `http://127.0.0.1:${mock.address().port}`;
let server;
const bootstrap = `
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith(process.env.LLM_BASE_URL)) return original(input, init);
  if (url === 'https://api.tavily.com/search') return Response.json({ results: [{ title: '隔离攻略', url: 'https://travel.example/guide', content: '城市漫游参考' }] });
  if (url.startsWith('https://geocoding-api.open-meteo.com/')) return Response.json({ results: [] });
  throw new Error('External network disabled in recovery test');
};
process.on('message', m => { if (m === 'graceful-stop') process.emit('SIGTERM'); });
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
        LLM_BASE_URL: model,
        LLM_MODEL: "fixture",
        LLM_API_KEY: "test-key",
        AMAP_KEY: "",
        UNSPLASH_ACCESS_KEY: "",
        TAVILY_API_KEY: "test-search",
        MCP_SERVERS_JSON: "[]",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`API startup timeout: ${output}`)),
      15000,
    );
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Roam API ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`API exited ${code}: ${output}`));
    });
  });
}
async function stop(graceful = false) {
  if (!server || server.exitCode !== null || server.signalCode) return;
  const exited = once(server, "exit");
  if (graceful) server.send("graceful-stop");
  else server.kill("SIGKILL");
  await exited;
}
async function until(read, accept, label) {
  const deadline = Date.now() + 20000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function post(url, body = {}) {
  const response = await fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
const read = (id) => fetch(`${base}/api/trips/${id}`).then((r) => r.json());
const persisted = (id) =>
  JSON.parse(
    fs.readFileSync(path.join(directory, "trips", `${id}.json`), "utf8"),
  );
function unblock() {
  hold = "";
  for (const resolve of release) resolve();
  release = [];
}
try {
  await start();
  const request = { ...exampleRequest(), days: 2, mode: "live" };
  const { id } = await post("/api/trips", request);
  const proposal = await until(
    () => read(id),
    (j) => j.status === "awaiting_confirmation",
    "proposal",
  );
  await post(`/api/trips/${id}/decision`, {
    proposalId: proposal.proposal.id,
    action: "confirm",
    optionId: "A",
    notes: "少走路",
  });
  await until(
    async () => calls,
    (c) => c.includes("route-review"),
    "route review in flight",
  );
  const before = persisted(id);
  assert.equal(Object.keys(before.workflow.reports).length, 9);
  const evidenceIds = before.workflow.evidence.map((e) => e.id);
  assert.ok(evidenceIds.length > 2);
  await stop(true);
  assert.equal(
    persisted(id).status,
    "running",
    "shutdown is resumable, never cancelled",
  );
  unblock();
  const callCount = calls.length;
  await start();
  const completed = await until(
    () => read(id),
    (j) => j.status === "complete",
    "resumed complete",
  );
  assert.deepEqual(calls.slice(callCount), ["route-review", "final"]);
  assert.equal(completed.plan.days.length, 2);
  assert.ok(
    evidenceIds.every((id) => completed.plan.evidence.some((e) => e.id === id)),
  );
  assert.equal(completed.error, undefined);
  assert.ok(!("workflow" in completed));

  hold = "proposal";
  const pending = [];
  for (let i = 0; i < 4; i++)
    pending.push((await post("/api/trips", request)).id);
  await until(
    async () => persisted(pending[3]),
    (j) => j.events.some((e) => e.message.includes("排队")),
    "fourth job queued",
  );
  await post(`/api/trips/${pending[3]}/cancel`);
  assert.equal(persisted(pending[3]).status, "cancelled");
  await stop(); // Unclean crash while three proposal requests are in flight.
  unblock();
  await start();
  for (const jobId of pending.slice(0, 3)) {
    const job = await until(
      () => read(jobId),
      (j) => j.status === "awaiting_confirmation",
      "crash recovery",
    );
    assert.equal(job.error, undefined);
  }
  assert.equal(
    (await read(pending[3])).status,
    "cancelled",
    "explicitly cancelled queue item must never restart",
  );
  assert.equal((await read(id)).status, "complete");
  console.log(
    JSON.stringify({
      passed: true,
      gracefulRestart: true,
      crashRecovery: true,
      completedStagesNotRepeated: true,
      evidencePreserved: true,
      queuedInsteadOfRejected: true,
      explicitCancelPreserved: true,
    }),
  );
} finally {
  unblock();
  await stop();
  mock.closeAllConnections();
  mock.close();
}
