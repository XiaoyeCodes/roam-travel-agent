import type { DayPlan, Plan, Stop } from "../../shared/types.js";
import {
  dayCheckPresentation,
  stopTrustSummary,
  type CheckNotice,
} from "../../shared/quality-presentation.js";
import {
  checkedLabel,
  effectiveFact,
  FACT_LABELS,
  LOCAL_MODE_LABELS,
  minuteLabel,
  safeSourceUrl,
  TRUST_LABELS,
  type Fact,
} from "../../shared/quality.js";
const h = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function factHtml(label: string, input?: Fact) {
  const fact = effectiveFact(
      input || { status: "unknown", detail: "尚未核验" },
    ),
    url = safeSourceUrl(fact.url);
  return `<details class="fact-detail fact-${fact.status}"><summary><span>${h(label)}</span><b>${TRUST_LABELS[fact.status]}</b></summary><div class="fact-explanation"><p>${h(fact.detail)}</p>${fact.source ? `<span>来源：${h(fact.source)}</span>` : ""}${fact.checkedAt ? `<span>查询：${h(checkedLabel(fact.checkedAt))}</span>` : ""}${fact.expiresAt ? `<span>建议更新：${h(checkedLabel(fact.expiresAt))}</span>` : ""}${url ? `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a>` : ""}</div></details>`;
}
export function stopFactsHtml(stop: Stop) {
  return `<details class="stop-trust" aria-label="${h(stop.name)}信息可信状态"><summary>${h(stopTrustSummary(stop))}</summary><div class="stop-facts">${(Object.keys(FACT_LABELS) as (keyof typeof FACT_LABELS)[]).map((key) => factHtml(FACT_LABELS[key], stop.facts?.[key])).join("")}</div></details>`;
}
export function dayCheckHtml(day: DayPlan) {
  const check = day.check;
  if (!check)
    return `<section class="day-verification"><strong>这一天，走得通吗</strong><p class="schedule-note">当天尚未完成交通与时间核验，请在网页中核验后重新导出。</p></section>`;
  const { conflicts, actions, information } = dayCheckPresentation(day);
  const notice = (item: CheckNotice) =>
    `<article class="check-notice"><strong>${h(item.title)}</strong>${item.detail && item.key !== "map" ? `<p>${h(item.detail)}</p>` : ""}${item.action ? `<p>${item.action === "journey" ? "请回到网页的「班次与衔接」填写。" : "请回到网页编辑当天时间。"}</p>` : ""}${item.items.length > 1 || item.detail ? `<details class="check-originals"><summary>涉及哪些安排 · ${item.items.length} 条记录</summary><ul>${item.items.map((text) => `<li>${h(text)}</li>`).join("")}</ul></details>` : ""}</article>`;
  const partial = check.queriedLegs < check.totalLegs ? "（部分）" : "";
  const metrics = `<div class="verification-metrics"><span>停留 ${minuteLabel(check.visitMinutes)}${check.unknownDurations ? ` + ${check.unknownDurations} 项未知` : ""}</span>${check.queriedLegs ? `<span>已查交通 ${minuteLabel(check.travelMinutes)}${partial}</span><span>站间步行 ${(check.walkingMeters / 1000).toFixed(1)} km${partial}</span><span>已查 ${check.queriedLegs}/${check.totalLegs} 段</span>` : ""}</div>`;
  const actionHtml = actions.length
    ? `<div class="check-actions">${actions.slice(0, 3).map(notice).join("")}${actions.length > 3 ? `<details><summary>另外 ${actions.length - 3} 项提醒</summary>${actions.slice(3).map(notice).join("")}</details>` : ""}</div>`
    : "";
  const infoHtml = information.length
    ? `${information
        .filter((item) => item.key === "map")
        .map(
          (item) =>
            `<p class="check-coverage-note"><strong>${h(item.title)}。</strong>${h(item.detail)}</p>`,
        )
        .join(
          "",
        )}<details class="check-information"><summary>查询资料与说明 · ${information.length} 类${information.some((item) => item.key === "map") ? "（含地图与交通缺口）" : ""}</summary>${information.map(notice).join("")}</details>`
    : "";
  const legs = check.legs
    .map(
      (leg, i) =>
        `<article class="travel-leg"><strong>${i + 1} → ${i + 2}　${h(leg.fromName)} → ${h(leg.toName)}</strong><p>${LOCAL_MODE_LABELS[leg.mode]} · ${leg.minutes === null ? "耗时待查" : `约 ${leg.minutes} 分钟`} · ${leg.meters === null ? "距离待查" : `${(leg.meters / 1000).toFixed(1)} km`} · 预留 ${leg.bufferMinutes} 分钟</p>${leg.slackMinutes !== null ? `<p class="${leg.slackMinutes < 0 ? "negative" : ""}">${leg.slackMinutes < 0 ? `衔接少 ${-leg.slackMinutes} 分钟` : `衔接余量 ${leg.slackMinutes} 分钟`}</p>` : ""}${factHtml("交通依据", leg.fact)}${safeSourceUrl(leg.navigationUrl) ? `<a href="${h(safeSourceUrl(leg.navigationUrl))}" target="_blank" rel="noopener noreferrer">打开这段导航 ↗</a>` : ""}</article>`,
    )
    .join("");
  return `<section class="day-verification ${conflicts.length ? "has-conflicts" : ""}" aria-label="第 ${day.day} 天时间与交通核验"><div class="verification-head"><strong>这一天，走得通吗</strong><span>${conflicts.length ? `${conflicts.length} 项时间冲突` : check.status === "partial" ? "部分数据未取得" : "已完成当前可用信息检查"}</span></div>${metrics}${conflicts.map((item) => `<p class="schedule-conflict">${h(item.message)}</p>`).join("")}${actionHtml}${infoHtml}<details class="verification-details"><summary>查看交通分段 · ${check.queriedLegs}/${check.totalLegs} 段已查到</summary><div class="travel-legs">${legs}</div></details><details class="verification-method"><summary>检查时间与计算说明</summary><p class="verification-footnote">${h(checkedLabel(check.checkedAt))} · 耗时为查询时参考；步行不含景区内部。站间默认预留 10 分钟；已确认班次另按班次设置计入进出站缓冲。未确认班次时，火车站 / 机场使用参考缓冲，请按实际要求核对。</p></details></section>`;
}
export function revisionHtml(plan: Plan) {
  const change = plan.lastRevision;
  return `<aside class="revision-note"><strong>行程版本 V${plan.revision || 1}</strong><p>本手册保存已应用的行程与核验结果。继续调整请返回网页，应用修改后重新导出。</p>${change ? `<details><summary>最近修改 · ${h(change.instruction)}</summary><p>${h(checkedLabel(change.createdAt))} · ${change.scope === "trip" ? "全程设置" : `第 ${change.day} 天`} · 参考费用变化 ${change.budgetDelta >= 0 ? "+" : ""}¥${change.budgetDelta.toFixed(2)}${change.budgetIncomplete ? "（金额不完整）" : ""}</p>${change.repair ? `<p>重新核验：时间冲突 ${change.repair.beforeConflicts} → ${change.repair.afterConflicts} 项；待确认事项 ${change.repair.beforeWarnings} → ${change.repair.afterWarnings} 项。未知信息不代表已解决。</p>` : ""}${change.changes.map((c) => `<p>${h(c.name)}：${h(c.details.join("；"))}</p>`).join("")}</details>` : ""}</aside>`;
}
