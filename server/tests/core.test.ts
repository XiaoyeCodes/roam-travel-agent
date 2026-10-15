import test from "node:test";
import assert from "node:assert/strict";
import {
  tripRequestSchema,
  budgetTotals,
  dateAt,
  planSchema,
} from "../src/schema.js";
import { allowedTool } from "../src/mcp.js";
import { demoPlan, exampleRequest } from "../src/demo.js";
import { escapeHtml, schematic } from "../src/maps.js";
test("calendar validation rejects impossible days and preserves cross-month trips", () => {
  assert.equal(
    tripRequestSchema.safeParse({
      ...exampleRequest(),
      startDate: "2026-02-30",
    }).success,
    false,
  );
  assert.equal(dateAt("2026-12-31", 1), "2027-01-01");
  assert.equal(
    tripRequestSchema.safeParse({ ...exampleRequest(), days: 15 }).success,
    false,
  );
  assert.equal(
    tripRequestSchema.safeParse({ ...exampleRequest(), travelers: 0 }).success,
    false,
  );
});
test("budget keeps unknown amounts separate and uses currency rounding", () => {
  assert.deepEqual(
    budgetTotals([{ amount: 0.1 }, { amount: 0.2 }, { amount: null }]),
    { totalEstimate: 0.3, unknownCosts: 1 },
  );
  assert.deepEqual(budgetTotals([{ amount: null }]), {
    totalEstimate: 0,
    unknownCosts: 1,
  });
});
test("MCP tool access excludes purchasing and mutations, including misleading read prefixes", () => {
  for (const name of [
    "get_tickets",
    "query_flights",
    "maps_text_search",
    "maps_direction_driving",
  ])
    assert.equal(allowedTool(name), true);
  for (const name of [
    "book_ticket",
    "get_and_purchase_ticket",
    "cancel_order",
    "execute_shell",
    "delete_record",
    "send_message",
  ])
    assert.equal(allowedTool(name, [name]), false);
  assert.equal(allowedTool("get_tickets", ["query_flights"]), false);
});
test("demonstration is explicitly labelled and its budget agrees with daily tickets", () => {
  const plan = demoPlan("test");
  assert.equal(plan.totalEstimate, 3060);
  assert.equal(plan.evidence[0].status, "demo");
  assert.ok(plan.days.every((d) => d.weather.includes("未查询")));
  assert.equal(
    plan.days
      .flatMap((d) => d.stops)
      .filter((s) => s.type === "attraction")
      .reduce((n, s) => n + (s.cost || 0), 0),
    340,
  );
  assert.equal(planSchema.safeParse(plan).success, true);
});
test("map fallback is labelled, keeps all daily stop numbers, and escapes user text", () => {
  const plan = demoPlan("map");
  plan.destination = "<script>alert(1)</script>";
  const svg = schematic(plan, 1);
  assert.ok(svg.includes("非高德底图"));
  for (let i = 1; i <= 4; i++) assert.ok(svg.includes(`>1.${i}</text>`));
  assert.ok(!svg.includes("<script>"));
  assert.equal(escapeHtml("\"<>&'"), "&quot;&lt;&gt;&amp;&#39;");
});
