import type { DayPlan, Stop } from "./types.js";
import { effectiveFact, type ScheduleIssue } from "./quality.js";

export type CheckNotice = {
  key: string;
  title: string;
  detail: string;
  items: string[];
  action?: "journey" | "edit";
};

// Presentation only: preserve all underlying checks and their factual status.
export function dayCheckPresentation(day: DayPlan) {
  const issues = [
    ...new Map(
      (day.check?.issues || []).map((issue) => [
        JSON.stringify([issue.code, issue.stopId, issue.message]),
        issue,
      ]),
    ).values(),
  ];
  const conflicts = issues.filter((issue) => issue.severity === "conflict");
  const notes = issues.filter((issue) => issue.severity !== "conflict");
  const consumed = new Set<ScheduleIssue>();
  const actions: CheckNotice[] = [];
  const information: CheckNotice[] = [];
  const add = (
    target: CheckNotice[],
    notice: Omit<CheckNotice, "items">,
    matches: ScheduleIssue[],
  ) => {
    if (!matches.length) return;
    matches.forEach((item) => consumed.add(item));
    target.push({ ...notice, items: matches.map((item) => item.message) });
  };
  const names = (matches: ScheduleIssue[]) => [
    ...new Set(
      matches
        .map((item) => day.stops.find((stop) => stop.id === item.stopId)?.name)
        .filter((name): name is string => !!name),
    ),
  ];

  const missingJourney = notes.filter((issue) =>
    ["arrival_missing", "departure_missing"].includes(issue.code),
  );
  if (missingJourney.length) {
    const kinds = missingJourney.map((issue) =>
      issue.code === "arrival_missing" ? "到达" : "返程",
    );
    const anchors = missingJourney
      .map((issue) =>
        issue.code === "arrival_missing" ? day.stops[0] : day.stops.at(-1),
      )
      .filter((stop): stop is Stop => !!stop && stop.type === "transport");
    const times = notes.filter(
      (issue) =>
        ["duration_unknown", "time_unknown"].includes(issue.code) &&
        anchors.some((stop) => stop.id === issue.stopId),
    );
    add(
      actions,
      {
        key: "journey",
        title: `补充${kinds.join("与")}班次`,
        action: "journey",
        detail: "填写实际班次时间与进出站缓冲后，才能检查机场或车站的衔接。",
      },
      [...missingJourney, ...times],
    );
  }

  const mapIssues = notes.filter((issue) =>
    ["location_unknown", "route_unknown", "journey_location"].includes(
      issue.code,
    ),
  );
  const locations = names(
    mapIssues.filter((issue) => issue.code !== "route_unknown"),
  );
  const routes = mapIssues.filter((issue) => issue.code === "route_unknown");
  const counts = [
    locations.length ? `${locations.length} 个地点` : "",
    routes.length ? `${routes.length} 段交通` : "",
  ]
    .filter(Boolean)
    .join("、");
  const allMissing =
    day.stops.length > 0 &&
    day.stops.every((stop) => !stop.verified || !stop.location);
  const serviceNote = day.stops.find((stop) =>
    stop.locationNote?.startsWith("当前地点服务未识别"),
  )?.locationNote;
  add(
    information,
    {
      key: "map",
      title: `地图与交通数据不完整${counts ? ` · ${counts}` : ""}`,
      detail:
        serviceNote ||
        (allMissing
          ? "当前地点服务未返回本日坐标，交通耗时也未能计算；这是查询数据缺口，不能据此判断衔接是否可行。"
          : "部分地点或路段未取得查询数据，尚不能完成全部交通衔接检查。"),
    },
    mapIssues,
  );
  const opening = notes.filter((issue) =>
    ["opening_unknown", "opening_unparsed"].includes(issue.code),
  );
  add(
    information,
    {
      key: "opening",
      title: `营业与开放时间 · ${names(opening).length || opening.length} 处信息不完整`,
      detail:
        "当前资料不足以自动匹配游览时段；涉及入场或预约的场所，请以官方安排为准。",
    },
    opening,
  );
  const schedule = notes.filter(
    (issue) =>
      !consumed.has(issue) &&
      ["duration_unknown", "time_unknown"].includes(issue.code),
  );
  add(
    actions,
    {
      key: "schedule",
      title: "补充具体时间或停留时长",
      action: "edit",
      detail: `${names(schedule).join("、")}的时间信息不足，暂不能计算完整日程。`,
    },
    schedule,
  );
  for (const issue of notes.filter((issue) => !consumed.has(issue))) {
    add(
      issue.severity === "warning" ? actions : information,
      {
        key: `${issue.code}-${issue.stopId || ""}-${actions.length + information.length}`,
        title: issue.message,
        detail: "",
      },
      [issue],
    );
  }
  return { conflicts, actions, information, originalCount: issues.length };
}

export function stopTrustSummary(stop: Stop) {
  const location = stop.facts?.location && effectiveFact(stop.facts.location);
  return location?.status === "verified"
    ? "地点已定位 · 信息与来源"
    : location?.status === "demo"
      ? "示例信息与来源"
      : location?.status === "stale"
        ? "地点信息需更新 · 查看详情"
        : "地点未定位 · 信息与来源";
}
