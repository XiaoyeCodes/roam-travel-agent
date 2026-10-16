export const COST_CATEGORIES = {
  tickets: "景点门票",
  food: "餐饮",
  hotel: "住宿",
  intercity: "往返交通",
  local: "市内交通",
  other: "其他与预留",
} as const;
export type CostCategory = keyof typeof COST_CATEGORIES;
export const COST_UNITS = {
  person: "每人",
  room_night: "每间每晚",
  fixed: "整笔",
} as const;
export type CostEntry = {
  id: string;
  label: string;
  category: CostCategory;
  stopId?: string;
  unit: keyof typeof COST_UNITS;
  unitPrice: number | null;
  highPrice: number | null;
  source: "plan" | "user";
  note: string;
  review?: boolean;
};
export type CostLedger = {
  version: 1;
  rooms: number;
  nights: number;
  entries: CostEntry[];
  low: number;
  high: number;
  unknown: number;
  review: number;
};
export type CostInput = {
  travelers: number;
  rooms: number;
  nights: number;
  entries: CostEntry[];
};
export function costQuantity(
  e: CostEntry,
  travelers: number,
  rooms: number,
  nights: number,
) {
  return e.unit === "person"
    ? travelers
    : e.unit === "room_night"
      ? rooms * nights
      : 1;
}
export function costAmount(
  e: CostEntry,
  travelers: number,
  rooms: number,
  nights: number,
  high = false,
): number | null {
  const n = costQuantity(e, travelers, rooms, nights),
    price = high ? e.highPrice : e.unitPrice;
  return !n ? 0 : price === null ? null : Math.round(price * n * 100) / 100;
}
export function costFormula(
  e: CostEntry,
  travelers: number,
  rooms: number,
  nights: number,
) {
  const precise = (n: number) =>
    `${Number.isInteger(n * 100) ? "" : "约"}¥${Number(n.toFixed(2))}`;
  const price =
    e.unitPrice === null
      ? "待查"
      : `${precise(e.unitPrice)}${e.highPrice !== null && e.highPrice !== e.unitPrice ? `–${precise(e.highPrice)}` : ""}`;
  return `${price} × ${e.unit === "person" ? `${travelers} 人` : e.unit === "room_night" ? `${rooms} 间 × ${nights} 晚` : "1 笔"}`;
}
export type JourneyBoundary = {
  day: number;
  stopId?: string;
  station: string;
  mode: "rail" | "flight";
  at: string;
  serviceNumber: string;
  ticketRef?: { evidenceId: string; index: number };
  source?: "user" | "ticket";
  queriedAt?: string;
};
export type JourneyConstraints = {
  arrival: JourneyBoundary | null;
  departure: JourneyBoundary | null;
  arrivalBuffer: number;
  departureBuffer: number;
  extraBuffer: number;
  withChildren: boolean;
  withSeniors: boolean;
  largeLuggage: boolean;
  transferPreference: "less" | "balanced";
};
export const DEFAULT_JOURNEY: JourneyConstraints = {
  arrival: null,
  departure: null,
  arrivalBuffer: 20,
  departureBuffer: 45,
  extraBuffer: 0,
  withChildren: false,
  withSeniors: false,
  largeLuggage: false,
  transferPreference: "balanced",
};
export function journeyExtra(c: JourneyConstraints) {
  return (
    c.extraBuffer +
    (c.withChildren ? 15 : 0) +
    (c.withSeniors ? 15 : 0) +
    (c.largeLuggage ? 10 : 0)
  );
}
export function journeyBuffer(
  c: JourneyConstraints,
  kind: "arrival" | "departure",
) {
  return (
    (kind === "arrival" ? c.arrivalBuffer : c.departureBuffer) + journeyExtra(c)
  );
}
// Compare China-local date/time values without depending on the server timezone.
export function localMinute(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const at = Date.parse(value + ":00+08:00");
  if (
    !Number.isFinite(at) ||
    new Date(at + 8 * 3600000).toISOString().slice(0, 16) !== value
  )
    return null;
  return at / 60000;
}
export type JourneyOption = {
  id: string;
  direction: "arrival" | "departure";
  mode: "rail" | "flight";
  serviceNumber: string;
  station: string;
  at: string;
  evidenceId: string;
  index: number;
  queriedAt: string;
  description: string;
};
export type RepairImpact = {
  attempts?: number;
  beforeConflicts: number;
  afterConflicts: number;
  beforeWarnings: number;
  afterWarnings: number;
  beforeMinutes: number;
  afterMinutes: number;
  unresolved: string[];
};
