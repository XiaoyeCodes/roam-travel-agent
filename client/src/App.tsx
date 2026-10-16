import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Mountain,
  Compass,
  Map,
  MapPin,
  CalendarDays,
  Users,
  Wallet,
  ArrowRight,
  ArrowUpRight,
  Plus,
  Settings2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  ArrowLeftRight,
  Leaf,
  TrainFront,
  Utensils,
  Building2,
  CloudSun,
  Route,
  Landmark,
  Clock3,
  Download,
  Check,
  LoaderCircle,
  CircleHelp,
  ExternalLink,
  X,
  TriangleAlert,
  MessageCircle,
  Network,
  Search,
  FileText,
  RotateCcw,
  CircleStop,
  Globe2,
  CheckCircle2,
  Heart,
  Coffee,
} from "lucide-react";
import {
  AGENTS,
  PHOTO_VERSION,
  DAY_COLORS,
  type AgentId,
  type Job,
  type Plan,
  type PublicConfig,
  type TripEvent,
  type TripRequest,
  type TripSummary,
} from "../../shared/types";
import { api, downloadHtml, watchEvents } from "./api";
import Settings from "./Settings";
import HistoryCard from "./HistoryCard";
import MapView from "./MapView";
import { PhotoFigure } from "./StopPhoto";
import { coverPhoto, photoMode } from "../../shared/photos";
import StopPhoto from "./StopPhoto";
import ProposalReview from "./ProposalReview";
import WorkProgress from "./WorkProgress";
import ItineraryEditor from "./ItineraryEditor";
import { CostDetails, JourneyDetails } from "./PlanningDetails";
import { FactBadge, StopTrust } from "./PlanQuality";
import { PLANNING_CSS } from "../../shared/planning-styles";
import { QUALITY_CSS } from "../../shared/quality-styles";
const ICONS = {
  attractions: Landmark,
  transport: TrainFront,
  weather: CloudSun,
  hotel: Building2,
  food: Utensils,
  budget: Wallet,
  route: Route,
};
const HERO =
  "https://images.unsplash.com/photo-1557750223-53916b138a90?auto=format&fit=crop&w=1800&q=85";
const NATURE =
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=700&q=80";
const initialForm = (): TripRequest => ({
  origin: "上海",
  destination: "南京",
  startDate: new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  }),
  days: 3,
  travelers: 2,
  budget: 3500,
  preferences: ["历史文化", "当地美食"],
  pace: "balanced",
  transport: "smart",
  notes: "",
  mode: "live",
});
const preferences = [
  { label: "历史文化", icon: Landmark },
  { label: "自然风光", icon: Leaf },
  { label: "当地美食", icon: Utensils },
  { label: "城市漫游", icon: Coffee },
  { label: "亲子时光", icon: Heart },
  { label: "小众秘境", icon: Compass },
];
const money = (n: number | null) =>
  n === null ? "待查询" : `¥${Math.round(n).toLocaleString("zh-CN")}`;
