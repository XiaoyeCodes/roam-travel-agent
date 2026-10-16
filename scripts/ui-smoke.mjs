import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserExecutable } from "../server/src/pdf.ts";
fs.mkdirSync("output/qa", { recursive: true });
fs.mkdirSync("output/html", { recursive: true });
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.UI_BASE_URL || "http://127.0.0.1:5173/", {
    waitUntil: "networkidle",
  });
  await page.screenshot({ path: "output/qa/home-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "体验南京示例", exact: true }).click();
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByText("初见金陵，赴一场秦淮夜色", { exact: true }).waitFor();
  await page.locator(".stop-photo img").first().waitFor();
  await page.locator(".stop-photo img").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => document.querySelector(".stop-photo img")?.naturalWidth > 0,
    { timeout: 30000 },
  );
  if ((await page.locator(".day-detail .stop-photo").count()) !== 4)
    throw new Error("Expected a photo on every day-one stop");
  for (const img of await page.locator(".stop-photo img").all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((img) => img.decode());
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page
    .locator(".day-detail")
    .screenshot({ path: "output/qa/stop-photos-desktop.png" });
  await page.screenshot({
    path: "output/qa/itinerary-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /DAY 02/ }).click();
  await page.getByRole("heading", { name: "走进钟山，听梧桐与风" }).waitFor();
  await page.getByRole("button", { name: "路线地图", exact: true }).click();
  await page.getByRole("button", { name: "全部路线", exact: true }).click();
  await page.locator(".map-image img").waitFor();
  await page.screenshot({ path: "output/qa/map-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "预算与住宿", exact: true }).click();
  await page.getByRole("heading", { name: "把花费，安排得刚刚好。" }).waitFor();
  if ((await page.getByText("¥3,060", { exact: true }).count()) !== 1)
    throw new Error("Budget total is not visible");
  await page.screenshot({
    path: "output/qa/budget-desktop.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().endsWith(".html"))
    throw new Error("Wrong export extension");
  await download.saveAs("output/html/nanjing-travel-guide.html");
  const guideUrl = pathToFileURL(
    path.resolve("output/html/nanjing-travel-guide.html"),
  ).href;
  const guide = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  guide.on("pageerror", (e) => errors.push(e.message));
  await guide.goto(guideUrl, { waitUntil: "networkidle" });
  await guide.locator(".cover-photo img").waitFor();
  await guide.waitForFunction(
    () => document.querySelector(".cover-photo img")?.naturalWidth > 0,
  );
  await guide.screenshot({
    path: "output/qa/html-guide-desktop.png",
    fullPage: true,
  });
  await guide.locator('[data-day="2"]').click();
  if (
    !(await guide.locator('[data-day-panel="2"]').isVisible()) ||
    (await guide.locator('[data-day-panel="1"]').isVisible())
  )
    throw new Error("Export day navigation failed");
  for (const section of [
    "practical",
    "attractions",
    "food",
    "notes",
    "itinerary",
  ]) {
    await guide.locator('[data-section="' + section + '"]').click();
    if (
      !(await guide
        .locator('[data-section-panel="' + section + '"]')
        .isVisible())
    )
      throw new Error("Export chapter navigation failed");
  }
  await guide.locator('[data-section="attractions"]').click();
  for (const img of await guide
    .locator('[data-section-panel="attractions"] .photo img')
    .all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((img) => img.decode());
  }
  await guide.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await guide.screenshot({
    path: "output/qa/html-attractions-desktop.png",
    fullPage: true,
  });
  await guide.locator('[data-section="food"]').click();
  await guide
    .locator('[data-section-panel="food"] .photo img')
    .first()
    .evaluate((img) => img.decode());
  await guide.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await guide.screenshot({
    path: "output/qa/html-food-desktop.png",
    fullPage: true,
  });
  await guide.setViewportSize({ width: 390, height: 844 });
  await guide.locator('[data-section="itinerary"]').click();
  await guide.locator('[data-day="1"]').click();
  await guide.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await guide.screenshot({
    path: "output/qa/html-guide-mobile.png",
    fullPage: true,
  });
  for (const section of [
    "itinerary",
    "practical",
    "attractions",
    "food",
    "notes",
  ]) {
    await guide.locator('[data-section="' + section + '"]').click();
    if (
      await guide.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error("Export mobile overflow: " + section);
  }
  const offlineContext = await browser.newContext({ offline: true });
  const offline = await offlineContext.newPage();
  await offline.goto(guideUrl);
  await offline.locator('[data-section="practical"]').click();
  if (!(await offline.getByText("¥3,060", { exact: true }).last().isVisible()))
    throw new Error("Offline budget missing");
  await offline.locator('[data-section="itinerary"]').click();
  if (
    !(await offline
      .locator(".route-map img")
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0))
  )
    throw new Error("Offline map missing");
  await offlineContext.close();
  await guide.close();
  await page.getByRole("button", { name: "协作过程", exact: true }).click();
  await page.getByRole("heading", { name: "从讨论，到出发" }).waitFor();
  await page.getByRole("button", { name: "信息来源", exact: true }).click();
  await page.getByText("每一次检索，都有记录。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "模型与工具", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "外部工具", exact: true }).click();
  await page.screenshot({
    path: "output/qa/settings-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "MCP 服务", exact: true }).click();
  await page.getByPlaceholder("rail", { exact: true }).fill("rail-example");
  await page.getByPlaceholder("12306 铁路", { exact: true }).fill("铁路示例");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "我的旅程", exact: false }).click();
  await page.locator(".history-card").first().waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "开启另一段旅程", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "output/qa/home-mobile.png", fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error("Mobile home has horizontal overflow");
  await page.getByRole("button", { name: "体验南京示例", exact: true }).click();
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor({ timeout: 20000 });
  await page.screenshot({
    path: "output/qa/itinerary-mobile.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  )
    throw new Error("Mobile itinerary has horizontal overflow");
  await page.getByRole("button", { name: "预算与住宿", exact: true }).click();
  await page.getByRole("heading", { name: "把花费，安排得刚刚好。" }).waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "UI smoke passed: desktop and mobile, demo workflow, daily tabs, map, budget, settings, history, persistence, HTML download, photos, chapter/day navigation and offline content.",
  );
} finally {
  await browser.close();
}
