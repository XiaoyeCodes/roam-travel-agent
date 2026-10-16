import type { DayPlan, Plan, Stop } from "./types.js";
import type {
  CostInput,
  CostLedger,
  JourneyConstraints,
  RepairImpact,
} from "./planning.js";
export type StopEditFields = Partial<
  Pick<Stop, "name" | "time" | "duration" | "cost" | "description" | "tip">
>;
export type RevisionRequest = {
  baseRevision: number;
  day: number;
  instruction: string;
  lockedStopIds: string[];
  action: "ai" | "update" | "remove" | "move" | "repair" | "journey" | "budget";
  repairStrategy?: "preserve" | "relaxed";
  journey?: JourneyConstraints;
  costs?: CostInput;
  stopId?: string;
  fields?: StopEditFields;
  moveTo?: number;
};
export type RevisionChange = {
  kind: "added" | "removed" | "updated" | "moved";
  name: string;
  details: string[];
};
export type RevisionSummary = {
  scope?: "day" | "trip";
  repair?: RepairImpact;
  id: string;
  revision: number;
  day: number;
  instruction: string;
  createdAt: string;
  changes: RevisionChange[];
  budgetDelta: number;
  budgetIncomplete: boolean;
  travelMinutesDelta: number | null;
  warnings: string[];
};
export type RevisionDraft = {
  id: string;
  baseRevision: number;
  status: "running" | "ready" | "error" | "cancelled";
  request: RevisionRequest;
  createdAt: string;
  progress: string;
  error?: string;
  summary?: RevisionSummary;
  candidate?: Plan;
};
export type RevisionHistory = { summary: RevisionSummary; before: Plan };
export type RevisionPreview = Pick<
  RevisionDraft,
  | "id"
  | "baseRevision"
  | "status"
  | "createdAt"
  | "progress"
  | "error"
  | "summary"
> & {
  action: RevisionRequest["action"];
  day?: DayPlan;
  journey?: JourneyConstraints;
  costs?: CostLedger;
  travelers?: number;
  days?: DayPlan[];
};
