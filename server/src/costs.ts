import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Plan } from "../../shared/types.js";
import {
  COST_CATEGORIES,
  costAmount,
  costFormula,
  type CostCategory,
  type CostEntry,
  type CostInput,
} from "../../shared/planning.js";
const price = z.number().finite().min(0).max(1000000).nullable();
export const costInputSchema = z
  .object({
    travelers: z.number().int().min(1).max(20),
    rooms: z.number().int().min(1).max(20),
    nights: z.number().int().min(0).max(30),
    entries: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            label: z.string().trim().min(1).max(150),
            category: z.enum([
              "tickets",
              "food",
              "hotel",
              "intercity",
              "local",
              "other",
            ]),
            stopId: z.string().uuid().optional(),
            unit: z.enum(["person", "room_night", "fixed"]),
            unitPrice: price,
            highPrice: price,
            source: z.enum(["plan", "user"]),
            note: z.string().max(1000),
            review: z.boolean().optional(),
          })
          .strict()
          .refine(
            (e) =>
              e.unitPrice === null
                ? e.highPrice === null
                : e.highPrice !== null && e.highPrice >= e.unitPrice,
            "费用区间上限不能小于下限；未知请同时留空",
          ),
      )
      .min(1, "至少保留一项费用；尚未确定的金额请留空")
      .max(180),
  })
  .strict();
