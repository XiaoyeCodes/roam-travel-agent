import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { demoPlan, exampleRequest } from "../src/demo.js";
import type { Config } from "../src/config.js";
import type { TravelLeg } from "../../shared/quality.js";
import {
  dayCheckPresentation,
  stopTrustSummary,
} from "../../shared/quality-presentation.js";
import { dayCheckHtml, stopFactsHtml } from "../src/quality-html.js";
fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "quality-test-"),
);
const {
  timeMinutes,
  durationMinutes,
  openingWindows,
  checkSchedule,
  verifyPlan,
  refreshFacts,
  ensurePlanIdentity,
} = await import("../src/quality.js");
const { createJob, saveJob, publicJob } = await import("../src/store.js");
const {
  startRevision,
  applyRevision,
  undoRevision,
  cancelRevision,
  editControllers,
  revisionPreview,
  reconcileBudget,
} = await import("../src/revisions.js");
const { buildTravelHtml } = await import("../src/html.js");
const config: Config = {
  baseUrl: "https://model.example/v1",
  apiKey: "",
  model: "fixture",
  amapKey: "",
  unsplashKey: "",
  searchKey: "",
  mcpServers: [],
};
const at = new Date().toISOString();
function livePlan() {
  const p = demoPlan("quality-fixture");
  p.mode = "live";
  p.request.mode = "live";
  ensurePlanIdentity(p);
  for (const [i, s] of p.days.flatMap((d) => d.stops).entries()) {
    s.verified = true;
    s.placeCheckedAt = at;
    s.poiId = `BQUALITY${i}`;
    s.location = [118.78 + i * 0.001, 32.06];
  }
  refreshFacts(p);
  return p;
}
async function editableJob() {
  const j = createJob(exampleRequest());
  j.status = "complete";
  j.plan = demoPlan(j.id);
  await verifyPlan(j.plan, config);
  saveJob(j);
  return j;
}
async function waitDraft(job: ReturnType<typeof createJob>) {
  for (let i = 0; i < 300 && editControllers.has(job.id); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(!editControllers.has(job.id), "draft should finish");
  return job.editDraft!;
}

test("time and duration parsing reserves upper ranges without turning unknowns into zero", () => {
  assert.equal(timeMinutes("9：30"), 570);
  for (const value of ["25:00", "09:60", "上午", "09:30-10:00"])
    assert.equal(timeMinutes(value), null);
  for (const [text, result] of [
    ["约1小时30分钟", 90],
    ["1.5小时", 90],
    ["1–2小时", 120],
    ["半小时", 30],
    ["2小时半", 150],
    ["约1.5小时（入境与提取行李）", 90],
    ["45分钟 (午餐)", 45],
  ] as const)
    assert.equal(durationMinutes(text), result);
  for (const text of [
    "待定",
    "0分钟",
    "两小时",
    "-1小时",
    "25小时",
    "1小时（另30分钟排队）",
  ])
    assert.equal(durationMinutes(text), null);
});

test("repeated coverage gaps are grouped without suppressing conflicts, manual actions or original evidence", () => {
  const day = livePlan().days[0];
  day.stops = day.stops.slice(0, 4);
  day.stops[3].type = "transport";
  day.stops[3].name = "机场";
  const missing = day.stops.flatMap((stop, i) => [
    {
      severity: "warning" as const,
      code: "location_unknown",
      stopId: stop.id,
      message: `${stop.name}地点未取得`,
    },
    ...(i < 3
      ? [
          {
            severity: "info" as const,
            code: "opening_unknown",
            stopId: stop.id,
            message: `${stop.name}开放时间未取得`,
          },
        ]
      : []),
    ...(i > 0
      ? [
          {
            severity: "warning" as const,
            code: "route_unknown",
            stopId: stop.id,
            message: `交通分段${i}未取得`,
          },
        ]
      : []),
  ]);
  day.check = {
    checkedAt: at,
    status: "conflict",
    mode: "auto",
    visitMinutes: 180,
    unknownDurations: 1,
    travelMinutes: 0,
    walkingMeters: 0,
    queriedLegs: 0,
    totalLegs: 3,
    legs: [],
    issues: [
      ...missing,
      {
        severity: "warning",
        code: "duration_unknown",
        stopId: day.stops[3].id,
        message: "机场时长未知",
      },
      { severity: "info", code: "departure_missing", message: "返程班次未知" },
      { severity: "conflict", code: "overlap", message: "两个安排重叠120分钟" },
    ],
  };
  const original = JSON.stringify(day);
  const view = dayCheckPresentation(day);
  assert.equal(view.originalCount, 13);
  assert.equal(view.conflicts.length, 1);
  assert.equal(view.actions.length, 1);
  assert.equal(view.actions[0].action, "journey");
  assert.deepEqual(
    view.actions[0].items.sort(),
    ["机场时长未知", "返程班次未知"].sort(),
  );
  assert.equal(view.information.length, 2);
  assert.match(view.information[0].title, /4 个地点、3 段交通/);
  assert.equal(
    view.conflicts.length +
      [...view.actions, ...view.information].reduce(
        (sum, item) => sum + item.items.length,
        0,
      ),
    view.originalCount,
  );
  assert.equal(
    JSON.stringify(day),
    original,
    "presentation must not rewrite unknowns or conflicts",
  );
  const html = dayCheckHtml(day);
  assert.match(html, /schedule-conflict[^>]*>两个安排重叠120分钟/);
  assert.match(html, /查询资料与说明 · 2 类/);
  assert.ok(!html.includes("交通 0 分钟"));
  assert.ok(!html.includes('class="schedule-note"'));
  day.check.issues.push({
    severity: "warning",
    code: "new_rule",
    message: "不能丢失的新规则",
  });
  assert.ok(
    dayCheckPresentation(day).actions.some(
      (item) => item.title === "不能丢失的新规则",
    ),
  );
});

test("compact stop facts remain expandable, escaped and honest about stale or missing locations", () => {
  const stop = livePlan().days[0].stops[0];
  assert.match(stopTrustSummary(stop), /地点已定位/);
  stop.facts!.location = {
    status: "verified",
    expiresAt: "2000-01-01T00:00:00Z",
    detail: "旧坐标",
  };
  assert.match(stopTrustSummary(stop), /需更新/);
  stop.facts!.location.status = "unknown";
  stop.name = '<img src=x onerror="alert(1)">';
  stop.facts!.opening.detail = "<script>alert(1)</script>";
  const html = stopFactsHtml(stop);
  assert.match(html, /^<details class="stop-trust"/);
  assert.match(html, /地点未定位/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.equal((html.match(/class="fact-detail/g) || []).length, 5);
});
test("opening checks respect weekdays, last entry, overnight windows and holiday exceptions", () => {
  const info = {
    checkedAt: "2026-10-16T01:00:00Z",
    source: "fixture",
    url: "",
    today: "09:00-17:00",
    weekly:
      "周一 闭馆(法定节假日除外)；周二至周日 09:00-17:00开放(16:00停止入园)",
  };
  assert.deepEqual(openingWindows(info, "2026-10-17").windows, [[540, 1020]]);
  assert.equal(openingWindows(info, "2026-10-16").lastEntry, 960);
  assert.equal(openingWindows(info, "2026-10-19").closed, true);
  assert.equal(openingWindows(info, "2026-10-19").conditional, true);
  assert.deepEqual(
    openingWindows({ ...info, weekly: "每天18:00-02:00" }, "2026-10-17")
      .windows,
    [[1080, 1560]],
  );
  assert.deepEqual(
    openingWindows({ ...info, weekly: "须提前预约" }, "2026-10-17").windows,
    [],
  );
  assert.deepEqual(
    openingWindows(
      {
        ...info,
        weekly:
          "3–10月:06:45–17:30(17:00 停止入园),11–2月:7:30–17:00(16:30 停止入园)",
      },
      "2026-10-17",
    ).windows,
    [[405, 1050]],
  );
  const calendar = openingWindows(
    {
      ...info,
      weekly:
        "09/30-10/06 10:00–20:00开放 最晚进入19:00；10/07-12/31 周二–周日 09:00–17:00开放 最晚进入16:00",
    },
    "2026-10-23",
  );
  assert.deepEqual(calendar.windows, [[540, 1020]]);
  assert.equal(calendar.lastEntry, 960);
});
test("POI coordinates verify only location; expired facts, unknown prices and reservations stay distinct", () => {
  const p = livePlan(),
    s = p.days[0].stops[0];
  s.cost = null;
  s.openingInfo = {
    today: "09:00-17:00",
    weekly: "",
    source: "高德",
    url: "https://amap.com/",
    checkedAt: "2001-01-01T00:00:00Z",
  };
  refreshFacts(p);
  assert.equal(s.facts!.location.status, "verified");
  assert.equal(s.facts!.price.status, "unknown");
  assert.equal(s.facts!.reservation.status, "unknown");
  assert.equal(s.facts!.opening.status, "stale");
  s.cost = 20;
  s.userProvidedFields = ["cost"];
  s.placeCheckedAt = "bad legacy timestamp";
  refreshFacts(p);
  assert.equal(s.facts!.price.status, "user");
  assert.equal(s.facts!.location.status, "stale");
  assert.equal(p.days[0].weatherFact!.status, "unknown");
  p.destination = "苏州";
  p.evidence.push({
    id: "weather-wrong-city",
    tool: "weather_forecast",
    source: "Open-Meteo",
    status: "live",
    queriedAt: at,
    data: {
      location: "宿州市",
      days: [{ date: p.days[0].date, available: true }],
    },
  });
  refreshFacts(p);
  assert.equal(
    p.days[0].weatherFact!.status,
    "unknown",
    "same-sounding cities cannot verify destination weather",
  );
});
test("deterministic schedule validation detects overlaps, transfer buffers and unknowns", () => {
  const p = livePlan(),
    day = p.days[0];
  day.stops = day.stops.slice(0, 2);
  day.stops[0].time = "10:00";
  day.stops[0].duration = "1小时";
  day.stops[1].time = "11:10";
  const leg: TravelLeg = {
    fromId: day.stops[0].id!,
    toId: day.stops[1].id!,
    fromName: day.stops[0].name,
    toName: day.stops[1].name,
    mode: "driving",
    minutes: 30,
    meters: 10000,
    walkingMeters: 0,
    bufferMinutes: 10,
    availableMinutes: null,
    slackMinutes: null,
    fact: { status: "verified", detail: "fixture", checkedAt: at },
  };
  let c = checkSchedule(day, [leg], "balanced");
  assert.equal(c.status, "conflict");
  assert.equal(c.legs[0].slackMinutes, -30);
  assert.ok(c.issues.some((i) => i.code === "transfer_short"));
  day.stops[1].time = "10:30";
  c = checkSchedule(day, [leg], "balanced");
  assert.ok(c.issues.some((i) => i.code === "overlap"));
  day.stops[0].duration = "待定";
  leg.minutes = null;
  leg.slackMinutes = null;
  leg.fact = { status: "unknown", detail: "failure" };
  c = checkSchedule(day, [leg], "balanced");
  assert.equal(c.unknownDurations, 1);
  assert.equal(c.queriedLegs, 0);
  assert.ok(c.issues.some((i) => i.code === "route_unknown"));
});
test("generation queries actual route modes and opening data, while a failed query stays unknown", async (t) => {
  const p = livePlan();
  p.days = p.days.slice(0, 1);
  p.days[0].stops = p.days[0].stops.slice(0, 2);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const u = new URL(String(input));
    paths.push(u.pathname);
    if (u.pathname.endsWith("/place/detail"))
      return Response.json({
        status: "1",
        pois: p.days[0].stops.map((s) => ({
          id: s.poiId,
          biz_ext: { open_time: "09:00-17:00", opentime2: "每天09:00-17:00" },
        })),
      });
    if (u.pathname.includes("/walking"))
      return Response.json({
        status: "1",
        route: { paths: [{ duration: "600", distance: "700" }] },
      });
    if (u.pathname.includes("/driving"))
      return Response.json({
        status: "0",
        infocode: "10001",
        info: "INVALID_USER_KEY",
      });
    if (u.pathname.includes("/transit/"))
      return Response.json({
        status: "1",
        route: {
          transits: [
            { duration: "1800", distance: "3200", walking_distance: "450" },
          ],
        },
      });
    throw Error("Unexpected endpoint");
  });
  const cfg = { ...config, amapKey: "quality-route-key" };
  await verifyPlan(p, cfg, { mode: "walking" });
  assert.equal(p.days[0].check!.legs[0].minutes, 10);
  assert.equal(p.days[0].stops[0].facts!.opening.status, "verified");
  await verifyPlan(p, cfg, { mode: "transit" });
  assert.equal(p.days[0].check!.legs[0].walkingMeters, 450);
  await verifyPlan(p, cfg, { mode: "driving" });
  assert.equal(p.days[0].check!.legs[0].minutes, null);
  assert.equal(p.days[0].check!.legs[0].fact.status, "unknown");
  assert.ok(paths.some((s) => s.endsWith("/walking")));
  assert.ok(paths.some((s) => s.includes("/transit/")));
});
test("preview, apply, persistence and undo keep unaffected dates and budgets intact", async () => {
  const j = await editableJob(),
    before = structuredClone(j.plan!);
  const stop = before.days[0].stops[0];
  const draft = startRevision(
    j,
    {
      baseRevision: 1,
      day: 1,
      action: "update",
      stopId: stop.id,
      fields: { time: "11:00", cost: 80 },
    },
    config,
  );
  assert.deepEqual(j.plan, before);
  assert.throws(() => applyRevision(j, draft.id, 1), /正在修改|失效/);
  await waitDraft(j);
  assert.equal(j.editDraft!.status, "ready", j.editDraft!.error);
  assert.deepEqual(j.plan, before);
  assert.ok(j.editDraft!.candidate!.days[0].check);
  assert.deepEqual(j.editDraft!.candidate!.days.slice(1), before.days.slice(1));
  assert.equal(j.editDraft!.summary!.budgetDelta, 80);
  assert.ok(!("candidate" in publicJob(j).editDraft!));
  const persisted = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `const {getJob}=await import('./server/src/store.ts');const j=getJob('${j.id}');console.log(JSON.stringify({status:j.editDraft.status,revision:j.plan.revision,stopId:j.plan.days[0].stops[0].id}));`,
      ],
      { env: { ...process.env }, encoding: "utf8" },
    ),
  );
  assert.equal(persisted.status, "ready");
  assert.equal(persisted.stopId, stop.id);
  applyRevision(j, draft.id, 1);
  assert.equal(j.plan!.revision, 2);
  assert.equal(j.plan!.days[0].stops[0].time, "11:00");
  assert.deepEqual(j.plan!.days.slice(1), before.days.slice(1));
  assert.equal(j.plan!.totalEstimate, before.totalEstimate + 80);
  assert.throws(() => applyRevision(j, draft.id, 1), /版本/);
  assert.throws(() => undoRevision(j, 1), /版本/);
  undoRevision(j, 2);
  assert.equal(j.plan!.revision, 3);
  assert.deepEqual(j.plan!.days, before.days);
  assert.deepEqual(j.plan!.budget, before.budget);
  assert.equal(publicJob(j).canUndo, false);
  const timeOnly = startRevision(
    j,
    {
      baseRevision: 3,
      day: 1,
      action: "update",
      stopId: stop.id,
      fields: { time: "12:00", cost: stop.cost },
    },
    config,
  );
  await waitDraft(j);
  assert.equal(
    j.editDraft!.candidate!.days[0].stops[0].userProvidedFields?.includes(
      "cost",
    ),
    false,
    "unchanged form defaults are not new user price evidence",
  );
  cancelRevision(j, timeOnly.id);
  const reordered = structuredClone(before);
  reordered.days[0].stops.reverse();
  reconcileBudget(before, reordered, 1);
  assert.deepEqual(
    reordered.budget,
    before.budget,
    "ordering alone cannot change budget provenance",
  );
});
test("locked edits, stale versions, unknown costs and cancellation cannot silently overwrite", async () => {
  const j = await editableJob(),
    s = j.plan!.days[0].stops[0],
    before = structuredClone(j.plan);
  assert.throws(
    () =>
      startRevision(
        j,
        {
          baseRevision: 1,
          day: 1,
          action: "remove",
          stopId: s.id,
          lockedStopIds: [s.id],
        },
        config,
      ),
    /解除/,
  );
  assert.throws(
    () =>
      startRevision(
        j,
        { baseRevision: 9, day: 1, action: "remove", stopId: s.id },
        config,
      ),
    /版本/,
  );
  const d = startRevision(
    j,
    {
      baseRevision: 1,
      day: 1,
      action: "update",
      stopId: s.id,
      fields: { cost: null },
    },
    config,
  );
  await waitDraft(j);
  assert.equal(j.editDraft!.status, "ready");
  assert.ok(j.editDraft!.candidate!.unknownCosts > before!.unknownCosts);
  assert.equal(j.editDraft!.summary!.budgetIncomplete, true);
  cancelRevision(j, d.id);
  assert.equal(revisionPreview(j), null);
  assert.deepEqual(j.plan, before);
  const cancelled = startRevision(
    j,
    { baseRevision: 1, day: 1, action: "remove", stopId: s.id },
    config,
  );
  cancelRevision(j, cancelled.id);
  await waitDraft(j);
  assert.equal(j.editDraft!.status, "cancelled");
  assert.deepEqual(j.plan, before);
});
test("AI edit retries a locked-stop violation and retains exact locked content", async (t) => {
  const j = await editableJob(),
    old = structuredClone(j.plan!),
    locked = old.days[0].stops[0];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const day = structuredClone(old.days[0]);
    calls++;
    if (calls === 1) day.stops[0].time = "12:00";
    day.stops[1].time = "15:00";
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              ...day,
              explanation: "只调整未锁定地点的开始时间",
            }),
          },
        },
      ],
    });
  });
  const d = startRevision(
    j,
    {
      baseRevision: 1,
      day: 1,
      action: "ai",
      instruction: "下午稍晚一些",
      lockedStopIds: [locked.id],
    },
    { ...config, apiKey: "fixture-only" },
  );
  await waitDraft(j);
  assert.equal(j.editDraft!.status, "ready", j.editDraft!.error);
  assert.equal(calls, 2);
  applyRevision(j, d.id, 1);
  const updated = j.plan!.days[0].stops[0];
  for (const field of [
    "id",
    "name",
    "time",
    "duration",
    "cost",
    "description",
    "tip",
  ] as const)
    assert.equal(updated[field], locked[field]);
  assert.deepEqual(j.plan!.days.slice(1), old.days.slice(1));
});
test("HTML snapshot keeps field facts and revision metadata without the daily verification card", async () => {
  const j = await editableJob();
  j.plan!.lastRevision = {
    id: "test",
    revision: 2,
    day: 1,
    instruction: "<script>alert(1)</script>",
    createdAt: at,
    changes: [],
    budgetDelta: 0,
    budgetIncomplete: false,
    travelMinutesDelta: null,
    warnings: [],
  };
  const map = {
    image: "data:image/svg+xml;base64,PHN2Zy8+",
    kind: "schematic" as const,
    caption: "示意",
    missing: [],
    stops: [],
  };
  const html = buildTravelHtml(
    j.plan!,
    j.plan!.days.map(() => map),
    map,
  );
  assert.equal(
    (html.match(/aria-label="第 \d 天时间与交通核验"/g) || []).length,
    0,
  );
  assert.ok(html.includes("行程版本 V1"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes("这一天，走得通吗"));
  assert.ok(html.includes("预约"));
});
