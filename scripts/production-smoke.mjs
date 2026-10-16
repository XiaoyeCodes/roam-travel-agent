import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import dotenv from "dotenv";
fs.mkdirSync("tmp", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("tmp", "production-test-"));
const server = spawn(process.execPath, ["server/dist/server/src/index.js"], {
  env: {
    ...process.env,
    PORT: "8793",
    HOST: "127.0.0.1",
    ROAM_DATA_DIR: directory,
    ROAM_TICKETS_DISABLED: "1",
    APP_ACCESS_TOKEN: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server startup timed out")),
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
      reject(new Error(`Server exited ${code}`));
    });
  });
  const base = "http://127.0.0.1:8793";
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes("山行 Roam"));
  const asset = html.match(/src="([^\"]+\.js)"/)[1];
  assert.equal((await fetch(base + asset)).status, 200);
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.ok(!("apiKey" in config));
  assert.ok(!JSON.stringify(config).includes("sk-"));
  const rejected = await fetch(`${base}/api/config`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  const invalid = await fetch(`${base}/api/trips`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.status, 400);
  const request = {
    origin: "上海",
    destination: "南京",
    startDate: "2026-10-22",
    days: 3,
    travelers: 2,
    budget: 3500,
    preferences: ["历史文化"],
    pace: "balanced",
    transport: "train",
    notes: "",
    mode: "demo",
  };
  const created = await (
    await fetch(`${base}/api/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
  ).json();
  assert.ok(created.id);
  const stream = await (
    await fetch(`${base}/api/trips/${created.id}/events`)
  ).text();
  assert.ok(stream.includes('"type":"message"'));
  assert.ok(stream.includes('"type":"complete"'));
  const job = await (await fetch(`${base}/api/trips/${created.id}`)).json();
  assert.equal(job.status, "complete");
  assert.equal(job.plan.totalEstimate, 3060);
  const replay = await (
    await fetch(`${base}/api/trips/${created.id}/events?after=1`)
  ).text();
  assert.ok(!replay.startsWith("id: 1\n"));
  assert.ok(replay.includes("event: closed"));
  const invalidMap = await fetch(`${base}/api/trips/${created.id}/map?day=99`);
  assert.equal(invalidMap.status, 400);
  const legacy = await (
    await fetch(base + "/api/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  const enriched = await (
    await fetch(base + "/api/trips/" + legacy.id + "/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  assert.equal(enriched.plan.images.length, 10);
  const htmlResponse = await fetch(base + "/api/trips/" + legacy.id + "/html");
  assert.ok(htmlResponse.headers.get("content-type").includes("text/html"));
  assert.ok(htmlResponse.headers.get("content-disposition").includes(".html"));
  const exportedHtml = await htmlResponse.text();
  assert.equal((exportedHtml.match(/data-day-panel="/g) || []).length, 3);
  assert.ok(exportedHtml.includes("images.unsplash.com"));
  assert.ok(exportedHtml.includes("Content-Security-Policy"));
  const env = fs.existsSync(".env")
    ? dotenv.parse(fs.readFileSync(".env"))
    : {};
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const exposed = files.filter(
    (file) =>
      fs.statSync(file).isFile() &&
      env.LLM_API_KEY &&
      fs.readFileSync(file, "utf8").includes(env.LLM_API_KEY),
  );
  assert.equal(
    exposed.length,
    0,
    "A model key was found outside ignored local configuration",
  );
  assert.ok(!env.LLM_API_KEY || !exportedHtml.includes(env.LLM_API_KEY));
  const bundle = fs.readFileSync(
    path.join("client/dist", asset.replace(/^\//, "")),
    "utf8",
  );
  assert.ok(!env.LLM_API_KEY || !bundle.includes(env.LLM_API_KEY));
  console.log(
    "Production smoke passed: static assets, API validation, origin rejection, SSE delivery/replay, persisted demo, map bounds, legacy photo enrichment, HTML export, and no configured secret in source or client bundle.",
  );
} finally {
  server.kill();
}