function category(name: string): CostCategory {
  if (/往返|机票|高铁|城际|跨城/.test(name)) return "intercity";
  if (/市内|当地交通/.test(name)) return "local";
  if (/住宿|酒店/.test(name)) return "hotel";
  if (/门票|景点/.test(name)) return "tickets";
  if (/餐饮|餐费|美食|用餐/.test(name)) return "food";
  return "other";
}
export function ensureCosts(plan: Plan) {
  if (plan.costs?.version === 1) return;
  const rooms = Math.max(1, Math.ceil(plan.request.travelers / 2)),
    nights = Math.max(0, plan.days.length - 1),
    entries: CostEntry[] = [];
  for (const row of plan.budget) {
    const cat = category(row.category),
      type = cat === "tickets" ? "attraction" : cat === "food" ? "food" : "";
    const stops = plan.days
      .flatMap((d) => d.stops)
      .filter((s) => s.type === type);
    const known = stops.every((s) => s.cost !== null),
      sum = stops.reduce((n, s) => n + (s.cost || 0), 0);
    const canSplit =
      type &&
      stops.length &&
      known &&
      row.amount !== null &&
      row.amount >= sum &&
      plan.budget.filter((b) => category(b.category) === cat).length === 1;
    if (canSplit)
      for (const s of stops)
        entries.push({
          id: randomUUID(),
          label: s.name,
          category: cat,
          stopId: s.id,
          unit: "person",
          unitPrice: s.cost! / plan.request.travelers,
          highPrice: s.cost! / plan.request.travelers,
          source: "plan",
          note: "原全体小计按人数均摊；不是实际票种单价",
          review: true,
        });
    const amount = canSplit
      ? Math.round((row.amount! - sum) * 100) / 100
      : row.amount;
    if (canSplit && amount === 0) continue;
    const hotelExact =
      cat === "hotel" &&
      nights > 0 &&
      plan.hotel.nightlyEstimate !== null &&
      Math.round(plan.hotel.nightlyEstimate * rooms * nights * 100) / 100 ===
        amount;
    entries.push({
      id: randomUUID(),
      label: canSplit ? `${row.category}未分配部分` : row.category,
      category: cat,
      unit: hotelExact ? "room_night" : "fixed",
      unitPrice: hotelExact ? plan.hotel.nightlyEstimate : amount,
      highPrice: hotelExact ? plan.hotel.nightlyEstimate : amount,
      source: "plan",
      note: `${row.basis}${hotelExact ? "；间数按两人一间推算，请核对" : "；原分类总额保留，计费口径待核对"}`,
      review: true,
    });
  }
  plan.costs = {
    version: 1,
    rooms,
    nights,
    entries,
    low: plan.totalEstimate,
    high: plan.totalEstimate,
    unknown: plan.unknownCosts,
    review: entries.filter((e) => e.review).length,
  };
  // Migration preserves the original category amounts; recomputation occurs on an explicit edit.
}
export function recalculateCosts(plan: Plan) {
  ensureCosts(plan);
  const c = plan.costs!;
  c.low = c.high = c.unknown = 0;
  c.review = c.entries.filter((e) => e.review).length;
  for (const e of c.entries) {
    const low = costAmount(e, plan.request.travelers, c.rooms, c.nights),
      high = costAmount(e, plan.request.travelers, c.rooms, c.nights, true);
    c.low += low || 0;
    c.high += high || 0;
    if (low === null || high === null) c.unknown++;
  }
  c.low = Math.round(c.low * 100) / 100;
  c.high = Math.round(c.high * 100) / 100;
  plan.budget = Object.entries(COST_CATEGORIES).flatMap(([key, label]) => {
    const rows = c.entries.filter((e) => e.category === key);
    if (!rows.length) return [];
    const amounts = rows.map((e) =>
      costAmount(e, plan.request.travelers, c.rooms, c.nights),
    );
    const missing = amounts.some((n) => n === null);
    return [
      {
        category: label,
        amount: missing
          ? null
          : Math.round(
              amounts.reduce<number>((n, v) => n + (v || 0), 0) * 100,
            ) / 100,
        basis: rows
          .map(
            (e) =>
              `${e.label} ${costFormula(e, plan.request.travelers, c.rooms, c.nights)}`,
          )
          .join("；"),
        status: missing ? ("unknown" as const) : ("estimate" as const),
      },
    ];
  });
  plan.totalEstimate = c.low;
  plan.unknownCosts = c.unknown;
  for (const s of plan.days.flatMap((d) => d.stops)) {
    const linked = c.entries.filter((e) => e.stopId === s.id);
    if (!linked.length) continue;
    const amounts = linked.map((e) =>
      costAmount(e, plan.request.travelers, c.rooms, c.nights),
    );
    s.cost = amounts.some((n) => n === null)
      ? null
      : Math.round(amounts.reduce<number>((n, v) => n + (v || 0), 0) * 100) /
        100;
    if (linked.some((e) => e.source === "user"))
      s.userProvidedFields = [
        ...new Set([...(s.userProvidedFields || []), "cost"]),
      ];
  }
}
export function applyCostInput(plan: Plan, raw: CostInput) {
  ensureCosts(plan);
  const input = costInputSchema.parse(raw),
    old = plan.costs!;
  if (new Set(input.entries.map((e) => e.id)).size !== input.entries.length)
    throw Error("费用项目 ID 重复");
  const stops = plan.days.flatMap((d) => d.stops),
    ids = new Set(stops.map((s) => s.id));
  const linked = new Set<string>();
  for (const e of input.entries)
    if (e.stopId) {
      if (!ids.has(e.stopId) || linked.has(e.stopId))
        throw Error("每个停留点只关联一项费用，请合并或取消关联");
      const stop = stops.find((s) => s.id === e.stopId)!;
      if (
        (stop.type === "attraction" && e.category !== "tickets") ||
        (stop.type === "food" && e.category !== "food") ||
        !["attraction", "food"].includes(stop.type)
      )
        throw Error(
          "仅景点门票、餐饮可关联对应停留点；酒店与交通按独立项目计费",
        );
      linked.add(e.stopId);
    }
  input.entries = input.entries.map((e) => {
    const prior = old.entries.find((x) => x.id === e.id);
    const unchanged =
      prior &&
      [
        "label",
        "category",
        "stopId",
        "unit",
        "unitPrice",
        "highPrice",
        "note",
        "review",
      ].every((k) => prior[k as keyof CostEntry] === e[k as keyof CostEntry]);
    return { ...e, source: unchanged ? prior.source : "user" };
  });
  const changedPeople = plan.request.travelers !== input.travelers;
  // Unlinked stop estimates cannot be recalculated reliably after changing party size.
  if (changedPeople)
    for (const s of stops.filter((s) => !linked.has(s.id!))) {
      s.cost = null;
      s.userProvidedFields = (s.userProvidedFields || []).filter(
        (k) => k !== "cost",
      );
    }
  for (const e of old.entries.filter(
    (e) => e.stopId && !linked.has(e.stopId),
  )) {
    const s = stops.find((s) => s.id === e.stopId);
    if (s) s.cost = null;
  }
  plan.request.travelers = input.travelers;
  plan.costs = {
    ...old,
    rooms: input.rooms,
    nights: input.nights,
    entries: input.entries,
  };
  if (changedPeople)
    for (const e of plan.costs.entries) if (e.unit === "fixed") e.review = true;
  recalculateCosts(plan);
  const warnings = changedPeople
    ? [
        "人数已更新。按人计费项目自动重算；未关联费用的停留点金额已清空，整笔金额和原票务人数需重新核对。",
      ]
    : [];
  if (!input.entries.length)
    warnings.push("费用明细已清空。当前为未录入开销，不代表旅行免费。");
  if (plan.costs.high > plan.request.budget)
    warnings.push(
      `已知费用上限超出预算 ¥${Math.round(plan.costs.high - plan.request.budget)}`,
    );
  return warnings;
}
export function reconcileCosts(
  before: Plan,
  after: Plan,
  day: number,
): string[] {
  if (!after.costs) return [];
  const warnings: string[] = [],
    old = before.days.find((d) => d.day === day)!,
    next = after.days.find((d) => d.day === day)!;
  let changed = false;
  for (const s of old.stops)
    if (!next.stops.some((n) => n.id === s.id)) {
      const rows = after.costs.entries.filter((e) => e.stopId === s.id);
      if (rows.length) {
        after.costs.entries = after.costs.entries.filter(
          (e) => e.stopId !== s.id,
        );
        changed = true;
      } else if (s.cost !== 0) {
        const cat =
          s.type === "attraction"
            ? "tickets"
            : s.type === "food"
              ? "food"
              : null;
        for (const e of after.costs.entries.filter(
          (e) => !e.stopId && e.category === cat,
        )) {
          e.unitPrice = e.highPrice = null;
          e.review = true;
          changed = true;
        }
        warnings.push(
          `${s.name}未关联独立费用，移除后无法准确扣减，相关未分配金额已标为待核算`,
        );
      }
    }
  for (const s of next.stops) {
    const previous = old.stops.find((o) => o.id === s.id),
      rows = after.costs.entries.filter((e) => e.stopId === s.id);
    if (
      previous &&
      previous.name === s.name &&
      previous.type === s.type &&
      previous.cost === s.cost
    )
      continue;
    if (rows.length) {
      if (!["attraction", "food"].includes(s.type)) {
        after.costs.entries = after.costs.entries.filter(
          (e) => e.stopId !== s.id,
        );
        changed = true;
        warnings.push(
          `${s.name}已改为住宿或交通，旧门票/餐饮费用已移除，请核对对应全程费用`,
        );
        continue;
      }
      const e = rows[0];
      e.label = s.name;
      e.category = s.type === "food" ? "food" : "tickets";
      if (!previous || previous.cost !== s.cost || previous.name !== s.name) {
        e.unitPrice =
          s.cost === null
            ? null
            : e.unit === "person"
              ? s.cost / after.request.travelers
              : s.cost;
        e.highPrice = e.unitPrice;
        e.unit = e.unit === "person" ? "person" : "fixed";
        e.source = s.userProvidedFields?.includes("cost") ? "user" : "plan";
        e.review = true;
        e.note = "行程修改后的小计，区间与计费口径需重新确认";
      }
      changed = true;
    } else if (["attraction", "food"].includes(s.type)) {
      const cat = s.type === "food" ? "food" : "tickets";
      const unallocated = after.costs.entries.filter(
        (e) => !e.stopId && e.category === cat,
      );
      // Never add a new stop price on top of a possibly inclusive category total.
      for (const e of unallocated) {
        e.unitPrice = e.highPrice = null;
        e.review = true;
        e.note += "；停留点变化后未分配余额待重算";
      }
      after.costs.entries.push({
        id: randomUUID(),
        stopId: s.id,
        label: s.name,
        category: cat,
        unit: "person",
        unitPrice: s.cost === null ? null : s.cost / after.request.travelers,
        highPrice: s.cost === null ? null : s.cost / after.request.travelers,
        source: s.userProvidedFields?.includes("cost") ? "user" : "plan",
        note: "按当前停留点小计均摊，票种和单价需核对",
        review: true,
      });
      changed = true;
      if (unallocated.length)
        warnings.push(
          `${s.name}已关联独立费用，原分类未分配金额标为未知，避免重复计入；请补齐其余开销`,
        );
    } else if (previous?.cost !== s.cost)
      warnings.push(`${s.name}费用未关联账本，请在费用明细中调整相应项目`);
  }
  if (changed) recalculateCosts(after);
  if (after.totalEstimate > after.request.budget)
    warnings.push(
      `已知参考费用超出预算 ¥${Math.round(after.totalEstimate - after.request.budget)}`,
    );
  return warnings;
}