type History = TripSummary;
type Page = "planner" | "history" | "team";
function nameOf(id: string) {
  return (
    AGENTS.find((a) => a.id === id)?.name ||
    { planner: "总规划师", system: "系统" }[id] ||
    id
  );
}
export default function App() {
  const [editorTarget, setEditorTarget] = useState<{
    day: number;
    stopId?: string;
    mode?: "repair" | "journey" | "budget";
  } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [page, setPage] = useState<Page>("planner"),
    [form, setForm] = useState(initialForm),
    [config, setConfig] = useState<PublicConfig | null>(null),
    [settings, setSettings] = useState(false),
    [job, setJob] = useState<Job | null>(null),
    [history, setHistory] = useState<History[]>([]),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [htmlBusy, setHtmlBusy] = useState(false),
    [photosBusy, setPhotosBusy] = useState(false),
    [auth, setAuth] = useState(false),
    [token, setToken] = useState("");
  const [tab, setTab] = useState<
      "itinerary" | "map" | "budget" | "agents" | "sources"
    >("itinerary"),
    [day, setDay] = useState(1),
    [expanded, setExpanded] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  }, []);
  const closeSettings = useCallback(() => setSettings(false), []);
  const loadHistory = useCallback(
    () =>
      api<History[]>("/trips")
        .then(setHistory)
        .catch(() => {}),
    [],
  );
  const loadJob = useCallback(async (id: string) => {
    try {
      const data = await api<Job>(`/trips/${id}`);
      setJob(data);
      setEditorTarget(null);
      setForm(data.request);
      setDay(1);
      setPage("planner");
      localStorage.setItem("roam-active-id", id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api<PublicConfig>("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    loadHistory();
    const id = localStorage.getItem("roam-active-id");
    if (id) void loadJob(id);
    const listener = () => setAuth(true);
    window.addEventListener("roam-auth", listener);
    return () => window.removeEventListener("roam-auth", listener);
  }, [loadHistory, loadJob]);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const controller = new AbortController();
    const id = job.id;
    let last = job.events.at(-1)?.id || 0;
    let attempts = 0;
    async function connect() {
      while (!controller.signal.aborted) {
        try {
          await watchEvents(id, last, controller.signal, (event: TripEvent) => {
            last = event.id;
            setJob((current) =>
              current?.id === id
                ? {
                    ...current,
                    events: current.events.some((e) => e.id === event.id)
                      ? current.events
                      : [...current.events, event],
                  }
                : current,
            );
          });
          if (controller.signal.aborted) return;
          const next = await api<Job>(`/trips/${id}`);
          setJob((current) => (current?.id === id ? next : current));
          if (next.status !== "running") {
            loadHistory();
            return;
          }
          attempts = 0;
        } catch {
          if (controller.signal.aborted) return;
          attempts++;
          if (attempts === 3)
            notify("协作连接暂时中断，正在重连；任务仍在后端运行。");
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    void connect();
    return () => controller.abort();
    // The stream owns event updates until this job reaches a terminal status.
  }, [job?.id, job?.status, loadHistory, notify]);
  useEffect(() => {
    if (job?.status !== "awaiting_confirmation") return;
    window.scrollTo({ top: 0, behavior: "instant" });
    const id = job.id;
    const proposalId = job.proposal?.id;
    let active = true;
    const timer = setInterval(() => {
      void api<Job>(`/trips/${id}`)
        .then((next) => {
          if (active)
            setJob((current) =>
              current?.id === id &&
              current.status === "awaiting_confirmation" &&
              current.proposal?.id === proposalId
                ? next
                : current,
            );
        })
        .catch(() => {});
    }, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status, job?.proposal?.id]);
  const photoRequest = useRef(0);
  const refreshPhotos = useCallback(
    async (id: string, force = false) => {
      const request = ++photoRequest.current;
      setPhotosBusy(true);
      try {
        const updated = await api<Job>(`/trips/${id}/photos`, {
          method: "POST",
          body: JSON.stringify({ force }),
        });
        setJob((current) =>
          current?.id === id &&
          (current.plan?.revision || 1) <= (updated.plan?.revision || 1)
            ? updated
            : current,
        );
        if (force) {
          const stops = updated
            .plan!.days.flatMap((d) => d.stops)
            .filter((s) => ["attraction", "food"].includes(s.type));
          const count = stops.filter((s) => s.photo).length;
          notify(`已为 ${count} / ${stops.length} 个景点与美食停留点配图。`);
        }
      } catch (e) {
        if (force) notify((e as Error).message);
      } finally {
        if (photoRequest.current === request) setPhotosBusy(false);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (
      job?.status === "complete" &&
      config &&
      job.plan &&
      (job.plan.photoVersion !== PHOTO_VERSION ||
        job.plan.photoMode !==
          photoMode(config.hasAmapKey, config.hasUnsplashKey))
    )
      void refreshPhotos(job.id);
  }, [
    job?.id,
    job?.status,
    job?.plan?.photoVersion,
    config?.hasUnsplashKey,
    config?.hasAmapKey,
    refreshPhotos,
  ]);
  const busy = creating || job?.status === "running";
  async function generate(demo = false) {
    setError("");
    setCreating(true);
    setPage("planner");
    setTab("itinerary");
    setDay(1);
    try {
      const request = demo
        ? {
            ...initialForm(),
            transport: "train",
            preferences: ["历史文化", "当地美食", "自然风光"],
            mode: "demo",
          }
        : { ...form, mode: "live" };
      const { id } = await api<{ id: string }>("/trips", {
        method: "POST",
        body: JSON.stringify(request),
      });
      await loadJob(id);
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  async function retryTrip() {
    if (!job || creating) return;
    setError("");
    setCreating(true);
    try {
      await api<Job>(`/trips/${job.id}/retry`, { method: "POST", body: "{}" });
      await loadJob(job.id);
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }
  function newTrip() {
    setJob(null);
    setEditorTarget(null);
    setError("");
    setPage("planner");
    localStorage.removeItem("roam-active-id");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function exportHtml() {
    if (!job?.plan) return;
    setHtmlBusy(true);
    try {
      await downloadHtml(
        job.id,
        `${job.request.destination}-${job.request.days}日旅行手册.html`,
      );
      notify("HTML 手册已导出，双击即可打开；图片需要联网加载。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setHtmlBusy(false);
    }
  }
  const closeEditor = useCallback(() => {
    setEditorTarget(null);
    if (job?.id)
      void api<Job>(`/trips/${job.id}`)
        .then((next) =>
          setJob((current) =>
            current?.id === next.id &&
            (current.plan?.revision || 1) <= (next.plan?.revision || 1)
              ? next
              : current,
          ),
        )
        .catch(() => {});
  }, [job?.id]);
  function acceptEditedJob(next: Job) {
    setJob((current) => (current?.id === next.id ? next : current));
    loadHistory();
    notify(`已应用修改，当前为 V${next.plan?.revision}；可以撤销上次修改。`);
  }
  async function undoEdit() {
    if (!job?.plan) return;
    setUndoBusy(true);
    try {
      const next = await api<Job>(`/trips/${job.id}/undo`, {
        method: "POST",
        body: JSON.stringify({ baseRevision: job.plan.revision || 1 }),
      });
      setJob((current) => (current?.id === next.id ? next : current));
      notify("已撤销上次修改，原安排和预算已恢复。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUndoBusy(false);
    }
  }
  const plan = job?.plan;
  return (
    <div className="app-shell">
      <style>{QUALITY_CSS + PLANNING_CSS}</style>
      <aside className="sidebar">
        <button className="brand" onClick={newTrip} aria-label="山行首页">
          <div className="brand-mark">
            <Mountain size={27} />
            <i />
          </div>
          <div>
            <strong>
              山行<span>Roam</span>
            </strong>
            <small>YOUR PERSONAL JOURNEY</small>
          </div>
        </button>
        <button className="new-trip" onClick={newTrip}>
          <Plus size={18} />
          <span>开启新旅程</span>
        </button>
        <div className="nav-label">我的旅行空间</div>
        <nav>
          {(
            [
              { id: "planner", icon: Compass, title: "旅行规划" },
              { id: "history", icon: Map, title: "我的旅程" },
              { id: "team", icon: Network, title: "协作团队" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setPage(item.id);
                if (item.id === "history") loadHistory();
              }}
            >
              <item.icon size={19} />
              <span>{item.title}</span>
              {item.id === "history" && history.length > 0 && (
                <small>{history.length}</small>
              )}
              {page === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="compass-art">
            <Compass size={43} strokeWidth={0.8} />
            <span>EXPLORE MORE</span>
          </div>
          <p>
            世界很大，
            <br />
            下一站，听你的。
          </p>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setSettings(true)} className="settings-link">
            <Settings2 size={18} />
            <span>模型与工具</span>
            <ChevronRight size={14} />
          </button>
          <div className="model-status">
            <i className={config?.hasLlmKey ? "configured" : ""} />
            <div>
              <strong>{config?.model || "正在连接后端"}</strong>
              <small>
                {config?.hasLlmKey
                  ? "模型已配置 · 本地工作空间"
                  : "等待模型配置"}
              </small>
            </div>
            <div className="avatar">旅</div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            我的旅行空间
            <ChevronRight size={13} />
            <span>
              {page === "planner"
                ? "旅行规划"
                : page === "history"
                  ? "我的旅程"
                  : "协作团队"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <i />
              LOCAL WORKSPACE
            </span>
            <button
              className="icon-btn"
              aria-label="查看使用说明"
              onClick={() => {
                setPage("team");
              }}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        <main>
          {page === "planner" && !job && (
            <>
              <div className="welcome">
                <div>
                  <div className="eyebrow">LESS PLANNING. MORE WANDERING.</div>
                  <h1>
                    把向往，写成旅程<span>。</span>
                  </h1>
                  <p>告诉我们你想去的地方，剩下的交给你的 AI 旅行团队。</p>
                </div>
                <div className="welcome-stamp">
                  <Sparkles size={15} />
                  <span>为你而作的旅行</span>
                </div>
              </div>
              <section
                className="hero"
                style={{
                  backgroundImage: `linear-gradient(90deg,rgba(15,36,32,.64),rgba(15,36,32,.02)),url(${HERO})`,
                }}
              >
                <div className="hero-copy">
                  <div className="hero-kicker">
                    <span />
                    THE WORLD IS CALLING
                  </div>
                  <h2>
                    去山间，去湖畔。
                    <br />
                    去生活的另一面。
                  </h2>
                  <p>每一段好旅程，都从一点期待开始。</p>
                </div>
                <div className="hero-location">
                  <MapPin size={15} />
                  <div>
                    <strong>中国 · 桂林</strong>
                    <span>山水之间，自有答案</span>
                  </div>
                </div>
                <a
                  className="hero-credit"
                  href="https://unsplash.com/s/photos/li-river?utm_source=roam_travel&utm_medium=referral"
                  target="_blank"
                  rel="noreferrer"
                >
                  旅行意象 · Unsplash <ArrowUpRight size={11} />
                </a>
                <div className="hero-count">
                  01 <span>/ 你的下一站</span>
                </div>
              </section>
              <div className="planning-layout">
                <section className="planner-card">
                  <div className="section-heading">
                    <div className="inline">
                      <span className="small-icon">
                        <Sparkles size={17} />
                      </span>
                      <h2>这次，想怎么出发？</h2>
                    </div>
                    <span className="quiet-text">一份专属于你的旅行提案</span>
                  </div>
                  <form
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault();
                      void generate();
                    }}
                  >
                    <div className="form-grid four">
                      <label className="field">
                        <span>
                          <MapPin size={14} />
                          出发城市
                        </span>
                        <input
                          required
                          maxLength={60}
                          value={form.origin}
                          onChange={(e) =>
                            setForm({ ...form, origin: e.target.value })
                          }
                          placeholder="从哪里出发"
                        />
                      </label>
                      <label className="field destination-field">
                        <span>
                          <Compass size={14} />
                          目的地
                        </span>
                        <input
                          required
                          maxLength={60}
                          value={form.destination}
                          onChange={(e) =>
                            setForm({ ...form, destination: e.target.value })
                          }
                          placeholder="想去哪里"
                        />
                        <button
                          type="button"
                          className="swap-btn"
                          aria-label="交换出发地与目的地"
                          onClick={() =>
                            setForm({
                              ...form,
                              origin: form.destination,
                              destination: form.origin,
                            })
                          }
                        >
                          <ArrowLeftRight size={13} />
                        </button>
                      </label>
                      <label className="field">
                        <span>
                          <CalendarDays size={14} />
                          出发日期
                        </span>
                        <input
                          required
                          type="date"
                          value={form.startDate}
                          onChange={(e) =>
                            setForm({ ...form, startDate: e.target.value })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>
                          <Clock3 size={14} />
                          旅行天数
                        </span>
                        <select
                          value={form.days}
                          onChange={(e) =>
                            setForm({ ...form, days: Number(e.target.value) })
                          }
                        >
                          {Array.from({ length: 14 }, (_, i) => (
                            <option key={i} value={i + 1}>
                              {i + 1} 天{i + 1 > 1 ? ` ${i} 晚` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="form-grid three">
                      <label className="field">
                        <span>
                          <Users size={14} />
                          同行人数
                        </span>
                        <select
                          value={form.travelers}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              travelers: Number(e.target.value),
                            })
                          }
                        >
                          {Array.from({ length: 12 }, (_, i) => (
                            <option key={i} value={i + 1}>
                              {i + 1} 位旅行者
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>
                          <Wallet size={14} />
                          总预算 · 全体旅客
                        </span>
                        <div className="currency-input">
                          <span>¥</span>
                          <input
                            required
                            type="number"
                            min={100}
                            max={1000000}
                            step={100}
                            value={form.budget}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                budget: Number(e.target.value),
                              })
                            }
                          />
                          <small>CNY</small>
                        </div>
                      </label>
                      <label className="field">
                        <span>
                          <TrainFront size={14} />
                          往返交通
                        </span>
                        <select
                          value={form.transport}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              transport: e.target
                                .value as TripRequest["transport"],
                            })
                          }
                        >
                          <option value="smart">交给团队推荐</option>
                          <option value="train">高铁 / 火车</option>
                          <option value="flight">飞机</option>
                          <option value="drive">自驾</option>
                        </select>
                      </label>
                    </div>
                    <div className="preference-group">
                      <span className="label-text">
                        你喜欢怎样的旅行 <small>可多选</small>
                      </span>
                      <div className="chips">
                        {preferences.map((p) => (
                          <button
                            type="button"
                            key={p.label}
                            aria-pressed={form.preferences.includes(p.label)}
                            className={`chip ${form.preferences.includes(p.label) ? "selected" : ""}`}
                            onClick={() =>
                              setForm({
                                ...form,
                                preferences: form.preferences.includes(p.label)
                                  ? form.preferences.filter(
                                      (v) => v !== p.label,
                                    )
                                  : [...form.preferences, p.label],
                              })
                            }
                          >
                            <p.icon size={14} />
                            {p.label}
                            {form.preferences.includes(p.label) && (
                              <Check size={12} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pace-row">
                      <span className="label-text">旅行节奏</span>
                      <div className="segmented">
                        {(
                          [
                            { value: "relaxed", label: "慢慢逛" },
                            { value: "balanced", label: "刚刚好" },
                            { value: "packed", label: "尽兴玩" },
                          ] as const
                        ).map((p) => (
                          <button
                            key={p.value}
                            type="button"
                            className={form.pace === p.value ? "selected" : ""}
                            onClick={() => setForm({ ...form, pace: p.value })}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="text-btn more-needs"
                        onClick={() => setExpanded(!expanded)}
                      >
                        更多想法
                        <ChevronDown
                          size={14}
                          className={expanded ? "rotate" : ""}
                        />
                      </button>
                    </div>
                    {expanded && (
                      <label className="field notes-field">
                        <span>还有什么想告诉我们？</span>
                        <textarea
                          maxLength={2000}
                          value={form.notes}
                          onChange={(e) =>
                            setForm({ ...form, notes: e.target.value })
                          }
                          placeholder="例如带着父母，希望少走路；不能吃辣；想给美术馆留半天……"
                          rows={3}
                        />
                      </label>
                    )}
                    <div className="form-bottom">
                      <span>
                        <Network size={15} />
                        先选方案，再由 7 位专家细化行程
                      </span>
                      <button
                        className="button primary generate-btn"
                        disabled={busy}
                        type="submit"
                      >
                        {creating ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <Sparkles size={17} />
                        )}
                        先看看旅行方案
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  </form>
                </section>
                <aside className="inspiration-card">
                  <div className="eyebrow">A LITTLE INSPIRATION</div>
                  <h3>
                    还没想好？
                    <br />
                    先借一段好时光。
                  </h3>
                  <div className="postcard">
                    <div className="postcard-art">
                      <Landmark size={54} strokeWidth={0.7} />
                      <span>金陵</span>
                      <i>NANJING</i>
                    </div>
                    <div className="postcard-caption">
                      <strong>在金陵，拾一段慢时光</strong>
                      <p>3 天 2 晚 · 历史人文与城市漫游</p>
                    </div>
                  </div>
                  <div className="sample-stats">
                    <span>
                      <Users size={13} />
                      双人出行
                    </span>
                    <span>
                      <Wallet size={13} />
                      参考 ¥3,060
                    </span>
                  </div>
                  <button
                    className="sample-button"
                    disabled={busy}
                    onClick={() => generate(true)}
                  >
                    体验南京示例
                    <ArrowUpRight size={17} />
                  </button>
                  <p className="sample-note">无需外部 Key · 固定演示方案</p>
                </aside>
              </div>
              <section className="expert-section">
                <div className="section-heading">
                  <div>
                    <h2>一个想法，一整支团队。</h2>
                    <p>分工寻找，彼此讨论，把细节留给专家。</p>
                  </div>
                  <button className="text-btn" onClick={() => setPage("team")}>
                    认识你的团队
                    <ArrowRight size={15} />
                  </button>
                </div>
                <AgentGrid events={[]} />
              </section>
              <div className="home-footer">
                <span>用一点智能，换多一点自由。</span>
                <span>
                  山行 ROAM <i>✳</i> MADE FOR YOUR NEXT CHAPTER
                </span>
              </div>
            </>
          )}
          {page === "planner" && job && !plan && (
            <>
              <div className="back-row">
                <button className="text-btn" onClick={newTrip}>
                  <ArrowLeft size={16} />
                  返回规划
                </button>
                <span className="pill">
                  {job.request.mode === "demo" ? "演示模式" : "智能协作"}
                </span>
              </div>
              {job.status === "awaiting_confirmation" && job.proposal ? (
                <ProposalReview
                  key={job.proposal.id}
                  job={job}
                  onDecision={async (decision) => {
                    const updated = await api<Job>(
                      `/trips/${job.id}/decision`,
                      { method: "POST", body: JSON.stringify(decision) },
                    );
                    setJob((current) =>
                      current?.id === updated.id ? updated : current,
                    );
                    loadHistory();
                  }}
                  onCancel={async () => {
                    await api(`/trips/${job.id}/cancel`, {
                      method: "POST",
                      body: "{}",
                    });
                    await loadJob(job.id);
                    loadHistory();
                  }}
                />
              ) : (
                <div className="working-heading work-intro">
                  <div className="planning-title">
                    <h1>
                      {job.status === "running"
                        ? `正在规划你的${job.request.destination}之旅`
                        : "这次规划暂时停了下来"}
                    </h1>
                    <p>
                      {job.request.origin} → {job.request.destination} ·{" "}
                      {job.request.days} 天 · {job.request.travelers} 人 ·
                      总预算 {money(job.request.budget)}
                    </p>
                    {job.status !== "running" && (
                      <div role="alert" className="error-banner">
                        {job.error}
                      </div>
                    )}
                  </div>
                  {job.status === "running" && (
                    <button
                      className="text-btn danger planning-stop"
                      onClick={() =>
                        api(`/trips/${job.id}/cancel`, {
                          method: "POST",
                          body: "{}",
                        }).catch((e) => notify(e.message))
                      }
                    >
                      <CircleStop size={14} />
                      停止规划
                    </button>
                  )}
                </div>
              )}
              <WorkProgress job={job} />
              {job.status !== "running" &&
                job.status !== "awaiting_confirmation" && (
                  <div className="center-actions">
                    <button
                      className="button primary"
                      disabled={creating}
                      onClick={() => void retryTrip()}
                    >
                      <RotateCcw size={16} />
                      重新规划
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setSettings(true)}
                    >
                      检查模型配置
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => generate(true)}
                    >
                      体验示例
                    </button>
                  </div>
                )}
            </>
          )}
          {page === "planner" && plan && (
            <>
              <div className="back-row">
                <button className="text-btn" onClick={newTrip}>
                  <ArrowLeft size={16} />
                  开启另一段旅程
                </button>
                <div className="inline">
                  <span
                    className={`pill ${plan.mode === "demo" ? "amber" : "green"}`}
                  >
                    {plan.mode === "demo"
                      ? "演示方案 · 非实时数据"
                      : "AI 旅行提案"}
                  </span>
                  <span className="quiet-text">
                    <Check size={13} />
                    已保存到我的旅程
                  </span>
                </div>
              </div>
              <section
                className={`plan-cover ${coverPhoto(plan) ? "with-photo" : ""}`}
              >
                <div className="plan-cover-copy">
                  <div className="eyebrow">
                    YOUR NEXT CHAPTER / {plan.destination}
                  </div>
                  <h1>{plan.title}</h1>
                  <p>{plan.subtitle}</p>
                  <div className="trip-meta">
                    <span>
                      <MapPin size={15} />
                      {plan.request.origin} → {plan.destination}
                    </span>
                    <span>
                      <CalendarDays size={15} />
                      {plan.request.startDate} · {plan.days.length} 天
                    </span>
                    <span>
                      <Users size={15} />
                      {plan.request.travelers} 人
                    </span>
                  </div>
                </div>
                {coverPhoto(plan) ? (
                  <PhotoFigure
                    photo={coverPhoto(plan)!}
                    name={plan.destination}
                    cover
                  />
                ) : (
                  <div className="plan-cover-art">
                    <Mountain size={120} strokeWidth={0.45} />
                    <span>慢一点，也很好。</span>
                  </div>
                )}
              </section>
              {plan.confirmedSelection && (
                <details className="card confirmed-direction">
                  <summary>
                    已按你确认的方案 {plan.confirmedSelection.option.id}「
                    {plan.confirmedSelection.option.title}」规划
                  </summary>
                  {plan.confirmedSelection.notes.map((note, i) => (
                    <p key={i}>{note}</p>
                  ))}
                </details>
              )}
              <div className="plan-toolbar">
                <div className="plan-tabs">
                  {(
                    [
                      {
                        id: "itinerary",
                        label: "每日行程",
                        icon: CalendarDays,
                      },
                      { id: "map", label: "路线地图", icon: Map },
                      { id: "budget", label: "预算与住宿", icon: Wallet },
                      { id: "agents", label: "协作过程", icon: Network },
                      { id: "sources", label: "信息来源", icon: Search },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      className={tab === t.id ? "active" : ""}
                      onClick={() => {
                        setTab(t.id);
                        if (t.id === "itinerary" && day === 0) setDay(1);
                      }}
                    >
                      <t.icon size={16} />
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  className="button primary small"
                  disabled={htmlBusy}
                  onClick={exportHtml}
                >
                  {htmlBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Download size={15} />
                  )}{" "}
                  {htmlBusy ? "正在制作手册" : "导出 HTML"}
                </button>
              </div>
              {tab === "itinerary" && (
                <div className="photo-toolbar">
                  <span>
                    {plan.assets
                      ? `生成时已核验 ${plan.assets.locations.ready}/${plan.assets.locations.total} 个地点 · 已准备 ${plan.assets.maps.filter((m) => m.day && m.kind === "amap").length}/${plan.days.length} 张每日地图`
                      : "高德地点照片优先 · Unsplash 补充配图 · 取景以来源说明为准"}
                  </span>
                  <button
                    className="text-btn"
                    disabled={photosBusy}
                    onClick={() => void refreshPhotos(job!.id, true)}
                  >
                    {photosBusy ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    {photosBusy ? "正在匹配图片" : "补全图片"}
                  </button>
                </div>
              )}
              {tab === "itinerary" && (
                <div className="revision-toolbar">
                  <div>
                    <strong>行程 V{plan.revision || 1}</strong>
                    <span>局部调整，保留其他日期</span>
                  </div>
                  <div>
                    <button
                      className="button secondary small"
                      disabled={undoBusy || photosBusy}
                      onClick={() =>
                        setEditorTarget({ day: 1, mode: "journey" })
                      }
                    >
                      班次与衔接
                    </button>
                    <button
                      className="button secondary small"
                      disabled={undoBusy || photosBusy}
                      onClick={() =>
                        setEditorTarget({ day: 1, mode: "budget" })
                      }
                    >
                      费用与人数
                    </button>
                    <button
                      className="button secondary small"
                      disabled={!job?.canUndo || undoBusy || photosBusy}
                      onClick={undoEdit}
                    >
                      <RotateCcw size={14} />
                      {undoBusy ? "正在恢复" : "撤销上次修改"}
                    </button>
                    <button
                      className="button primary small"
                      disabled={undoBusy || photosBusy}
                      onClick={() =>
                        setEditorTarget({
                          day: job?.editDraft?.request.day || day || 1,
                          mode: ["journey", "budget", "repair"].includes(
                            job?.editDraft?.request.action || "",
                          )
                            ? (job!.editDraft!.request.action as
                                "journey" | "budget" | "repair")
                            : undefined,
                        })
                      }
                    >
                      <Sparkles size={14} />
                      {job?.editDraft &&
                      ["running", "ready"].includes(job.editDraft.status)
                        ? "继续查看修改"
                        : `调整第 ${day || 1} 天`}
                    </button>
                  </div>
                </div>
              )}
              {plan.lastRevision && (
                <details className="revision-note">
                  <summary>最近修改 · {plan.lastRevision.instruction}</summary>
                  <p>
                    V{plan.lastRevision.revision} ·{" "}
                    {plan.lastRevision.scope === "trip"
                      ? "全程设置"
                      : `第 ${plan.lastRevision.day} 天`}{" "}
                    · 参考费用变化{" "}
                    {plan.lastRevision.budgetDelta >= 0 ? "+" : ""}
                    {money(plan.lastRevision.budgetDelta)}
                    {plan.lastRevision.budgetIncomplete ? "（金额不完整）" : ""}
                  </p>
                  {plan.lastRevision.changes.map((c, i) => (
                    <p key={i}>
                      {c.name}：{c.details.join("；")}
                    </p>
                  ))}
                </details>
              )}
              {tab === "itinerary" && (
                <div className="itinerary-layout">
                  <section>
                    <div className="trip-intro">
                      <span>
                        <Sparkles size={16} />
                        总规划师的话
                      </span>
                      <p>{plan.summary}</p>
                    </div>
                    <DayTabs plan={plan} day={day} setDay={setDay} />
                    <DayDetail
                      plan={plan}
                      day={day}
                      onEdit={(stopId) => setEditorTarget({ day, stopId })}
                      busy={undoBusy || photosBusy}
                    />
                  </section>
                  <aside className="itinerary-aside">
                    <MapView
                      plan={plan}
                      day={day}
                      compact
                      onUpdated={(next) =>
                        setJob((current) =>
                          current?.id === next.id ? next : current,
                        )
                      }
                    />
                    <div className="card budget-preview">
                      <div className="section-heading">
                        <h3>让预算，心里有数</h3>
                        <Wallet size={18} />
                      </div>
                      <div className="big-money">
                        {estimate(plan)}
                        <span>/ 全体 · 全程参考</span>
                      </div>
                      <div className="budget-track">
                        <div
                          style={{
                            width: `${Math.min(100, ((plan.costs?.high ?? plan.totalEstimate) / plan.request.budget) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="budget-small">
                        <span>总预算 {money(plan.request.budget)}</span>
                        <span
                          className={
                            (plan.costs?.high ?? plan.totalEstimate) >
                            plan.request.budget
                              ? "over"
                              : ""
                          }
                        >
                          {(plan.costs?.high ?? plan.totalEstimate) >
                          plan.request.budget
                            ? "超出"
                            : "余量"}{" "}
                          {money(
                            Math.abs(
                              plan.request.budget -
                                (plan.costs?.high ?? plan.totalEstimate),
                            ),
                          )}
                        </span>
                      </div>
                      {plan.unknownCosts > 0 && (
                        <p className="warning-text">
                          另有 {plan.unknownCosts} 项费用未知，合计不完整。
                        </p>
                      )}
                      <button
                        className="text-btn"
                        onClick={() => setTab("budget")}
                      >
                        查看预算明细
                        <ArrowRight size={14} />
                      </button>
                    </div>
                    <div className="gentle-card">
                      <Leaf size={21} />
                      <h3>留一点空白给偶遇</h3>
                      <p>
                        {plan.tips[0] ||
                          "带着期待出发，也给临时的心动留一点余地。"}
                      </p>
                    </div>
                  </aside>
                </div>
              )}
              {tab === "map" && (
                <section className="map-full">
                  <div className="section-heading">
                    <div>
                      <h2>每天的风景，各有方向。</h2>
                      <p>按颜色分辨日期，按编号查看游览顺序。</p>
                    </div>
                  </div>
                  <DayTabs plan={plan} day={day} setDay={setDay} overview />
                  <MapView
                    plan={plan}
                    day={day}
                    onUpdated={(next) =>
                      setJob((current) =>
                        current?.id === next.id ? next : current,
                      )
                    }
                  />
                </section>
              )}
              {tab === "budget" && (
                <>
                  <div className="revision-toolbar">
                    <button
                      className="button secondary small"
                      onClick={() =>
                        setEditorTarget({ day: 1, mode: "journey" })
                      }
                    >
                      班次与衔接
                    </button>
                    <button
                      className="button primary small"
                      onClick={() =>
                        setEditorTarget({ day: 1, mode: "budget" })
                      }
                    >
                      管理费用与人数
                    </button>
                  </div>
                  <BudgetView plan={plan} />
                </>
              )}
              {tab === "agents" && (
                <>
                  <WorkProgress job={job!} />
                </>
              )}
              {tab === "sources" && <Sources plan={plan} />}
              <div className="plan-notice">
                <TriangleAlert size={17} />
                <div>
                  <strong>
                    {plan.mode === "demo"
                      ? "这是一份演示行程"
                      : "出发前，再确认一次"}
                  </strong>
                  <p>{plan.warnings.slice(0, 2).join(" ")}</p>
                </div>
                <button className="text-btn" onClick={() => setTab("sources")}>
                  查看全部
                  <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}
          {page === "history" && (
            <>
              <div className="welcome">
                <div>
                  <div className="eyebrow">PLACES TO GO. MEMORIES TO KEEP.</div>
                  <h1>你的每一段向往。</h1>
                  <p>已经写好的旅程，都在这里等你出发。</p>
                </div>
                <button className="button primary" onClick={newTrip}>
                  <Plus size={16} />
                  新旅程
                </button>
              </div>
              {history.length ? (
                <div className="history-grid">
                  {history.map((trip, i) => (
                    <HistoryCard
                      key={trip.id}
                      trip={trip}
                      index={i}
                      onOpen={() => loadJob(trip.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Map size={45} strokeWidth={1} />
                  <h2>第一段旅程，从这里开始。</h2>
                  <p>生成的计划会自动保存在本机。</p>
                  <button className="button primary" onClick={newTrip}>
                    开始规划
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {page === "team" && (
            <>
              <div className="welcome">
                <div>
                  <div className="eyebrow">
                    SEVEN MINDS. ONE BEAUTIFUL JOURNEY.
                  </div>
                  <h1>你的随行团队。</h1>
                  <p>
                    各有所长，也彼此倾听。把零散的信息，变成一段顺畅的旅程。
                  </p>
                </div>
                <span className="welcome-stamp">
                  <Network size={16} />7 位专家 + 1 位总规划师
                </span>
              </div>
              <div className="team-flow">
                <div className="flow-pill">
                  <MessageCircle size={17} />
                  你的旅行想法
                </div>
                <div className="flow-line" />
                <div className="flow-supervisor">
                  <Sparkles size={23} />
                  <div>
                    <strong>总规划师</strong>
                    <span>拆解需求 · 协调分工 · 汇总最终方案</span>
                  </div>
                </div>
                <div className="flow-branches" />
                <AgentGrid events={job?.events || []} />
                <div className="flow-discussion">
                  <ArrowLeftRight size={17} />
                  <span>共享检索结果</span>
                  <i /> <span>天气与预算交叉审阅</span>
                  <i />
                  <span>路线修订</span>
                  <ArrowRight size={17} />
                  <strong>你的旅行计划</strong>
                </div>
              </div>
              <div className="team-details">
                {AGENTS.map((a) => {
                  const Icon = ICONS[a.id];
                  return (
                    <article className="card" key={a.id}>
                      <span
                        className="agent-icon"
                        style={{ color: a.color, background: `${a.color}12` }}
                      >
                        <Icon size={24} />
                      </span>
                      <h3>{a.name}</h3>
                      <p>
                        {a.description}。
                        {
                          {
                            attractions: "按兴趣检索高德 POI，核对门票与预约。",
                            transport:
                              "比较往返高铁、航班和自驾，保留返程余量。",
                            weather:
                              "查询实际预报，为下雨的日子准备另一种安排。",
                            hotel: "兼顾位置、预算与出行方便，筛选住宿片区。",
                            food: "寻找地方菜与附近餐馆，尊重你的口味与忌口。",
                            budget:
                              "按人数、房间数和晚数核算，明确估算与未知项。",
                            route:
                              "按地理位置与时间串联每一天，并回应其他专家建议。",
                          }[a.id]
                        }
                      </p>
                    </article>
                  );
                })}
              </div>
              <div className="team-tools">
                <div>
                  <h2>工具连接，让建议更有依据。</h2>
                  <p>配置模型后即可开始。补全外部服务，让检索覆盖更多细节。</p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={16} />
                  配置连接
                </button>
              </div>
              <div className="tool-status-grid">
                {[
                  { name: "DeepSeek / 兼容模型", ready: config?.hasLlmKey },
                  { name: "高德地图 & MCP", ready: config?.hasAmapKey },
                  { name: "Open-Meteo 天气", ready: true },
                  { name: "Unsplash 图片", ready: config?.hasUnsplashKey },
                  { name: "Tavily Web Search", ready: config?.hasSearchKey },
                  {
                    name: "12306 高铁 / fast-flights 机票",
                    ready: true,
                    label: "内置 · 免 Key",
                  },
                ].map((t) => (
                  <div key={t.name}>
                    <Globe2 size={16} />
                    <span>{t.name}</span>
                    <small className={t.ready ? "ready" : ""}>
                      {t.label || (t.ready ? "已配置" : "未配置")}
                    </small>
                  </div>
                ))}
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="error-banner page-error">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button
                className="icon-btn"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
        </main>
        {editorTarget && job?.plan && (
          <ItineraryEditor
            job={job}
            day={editorTarget.day}
            stopId={editorTarget.stopId}
            mode={editorTarget.mode}
            onUpdated={acceptEditedJob}
            onClose={closeEditor}
          />
        )}
      </div>
      {settings &&
        (config ? (
          <Settings
            config={config}
            onClose={closeSettings}
            onSaved={setConfig}
            notify={notify}
          />
        ) : (
          <div className="modal-backdrop">
            <div className="card">
              <h2>尚未连接到后端</h2>
              <p>请启动 API 服务后重试。</p>
              <button
                className="button primary"
                onClick={() => setSettings(false)}
              >
                知道了
              </button>
            </div>
          </div>
        ))}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-btn"
            aria-label="关闭通知"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {auth && (
        <div className="modal-backdrop">
          <form
            className="auth-card card"
            onSubmit={async (e) => {
              e.preventDefault();
              sessionStorage.setItem("roam-token", token);
              try {
                setConfig(await api("/config"));
                setAuth(false);
                setError("");
                loadHistory();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <h2>进入旅行空间</h2>
            <p>此服务已启用访问口令。</p>
            <label className="field">
              <span>访问口令</span>
              <input
                type="password"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button className="button primary">
              进入
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function AgentGrid({ events }: { events: TripEvent[] }) {
  return (
    <div className="agent-grid">
      {AGENTS.map((a) => {
        const Icon = ICONS[a.id];
        const status = [...events]
          .reverse()
          .find((e) => e.agent === a.id && e.type === "status")?.state;
        return (
          <div
            className={`agent-tile ${status === "running" ? "is-running" : ""}`}
            key={a.id}
          >
            <span
              className="agent-icon"
              style={{ color: a.color, background: `${a.color}13` }}
            >
              <Icon size={22} strokeWidth={1.5} />
              {status === "done" && (
                <i>
                  <Check size={9} />
                </i>
              )}
            </span>
            <strong>{a.short}专家</strong>
            <span className="agent-status">
              {status === "running" ? (
                <>
                  <i className="pulse-dot" />
                  工作中
                </>
              ) : status === "done" ? (
                "已完成"
              ) : status === "error" ? (
                "暂不可用"
              ) : (
                "随时待命"
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function EventFeed({
  events,
  autoScroll = true,
}: {
  events: TripEvent[];
  autoScroll?: boolean;
}) {
  const messages = events.filter((e) => e.type !== "report");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll)
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length, autoScroll]);
  return (
    <div className="event-feed" aria-live="polite">
      {messages.length ? (
        messages.map((e) => (
          <div
            key={e.id}
            className={`event ${e.type === "message" ? "discussion" : ""} ${e.state === "error" ? "event-error" : ""}`}
          >
            <div className="event-dot">
              {e.type === "message" ? (
                <MessageCircle size={13} />
              ) : e.type === "tool" ? (
                <Search size={12} />
              ) : e.state === "done" ? (
                <Check size={12} />
              ) : (
                <span />
              )}
            </div>
            <div>
              <div className="event-byline">
                <strong>{nameOf(e.agent)}</strong>
                {e.to && (
                  <>
                    <ArrowRight size={11} />
                    <b>{nameOf(e.to)}</b>
                  </>
                )}
                <time>
                  {new Date(e.at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </div>
              <p>{e.message}</p>
            </div>
          </div>
        ))
      ) : (
        <div className="empty-feed">
          <Network size={30} />
          <p>团队正在集合，协作动态即将出现在这里。</p>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
function DayTabs({
  plan,
  day,
  setDay,
  overview = false,
}: {
  plan: Plan;
  day: number;
  setDay: (n: number) => void;
  overview?: boolean;
}) {
  return (
    <div className="day-tabs">
      {overview && (
        <button className={day === 0 ? "active" : ""} onClick={() => setDay(0)}>
          全部路线
        </button>
      )}
      {plan.days.map((d) => (
        <button
          key={d.day}
          className={day === d.day ? "active" : ""}
          onClick={() => setDay(d.day)}
        >
          <span>DAY {String(d.day).padStart(2, "0")}</span>
          <small>{d.date.slice(5).replace("-", " / ")}</small>
        </button>
      ))}
    </div>
  );
}
function DayDetail({
  plan,
  day,
  onEdit,
  busy,
}: {
  plan: Plan;
  day: number;
  onEdit: (stopId?: string) => void;
  busy: boolean;
}) {
  const d = plan.days.find((d) => d.day === day) || plan.days[0];
  const color = DAY_COLORS[(d.day - 1) % DAY_COLORS.length];
  return (
    <article className="day-detail">
      <div className="day-title">
        <span style={{ color }}>{String(d.day).padStart(2, "0")}</span>
        <div>
          <h2>{d.title}</h2>
          <p>{d.subtitle}</p>
        </div>
      </div>
      <div className="weather-line">
        <CloudSun size={17} />
        {d.weather}
      </div>
      <FactBadge label="天气依据" fact={d.weatherFact} />
      <div className="timeline">
        {d.stops.map((s, i) => {
          const Icon = {
            attraction: Landmark,
            food: Utensils,
            hotel: Building2,
            transport: TrainFront,
          }[s.type];
          return (
            <div className="timeline-item" key={s.id || `${s.name}-${i}`}>
              <div className="timeline-time">
                <strong>{s.time}</strong>
                <span>{s.duration}</span>
              </div>
              <div className="timeline-dot" style={{ background: color }}>
                {i + 1}
              </div>
              <div className="stop-content">
                <div className="stop-head">
                  <div>
                    <span className="stop-type">
                      <Icon size={12} />
                      {
                        {
                          attraction: "风景与故事",
                          food: "寻味当地",
                          hotel: "安心休息",
                          transport: "在路上",
                        }[s.type]
                      }
                    </span>
                    <h3>{s.name}</h3>
                  </div>
                  <span className="stop-cost">
                    {s.cost === 0
                      ? "免费 / 待核验"
                      : s.cost === null
                        ? "费用待查"
                        : `${money(s.cost)} 参考`}
                  </span>
                </div>
                <StopTrust stop={s} />
                {(s.type === "attraction" || s.type === "food") && (
                  <StopPhoto stop={s} />
                )}
                <p>{s.description}</p>
                {s.tip && (
                  <div className="stop-tip">
                    <Leaf size={13} />
                    <span>{s.tip}</span>
                  </div>
                )}
                <button
                  className="text-btn stop-edit"
                  disabled={busy}
                  onClick={() => onEdit(s.id)}
                >
                  编辑这一站 <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="day-note">
        <Compass size={18} />
        <div>
          <strong>这一天的小提醒</strong>
          <p>{d.note}</p>
        </div>
      </div>
    </article>
  );
}
function estimate(plan: Plan) {
  return plan.costs && plan.costs.high !== plan.costs.low
    ? `${money(plan.costs.low)}–${money(plan.costs.high)}`
    : money(plan.totalEstimate);
}
function BudgetView({ plan }: { plan: Plan }) {
  return (
    <div className="budget-layout">
      <section className="card budget-card">
        <details className="expense-breakdown">
          <summary>逐笔费用 · 单价、人数与房晚</summary>
          <CostDetails
            costs={plan.costs}
            travelers={plan.request.travelers}
            budget={plan.request.budget}
          />
        </details>
        <div className="section-heading">
          <div>
            <h2>把花费，安排得刚刚好。</h2>
            <p>
              人民币 · {plan.request.travelers} 位旅客 · 全程 {plan.days.length}{" "}
              天
            </p>
          </div>
          <span className="pill amber">参考估算 · 非实时报价</span>
        </div>
        <div className="budget-totals">
          <div>
            <span>全程参考费用</span>
            <strong>{estimate(plan)}</strong>
          </div>
          <div>
            <span>你的总预算</span>
            <strong>{money(plan.request.budget)}</strong>
          </div>
          <div
            className={
              (plan.costs?.high ?? plan.totalEstimate) > plan.request.budget
                ? "over"
                : ""
            }
          >
            <span>
              {(plan.costs?.high ?? plan.totalEstimate) > plan.request.budget
                ? "超出预算"
                : "参考余量"}
            </span>
            <strong>
              {money(
                Math.abs(
                  plan.request.budget -
                    (plan.costs?.high ?? plan.totalEstimate),
                ),
              )}
            </strong>
          </div>
        </div>
        {plan.unknownCosts > 0 && (
          <div className="warning-banner">
            有 {plan.unknownCosts} 项费用尚未取得，当前合计不完整。
          </div>
        )}
        <div className="budget-stacked">
          {plan.budget.map((b, i) =>
            b.amount ? (
              <div
                key={i}
                style={{
                  width: `${(b.amount / (plan.totalEstimate || 1)) * 100}%`,
                  background: DAY_COLORS[i % DAY_COLORS.length],
                }}
                title={`${b.category} ${money(b.amount)}`}
              />
            ) : null,
          )}
        </div>
        <div className="budget-table">
          {plan.budget.map((b, i) => (
            <div className="budget-row" key={i}>
              <span className="budget-category">
                <i style={{ background: DAY_COLORS[i % DAY_COLORS.length] }} />
                {b.category}
              </span>
              <p>{b.basis}</p>
              <strong>{money(b.amount)}</strong>
            </div>
          ))}
        </div>
        <p className="fineprint">
          金额为已知费用区间，余量按区间上限计算；未知金额未计入。逐笔口径见费用明细。
        </p>
      </section>
      <div className="practical-grid">
        <section className="card">
          <div className="practical-icon">
            <TrainFront size={24} />
          </div>
          <h2>出发，也安排好归途。</h2>
          <JourneyDetails journey={plan.journey} />
          <span className="pill">{plan.transport.mode}</span>
          <div className="transport-detail">
            <span>去程</span>
            <p>{plan.transport.outbound}</p>
            <FactBadge label="去程依据" fact={plan.quality?.outbound} />
          </div>
          <div className="transport-detail">
            <span>返程</span>
            <p>{plan.transport.inbound}</p>
            <FactBadge label="返程依据" fact={plan.quality?.inbound} />
          </div>
          <p className="fineprint">{plan.transport.note}</p>
          <a
            href="https://www.12306.cn/"
            className="text-btn"
            target="_blank"
            rel="noreferrer"
          >
            12306 铁路查询
            <ExternalLink size={13} />
          </a>
          <a
            href="https://flights.ctrip.com/"
            className="text-btn flight-link"
            target="_blank"
            rel="noreferrer"
          >
            机票查询
            <ExternalLink size={13} />
          </a>
        </section>
        <section className="card">
          <div className="practical-icon">
            <Building2 size={24} />
          </div>
          <h2>旅途里，舒服的落脚点。</h2>
          <h3>{plan.hotel.name}</h3>
          <p className="hotel-area">
            <MapPin size={14} />
            {plan.hotel.area}
          </p>
          <p>{plan.hotel.reason}</p>
          <FactBadge label="住宿依据" fact={plan.quality?.hotel} />
          <div className="hotel-price">
            {money(plan.hotel.nightlyEstimate)}{" "}
            <span>/ 间夜参考 · 可订房型待核实</span>
          </div>
        </section>
      </div>
      <section className="card travel-tips">
        <h2>
          <Leaf size={20} />
          出发前的小备忘
        </h2>
        {plan.tips.map((t, i) => (
          <p key={i}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {t}
          </p>
        ))}
      </section>
    </div>
  );
}
function Sources({ plan }: { plan: Plan }) {
  return (
    <div className="sources-view">
      <section className="card">
        <div className="section-heading">
          <h2>这些细节，还需要确认。</h2>
          <TriangleAlert size={19} />
        </div>
        {plan.warnings.map((w, i) => (
          <div className="source-warning" key={i}>
            <span>{i + 1}</span>
            <p>{w}</p>
          </div>
        ))}
      </section>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>每一次检索，都有记录。</h2>
            <p>保留工具结果、查询时间与可核验来源。</p>
          </div>
          <span className="pill">{plan.evidence.length} 条记录</span>
        </div>
        {plan.evidence.map((e) => (
          <details className="evidence" key={e.id}>
            <summary>
              <div>
                <FileText size={16} />
                <strong>{e.source}</strong>
                <span
                  className={`pill ${e.status === "live" ? "green" : "amber"}`}
                >
                  {
                    {
                      live: "已返回",
                      demo: "演示",
                      error: "调用失败",
                      unconfigured: "未配置",
                    }[e.status]
                  }
                </span>
              </div>
              <span>
                {new Date(e.queriedAt).toLocaleString("zh-CN")}
                <ChevronDown size={14} />
              </span>
            </summary>
            <EvidenceLinks data={e.data} />
            <pre>{JSON.stringify(e.data, null, 2)}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
function EvidenceLinks({ data }: { data: unknown }) {
  const matches = JSON.stringify(data).match(/https?:\/\/[^\s"<>\\]+/g) || [];
  return (
    <div className="evidence-links">
      {[...new Set(matches)]
        .filter((url) => {
          try {
            return ["https:", "http:"].includes(new URL(url).protocol);
          } catch {
            return false;
          }
        })
        .slice(0, 8)
        .map((url, i) => (
          <a key={i} href={url} target="_blank" rel="noreferrer">
            {new URL(url).hostname}
            <ArrowUpRight size={13} />
          </a>
        ))}
    </div>
  );
}
