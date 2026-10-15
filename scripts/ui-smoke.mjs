import { chromium } from "playwright-core";
import fs from "node:fs";
import { browserExecutable } from "../server/src/pdf.ts";
fs.mkdirSync("output/qa", { recursive: true });
fs.mkdirSync("output/pdf", { recursive: true });
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
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.screenshot({ path: "output/qa/home-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "体验南京示例", exact: true }).click();
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByText("初见金陵，赴一场秦淮夜色", { exact: true }).waitFor();
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
  await page.getByRole("button", { name: "导出 PDF", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs("output/pdf/nanjing-travel-demo.pdf");
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
    "UI smoke passed: desktop and mobile, demo workflow, daily tabs, map, budget, settings, history, persistence, PDF download.",
  );
} finally {
  await browser.close();
}
