import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DayPlan, Plan } from "../../shared/types.js";
import type { DayCheck, ScheduleIssue } from "../../shared/quality.js";
import {
  DEFAULT_JOURNEY,
  journeyBuffer,
  localMinute,
  type JourneyConstraints,
  type JourneyOption,
} from "../../shared/planning.js";
const boundarySchema = z
  .object({
    day: z.number().int().min(1).max(14),
    stopId: z.string().uuid().optional(),
    station: z.string().trim().min(1).max(150),
    mode: z.enum(["rail", "flight"]),
    at: z
      .string()
      .refine((v) => localMinute(v) !== null, "请填写有效的北京时间日期和时间"),
    serviceNumber: z.string().trim().max(80),
    ticketRef: z
      .object({
        evidenceId: z.string().max(150),
        index: z.number().int().min(0).max(100),
      })
      .strict()
      .optional(),
    source: z.enum(["user", "ticket"]).optional(),
    queriedAt: z.string().optional(),
  })
  .strict();
export const journeySchema = z
  .object({
    arrival: boundarySchema.nullable(),
    departure: boundarySchema.nullable(),
    arrivalBuffer: z.number().int().min(0).max(240),
    departureBuffer: z.number().int().min(0).max(240),
    extraBuffer: z.number().int().min(0).max(120),
    withChildren: z.boolean(),
    withSeniors: z.boolean(),
    largeLuggage: z.boolean(),
    transferPreference: z.enum(["less", "balanced"]),
  })
  .strict();
