import type { Plan } from "../../shared/types.js";
import {
  COST_CATEGORIES,
  costAmount,
  costFormula,
  journeyBuffer,
} from "../../shared/planning.js";
import { checkedLabel } from "../../shared/quality.js";
const h = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (n: number | null) =>
  n === null
    ? "待查"
    : `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
export function costsHtml(plan: Plan) {
  const c = plan.costs;
  if (!c) return "";
  return `<section class="cost-details" aria-label="逐笔费用明细"><h3>逐笔费用 · 单价、人数与房晚</h3><div class="revision-impact"><span>已知费用区间<b>${money(c.low)} — ${money(c.high)}</b></span><span>按已知上限计算的余量<b>${money(plan.request.budget - c.high)}</b></span></div><p class="schedule-note">${plan.request.travelers} 人 · ${c.rooms} 间 × ${c.nights} 晚 · ${c.unknown} 项金额未知 · ${c.review} 项口径待核对。未知金额未计入区间，余量可能减少。${!c.entries.length ? "尚未录入开销，不代表旅行免费。" : ""}</p><div class="cost-list">${c.entries.map((e) => `<article><div><strong>${h(e.label)}</strong><span>${COST_CATEGORIES[e.category]} · ${e.source === "user" ? "用户填写" : "计划估算"}${e.review ? " · 待核对" : ""}</span></div><b>${money(costAmount(e, plan.request.travelers, c.rooms, c.nights))}${e.highPrice !== e.unitPrice ? ` — ${money(costAmount(e, plan.request.travelers, c.rooms, c.nights, true))}` : ""}</b><p>${h(costFormula(e, plan.request.travelers, c.rooms, c.nights))}${e.note ? ` · ${h(e.note)}` : ""}</p></article>`).join("")}</div></section>`;
}
export function journeyHtml(plan: Plan) {
  const c = plan.journey;
  return `<section class="journey-details" aria-label="班次与行程衔接">${(
    ["arrival", "departure"] as const
  )
    .map((kind) => {
      const b = c?.[kind];
      return `<article><strong>${kind === "arrival" ? "到达目的地" : "离开目的地"}</strong><p>${b ? h(`${b.at.replace("T", " ")} · ${b.serviceNumber || "班次号未填"} · ${b.station}`) : "尚未确认班次时间"}</p>${b && c ? `<small>北京时间 · ${b.source === "ticket" ? `查询结果，${h(checkedLabel(b.queriedAt))}` : "用户填写"} · 预留 ${journeyBuffer(c, kind)} 分钟 · 未代表已购票</small>` : ""}</article>`;
    })
    .join(
      "",
    )}${c ? `<p class="schedule-note">出行情况：${[c.withChildren && "带儿童", c.withSeniors && "带长者", c.largeLuggage && "大件行李"].filter(Boolean).join("、") || "一般出行"} · 公交换乘偏好：${c.transferPreference === "less" ? "少换乘" : "综合考虑"}</p>` : ""}</section>`;
}
