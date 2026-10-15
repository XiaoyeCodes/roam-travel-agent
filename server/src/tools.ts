import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { safeError } from "./config.js";
import type { ToolDef } from "./llm.js";
import type { Evidence, Photo } from "../../shared/types.js";
import { dateAt } from "./schema.js";
type ToolResult = { source: string; status: Evidence["status"]; data: unknown };
export type BuiltinTool = {
  definition: ToolDef;
  run: (args: unknown, signal?: AbortSignal) => Promise<ToolResult>;
};
const str = { type: "string" };
const def = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`外部服务返回 HTTP ${response.status}`);
  return response.json();
}
export async function amap(
  config: Config,
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  if (!config.amapKey) throw new Error("高德 Key 尚未配置");
  const data = await fetchJson(
    `https://restapi.amap.com/${endpoint}?${new URLSearchParams({ ...params, key: config.amapKey })}`,
    {},
    signal,
  );
  if (data.status !== "1")
    throw new Error(
      `高德服务调用失败（${String(data.infocode || "unknown")}）`,
    );
  return data;
}
export function makeTools(config: Config): BuiltinTool[] {
  return [
    {
      definition: def(
        "search_places",
        "高德 POI 搜索。按城市、用户偏好搜索景点/酒店/餐馆，返回 GCJ-02 坐标。酒店 POI 不等于实时房价。",
        {
          city: str,
          keywords: str,
          category: { type: "string", enum: ["attraction", "hotel", "food"] },
        },
        ["city", "keywords", "category"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            city: z.string().max(60),
            keywords: z.string().max(100),
            category: z.enum(["attraction", "hotel", "food"]),
          })
          .parse(raw);
        if (!config.amapKey)
          return {
            source: "高德 POI",
            status: "unconfigured",
            data: {
              message: "尚未配置高德 Key，无法核验地点、坐标、营业时间及价格。",
            },
          };
        const data = await amap(
          config,
          "v3/place/text",
          {
            city: args.city,
            keywords: args.keywords,
            types: { attraction: "110000", hotel: "100000", food: "050000" }[
              args.category
            ],
            citylimit: "true",
            offset: "12",
            extensions: "all",
          },
          signal,
        );
        return {
          source: "高德 POI",
          status: "live",
          data: data.pois.map((p: any) => ({
            id: p.id,
            name: p.name,
            address: p.address,
            location: p.location,
            type: p.type,
            tel: p.tel,
            rating: p.biz_ext?.rating,
            averageCost: p.biz_ext?.cost,
          })),
        };
      },
    },
    {
      definition: def(
        "weather_forecast",
        "查询目的地实际天气预报。Open-Meteo 仅覆盖未来约 16 天；远期日期必须标注无法预报，不能生成虚假天气。可用英文城市名提高地理编码命中率。",
        {
          city: str,
          startDate: str,
          days: { type: "integer", minimum: 1, maximum: 14 },
        },
        ["city", "startDate", "days"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            city: z.string().max(60),
            startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            days: z.number().int().min(1).max(14),
          })
          .parse(raw);
        const geo = await fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: args.city.replace(/市$/, ""), count: "3", language: "zh" })}`,
          {},
          signal,
        );
        const place =
          geo.results?.find((p: any) => p.country_code === "CN") ||
          geo.results?.[0];
        if (!place)
          return {
            source: "Open-Meteo",
            status: "error",
            data: { message: "未找到匹配城市，可尝试英文名称。" },
          };
        const weather = await fetchJson(
          `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "Asia/Shanghai", forecast_days: "16" })}`,
          {},
          signal,
        );
        const requested = Array.from({ length: args.days }, (_, i) =>
          dateAt(args.startDate, i),
        );
        const days = requested.map((date) => {
          const i = weather.daily.time.indexOf(date);
          return i < 0
            ? { date, available: false, message: "超出预报窗口，请临行前查询" }
            : {
                date,
                available: true,
                code: weather.daily.weather_code[i],
                high: weather.daily.temperature_2m_max[i],
                low: weather.daily.temperature_2m_min[i],
                rainProbability: weather.daily.precipitation_probability_max[i],
              };
        });
        return {
          source: "Open-Meteo",
          status: "live",
          data: {
            location: place.name,
            country: place.country,
            days,
            url: "https://open-meteo.com/",
          },
        };
      },
    },
    {
      definition: def(
        "search_web",
        "搜索可索引的旅行攻略、门票、营业时间、地方菜与交通信息。source 可限定小红书或携程；搜索摘要不是实时订单报价。",
        {
          query: str,
          source: { type: "string", enum: ["all", "xiaohongshu", "ctrip"] },
        },
        ["query", "source"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            query: z.string().max(500),
            source: z.enum(["all", "xiaohongshu", "ctrip"]),
          })
          .parse(raw);
        if (!config.searchKey)
          return {
            source: "Tavily Web Search",
            status: "unconfigured",
            data: {
              message: "尚未配置 Tavily 或搜索 MCP；攻略与价格需自行核验。",
            },
          };
        const data = await fetchJson(
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.searchKey}`,
            },
            body: JSON.stringify({
              query: args.query,
              max_results: 5,
              search_depth: "basic",
              ...(args.source === "all"
                ? {}
                : {
                    include_domains: [
                      args.source === "ctrip" ? "ctrip.com" : "xiaohongshu.com",
                    ],
                  }),
            }),
          },
          signal,
        );
        return {
          source: "Tavily Web Search",
          status: "live",
          data:
            data.results?.map((r: any) => ({
              title: r.title,
              url: r.url,
              content: String(r.content).slice(0, 1600),
            })) || [],
        };
      },
    },
    {
      definition: def(
        "driving_route",
        "高德自驾路线，需出发城市和目的地；返回真实里程、预计时长和通行费，不含油费/停车费。",
        { origin: str, destination: str },
        ["origin", "destination"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            origin: z.string().max(100),
            destination: z.string().max(100),
          })
          .parse(raw);
        if (!config.amapKey)
          return {
            source: "高德路线",
            status: "unconfigured",
            data: { message: "高德 Key 尚未配置，无法获取真实驾驶路线。" },
          };
        const geos = await Promise.all(
          [args.origin, args.destination].map((address) =>
            amap(config, "v3/geocode/geo", { address }, signal),
          ),
        );
        if (geos.some((g) => !g.geocodes?.[0]))
          throw new Error("无法定位出发地或目的地");
        const data = await amap(
          config,
          "v3/direction/driving",
          {
            origin: geos[0].geocodes[0].location,
            destination: geos[1].geocodes[0].location,
            extensions: "base",
          },
          signal,
        );
        return {
          source: "高德路线",
          status: "live",
          data: data.route.paths?.map((p: any) => ({
            distanceMeters: p.distance,
            durationSeconds: p.duration,
            tolls: p.tolls,
            trafficLights: p.traffic_lights,
          })),
        };
      },
    },
    {
      definition: def(
        "ticket_sources",
        "检查高铁和机票接入情况。实时车次/余票必须调用交通 MCP 查询；该工具不提供价格，不可当作查票成功。",
        { origin: str, destination: str, date: str, returnDate: str },
        ["origin", "destination", "date", "returnDate"],
      ),
      run: async (raw) => {
        const args = z
          .object({
            origin: z.string(),
            destination: z.string(),
            date: z.string(),
            returnDate: z.string(),
          })
          .parse(raw);
        return {
          source: "票务服务状态",
          status: "unconfigured",
          data: {
            ...args,
            message:
              "请调用已连接的交通 MCP 获取往返票务。若没有对应查询工具，车次、航班、余票、价格全部标记待查询；12306 只提供铁路票务，机票须另接服务。",
            railUrl: "https://www.12306.cn/",
            flightUrl: "https://flights.ctrip.com/",
          },
        };
      },
    },
    {
      definition: def(
        "calculate_budget",
        "对人民币费用项目进行确定性加总。amount 为全体旅客整个行程的小计；不把未知金额当成零。",
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: str,
                amount: { type: ["number", "null"] },
              },
              required: ["category", "amount"],
            },
          },
        },
        ["items"],
      ),
      run: async (raw) => {
        const args = z
          .object({
            items: z
              .array(
                z.object({
                  category: z.string(),
                  amount: z.number().min(0).nullable(),
                }),
              )
              .max(30),
          })
          .parse(raw);
        return {
          source: "预算计算器",
          status: "live",
          data: {
            ...args,
            totalKnown: args.items.reduce((s, i) => s + (i.amount ?? 0), 0),
            unknownItems: args.items
              .filter((i) => i.amount === null)
              .map((i) => i.category),
            note: "仅执行算术，输入价格真实性仍以对应来源为准",
          },
        };
      },
    },
  ];
}
export async function executeTool(
  tool: BuiltinTool,
  args: unknown,
  signal?: AbortSignal,
): Promise<Evidence> {
  const base = {
    id: randomUUID(),
    tool: tool.definition.function.name,
    queriedAt: new Date().toISOString(),
  };
  try {
    return { ...base, ...(await tool.run(args, signal)) };
  } catch (e) {
    signal?.throwIfAborted();
    return {
      ...base,
      status: "error",
      source: tool.definition.function.name,
      data: { message: safeError(e) },
    };
  }
}
export async function searchPhotos(
  config: Config,
  query: string,
  signal?: AbortSignal,
): Promise<Photo[]> {
  if (!config.unsplashKey) return [];
  const data = await fetchJson(
    `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: "4", orientation: "landscape", content_filter: "high" })}`,
    { headers: { Authorization: `Client-ID ${config.unsplashKey}` } },
    signal,
  );
  return (data.results || []).map((p: any) => ({
    url: p.urls.regular,
    alt: p.alt_description || query,
    photographer: p.user.name,
    profileUrl: `${p.user.links.html}?utm_source=roam_travel&utm_medium=referral`,
    photoUrl: `${p.links.html}?utm_source=roam_travel&utm_medium=referral`,
    downloadLocation: p.links.download_location,
  }));
}
