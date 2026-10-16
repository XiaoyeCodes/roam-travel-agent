import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Clock3,
  CloudSun,
  Compass,
  Landmark,
  LoaderCircle,
  MessageCircle,
  Route,
  Search,
  TrainFront,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import { AGENTS, type Job } from "../../shared/types";
import {
  agentWorkspace,
  type AgentWorkspaceId,
  type AgentWorkspaceNode,
} from "../../shared/agent-workspace";
import type { WorkTask } from "../../shared/work-progress";
import "./work-progress.css";

const ICONS = {
  planner: Compass,
  attractions: Landmark,
  transport: TrainFront,
  weather: CloudSun,
  hotel: Building2,
  food: Utensils,
  budget: Wallet,
  route: Route,
};
const POSITIONS: Record<AgentWorkspaceId, [number, number]> = {
  planner: [500, 57.2],
  attractions: [100, 198],
  transport: [300, 198],
  weather: [500, 198],
  hotel: [700, 198],
  food: [900, 198],
  budget: [300, 356.4],
  route: [700, 356.4],
};
const STAGES = [
  ["准备方向", "明确旅行偏好"],
  ["专家检索", "各自收集资料"],
  ["编排行程", "路线与预算协作"],
  ["整理交付", "汇总每日安排"],
];
const RESEARCH = [
  "attractions",
  "transport",
  "weather",
  "hotel",
  "food",
] as const;
const WORKFLOW: [AgentWorkspaceId, AgentWorkspaceId][] = [
  ...RESEARCH.map((id): [AgentWorkspaceId, AgentWorkspaceId] => [
    "planner",
    id,
  ]),
  ...RESEARCH.map((id): [AgentWorkspaceId, AgentWorkspaceId] => [id, "budget"]),
  ["budget", "route"],
];
const stateLabel = {
  idle: "待命",
  running: "工作中",
  done: "已完成",
  error: "未完成",
  paused: "已暂停",
};
const agentName = (id: string) =>
  AGENTS.find((a) => a.id === id)?.name || "总规划师";
const time = (at: string) =>
  new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
