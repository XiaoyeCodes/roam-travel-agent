// Real UI/API, isolated trip store. Model output is a fixture; no provider charges.
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { browserExecutable } from "../server/src/pdf.ts";
fs.mkdirSync("tmp", { recursive: true });
fs.mkdirSync("output/qa", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("tmp", "revisions-smoke-"));
const reserved = http.createServer().listen(0, "127.0.0.1");
await once(reserved, "listening");
const port = reserved.address().port;
await new Promise((r) => reserved.close(r));
const base = `http://127.0.0.1:${port}`;
const bootstrap = `
globalThis.fetch=async(input, init)=>{
 if(!String(input).includes('model.example'))throw Error('External requests disabled for QA');
 const context=JSON.parse(JSON.parse(init.body).messages[1].content), day=context.day;
 day.stops[1].time='16:00';
 return Response.json({choices:[{message:{role:'assistant',content:JSON.stringify({...day,explanation:'保留锁定地点，仅调整第二站时间'})}}]});
};
await import('./server/src/index.ts');`;
let server, browser;
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
        LLM_BASE_URL: "https://model.example/v1",
        LLM_API_KEY: "qa-fixture",
        AMAP_KEY: "",
        AMAP_JS_KEY: "",
        AMAP_JS_SECURITY_CODE: "",
        UNSPLASH_ACCESS_KEY: "",
        TAVILY_API_KEY: "",
        MCP_SERVERS: "[]",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("API startup timeout")), 15000);
    server.stdout.on("data", (b) => {
      if (String(b).includes("Roam API ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (c) => {
      clearTimeout(timer);
      reject(Error(`API exited ${c}`));
    });
  });
}
async function stop() {
  if (server?.exitCode === null) {
    const done = once(server, "exit");
    server.kill();
    await done;
  }
}
async function get(id) {
  return fetch(`${base}/api/trips/${id}`).then((r) => r.json());
}
try {
  await start();
  const created = await fetch(base + "/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => r.json());
  assert.ok(created.id, JSON.stringify(created));
  const id = created.id;
  await fetch(`${base}/api/trips/${id}/photos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  let initial = await get(id);
  await fetch(`${base}/api/trips/${id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision: initial.plan.revision }),
  });
  initial = await get(id);
  const before = structuredClone(initial.plan),
    beforeVersion = before.revision;
  browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ||
    route.request().url().startsWith("file:")
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(
    (id) => localStorage.setItem("roam-active-id", id),
    id,
  );
  await page.goto(base);
  await page.locator(".day-detail .timeline").waitFor();
  assert.equal(await page.locator(".day-verification").count(), 0);
  await page
    .getByRole("button", { name: "编辑这一站", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: "调整第 1 天" });
  await modal.getByRole("textbox", { name: "停留时长" }).fill("5小时");
  await modal
    .getByRole("spinbutton", { name: "全体旅客该项费用 / 元" })
    .fill("80");
  await modal.getByRole("button", { name: "预览修改", exact: true }).click();
  await modal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .waitFor({ timeout: 20000 });
  assert.deepEqual(
    (await get(id)).plan.days,
    before.days,
    "preview must not overwrite",
  );
  assert.ok(await modal.locator(".schedule-conflict").count());
  await modal.screenshot({ path: "output/qa/revision-preview-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await modal.screenshot({ path: "output/qa/revision-preview-mobile.png" });
  await modal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText(`行程 V${beforeVersion + 1}`, { exact: true }).waitFor();
  const applied = await get(id);
  assert.equal(applied.plan.days[0].stops[0].duration, "5小时");
  assert.equal(applied.plan.totalEstimate, before.totalEstimate + 80);
  assert.deepEqual(applied.plan.days.slice(1), before.days.slice(1));
  await page.reload();
  await page.getByText(`行程 V${beforeVersion + 1}`, { exact: true }).waitFor();
  await page
    .locator(".stop-facts")
    .first()
    .locator(".fact-detail")
    .first()
    .locator("summary")
    .click();
  assert.ok(
    await page
      .locator(".stop-facts")
      .first()
      .locator(".fact-explanation")
      .first()
      .isVisible(),
  );
  await page.locator(".day-detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/qa/quality-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".day-detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/qa/quality-desktop.png" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const htmlFile = path.resolve("output/qa/revised-itinerary.html");
  await (await download).saveAs(htmlFile);
  const exported = fs.readFileSync(htmlFile, "utf8");
  assert.ok(exported.includes(`行程版本 V${beforeVersion + 1}`));
  assert.ok(exported.includes("5小时"));
  const offline = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await offline.route("**/*", (r) =>
    r.request().url().startsWith("file:") ? r.continue() : r.abort(),
  );
  await offline.goto(pathToFileURL(htmlFile).href);
  await offline.locator(".day-panel.active .stop").first().waitFor();
  assert.equal(await offline.locator(".day-verification").count(), 0);
  assert.ok(
    await offline.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await offline.screenshot({ path: "output/qa/quality-html-mobile.png" });
  await offline.close();
  await page.getByRole("button", { name: "撤销上次修改", exact: true }).click();
  await page.getByText(`行程 V${beforeVersion + 2}`, { exact: true }).waitFor();
  assert.deepEqual((await get(id)).plan.days, before.days);
  await page.getByRole("button", { name: "调整第 1 天", exact: true }).click();
  await modal
    .getByRole("textbox", { name: "希望怎么调整" })
    .fill("保留第一站，第二站改到16点");
  await modal.locator(".edit-locks>summary").click();
  await modal.getByRole("checkbox").first().check();
  await modal.getByRole("button", { name: "预览修改", exact: true }).click();
  await modal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .waitFor({ timeout: 20000 });
  await modal.getByRole("button", { name: "关闭行程编辑" }).click();
  await page
    .getByRole("button", { name: "继续查看修改", exact: true })
    .waitFor();
  await stop();
  await start();
  await page.reload();
  await page.getByRole("button", { name: "继续查看修改", exact: true }).click();
  await modal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .click();
  await modal.waitFor({ state: "hidden" });
  const final = await get(id);
  assert.equal(final.plan.days[0].stops[1].time, "16:00");
  assert.equal(final.plan.days[0].stops[0].time, before.days[0].stops[0].time);
  assert.deepEqual(final.plan.days.slice(1), before.days.slice(1));
  // Phase 2: real forms -> isolated backend -> versioned application -> HTML.
  const beforeGlobal = structuredClone(final.plan);
  await page.getByRole("button", { name: "费用与人数", exact: true }).click();
  const costsModal = page.getByRole("dialog", { name: "费用明细与人数" });
  await costsModal
    .getByRole("spinbutton", { name: "同行人数", exact: true })
    .fill("3");
  await costsModal
    .getByRole("spinbutton", { name: "住宿间数", exact: true })
    .fill("2");
  await costsModal
    .getByRole("spinbutton", { name: "住宿晚数", exact: true })
    .fill("3");
  const costRow = costsModal.locator(".cost-edit-row").first();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await costsModal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await costsModal.screenshot({ path: "output/qa/costs-form-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await costRow
    .getByRole("combobox", { name: "计费单位", exact: true })
    .selectOption("person");
  await costRow
    .getByRole("spinbutton", { name: "参考单价下限", exact: true })
    .fill("100");
  await costRow
    .getByRole("spinbutton", { name: "参考单价上限", exact: true })
    .fill("150");
  await costsModal
    .getByRole("button", { name: "预览修改", exact: true })
    .click();
  await costsModal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .waitFor({ timeout: 20000 });
  assert.deepEqual((await get(id)).plan, beforeGlobal);
  assert.ok(await costsModal.locator(".cost-details").isVisible());
  await costsModal.screenshot({ path: "output/qa/costs-preview-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.ok(
    await costsModal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await costsModal.screenshot({ path: "output/qa/costs-preview-mobile.png" });
  await costsModal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .click();
  await costsModal.waitFor({ state: "hidden" });
  const afterCosts = await get(id);
  assert.equal(afterCosts.plan.request.travelers, 3);
  assert.equal(afterCosts.plan.costs.high - afterCosts.plan.costs.low, 150);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "班次与衔接", exact: true }).click();
  const journeyModal = page.getByRole("dialog", { name: "班次与行程衔接" });
  await journeyModal
    .getByRole("checkbox", { name: "设置返程时间约束", exact: true })
    .check();
  await journeyModal.getByLabel("返程班次号", { exact: true }).fill("G101");
  await journeyModal
    .getByLabel("返程车站或机场名称", { exact: true })
    .fill("南京南站");
  await journeyModal
    .getByRole("checkbox", { name: "带儿童 +15分钟", exact: true })
    .check();
  await journeyModal
    .getByRole("button", { name: "预览修改", exact: true })
    .click();
  await journeyModal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .waitFor({ timeout: 20000 });
  assert.ok(
    await journeyModal
      .locator(".journey-details")
      .getByText(/预留 60 分钟/)
      .isVisible(),
  );
  await journeyModal.screenshot({
    path: "output/qa/journey-preview-desktop.png",
  });
  await journeyModal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .click();
  await journeyModal.waitFor({ state: "hidden" });
  const afterJourney = await get(id);
  assert.equal(afterJourney.plan.journey.departure.source, "user");
  assert.equal(afterJourney.plan.days[2].stops.at(-1).name, "南京南站");
  await page.reload();
  await page
    .getByText(`行程 V${afterJourney.plan.revision}`, { exact: true })
    .waitFor();
  const exportedPhase2 = await fetch(`${base}/api/trips/${id}/html`).then((r) =>
    r.text(),
  );
  assert.ok(exportedPhase2.includes("G101"));
  assert.ok(exportedPhase2.includes("× 3 人"));
  assert.ok(exportedPhase2.includes("未代表已购票"));
  const phase2File = path.resolve("output/qa/planning-details.html");
  fs.writeFileSync(phase2File, exportedPhase2);
  const phase2Page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await phase2Page.route("**/*", (r) =>
    r.request().url().startsWith("file:") ? r.continue() : r.abort(),
  );
  await phase2Page.goto(pathToFileURL(phase2File).href);
  await phase2Page
    .getByRole("button", { name: "住宿交通", exact: true })
    .click();
  assert.ok(await phase2Page.locator(".journey-details").isVisible());
  assert.ok(await phase2Page.locator(".cost-details").isVisible());
  assert.ok(
    await phase2Page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await phase2Page.locator(".cost-details").scrollIntoViewIfNeeded();
  await phase2Page.screenshot({ path: "output/qa/planning-html-mobile.png" });
  await phase2Page.close();
  await page.getByRole("button", { name: "撤销上次修改", exact: true }).click();
  await page
    .getByText(`行程 V${afterJourney.plan.revision + 1}`, { exact: true })
    .waitFor();
  assert.deepEqual((await get(id)).plan.costs, afterCosts.plan.costs);
  await page.getByRole("button", { name: "撤销上次修改", exact: true }).click();
  await page
    .getByText(`行程 V${afterJourney.plan.revision + 2}`, { exact: true })
    .waitFor();
  assert.deepEqual((await get(id)).plan.days, beforeGlobal.days);
  assert.deepEqual((await get(id)).plan.costs, beforeGlobal.costs);
  await page.getByRole("button", { name: /生成冲突修复建议/ }).click();
  const repairModal = page.getByRole("dialog", { name: "修复第 1 天冲突" });
  await repairModal
    .getByRole("button", { name: "预览修改", exact: true })
    .click();
  await repairModal
    .getByRole("button", { name: "确认应用修改", exact: true })
    .waitFor({ timeout: 20000 });
  assert.ok(await repairModal.locator(".repair-comparison").isVisible());
  assert.ok(await repairModal.getByText(/当前约束下未减少冲突/).isVisible());
  await repairModal.screenshot({
    path: "output/qa/repair-preview-desktop.png",
  });
  await repairModal
    .getByRole("button", { name: "放弃预览", exact: true })
    .click();
  await repairModal
    .getByRole("button", { name: "关闭行程编辑", exact: true })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      manualPreview: true,
      applyUndo: true,
      lockedAI: true,
      restartDraft: true,
      fieldFacts: true,
      htmlSnapshot: true,
      mobile: true,
      costRanges: true,
      journeyConstraints: true,
      conflictRepair: true,
      errors,
    }),
  );
} finally {
  await browser?.close();
  await stop();
}
