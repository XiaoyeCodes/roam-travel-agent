import { useEffect, useRef, useState } from "react";
import {
  X,
  LoaderCircle,
  Sparkles,
  LockKeyhole,
  Check,
  Undo2,
} from "lucide-react";
import type { Job } from "../../shared/types";
import type { RevisionPreview, RevisionRequest } from "../../shared/revisions";
import { api } from "./api";
import { StopTrust } from "./PlanQuality";
import {
  CostDetails,
  CostFields,
  JourneyDetails,
  JourneyFields,
} from "./PlanningDetails";
import {
  DEFAULT_JOURNEY,
  type CostInput,
  type JourneyConstraints,
  type JourneyOption,
} from "../../shared/planning";

export default function ItineraryEditor({
  job,
  day,
  stopId,
  mode,
  onUpdated,
  onClose,
}: {
  job: Job;
  day: number;
  stopId?: string;
  mode?: "repair" | "journey" | "budget";
  onUpdated: (job: Job) => void;
  onClose: () => void;
}) {
  const plan = job.plan!,
    currentDay = plan.days.find((d) => d.day === day) || plan.days[0];
  const [tab, setTab] = useState<"ai" | "manual">(stopId ? "manual" : "ai");
  const [selected, setSelected] = useState(stopId || currentDay.stops[0].id!);
  const stop =
    currentDay.stops.find((s) => s.id === selected) || currentDay.stops[0];
  const [instruction, setInstruction] = useState("");
  const [strategy, setStrategy] = useState<"preserve" | "relaxed">("preserve");
  const [journey, setJourney] = useState<JourneyConstraints>(
    structuredClone(plan.journey || DEFAULT_JOURNEY),
  );
  const [costs, setCosts] = useState<CostInput>({
    travelers: plan.request.travelers,
    rooms: plan.costs?.rooms || 1,
    nights: plan.costs?.nights ?? Math.max(0, plan.days.length - 1),
    entries: structuredClone(plan.costs?.entries || []),
  });
  const [ticketOptions, setTicketOptions] = useState<JourneyOption[]>([]);
  useEffect(() => {
    if (mode === "journey")
      void api<JourneyOption[]>(`/trips/${job.id}/journey-options`)
        .then(setTicketOptions)
        .catch(() => {});
  }, [job.id, mode]);
  const [locked, setLocked] = useState<string[]>(plan.lockedStopIds || []);
  const [fields, setFields] = useState({
    name: stop.name,
    time: stop.time,
    duration: stop.duration,
    cost: stop.cost === null ? "" : String(stop.cost),
    description: stop.description,
    tip: stop.tip,
  });
  const [draft, setDraft] = useState<RevisionPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setFields({
      name: stop.name,
      time: stop.time,
      duration: stop.duration,
      cost: stop.cost === null ? "" : String(stop.cost),
      description: stop.description,
      tip: stop.tip,
    });
  }, [stop.id]);
  useEffect(() => {
    let active = true;
    api<RevisionPreview | null>(`/trips/${job.id}/revisions/current`)
      .then((d) => {
        if (active) setDraft(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [job.id]);
  useEffect(() => {
    if (draft?.status !== "running") return;
    let active = true;
    const timer = setInterval(() => {
      api<RevisionPreview | null>(`/trips/${job.id}/revisions/current`)
        .then((d) => {
          if (active) setDraft(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job.id, draft?.id, draft?.status]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const nodes = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary",
        ) || []),
      ].filter((n) => n.getClientRects().length);
      const first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [onClose]);
  async function preview(action: RevisionRequest["action"], moveTo?: number) {
    setBusy("preview");
    setError("");
    try {
      const request: RevisionRequest = {
        baseRevision: plan.revision || 1,
        day: currentDay.day,
        action,
        instruction,
        lockedStopIds: locked,
        ...(mode === "repair" ? { repairStrategy: strategy } : {}),
        ...(mode === "journey" ? { journey } : {}),
        ...(mode === "budget" ? { costs } : {}),
        ...(action !== "ai" || stopId ? { stopId: selected } : {}),
        ...(action === "update"
          ? {
              fields: {
                ...fields,
                cost: fields.cost.trim() === "" ? null : Number(fields.cost),
              },
            }
          : {}),
        ...(moveTo !== undefined ? { moveTo } : {}),
      };
      setDraft(
        await api(`/trips/${job.id}/revisions`, {
          method: "POST",
          body: JSON.stringify(request),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function apply() {
    if (!draft) return;
    setBusy("apply");
    setError("");
    try {
      onUpdated(
        await api(`/trips/${job.id}/revisions/${draft.id}/apply`, {
          method: "POST",
          body: JSON.stringify({ baseRevision: draft.baseRevision }),
        }),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function discard() {
    if (!draft) return;
    setBusy("discard");
    setError("");
    try {
      await api(`/trips/${job.id}/revisions/${draft.id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      if (draft.status !== "running") setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const running = draft?.status === "running",
    ready = draft?.status === "ready";
  const displayMode = running || ready ? draft?.action : mode;
  const disabled = loading || !!busy || !!running;
  return (
    <div className="modal-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        className="itinerary-editor"
      >
        <header className="editor-head">
          <div>
            <span className="eyebrow">MAKE ROOM FOR A BETTER DAY</span>
            <h2 id="edit-title">
              {displayMode === "journey"
                ? "班次与行程衔接"
                : displayMode === "budget"
                  ? "费用明细与人数"
                  : displayMode === "repair"
                    ? `修复第 ${draft?.summary?.day || currentDay.day} 天冲突`
                    : `调整第 ${draft?.summary?.day || currentDay.day} 天`}
            </h2>
            <p>当前版本 V{plan.revision || 1} · 先预览变化，再应用到行程</p>
          </div>
          <button
            className="icon-btn"
            aria-label="关闭行程编辑"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="editor-body">
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {!ready && !running && (
            <>
              {mode === "journey" && (
                <JourneyFields
                  plan={plan}
                  value={journey}
                  onChange={setJourney}
                  options={ticketOptions}
                />
              )}
              {mode === "budget" && (
                <CostFields plan={plan} value={costs} onChange={setCosts} />
              )}
              {mode === "repair" && (
                <section className="repair-choice">
                  <p>
                    将重新核验当天问题，把交通耗时、开放时间、已确认班次和锁定地点交给规划师，生成一个可比较的修复方案。
                  </p>
                  <label className="field">
                    <span>修复策略</span>
                    <select
                      value={strategy}
                      onChange={(e) =>
                        setStrategy(e.target.value as typeof strategy)
                      }
                    >
                      <option value="preserve">
                        保留全部地点，调整时间与时长
                      </option>
                      <option value="relaxed">
                        放松节奏，允许减少或替换未锁定地点
                      </option>
                    </select>
                  </label>
                </section>
              )}
              {mode !== "journey" && mode !== "budget" && (
                <>
                  {mode !== "repair" && (
                    <>
                      <div className="editor-tabs">
                        <button
                          aria-pressed={tab === "ai"}
                          onClick={() => setTab("ai")}
                        >
                          <Sparkles size={14} />
                          告诉智能体
                        </button>
                        <button
                          aria-pressed={tab === "manual"}
                          onClick={() => setTab("manual")}
                        >
                          直接编辑
                        </button>
                      </div>
                    </>
                  )}
                  {mode === "repair" || tab === "ai" ? (
                    <>
                      <label className="field">
                        <span>希望怎么调整</span>
                        <textarea
                          rows={4}
                          value={instruction}
                          onChange={(e) => setInstruction(e.target.value)}
                          placeholder="例如：第二天下午改成室内活动，保留博物馆；餐饮控制在每人80元以内。"
                        />
                      </label>
                      <div className="edit-examples">
                        {[
                          "这一天太赶了，减少一站并留足交通时间",
                          "下午可能下雨，换成有依据的室内活动",
                          "保留锁定地点，把餐饮预算降低一些",
                        ].map((t) => (
                          <button key={t} onClick={() => setInstruction(t)}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="manual-edit">
                      <label className="field">
                        <span>选择停留点</span>
                        <select
                          value={selected}
                          onChange={(e) => setSelected(e.target.value)}
                        >
                          {currentDay.stops.map((s, i) => (
                            <option key={s.id} value={s.id}>
                              {i + 1}. {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>地点名称</span>
                        <input
                          value={fields.name}
                          onChange={(e) =>
                            setFields({ ...fields, name: e.target.value })
                          }
                        />
                      </label>
                      <div className="edit-field-grid">
                        <label className="field">
                          <span>开始时间</span>
                          <input
                            type="time"
                            value={fields.time}
                            onChange={(e) =>
                              setFields({ ...fields, time: e.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>停留时长</span>
                          <input
                            value={fields.duration}
                            onChange={(e) =>
                              setFields({ ...fields, duration: e.target.value })
                            }
                            placeholder="如 1小时30分钟"
                          />
                        </label>
                        <label className="field">
                          <span>全体旅客该项费用 / 元</span>
                          <input
                            type="number"
                            min="0"
                            value={fields.cost}
                            onChange={(e) =>
                              setFields({ ...fields, cost: e.target.value })
                            }
                            placeholder="未知留空"
                          />
                        </label>
                      </div>
                      <label className="field">
                        <span>安排说明</span>
                        <textarea
                          rows={2}
                          value={fields.description}
                          onChange={(e) =>
                            setFields({
                              ...fields,
                              description: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span>提醒</span>
                        <textarea
                          rows={2}
                          value={fields.tip}
                          onChange={(e) =>
                            setFields({ ...fields, tip: e.target.value })
                          }
                        />
                      </label>
                      <div className="manual-operations">
                        <button
                          className="text-btn"
                          disabled={
                            disabled || currentDay.stops.indexOf(stop) === 0
                          }
                          onClick={() =>
                            preview("move", currentDay.stops.indexOf(stop) - 1)
                          }
                        >
                          预览上移一站
                        </button>
                        <button
                          className="text-btn"
                          disabled={
                            disabled ||
                            currentDay.stops.indexOf(stop) ===
                              currentDay.stops.length - 1
                          }
                          onClick={() =>
                            preview("move", currentDay.stops.indexOf(stop) + 1)
                          }
                        >
                          预览下移一站
                        </button>
                        <button
                          className="text-btn negative"
                          disabled={disabled || currentDay.stops.length <= 1}
                          onClick={() => preview("remove")}
                        >
                          预览移除这站
                        </button>
                      </div>
                    </div>
                  )}
                  <details className="edit-locks">
                    <summary>
                      <LockKeyhole size={14} />
                      保留这些安排（已锁定{" "}
                      {
                        currentDay.stops.filter((s) => locked.includes(s.id!))
                          .length
                      }{" "}
                      项）
                    </summary>
                    <p>
                      锁定的地点、时间和安排说明会保留。本次应用后继续记住锁定选择。
                    </p>
                    {currentDay.stops.map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={locked.includes(s.id!)}
                          onChange={(e) =>
                            setLocked(
                              e.target.checked
                                ? [...locked, s.id!]
                                : locked.filter((id) => id !== s.id),
                            )
                          }
                        />
                        {s.time} · {s.name}
                      </label>
                    ))}
                  </details>
                </>
              )}
              {draft?.error && (
                <p className="error-banner" role="alert">
                  {draft.error}
                </p>
              )}
            </>
          )}
          {running && (
            <div className="edit-progress">
              <LoaderCircle className="spin" size={30} />
              <strong>{draft.progress}</strong>
              <p>原行程仍可使用。关闭窗口后可再次打开查看进度。</p>
            </div>
          )}
          {ready && draft.summary && (
            <div className="revision-preview">
              {draft.summary.repair && (
                <div className="repair-comparison">
                  <strong>
                    重新核验结果 · {draft.summary.repair.attempts || 1} 轮修正
                  </strong>
                  <div className="revision-impact">
                    <span>
                      时间冲突
                      <b>
                        {draft.summary.repair.beforeConflicts} →{" "}
                        {draft.summary.repair.afterConflicts} 项
                      </b>
                    </span>
                    <span>
                      待确认事项
                      <b>
                        {draft.summary.repair.beforeWarnings} →{" "}
                        {draft.summary.repair.afterWarnings} 项
                      </b>
                    </span>
                    <span>
                      已知停留与交通
                      <b>
                        {draft.summary.repair.beforeMinutes} →{" "}
                        {draft.summary.repair.afterMinutes} 分钟
                      </b>
                    </span>
                  </div>
                  <p className="schedule-note">
                    {draft.summary.repair.afterConflicts <
                    draft.summary.repair.beforeConflicts
                      ? "冲突减少，仍需检查剩余事项。"
                      : "当前约束下未减少冲突，可放弃预览或调整锁定项后重试。"}{" "}
                    未知交通、开放和预约信息不会视为已解决。
                  </p>
                </div>
              )}
              <div className="revision-impact">
                <span>
                  参考费用变化{" "}
                  <b>
                    {draft.summary.budgetDelta >= 0 ? "+" : ""}¥
                    {draft.summary.budgetDelta.toFixed(2)}
                    {draft.summary.budgetIncomplete ? "（金额不完整）" : ""}
                  </b>
                </span>
                <span>
                  站间交通变化{" "}
                  <b>
                    {draft.summary.travelMinutesDelta === null
                      ? "数据不足，暂不能比较"
                      : `${draft.summary.travelMinutesDelta >= 0 ? "+" : ""}${draft.summary.travelMinutesDelta} 分钟`}
                  </b>
                </span>
              </div>
              <h3>本次修改</h3>
              {draft.action === "journey" && (
                <JourneyDetails journey={draft.journey} />
              )}
              {draft.action === "budget" && (
                <CostDetails
                  costs={draft.costs}
                  travelers={draft.travelers || plan.request.travelers}
                  budget={plan.request.budget}
                />
              )}
              {draft.summary.changes.map((change, i) => (
                <article className="revision-change" key={i}>
                  <strong>
                    {
                      {
                        added: "新增",
                        removed: "移除",
                        updated: "调整",
                        moved: "顺序",
                      }[change.kind]
                    }{" "}
                    · {change.name}
                  </strong>
                  {change.details.map((d, n) => (
                    <p key={n}>{d}</p>
                  ))}
                </article>
              ))}
              {draft.summary.warnings.map((w, i) => (
                <p className="schedule-note" key={i}>
                  {w}
                </p>
              ))}
              {draft.day && (
                <>
                  <details className="preview-day">
                    <summary>查看调整后的完整一天</summary>
                    {draft.day.stops.map((s, i) => (
                      <article key={s.id}>
                        <strong>
                          {i + 1}. {s.time} · {s.name}
                        </strong>
                        <p>
                          {s.duration} · {s.description}
                        </p>
                        <StopTrust stop={s} />
                      </article>
                    ))}
                  </details>
                </>
              )}
            </div>
          )}
        </div>
        <footer className="editor-footer">
          {running || ready ? (
            <button
              className="button secondary"
              onClick={discard}
              disabled={!!busy}
            >
              {running ? "取消本次修改" : "放弃预览"}
            </button>
          ) : (
            <button className="button secondary" onClick={onClose}>
              返回行程
            </button>
          )}
          {ready ? (
            <button
              className="button primary"
              onClick={apply}
              disabled={!!busy}
            >
              {busy === "apply" ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              确认应用修改
            </button>
          ) : (
            !running && (
              <button
                className="button primary"
                disabled={
                  disabled || (!mode && tab === "ai" && !instruction.trim())
                }
                onClick={() =>
                  preview(mode || (tab === "ai" ? "ai" : "update"))
                }
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                预览修改
              </button>
            )
          )}
        </footer>
      </div>
    </div>
  );
}