function elapsed(at: string, now: number) {
  const seconds = Math.max(
    0,
    Math.floor((now - (Date.parse(at) || now)) / 1000),
  );
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function queryLabel(task: WorkTask) {
  if (task.state === "running") return "查询中";
  if (task.state === "interrupted") return "已中断";
  if (task.state === "waiting") return "已暂停";
  if (task.state === "error") return "未成功";
  return {
    success: "已返回",
    partial: "部分结果",
    empty: "未查到",
    unconfigured: "未配置",
    error: "未成功",
    demo: "演示",
  }[task.outcome || "success"];
}
function linkPath(from: AgentWorkspaceId, to: AgentWorkspaceId) {
  const [x1, y1] = POSITIONS[from],
    [x2, y2] = POSITIONS[to];
  if (y1 === y2)
    return `M ${x1} ${y1} C ${x1} ${y1 + 64}, ${x2} ${y2 + 64}, ${x2} ${y2}`;
  if (to === "planner") {
    const side = x1 < 500 ? 24 : 976;
    return `M ${x1} ${y1} C ${side} ${y1}, ${side} ${y2}, ${x2} ${y2}`;
  }
  const middle = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
}

export default function WorkProgress({ job }: { job: Job }) {
  const view = useMemo(() => agentWorkspace(job), [job]);
  const [selected, setSelected] = useState<AgentWorkspaceId | null>(null);
  const [now, setNow] = useState(Date.now);
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const drawerId = useId();
  const live = job.status === "running";
  const node = view.nodes.find((n) => n.id === selected);
  const active = view.nodes.filter((n) => n.state === "running");
  const done = view.nodes.filter(
    (n) => n.id !== "planner" && n.state === "done",
  );
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const latestHandoff = view.handoffs.at(-1);
  const recentHandoffs = view.handoffs.slice(-5);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  useEffect(() => setSelected(null), [job.id]);
  useEffect(() => {
    const dialog = drawer.current;
    if (!selected || !dialog) return;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      trigger.current?.focus({ preventScroll: true });
    };
  }, [selected]);
  const status =
    job.status === "complete"
      ? "行程已就绪"
      : job.status === "awaiting_confirmation"
        ? "等待你确认方向"
        : job.status === "cancelled"
          ? "规划已停止"
          : job.status === "error"
            ? "规划暂时中断"
            : `${active.length} 位正在工作`;
  return (
    <section
      className="agent-workspace"
      aria-label="Agent 协作工作图"
      data-live={live}
    >
      <header className="workspace-heading">
        <div>
          <h2>专家协作</h2>
          <p>点选一位专家，查看工作详情</p>
        </div>
        <div
          className="workspace-live"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {live ? (
            <span className="workspace-status-dot" />
          ) : job.status === "complete" ? (
            <Check size={14} />
          ) : (
            <Clock3 size={14} />
          )}
          <span>{status}</span>
          <small>{done.length} / 7 位专家已完成</small>
        </div>
      </header>
      <ol className="workspace-stages" aria-label="规划阶段">
        {STAGES.map(([label, caption], i) => {
          const complete =
            job.status === "complete" || i + 1 < view.stage.index;
          const current =
            i + 1 === view.stage.index && job.status !== "complete";
          return (
            <li
              key={label}
              className={`${complete ? "is-complete" : ""} ${current ? "is-current" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              <span>{complete ? <Check size={13} /> : `0${i + 1}`}</span>
              <div>
                <strong>{label}</strong>
                <small title={current ? view.stage.detail : caption}>
                  {current ? view.stage.detail : caption}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
      <div
        className="workspace-canvas"
        tabIndex={0}
        role="region"
        aria-label="专家协作示意图，可横向滚动"
      >
        <div className="workspace-graph">
          <svg
            className="workspace-links"
            viewBox="0 0 1000 440"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {WORKFLOW.map(([from, to]) => (
              <path
                key={`${from}-${to}`}
                d={linkPath(from, to)}
                className="flow-link"
              />
            ))}
            {recentHandoffs.map((handoff) => {
              const age = now - Date.parse(handoff.at);
              const moving = live && age >= 0 && age < 12000;
              return (
                <path
                  key={handoff.id}
                  d={linkPath(handoff.from, handoff.to)}
                  className={`flow-link is-history ${moving ? "is-active" : ""} ${selected === handoff.from || selected === handoff.to ? "is-selected" : ""}`}
                />
              );
            })}
          </svg>
          {view.nodes.map((expert) => {
            const Icon = ICONS[expert.id];
            return (
              <button
                key={expert.id}
                type="button"
                className={`workspace-node node-${expert.id} ${selected === expert.id ? "is-selected" : ""}`}
                data-state={expert.state}
                aria-label={`${expert.name}，${stateLabel[expert.state]}，查看工作详情`}
                aria-haspopup="dialog"
                aria-expanded={selected === expert.id}
                aria-controls={drawerId}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setSelected(expert.id);
                }}
              >
                <span className="node-icon" style={{ color: expert.color }}>
                  <Icon size={21} strokeWidth={1.5} />
                </span>
                <span className="node-copy">
                  <strong>
                    {expert.id === "planner"
                      ? "总规划师"
                      : `${expert.short}专家`}
                  </strong>
                  <span className="state-label">
                    {expert.state === "running" ? (
                      <LoaderCircle size={11} className="spin" />
                    ) : expert.state === "done" ? (
                      <Check size={11} />
                    ) : null}
                    {stateLabel[expert.state]}
                  </span>
                </span>
                <span className="node-task">
                  {expert.state === "running"
                    ? expert.queries.some((q) => q.state === "running")
                      ? "正在查询资料"
                      : "正在整理建议"
                    : expert.state === "done"
                      ? "查看工作成果"
                      : expert.state === "idle"
                        ? "等待任务"
                        : "查看已有进展"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <footer className="workspace-footer">
        <span className="workspace-scroll-hint">左右滑动查看全部专家</span>
        {job.request.mode === "demo" ? (
          <span>演示流程 · 非实时检索</span>
        ) : (
          <span>虚线连接协作流程</span>
        )}
        {latestHandoff ? (
          <p title={latestHandoff.message}>
            <MessageCircle size={13} />
            <b>
              {byId.get(latestHandoff.from)?.short} →{" "}
              {byId.get(latestHandoff.to)?.short}
            </b>
            {latestHandoff.message}
          </p>
        ) : (
          <p>{live ? "专家的交接动态会在这里更新" : status}</p>
        )}
      </footer>
      <dialog
        ref={drawer}
        id={drawerId}
        className="agent-detail"
        aria-labelledby={titleId}
        onCancel={() => setSelected(null)}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], summary, [tabindex="0"]',
            ),
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
      >
        {node && (
          <div className="agent-detail-content">
            <header className="agent-detail-head">
              <span className="node-icon" style={{ color: node.color }}>
                {(() => {
                  const Icon = ICONS[node.id];
                  return <Icon size={24} strokeWidth={1.5} />;
                })()}
              </span>
              <div>
                <h2 id={titleId}>{node.name}</h2>
                <p>
                  {stateLabel[node.state]}
                  {job.request.mode === "demo" ? " · 演示内容" : ""}
                </p>
              </div>
              <button
                type="button"
                className="close-detail"
                autoFocus
                aria-label="关闭专家详情"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </button>
            </header>
            <div className="agent-detail-body">
              <ExpertDetail node={node} now={now} />
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

function ExpertDetail({
  node,
  now,
}: {
  node: AgentWorkspaceNode;
  now: number;
}) {
  const queries = [...node.queries].sort(
    (a, b) =>
      Number(b.state === "running") - Number(a.state === "running") ||
      b.eventId - a.eventId,
  );
  const messages = [...node.messages].sort((a, b) => b.id - a.id);
  const events = [...node.events]
    .filter((e) => e.type !== "report" && e.type !== "message")
    .reverse();
  return (
    <>
      <section className="detail-section">
        <h3>
          {node.state === "running"
            ? "正在做什么"
            : node.state === "idle"
              ? "工作安排"
              : "最近进展"}
        </h3>
        <div className="detail-current">
          <strong>
            {node.current?.title || node.summary || "等待任务分配"}
          </strong>
          {node.current && node.current.message !== node.current.title && (
            <p>{node.current.message}</p>
          )}
          {node.state === "running" && node.current && (
            <span className="detail-meta">
              <Clock3 size={12} />
              本阶段已进行 {elapsed(node.current.startedAt, now)}
            </span>
          )}
          {node.state === "idle" && (
            <p>任务开始后，这里会更新具体动作和查询结果。</p>
          )}
        </div>
      </section>
      {!!queries.length && (
        <section className="detail-section">
          <h3>
            <Search size={15} />
            查询与资料 <small>{queries.length}</small>
          </h3>
          {queries.slice(0, 4).map((task) => (
            <QueryDetail key={task.id} task={task} now={now} />
          ))}
          {queries.length > 4 && (
            <details>
              <summary>查看更早的 {queries.length - 4} 项查询</summary>
              {queries.slice(4).map((task) => (
                <QueryDetail key={task.id} task={task} now={now} />
              ))}
            </details>
          )}
        </section>
      )}
      {!!node.results.length && (
        <section className="detail-section">
          <h3>
            <Check size={15} />
            已有结果
          </h3>
          {node.results.map((result) => (
            <article className="detail-result" key={result.id}>
              <strong>{result.title}</strong>
              <p>{result.summary || result.message}</p>
              {!!result.findings?.length && (
                <ul>
                  {result.findings.map((finding, i) => (
                    <li key={i}>{finding}</li>
                  ))}
                </ul>
              )}
              {!!result.warnings?.length && (
                <details className="detail-warning">
                  <summary>相关说明 · {result.warnings.length}</summary>
                  {result.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </details>
              )}
            </article>
          ))}
        </section>
      )}
      <section className="detail-section">
        <h3>
          <MessageCircle size={15} />
          与其他专家的协作
        </h3>
        {messages.length ? (
          messages.map((event) => (
            <article className="detail-message" key={event.id}>
              <div className="detail-meta">
                <b>{agentName(event.agent)}</b>
                <ArrowRight size={12} />
                <b>{agentName(event.to || "planner")}</b>
                <time>{time(event.at)}</time>
              </div>
              <p>{event.message}</p>
            </article>
          ))
        ) : (
          <p className="detail-empty">
            {node.state === "idle"
              ? "收到任务后，协作消息会显示在这里。"
              : "暂时没有与其他专家的交接消息。"}
          </p>
        )}
      </section>
      {!!events.length && (
        <details className="detail-section">
          <summary>工作记录 · {events.length}</summary>
          {events.map((event) => (
            <div className="detail-event" key={event.id}>
              <time>{time(event.at)}</time>
              <p>{event.message}</p>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

function QueryDetail({ task, now }: { task: WorkTask; now: number }) {
  return (
    <article className="detail-query">
      <div className="detail-meta">
        <strong>{task.title}</strong>
        <span>{queryLabel(task)}</span>
      </div>
      {task.query && <p className="detail-query-text">{task.query}</p>}
      {task.source && <small>来源 · {task.source}</small>}
      {task.state === "running" ? (
        <p className="detail-meta">已等待 {elapsed(task.startedAt, now)}</p>
      ) : (
        <p>
          {task.state === "interrupted"
            ? "本次查询已中断，未取得完成结果。"
            : task.summary || task.message}
        </p>
      )}
      {!!(task.findings?.length || task.warnings?.length) && (
        <details>
          <summary>查看返回内容</summary>
          {task.findings?.map((text, i) => (
            <p key={`f${i}`}>{text}</p>
          ))}
          {task.warnings?.map((text, i) => (
            <p className="detail-warning" key={`w${i}`}>
              {text}
            </p>
          ))}
        </details>
      )}
    </article>
  );
}
