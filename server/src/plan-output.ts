import type { AgentReport, Evidence, Job, Plan } from "../../shared/types.js";
import { budgetTotals, dateAt, planSchema } from "./schema.js";
import { line, object, strings } from "./structured-output.js";

function amount(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizePlan(value: unknown) {
  const raw = object(value),
    transport = object(raw.transport),
    hotel = object(raw.hotel);
  return {
    title: line(raw.title, 4000),
    subtitle: line(raw.subtitle, 4000),
    summary: line(raw.summary, 4000),
    days: Array.isArray(raw.days)
      ? raw.days.map((item, i) => {
          const day = object(item);
          return {
            day: i + 1,
            title: line(day.title, 4000),
            subtitle: line(day.subtitle, 4000),
            weather: line(day.weather, 4000, "天气待查询"),
            note: line(day.note, 4000),
            stops: Array.isArray(day.stops)
              ? day.stops.map((item) => {
                  const stop = object(item);
                  const types: Record<string, string> = {
                    景点: "attraction",
                    美食: "food",
                    餐饮: "food",
                    酒店: "hotel",
                    住宿: "hotel",
                    交通: "transport",
                  };
                  return {
                    name: line(stop.name, 150),
                    time: line(stop.time, 30, "待安排"),
                    duration: line(stop.duration, 80, "待确认"),
                    type: types[stop.type] || stop.type,
                    description: line(stop.description, 4000),
                    tip: line(stop.tip, 4000),
                    cost: amount(stop.cost),
                    sourceIds: strings(stop.sourceIds, 50, 200),
                    photoQuery: line(stop.photoQuery, 160) || undefined,
                    poiId:
                      typeof stop.poiId === "string" &&
                      /^[a-zA-Z0-9_-]{1,80}$/.test(stop.poiId)
                        ? stop.poiId
                        : null,
                  };
                })
              : [],
          };
        })
      : [],
    budget:
      Array.isArray(raw.budget) && raw.budget.length
        ? raw.budget.map((item) => {
            const budget = object(item),
              total = amount(budget.amount);
            return {
              category: line(budget.category, 100, "待核算费用"),
              amount: total,
              basis: line(budget.basis, 4000, "具体费用待核算"),
              status: total === null ? "unknown" : "estimate",
            };
          })
        : [
            {
              category: "全程费用",
              amount: null,
              basis: "费用尚未取得，不能视为零支出",
              status: "unknown",
            },
          ],
    tips: strings(raw.tips, 15, 4000),
    warnings: strings(raw.warnings, 20, 4000),
    transport: {
      mode: line(transport.mode, 4000, "待确认"),
      outbound: line(transport.outbound, 4000, "去程待查询"),
      inbound: line(transport.inbound, 4000, "返程待查询"),
      note: line(transport.note, 4000, "实际班次与费用待确认"),
    },
    hotel: {
      name: line(hotel.name, 4000, "待检索"),
      area: line(hotel.area, 4000, "待确认"),
      reason: line(hotel.reason, 4000, "住宿尚待查询"),
      nightlyEstimate: amount(hotel.nightlyEstimate),
    },
  };
}

export const planDraftNotice =
  "当前为待完善草案：已保留确认的旅行方向、专家报告与查询资料；每日时间、交通衔接和费用尚未完整安排，请完善后再据此出行。";

export function fallbackPlan(job: Job) {
  const request = job.request,
    selection = job.confirmedSelection;
  return planSchema.parse({
    title: `${request.destination}旅行 · 待完善草案`,
    subtitle: "先保留已确认的方向和已查询资料，继续完善每天的安排",
    summary:
      selection?.option.summary ||
      "根据你的旅行需求保留每日规划框架，具体安排待完善。",
    days: Array.from({ length: request.days }, (_, i) => {
      const outline = selection?.option.outline[i];
      return {
        day: i + 1,
        title: outline?.title || `第 ${i + 1} 天 · 待完善`,
        subtitle: "时间与可行性待核对",
        weather: "天气待查询",
        note: "沿用已确认方向中的候选地点；地点种类、开放时间和交通仍需核验，不代表已完成详细安排。",
        stops: (outline?.places.length
          ? outline.places
          : ["具体地点待研究与确认"]
        )
          .slice(0, 5)
          .map((name) => ({
            name,
            time: "待安排",
            duration: "待确认",
            type: "attraction",
            description: "来自已确认的规划方向，具体活动待细化。",
            cost: null,
            tip: "请先完善时间与交通衔接，再作为出行安排使用。",
            sourceIds: [],
            poiId: null,
          })),
      };
    }),
    budget: ["往返交通", "住宿", "餐饮", "门票", "市内交通", "预留"]
      .filter((c) => c !== "住宿" || request.days > 1)
      .map((category) => ({
        category,
        amount: null,
        basis: "全体旅客全程金额待核算，未知金额不能视为零。",
        status: "unknown",
      })),
    tips: [
      "可以在每日行程中调整安排，专家报告和查询结果已保留在协作过程与信息来源中。",
    ],
    warnings: [
      planDraftNotice,
      ...(request.notes || selection?.notes.length
        ? ["补充意见已保留，但本草案尚未完成逐项可行性核对。"]
        : []),
    ],
    transport: {
      mode: {
        smart: "交通方式待比较",
        train: "高铁 / 火车",
        flight: "飞机",
        drive: "自驾",
      }[request.transport],
      outbound: "去程班次待查询",
      inbound: "返程班次待查询",
      note: "未确认交通班次，不应据此判断到达或离开时间。",
    },
    hotel: {
      name: "待检索",
      area: "待确认",
      reason:
        request.days > 1 ? "住宿待专家结果进一步核对" : "当天往返不安排住宿",
      nightlyEstimate: null,
    },
  });
}

export function emergencyPlan(
  job: Job,
  evidence: Evidence[],
  reports: AgentReport[],
): Plan {
  const parsed = fallbackPlan(job);
  return {
    ...parsed,
    id: job.id,
    request: job.request,
    destination: job.request.destination,
    days: parsed.days.map((day, i) => ({
      ...day,
      date: dateAt(job.request.startDate, i),
      stops: day.stops.map((stop) => ({
        ...stop,
        location: null,
        verified: false,
      })),
    })),
    ...budgetTotals(parsed.budget),
    evidence,
    reports,
    images: [],
    mode: job.request.mode,
    confirmedSelection: job.confirmedSelection,
    createdAt: new Date().toISOString(),
  };
}
