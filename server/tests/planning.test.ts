import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { demoPlan, exampleRequest } from "../src/demo.js";
import {
  ensureCosts,
  recalculateCosts,
  applyCostInput,
  reconcileCosts,
} from "../src/costs.js";
import { applyJourney, checkJourney, journeyOptions } from "../src/journey.js";
import {
  DEFAULT_JOURNEY,
  costAmount,
  localMinute,
  journeyBuffer,
  type CostEntry,
} from "../../shared/planning.js";
import type { Config } from "../src/config.js";
import type { TravelLeg } from "../../shared/quality.js";
fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "planning-test-"),
);
const { verifyPlan, ensurePlanIdentity, checkSchedule, refreshFacts } =
  await import("../src/quality.js");
const { createJob, saveJob } = await import("../src/store.js");
const {
  startRevision,
  applyRevision,
  undoRevision,
  cancelRevision,
  editControllers,
  revisionPreview,
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
function plan() {
  const p = demoPlan(randomUUID());
  ensurePlanIdentity(p);
  ensureCosts(p);
  return p;
}
const input = (p: ReturnType<typeof plan>) => ({
  travelers: p.request.travelers,
  rooms: p.costs!.rooms,
  nights: p.costs!.nights,
  entries: structuredClone(p.costs!.entries),
});
const entry = (patch: Partial<CostEntry> = {}): CostEntry => ({
  id: randomUUID(),
  label: "成人票",
  category: "tickets",
  unit: "person",
  unitPrice: 100,
  highPrice: 150,
  source: "user",
  note: "成人票估算",
  review: false,
  ...patch,
});
async function job() {
  const j = createJob(exampleRequest());
  j.status = "complete";
  j.plan = plan();
  j.plan.id = j.id;
  await verifyPlan(j.plan, config);
  saveJob(j);
  return j;
}
async function wait(j: ReturnType<typeof createJob>) {
  for (let i = 0; i < 400 && editControllers.has(j.id); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(!editControllers.has(j.id));
  assert.equal(j.editDraft?.status, "ready", j.editDraft?.error);
  return j.editDraft!;
}
test("ledger migration preserves amounts and never charges hotel/transport stop duplicates", () => {
  const p = plan(),
    original = p.totalEstimate;
  assert.equal(
    p.costs!.entries.filter((e) => e.category === "hotel").length,
    1,
  );
  const hotel = p.costs!.entries.find((e) => e.category === "hotel")!;
  assert.equal(hotel.unit, "room_night");
  p.days[0].stops.push({
    ...p.days[0].stops[0],
    id: randomUUID(),
    type: "hotel",
    cost: 900,
  });
  delete p.costs;
  ensureCosts(p);
  recalculateCosts(p);
  assert.equal(p.totalEstimate, original);
  assert.equal(
    p.costs!.entries.some((e) => e.stopId === p.days[0].stops.at(-1)!.id),
    false,
  );
  const saved = structuredClone(p.costs);
  ensureCosts(p);
  assert.deepEqual(p.costs, saved);
});
test("party size, room nights and price ranges calculate independently; unknown never becomes zero", () => {
  const p = plan();
  const entries = [
    entry(),
    entry({
      category: "hotel",
      label: "酒店",
      unit: "room_night",
      unitPrice: 400,
      highPrice: 500,
    }),
    entry({
      category: "intercity",
      unit: "fixed",
      unitPrice: 600,
      highPrice: 600,
    }),
    entry({
      category: "other",
      unit: "fixed",
      unitPrice: null,
      highPrice: null,
    }),
  ];
  applyCostInput(p, { travelers: 3, rooms: 2, nights: 2, entries });
  assert.equal(p.costs!.low, 2500);
  assert.equal(p.costs!.high, 3050);
  assert.equal(p.unknownCosts, 1);
  assert.equal(p.request.travelers, 3);
  assert.equal(p.budget.find((b) => b.category === "其他与预留")!.amount, null);
  assert.equal(costAmount(entries[3], 3, 2, 2), null);
  assert.equal(costAmount({ ...entries[3], unit: "room_night" }, 3, 2, 0), 0);
  assert.ok(p.days.flatMap((d) => d.stops).every((s) => s.cost === null));
  assert.throws(
    () =>
      applyCostInput(p, {
        ...input(p),
        entries: [entry({ unitPrice: 500, highPrice: 100 })],
      }),
    /上限/,
  );
});
test("cost links reject duplicate charges and fabricated plan provenance", () => {
  const p = plan(),
    s = p.days[0].stops[0],
    e = entry({ stopId: s.id, source: "plan" });
  assert.throws(
    () =>
      applyCostInput(p, {
        ...input(p),
        entries: [e, { ...e, id: randomUUID() }],
      }),
    /只关联/,
  );
  assert.throws(
    () =>
      applyCostInput(p, {
        ...input(p),
        entries: [{ ...e, category: "hotel" }],
      }),
    /仅景点/,
  );
  applyCostInput(p, { ...input(p), entries: [e] });
  assert.equal(p.costs!.entries[0].source, "user");
  assert.equal(s.cost, 200);
  assert.throws(
    () => applyCostInput(p, { ...input(p), entries: [] }),
    /至少保留/,
  );
  applyCostInput(p, {
    ...input(p),
    entries: [entry({ unitPrice: null, highPrice: null })],
  });
  assert.equal(s.cost, null);
  assert.equal(p.unknownCosts, 1);
});
test("removal and replacement recalculate links; inclusive category remainder stays unknown", () => {
  const before = plan(),
    after = structuredClone(before),
    paid = after.days[1].stops[0];
  after.days[1].stops.shift();
  reconcileCosts(before, after, 2);
  assert.equal(after.totalEstimate, before.totalEstimate - paid.cost!);
  assert.ok(!after.costs!.entries.some((e) => e.stopId === paid.id));
  const swapped = structuredClone(before);
  swapped.days[1].stops[0].type = "transport";
  reconcileCosts(before, swapped, 2);
  assert.ok(!swapped.costs!.entries.some((e) => e.stopId === paid.id));
  const added = structuredClone(before);
  added.days[0].stops.push({
    ...added.days[0].stops[2],
    id: randomUUID(),
    type: "food",
    cost: 100,
    name: "新餐馆",
  });
  reconcileCosts(before, added, 1);
  assert.ok(added.costs!.unknown > 0);
  assert.equal(
    added.costs!.entries.find((e) => e.category === "food" && !e.stopId)!
      .unitPrice,
    null,
  );
  assert.ok(
    added.totalEstimate < before.totalEstimate + 100,
    "unallocated original category not counted twice",
  );
});
test("journey boundaries validate dates and forbid impossible overnight buffers", () => {
  assert.equal(localMinute("2026-02-30T10:00"), null);
  assert.equal(localMinute("2026-10-16T24:00"), null);
  const p = plan(),
    day = p.days[0],
    boundary = {
      day: 1,
      at: `${day.date}T09:00`,
      station: "南京南站",
      mode: "rail" as const,
      serviceNumber: "G100",
    };
  assert.throws(
    () =>
      applyJourney(p, {
        ...DEFAULT_JOURNEY,
        arrival: { ...boundary, at: "2026-02-30T10:00" },
      }),
    /日期和时间/,
  );
  assert.throws(
    () =>
      applyJourney(p, {
        ...DEFAULT_JOURNEY,
        departure: { ...boundary, at: `${day.date}T00:10` },
      }),
    /午夜/,
  );
  assert.throws(
    () =>
      applyJourney(p, {
        ...DEFAULT_JOURNEY,
        arrival: { ...boundary, station: "NKG", mode: "flight" },
      }),
    /机场代码/,
  );
  applyJourney(p, {
    ...DEFAULT_JOURNEY,
    arrival: boundary,
    withChildren: true,
    largeLuggage: true,
  });
  assert.equal(p.days[0].stops[0].time, "09:00");
  assert.equal(journeyBuffer(p.journey!, "arrival"), 45);
  assert.equal(p.journey!.arrival!.source, "user");
  assert.equal(p.journey!.arrival!.stopId, p.days[0].stops[0].id);
});
test("ticket references match direction, date and times; edited or false queries cannot claim queried status", () => {
  const p = plan(),
    date = p.days[0].date,
    at = new Date(Date.now() - 3600000).toISOString();
  p.evidence.push({
    id: "ticket-one",
    tool: "search_train_tickets",
    source: "测试铁路",
    status: "live",
    queriedAt: at,
    data: {
      origin: p.request.origin,
      destination: p.destination,
      date,
      results: [
        {
          name: "G100",
          from: "上海虹桥",
          to: "南京南",
          departure: `${date}T08:00`,
          arrival: `${date}T09:00`,
        },
      ],
    },
  });
  const opts = journeyOptions(p);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].direction, "arrival");
  const b = {
    day: 1,
    at: opts[0].at,
    station: "南京南",
    mode: "rail" as const,
    serviceNumber: "G100",
    ticketRef: { evidenceId: "ticket-one", index: 0 },
  };
  assert.throws(
    () =>
      applyJourney(p, {
        ...DEFAULT_JOURNEY,
        arrival: { ...b, at: `${date}T10:00` },
      }),
    /引用已失效/,
  );
  applyJourney(p, { ...DEFAULT_JOURNEY, arrival: b });
  assert.equal(p.journey!.arrival!.source, "ticket");
  const check = checkSchedule(p.days[0], [], "balanced");
  checkJourney(p, p.days[0], check);
  assert.ok(check.issues.some((i) => i.code === "ticket_stale"));
});
test("arrival, departure and route buffers report missed connections independently", () => {
  const p = plan(),
    date = p.days[0].date;
  applyJourney(p, {
    ...DEFAULT_JOURNEY,
    arrival: {
      day: 1,
      at: `${date}T10:00`,
      station: "南京南站",
      mode: "rail",
      serviceNumber: "G100",
    },
    departure: {
      day: 3,
      at: `${p.days[2].date}T16:00`,
      station: "南京南站",
      mode: "rail",
      serviceNumber: "G101",
    },
    withSeniors: true,
  });
  const day = p.days[0];
  day.stops[0].time = "09:00";
  day.stops[1].time = "10:20";
  const leg: TravelLeg = {
    fromId: day.stops[0].id!,
    toId: day.stops[1].id!,
    fromName: "南京南站",
    toName: day.stops[1].name,
    mode: "driving",
    minutes: 30,
    meters: 10000,
    walkingMeters: 0,
    bufferMinutes: 10,
    availableMinutes: null,
    slackMinutes: null,
    fact: { status: "verified", detail: "fixture" },
  };
  const checked = checkSchedule(day, [leg], "balanced");
  checkJourney(p, day, checked);
  assert.ok(checked.issues.some((i) => i.code === "arrival_early"));
  assert.ok(checked.issues.some((i) => i.code === "arrival_connection"));
  p.days[2].stops.at(-1)!.time = "15:30";
  const dep = checkSchedule(p.days[2], [], "balanced");
  checkJourney(p, p.days[2], dep);
  assert.ok(dep.issues.some((i) => i.code === "departure_late"));
});
test("global cost/journey edits are previewed, versioned and undo restores both plan and request", async () => {
  const j = await job(),
    before = structuredClone(j.plan!);
  let d = startRevision(
    j,
    {
      baseRevision: 1,
      day: 1,
      action: "budget",
      costs: { ...input(before), travelers: 3 },
    },
    config,
  );
  await wait(j);
  assert.deepEqual(j.plan, before);
  assert.equal(revisionPreview(j)!.days!.length, 3);
  assert.equal(revisionPreview(j)!.action, "budget");
  applyRevision(j, d.id, 1);
  assert.equal(j.request.travelers, 3);
  assert.equal(j.plan!.request.travelers, 3);
  undoRevision(j, 2);
  assert.deepEqual(j.plan!.costs, before.costs);
  assert.equal(j.request.travelers, 2);
  d = startRevision(
    j,
    {
      baseRevision: 3,
      day: 1,
      action: "journey",
      journey: {
        ...DEFAULT_JOURNEY,
        departure: {
          day: 3,
          at: `${before.days[2].date}T18:00`,
          station: "南京南站",
          mode: "rail",
          serviceNumber: "G101",
        },
      },
    },
    config,
  );
  await wait(j);
  applyRevision(j, d.id, 3);
  const anchor = j.plan!.journey!.departure!.stopId!;
  assert.throws(
    () =>
      startRevision(
        j,
        { baseRevision: 4, day: 3, action: "remove", stopId: anchor },
        config,
      ),
    /解除关联/,
  );
  undoRevision(j, 4);
  assert.equal(j.plan!.journey, undefined);
  assert.deepEqual(j.plan!.days, before.days);
});
test("repair rechecks conflicts, preserves locked fields and untouched dates, and does not promise unknowns solved", async (t) => {
  const j = await job();
  j.plan!.days[0].stops[0].duration = "5小时";
  await verifyPlan(j.plan!, config);
  const before = structuredClone(j.plan!),
    locked = before.days[0].stops[0];
  let prompts = "";
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const messages = JSON.parse(String(init!.body)).messages;
    prompts = messages[0].content;
    const day = structuredClone(before.days[0]);
    day.stops[1].time = "15:30";
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({
              ...day,
              explanation: "仅推迟第二站，未知路线仍需确认",
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
      action: "repair",
      repairStrategy: "preserve",
      lockedStopIds: [locked.id],
    },
    { ...config, apiKey: "fixture-only" },
  );
  await wait(j);
  assert.match(prompts, /修复 day.check/);
  const impact = j.editDraft!.summary!.repair!;
  assert.ok(impact.beforeConflicts > impact.afterConflicts);
  assert.ok(impact.unresolved.length > 0);
  assert.deepEqual(j.plan, before);
  assert.deepEqual(j.editDraft!.candidate!.days.slice(1), before.days.slice(1));
  const revised = j.editDraft!.candidate!.days[0].stops[0];
  for (const field of ["id", "time", "duration", "name", "cost"] as const)
    assert.equal(revised[field], locked[field]);
  cancelRevision(j, d.id);
});
test("repair feedback keeps the better first candidate when retry adds conflicts", async (t) => {
  const j = await job(),
    original = structuredClone(j.plan!);
  j.plan!.days[0].stops[0].duration = "7小时";
  await verifyPlan(j.plan!, config);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    const day = structuredClone(original.days[0]);
    day.stops[0].duration = calls === 1 ? "5小时" : "8小时";
    return Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ ...day, explanation: "固定测试候选" }),
          },
        },
      ],
    });
  });
  const d = startRevision(
    j,
    { baseRevision: 1, day: 1, action: "repair", repairStrategy: "preserve" },
    { ...config, apiKey: "fixture-only" },
  );
  await wait(j);
  assert.equal(calls, 2);
  assert.equal(j.editDraft!.summary!.repair!.attempts, 2);
  assert.equal(j.editDraft!.candidate!.days[0].stops[0].duration, "5小时");
  assert.ok(
    j.editDraft!.summary!.warnings.some((w) => w.includes("保留第一轮")),
  );
  cancelRevision(j, d.id);
});
test("transit requests and cache distinguish departure time and transfer preference", async (t) => {
  const p = plan();
  p.mode = "live";
  p.request.mode = "live";
  p.days = p.days.slice(0, 1);
  p.days[0].stops = p.days[0].stops.slice(0, 2);
  for (const [i, s] of p.days[0].stops.entries()) {
    s.verified = true;
    s.poiId = `BCACHE${i}`;
    s.placeCheckedAt = new Date().toISOString();
    s.location = [118.7 + i * 0.01, 32.1];
    s.openingInfo = {
      today: "",
      weekly: "每天00:00-23:59",
      checkedAt: new Date().toISOString(),
      source: "fixture",
      url: "",
    };
  }
  const queries: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const u = new URL(String(input));
    assert.ok(u.pathname.includes("/transit/"));
    queries.push(u);
    return Response.json({
      status: "1",
      route: {
        transits: [
          { duration: "1800", distance: "4000", walking_distance: "300" },
        ],
      },
    });
  });
  const cfg = { ...config, amapKey: "planning-cache-fixture" };
  await verifyPlan(p, cfg, { mode: "transit" });
  await verifyPlan(p, cfg, { mode: "transit" });
  assert.equal(queries.length, 1);
  assert.equal(queries[0].searchParams.get("time"), "12:30");
  p.journey = { ...DEFAULT_JOURNEY, transferPreference: "less" };
  await verifyPlan(p, cfg, { mode: "transit" });
  assert.equal(queries.length, 2);
  assert.equal(queries[1].searchParams.get("strategy"), "2");
  p.days[0].stops[0].time = "11:00";
  await verifyPlan(p, cfg, { mode: "transit" });
  assert.equal(queries.length, 3);
  assert.equal(queries[2].searchParams.get("time"), "13:30");
});
test("HTML includes escaped cost formulas, ranges and unbooked journey constraints", () => {
  const p = plan();
  applyCostInput(p, {
    travelers: 3,
    rooms: 2,
    nights: 2,
    entries: [entry({ label: "<script>bad</script>" })],
  });
  applyJourney(p, {
    ...DEFAULT_JOURNEY,
    departure: {
      day: 3,
      at: `${p.days[2].date}T18:00`,
      station: "南京南站",
      mode: "rail",
      serviceNumber: "G101",
    },
  });
  refreshFacts(p);
  const map = {
    image: "data:image/svg+xml;base64,PHN2Zy8+",
    kind: "schematic" as const,
    caption: "示意",
    missing: [],
    stops: [],
  };
  const html = buildTravelHtml(
    p,
    p.days.map(() => map),
    map,
  );
  assert.ok(html.includes("× 3 人"));
  assert.ok(html.includes("¥300 — ¥450"));
  assert.ok(html.includes("未代表已购票"));
  assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(!html.includes("<script>bad</script>"));
});
