import type { Job, TripRequest } from "../../shared/types.js";
import { proposalSchema } from "./schema.js";
import { line, object, strings } from "./structured-output.js";

export function normalizeProposal(value: unknown, request: TripRequest) {
  const raw = object(value);
  return {
    message: line(
      raw.message,
      1000,
      "请选择适合你的旅行方向，也可以补充想法后调整。",
    ),
    options: Array.isArray(raw.options)
      ? raw.options.slice(0, 3).map((item) => {
          const option = object(item);
          const title = line(option.title, 100);
          const paces: Record<string, TripRequest["pace"]> = {
            relaxed: "relaxed",
            balanced: "balanced",
            packed: "packed",
            轻松: "relaxed",
            舒缓: "relaxed",
            慢游: "relaxed",
            均衡: "balanced",
            适中: "balanced",
            紧凑: "packed",
          };
          return {
            title,
            summary: line(option.summary, 800),
            highlights: strings(option.highlights, 6, 150).length
              ? strings(option.highlights, 6, 150)
              : [title],
            outline: Array.isArray(option.outline)
              ? option.outline.map((item, i) => {
                  const day = object(item);
                  return {
                    day: i + 1,
                    title: line(day.title, 100),
                    places: strings(day.places, 5, 100),
                  };
                })
              : [],
            pace: paces[String(option.pace)] || request.pace,
            costNote: line(
              option.costNote,
              500,
              `全体 ${request.travelers} 人全程预算 ¥${request.budget}，各项费用尚待核算。`,
            ),
            cautions: strings(option.cautions, 5, 300),
            sourceUrls: strings(option.sourceUrls, 8, 2000),
          };
        })
      : [],
  };
}

export const proposalFallbackNotice =
  "已保留查询资料，并提供基础规划方向供你选择；具体地点、费用与可行性将在确认后继续研究。";
export const proposalRetainedNotice =
  "本轮暂未形成可用的新方案，已保留上一版和你的全部意见；确认后会按这些意见细化行程，也可以继续调整。";

// No invented locations, prices, citations or claimed research. These options
// express different planning strategies, not a finished or verified itinerary.
export function fallbackProposal(job: Job) {
  const request = job.request;
  return proposalSchema.parse({
    message: "先确定你更喜欢的旅行节奏，接下来会结合已查询资料细化具体安排。",
    options: [
      {
        title: `${request.destination} · 集中体验`,
        focus: "按片区集中安排核心体验，减少跨区往返",
        pace: request.pace,
      },
      {
        title: `${request.destination} · 留白慢游`,
        focus: "每天少安排一些活动，优先休息和交通便利",
        pace: "relaxed",
      },
    ].map(({ title, focus, pace }) => ({
      title,
      summary: `${focus}。这是待细化的基础方向，具体地点尚未确定。`,
      highlights: [focus, ...strings(request.preferences, 4, 150)],
      outline: Array.from({ length: request.days }, (_, i) => ({
        day: i + 1,
        title:
          request.days === 1
            ? "往返衔接与核心体验"
            : i === 0
              ? "抵达与安顿"
              : i === request.days - 1
                ? "留出返程时间"
                : focus,
        places: ["具体地点待研究与确认"],
      })),
      pace,
      costNote: `按全体 ${request.travelers} 人、全程 ¥${request.budget} 的预算目标研究；交通、住宿、门票等费用尚待核算，暂不判断是否足够。`,
      cautions: [
        "营业、预约、交通与步行强度仍需核验。",
        ...(request.notes || job.proposalFeedback?.length
          ? [
              "已保留你的补充意见，确认后的详细规划将逐项处理；此方向尚未完成可行性核对。",
            ]
          : []),
      ],
      sourceUrls: [],
    })),
  });
}
