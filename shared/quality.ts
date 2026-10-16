export type TrustStatus =
  "verified" | "estimate" | "unknown" | "stale" | "user" | "demo";
export type Fact = {
  status: TrustStatus;
  detail: string;
  source?: string;
  url?: string;
  checkedAt?: string;
  expiresAt?: string;
};
export type StopFacts = {
  location: Fact;
  price: Fact;
  opening: Fact;
  reservation: Fact;
  photo: Fact;
};
export type OpeningInfo = {
  today: string;
  weekly: string;
  checkedAt: string;
  source: string;
  url: string;
};
export type LocalTravelMode = "auto" | "walking" | "driving" | "transit";
export type TravelLeg = {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  mode: Exclude<LocalTravelMode, "auto">;
  minutes: number | null;
  meters: number | null;
  walkingMeters: number | null;
  bufferMinutes: number;
  availableMinutes: number | null;
  slackMinutes: number | null;
  navigationUrl?: string;
  fact: Fact;
};
export type ScheduleIssue = {
  severity: "conflict" | "warning" | "info";
  code: string;
  message: string;
  stopId?: string;
};
export type DayCheck = {
  checkedAt: string;
  status: "conflict" | "partial" | "checked";
  mode: LocalTravelMode;
  visitMinutes: number;
  unknownDurations: number;
  travelMinutes: number;
  walkingMeters: number;
  queriedLegs: number;
  totalLegs: number;
  legs: TravelLeg[];
  issues: ScheduleIssue[];
};
export type PlanQuality = {
  version: 1;
  checkedAt: string;
  hotel: Fact;
  outbound: Fact;
  inbound: Fact;
};
export const TRUST_LABELS: Record<TrustStatus, string> = {
  verified: "工具已查到",
  estimate: "参考估算",
  unknown: "待确认",
  stale: "需要更新",
  user: "用户提供",
  demo: "演示数据",
};
export const FACT_LABELS: Record<keyof StopFacts, string> = {
  location: "地点",
  price: "费用",
  opening: "开放时间",
  reservation: "预约",
  photo: "配图",
};
export const LOCAL_MODE_LABELS: Record<LocalTravelMode, string> = {
  auto: "步行 + 打车",
  walking: "全程步行",
  driving: "驾车 / 打车",
  transit: "公交 / 地铁",
};
export function effectiveFact(fact: Fact, now = Date.now()): Fact {
  return fact.status === "verified" &&
    fact.expiresAt &&
    Date.parse(fact.expiresAt) < now
    ? { ...fact, status: "stale" }
    : fact;
}
export function safeSourceUrl(url?: string): string {
  try {
    const parsed = new URL(url || "");
    return ["https:", "http:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}
export function minuteLabel(minutes: number): string {
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ""}`
    : `${minutes} 分钟`;
}
export function checkedLabel(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚未查询";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
