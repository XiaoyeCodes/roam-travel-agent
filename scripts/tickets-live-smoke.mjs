// Explicit opt-in real-network verification. Does not call an LLM or purchase tickets.
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { browserExecutable } from "../server/dist/server/src/pdf.js";

fs.mkdirSync("tmp", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("tmp", "tickets-live-"));
const port = 8796,
  base = `http://127.0.0.1:${port}`;
const output = path.resolve("output", "qa");
fs.mkdirSync(output, { recursive: true });
const date = new Date(Date.now() + 7 * 86400000 + 8 * 3600000)
  .toISOString()
  .slice(0, 10);
let server, browser;
function start() {
  server = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "process.on('message',()=>process.emit('SIGTERM')); await import('./server/dist/server/src/index.js');",
    ],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        ROAM_DATA_DIR: directory,
        APP_ACCESS_TOKEN: "",
        ROAM_TICKETS_DISABLED: "0",
        LLM_API_KEY: "",
        AMAP_KEY: "",
        UNSPLASH_ACCESS_KEY: "",
        TAVILY_API_KEY: "",
      },
    },
  );
  server.stderr.on("data", (data) => process.stderr.write(data));
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, "exit");
  server.send("stop");
  await exited;
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null)
      throw new Error(`Server exited: ${server.exitCode}`);
    const state = await fetch(`${base}/api/tickets/status`)
      .then((r) => r.json())
      .catch(() => null);
    if (state?.rail.state === "error" || state?.flight.state === "error")
      throw new Error(JSON.stringify(state));
    if (state?.rail.state === "ready" && state?.flight.state === "ready")
      return state;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Automatic service initialization timed out");
}
async function query(kind, args) {
  const response = await fetch(`${base}/api/tickets/${kind}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, date, passengers: 1, limit: 5 }),
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "live", JSON.stringify(result));
  assert.ok(result.data.results.length > 0, `${kind} returned no results`);
  assert.ok(
    result.data.results.some((r) => r.price > 0),
    `${kind} returned no priced results`,
  );
  return result;
}
try {
  start();
  const coldStart = await ready();
  console.log(
    "PASS cold start: 12306 started and isolated Python dependencies installed automatically",
  );
  const rail = await query("rail", { origin: "上海", destination: "南京" });
  console.log(`PASS real rail query: ${rail.data.count} trains`);
  const flight = await query("flight", { origin: "SHA", destination: "PEK" });
  console.log(`PASS real flight query: ${flight.data.count} flights`);
  const cached = await query("flight", { origin: "SHA", destination: "PEK" });
  assert.equal(cached.data.queriedAt, flight.data.queriedAt);
  const cityFlight = await query("flight", {
    origin: "上海",
    destination: "北京",
  });
  console.log(
    `PASS city airport mapping: ${cityFlight.data.count} flights, ${cityFlight.data.urls.length} airport pairs returned`,
  );
  const invalid = await fetch(`${base}/api/tickets/rail/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin: "上海",
      destination: "南京",
      date: "2026-02-30",
    }),
  });
  assert.equal(invalid.status, 400);
  const venvConfig = path.join(directory, "travel-venv", "pyvenv.cfg");
  const before = fs.statSync(venvConfig).mtimeMs;
  await stop();
  start();
  const warmStart = await ready();
  assert.equal(fs.statSync(venvConfig).mtimeMs, before);
  const railAfterRestart = await query("rail", {
    origin: "上海",
    destination: "南京",
  });
  console.log(
    "PASS restart: same Python environment reused and railway service restarted automatically",
  );
  const flightAfterRestart = await query("flight", {
    origin: "SHA",
    destination: "PEK",
  });
  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "模型与工具", exact: true }).click();
  await page.getByRole("button", { name: "MCP 服务", exact: true }).click();
  const section = page.getByRole("region", { name: "免费高铁与机票查询" });
  await section.getByLabel("出发地").fill("上海");
  await section.getByLabel("到达地").fill("南京");
  await section.getByLabel("出发日期").fill(date);
  await section.getByRole("button", { name: "实查高铁", exact: true }).click();
  await section.locator(".ticket-option").first().waitFor({ timeout: 90000 });
  assert.match(
    await section.locator(".ticket-option").first().innerText(),
    /G|D/,
  );
  await page
    .locator(".settings-modal")
    .screenshot({ path: path.join(output, "tickets-rail-desktop.png") });
  await section.getByLabel("出发地").fill("SHA");
  await section.getByLabel("到达地").fill("PEK");
  await section.getByRole("button", { name: "实查机票", exact: true }).click();
  await section.locator(".ticket-option").first().waitFor({ timeout: 90000 });
  assert.match(
    await section.locator(".ticket-option").first().innerText(),
    /HU|CA|MU/,
  );
  await page
    .locator(".settings-modal")
    .screenshot({ path: path.join(output, "tickets-flight-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.locator(".ticket-option").first().scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(output, "tickets-flight-mobile.png"),
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    path.join(output, "tickets-live.json"),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        date,
        coldStart,
        warmStart,
        rail,
        flight,
        cityFlight,
        railAfterRestart,
        flightAfterRestart,
        checks: [
          "automatic cold setup",
          "real rail data",
          "real flight data",
          "multi-airport city lookup",
          "2-minute cache",
          "invalid date rejection",
          "warm restart",
          "desktop/mobile UI",
          "no browser runtime errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS desktop/mobile real-query UI; evidence saved to output/qa/tickets-live.json",
  );
} finally {
  await browser?.close();
  await stop();
}
