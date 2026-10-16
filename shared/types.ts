import type {
  DayCheck,
  Fact,
  LocalTravelMode,
  OpeningInfo,
  PlanQuality,
  StopFacts,
} from "./quality.js";
import type {
  RevisionDraft,
  RevisionHistory,
  RevisionSummary,
} from "./revisions.js";
import type { CostLedger, JourneyConstraints } from "./planning.js";
export const PHOTO_VERSION = 3;
export const AGENTS = [
  {
    id: "attractions",
    name: "景点搜索专家",
    short: "景点",
    description: "发现值得停留的风景",
    color: "#5d8061",
  },
  {
    id: "transport",
    name: "交通票务专家",
    short: "交通",
    description: "串起出发与抵达",
    color: "#64879e",
  },
  {
    id: "weather",
    name: "天气查询专家",
    short: "天气",
    description: "为晴雨多想一步",
    color: "#c29b51",
  },
  {
    id: "hotel",
    name: "酒店推荐专家",
    short: "住宿",
    description: "找到安心的落脚点",
    color: "#9384a5",
  },
  {
    id: "food",
    name: "当地美食专家",
    short: "美食",
    description: "循着味道认识一座城",
    color: "#c58064",
  },
  {
    id: "budget",
    name: "预算管理专家",
    short: "预算",
    description: "让每一笔花费有分寸",
    color: "#699c94",
  },
  {
    id: "route",
    name: "路线规划专家",
    short: "路线",
    description: "把心动连成一条路线",
    color: "#71895b",
  },
] as const;
export type AgentId = (typeof AGENTS)[number]["id"];
export type TripRequest = {
  origin: string;
  destination: string;
  startDate: string;
  days: number;
  travelers: number;
  budget: number;
  preferences: string[];
  pace: "relaxed" | "balanced" | "packed";
  transport: "smart" | "train" | "flight" | "drive";
  notes: string;
  mode: "demo" | "live";
};
export type Evidence = {
  id: string;
  tool: string;
  source: string;
  status: "live" | "unconfigured" | "error" | "demo";
  queriedAt: string;
  data: unknown;
};
export type AgentReport = {
  agent: AgentId;
  summary: string;
  findings: string[];
  warnings: string[];
  messages: { to: AgentId | "planner"; content: string }[];
  evidenceIds: string[];
  status: "done" | "error";
};
export type TravelOption = {
  id: string;
  title: string;
  summary: string;
  highlights: string[];
  outline: { day: number; title: string; places: string[] }[];
  pace: TripRequest["pace"];
  costNote: string;
  cautions: string[];
  sourceUrls: string[];
};
export type TravelProposal = {
  id: string;
  version: number;
  message: string;
  options: TravelOption[];
  sources: { title: string; url: string }[];
  notices: string[];
  evidence: Evidence[];
  createdAt: string;
};
export type ProposalDecision = {
  proposalId: string;
  action: "confirm" | "revise";
  optionId?: string;
  notes: string;
};
export type ProposalFeedback = ProposalDecision & {
  option?: TravelOption;
  at: string;
};
export type ConfirmedSelection = {
  proposalId: string;
  option: TravelOption;
  alternatives?: TravelOption[];
  notes: string[];
  confirmedAt: string;
};
export type TripEvent = {
  id: number;
  at: string;
  type:
    | "status"
    | "tool"
    | "message"
    | "report"
    | "proposal"
    | "complete"
    | "error";
  agent: AgentId | "planner" | "system";
  message: string;
  to?: string;
  state?: "running" | "done" | "error";
  data?: unknown;
  work?: WorkDetail;
};
/** Public work updates describe actions and results, never model reasoning. */
export type WorkDetail = {
  id: string;
  kind: "query" | "analysis";
  title: string;
  query?: string;
  source?: string;
  summary?: string;
  findings?: string[];
  warnings?: string[];
  outcome?: "success" | "partial" | "empty" | "unconfigured" | "error" | "demo";
};
export type Stop = {
  id?: string;
  facts?: StopFacts;
  openingInfo?: OpeningInfo;
  userProvidedFields?: string[];
  name: string;
  time: string;
  duration: string;
  type: "attraction" | "food" | "hotel" | "transport";
  description: string;
  cost: number | null;
  location: [number, number] | null;
  verified: boolean;
  tip: string;
  sourceIds: string[];
  photoQuery?: string;
  poiId?: string | null;
  photo?: Photo;
  photoStatus?: "ready" | "unconfigured" | "not_found" | "error";
  photoCheckedAt?: string;
  place?: {
    id: string;
    name: string;
    address: string;
    photos: string[];
  };
  placeCheckedAt?: string;
  placeAttemptedAt?: string;
  locationNote?: string;
};
export type DayPlan = {
  travelMode?: LocalTravelMode;
  check?: DayCheck;
  weatherFact?: Fact;
  day: number;
  date: string;
  title: string;
  subtitle: string;
  weather: string;
  stops: Stop[];
  note: string;
};
export type BudgetItem = {
  category: string;
  amount: number | null;
  basis: string;
  status: "estimate" | "verified" | "unknown";
};
export type Plan = {
  costs?: CostLedger;
  journey?: JourneyConstraints;
  revision?: number;
  updatedAt?: string;
  quality?: PlanQuality;
  lockedStopIds?: string[];
  lastRevision?: RevisionSummary;
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  destination: string;
  request: TripRequest;
  days: DayPlan[];
  budget: BudgetItem[];
  totalEstimate: number;
  unknownCosts: number;
  tips: string[];
  warnings: string[];
  transport: { mode: string; outbound: string; inbound: string; note: string };
  hotel: {
    name: string;
    area: string;
    reason: string;
    nightlyEstimate: number | null;
  };
  evidence: Evidence[];
  reports: AgentReport[];
  createdAt: string;
  mode: "demo" | "live";
  images: Photo[];
  photoVersion?: number;
  photoMode?: "search" | "curated" | "amap" | "mixed";
  photoUpdatedAt?: string;
  assets?: {
    generatedAt: string;
    status: "ready" | "partial";
    locations: { ready: number; total: number };
    photos: { ready: number; total: number };
    maps: {
      day: number;
      kind: "amap" | "schematic" | "unavailable";
      missing: string[];
    }[];
  };
  confirmedSelection?: ConfirmedSelection;
};
export type Photo = {
  id?: string;
  url: string;
  alt: string;
  photographer: string;
  profileUrl: string;
  photoUrl: string;
  downloadLocation?: string;
  source?: "unsplash-search" | "unsplash-curated" | "amap-poi";
  fallbackUrls?: string[];
  caption?: string;
  query?: string;
};
export type Job = {
  /** Durable server-only state; omitted from publicJob responses. */
  workflow?: {
    version: 1;
    selectionId?: string;
    evidence: Evidence[];
    reports: Record<string, AgentReport>;
  };
  canUndo?: boolean;
  revisionHistory?: RevisionSummary[];
  editDraft?: RevisionDraft;
  editHistory?: RevisionHistory[];
  id: string;
  request: TripRequest;
  status:
    "running" | "awaiting_confirmation" | "complete" | "error" | "cancelled";
  events: TripEvent[];
  plan?: Plan;
  error?: string;
  createdAt: string;
  proposal?: TravelProposal;
  proposalFeedback?: ProposalFeedback[];
  confirmedSelection?: ConfirmedSelection;
};
export type TripSummary = {
  id: string;
  destination: string;
  title?: string;
  days: number;
  travelers: number;
  startDate: string;
  status: Job["status"];
  mode: "demo" | "live";
  createdAt: string;
  coverPhotos: Photo[];
};
export type PublicConfig = {
  baseUrl: string;
  model: string;
  hasLlmKey: boolean;
  hasAmapKey: boolean;
  hasAmapJsKey?: boolean;
  hasAmapJsSecurityCode?: boolean;
  hasUnsplashKey: boolean;
  hasSearchKey: boolean;
  mcpServers: {
    id: string;
    name: string;
    transport: "http" | "sse";
    roles: AgentId[];
    configured: boolean;
  }[];
};
export const DAY_COLORS = [
  "#53765c",
  "#bd8b56",
  "#788ca7",
  "#a77c98",
  "#73a7a0",
  "#b3a15a",
  "#867fba",
];