export function journeyOptions(plan: Plan): JourneyOption[] {
  const options: JourneyOption[] = [],
    city = (v: unknown) =>
      String(v || "")
        .replace(/市$/, "")
        .toLowerCase();
  for (const evidence of plan.evidence) {
    if (
      evidence.status !== "live" ||
      !["search_train_tickets", "search_flights"].includes(evidence.tool)
    )
      continue;
    const data = evidence.data as any;
    const direction =
      city(data?.origin) === city(plan.request.origin) &&
      city(data?.destination) === city(plan.destination)
        ? "arrival"
        : city(data?.origin) === city(plan.destination) &&
            city(data?.destination) === city(plan.request.origin)
          ? "departure"
          : null;
    if (
      !direction ||
      data.date !==
        (direction === "arrival"
          ? plan.request.startDate
          : plan.days.at(-1)!.date) ||
      !Array.isArray(data.results)
    )
      continue;
    for (const [index, r] of data.results.entries()) {
      const at = direction === "arrival" ? r.arrival : r.departure;
      if (
        typeof at !== "string" ||
        localMinute(at) === null ||
        !plan.days.some((d) => d.date === at.slice(0, 10))
      )
        continue;
      const station = direction === "arrival" ? r.to : r.from;
      if (
        typeof station !== "string" ||
        !station.trim() ||
        typeof r.name !== "string"
      )
        continue;
      options.push({
        id: `${evidence.id}:${index}`,
        direction,
        mode: evidence.tool === "search_flights" ? "flight" : "rail",
        serviceNumber: String(r.name || ""),
        station,
        at,
        evidenceId: evidence.id,
        index,
        queriedAt: evidence.queriedAt,
        description: `${r.name} · ${r.from} → ${r.to} · ${r.departure} — ${r.arrival}`,
      });
    }
  }
  return options.slice(-80);
}
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function applyJourney(plan: Plan, raw: JourneyConstraints) {
  const input = journeySchema.parse(raw),
    options = journeyOptions(plan),
    warnings: string[] = [];
  for (const kind of ["arrival", "departure"] as const) {
    const b = input[kind];
    if (!b) continue;
    const day = plan.days.find((d) => d.day === b.day);
    if (!day || day.date !== b.at.slice(0, 10))
      throw Error("班次时间必须与关联当天日期一致；跨日到达请选到达当天");
    if (b.mode === "flight" && /^[A-Z]{3}$/.test(b.station))
      throw Error("请把机场代码换成具体机场/航站楼名称，再核对地图地点");
    const evidence =
      b.ticketRef &&
      options.find(
        (o) =>
          o.evidenceId === b.ticketRef!.evidenceId &&
          o.index === b.ticketRef!.index &&
          o.direction === kind,
      );
    if (
      b.ticketRef &&
      (!evidence ||
        evidence.at !== b.at ||
        evidence.mode !== b.mode ||
        evidence.serviceNumber !== b.serviceNumber)
    )
      throw Error("班次引用已失效或时间被修改，请重新选择，或作为手动信息填写");
    b.source = evidence ? "ticket" : "user";
    b.queriedAt = evidence?.queriedAt;
    const mins = Number(b.at.slice(11, 13)) * 60 + Number(b.at.slice(14, 16)),
      buffer = journeyBuffer(input, kind);
    if (
      (kind === "departure" && mins - buffer < 0) ||
      (kind === "arrival" && mins + buffer >= 1440)
    )
      throw Error("缓冲时间跨越午夜，请调整当天安排或缓冲值后重试");
    if (b.stopId) {
      const s = day.stops.find((s) => s.id === b.stopId);
      if (
        !s ||
        s.type !== "transport" ||
        (kind === "arrival" ? day.stops[0] : day.stops.at(-1)) !== s
      )
        throw Error(
          "到达需关联当天第一站、返程需关联当天最后一站，且为交通停留点；也可选择新增车站/机场",
        );
      if (s.name !== b.station)
        throw Error("关联站点名称不一致，请核对或新增正确的车站/机场");
    } else {
      if (day.stops.length >= 8)
        throw Error("当天已有8个停留点，请先移除一站再加入车站或机场");
      const s = {
        id: randomUUID(),
        name: b.station,
        type: "transport" as const,
        time: hhmm(kind === "arrival" ? mins : mins - buffer),
        duration: `${Math.max(1, buffer)}分钟`,
        description:
          kind === "arrival"
            ? "抵达后出站、取行李，随后开始当天行程"
            : "按班次时间预留进站或安检时间",
        cost: null,
        location: null,
        verified: false,
        tip: "班次未代表已购票；请核对实际运营时间和现场要求",
        sourceIds: [],
      };
      if (kind === "arrival") day.stops.unshift(s);
      else day.stops.push(s);
      b.stopId = s.id;
    }
    warnings.push(
      `${kind === "arrival" ? "到达" : "返程"}按${b.source === "ticket" ? "你选择的查询结果" : "你填写的时间"}约束；未代表已购票。总缓冲 ${buffer} 分钟。`,
    );
  }
  if (
    input.arrival &&
    input.departure &&
    localMinute(input.arrival.at)! >= localMinute(input.departure.at)!
  )
    throw Error("返程出发时间必须晚于去程到达时间");
  if (input.arrival?.stopId && input.arrival.stopId === input.departure?.stopId)
    throw Error("到达和返程请使用两个独立的交通停留点");
  plan.journey = input;
  return warnings;
}
export function checkJourney(plan: Plan, day: DayPlan, check: DayCheck) {
  const c = plan.journey,
    issues: ScheduleIssue[] = [];
  for (const kind of ["arrival", "departure"] as const) {
    const b = c?.[kind];
    if (!b) {
      if (
        plan.request.transport !== "drive" &&
        day.day === (kind === "arrival" ? 1 : plan.days.at(-1)!.day)
      )
        issues.push({
          severity: "info",
          code: `${kind}_missing`,
          message: `${kind === "arrival" ? "到达" : "返程"}班次时间尚未确认，暂不能核验与跨城交通的衔接`,
        });
      continue;
    }
    if (b.day !== day.day) continue;
    const s = day.stops.find((s) => s.id === b.stopId),
      expected = kind === "arrival" ? day.stops[0] : day.stops.at(-1);
    if (
      !s ||
      s !== expected ||
      s.name !== b.station ||
      s.type !== "transport"
    ) {
      issues.push({
        severity: "conflict",
        code: "journey_anchor",
        stopId: b.stopId,
        message: `${b.station}不在当天${kind === "arrival" ? "首" : "末"}站，无法校验班次衔接`,
      });
      continue;
    }
    const stopAt = localMinute(`${day.date}T${s.time}`),
      at = localMinute(b.at),
      buffer = journeyBuffer(c!, kind);
    if (stopAt === null || at === null) {
      issues.push({
        severity: "warning",
        code: "journey_time",
        message: "车站/机场时间无法计算，请填写明确时间",
      });
      continue;
    }
    if (kind === "arrival") {
      if (stopAt < at)
        issues.push({
          severity: "conflict",
          code: "arrival_early",
          stopId: s.id,
          message: `${b.station}安排早于班次实际到达 ${at - stopAt} 分钟`,
        });
      const next = day.stops[1],
        leg = check.legs[0];
      const nextAt = next && localMinute(`${day.date}T${next.time}`);
      if (
        nextAt !== null &&
        nextAt !== undefined &&
        leg?.minutes !== null &&
        leg?.minutes !== undefined
      ) {
        const deficit = at + buffer + leg.minutes + 10 - nextAt;
        if (deficit > 0)
          issues.push({
            severity: "conflict",
            code: "arrival_connection",
            stopId: next.id,
            message: `抵达 ${b.station} 后出站/行李预留 ${buffer} 分钟，再前往 ${next.name}，当前少 ${deficit} 分钟`,
          });
      }
    } else if (stopAt + buffer > at)
      issues.push({
        severity: "conflict",
        code: "departure_late",
        stopId: s.id,
        message: `需在 ${b.at.slice(11)} 班次前 ${buffer} 分钟到达 ${b.station}，当前晚 ${stopAt + buffer - at} 分钟`,
      });
    if (
      b.source === "ticket" &&
      b.queriedAt &&
      Date.now() - Date.parse(b.queriedAt) > 900000
    )
      issues.push({
        severity: "warning",
        code: "ticket_stale",
        stopId: s.id,
        message: `${b.serviceNumber || "班次"}查询已超过15分钟，请出发前复核，未代表已购票`,
      });
    if (!s.verified || !s.location)
      issues.push({
        severity: "warning",
        code: "journey_location",
        stopId: s.id,
        message: `${b.station}具体位置未核验，交通衔接仍有缺口`,
      });
  }
  check.issues.push(...issues);
  check.status = check.issues.some((i) => i.severity === "conflict")
    ? "conflict"
    : check.issues.length
      ? "partial"
      : "checked";
}
export function journeyLocks(plan: Plan) {
  return [
    plan.journey?.arrival?.stopId,
    plan.journey?.departure?.stopId,
  ].filter((v): v is string => !!v);
}
