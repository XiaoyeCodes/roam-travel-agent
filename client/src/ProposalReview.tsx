import { useState } from "react";
import {
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import type { Job, ProposalDecision } from "../../shared/types";

export default function ProposalReview({
  job,
  onDecision,
  onCancel,
}: {
  job: Job;
  onDecision: (decision: ProposalDecision) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const proposal = job.proposal!;
  const [selected, setSelected] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(action: ProposalDecision["action"]) {
    setBusy(true);
    setError("");
    try {
      await onDecision({
        proposalId: proposal.id,
        action,
        optionId: selected || undefined,
        notes: notes.trim(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="proposal-review" aria-label="确认旅行方向">
      <div className="proposal-heading">
        <span className="pill green">
          第 {proposal.version} 版 · 等待你确认
        </span>
        <h1>先选一个方向，再安排每一天。</h1>
        <p>
          {job.request.origin} → {job.request.destination} ·{" "}
          {job.request.startDate} 出发 · {job.request.days} 天 ·{" "}
          {job.request.travelers} 人
        </p>
        <p>{proposal.message}</p>
        <div className="proposal-steps">
          <span>1 搜索攻略</span>
          <strong>2 一起选方案</strong>
          <span>3 细化行程</span>
        </div>
      </div>
      {(job.error || error) && (
        <div className="error-banner" role="alert">
          {error || job.error}
        </div>
      )}
      {job.error && (
        <p className="fineprint">
          上次调整未完成，保留了上一版方案和你的意见。可以补充后重试，或选择上一版继续。
        </p>
      )}
      <div className="proposal-options" role="group" aria-label="候选旅行方案">
        {proposal.options.map((option) => (
          <article
            className={`card proposal-option ${selected === option.id ? "selected" : ""}`}
            key={option.id}
          >
            <div className="proposal-option-top">
              <span className="proposal-letter">{option.id}</span>
              <span className="pill">
                {
                  { relaxed: "慢慢逛", balanced: "刚刚好", packed: "尽兴玩" }[
                    option.pace
                  ]
                }
              </span>
            </div>
            <h2>{option.title}</h2>
            <p>{option.summary}</p>
            <div className="proposal-highlights">
              {option.highlights.map((text, i) => (
                <span key={i}>{text}</span>
              ))}
            </div>
            <ol className="proposal-outline">
              {option.outline.map((day) => (
                <li key={day.day}>
                  <span>DAY {String(day.day).padStart(2, "0")}</span>
                  <div>
                    <strong>{day.title}</strong>
                    <p>{day.places.join(" → ")}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="proposal-cost">
              <strong>费用方向</strong>
              {option.costNote}
            </p>
            {!!option.cautions.length && (
              <ul className="proposal-cautions">
                {option.cautions.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            )}
            <div className="proposal-sources">
              {option.sourceUrls.length ? (
                option.sourceUrls.map((url) => (
                  <a href={url} target="_blank" rel="noreferrer" key={url}>
                    <ExternalLink size={12} />
                    {proposal.sources.find((s) => s.url === url)?.title ||
                      "查看参考攻略"}
                  </a>
                ))
              ) : (
                <small>基础建议 · 暂无直接网页依据</small>
              )}
            </div>
            <button
              className={`button ${selected === option.id ? "primary" : "secondary"}`}
              type="button"
              aria-pressed={selected === option.id}
              disabled={busy}
              onClick={() => setSelected(option.id)}
            >
              {selected === option.id && <Check size={16} />}选择方案{" "}
              {option.id}
            </button>
          </article>
        ))}
      </div>
      <section className="card proposal-feedback">
        <h2>
          <MessageCircle size={20} />
          把你的想法也加进来。
        </h2>
        <p>可以在某个方案上调整，也可以混合喜欢的部分，或提出新的方向。</p>
        {!!job.proposalFeedback?.length && (
          <details className="proposal-history">
            <summary>已提交的想法（{job.proposalFeedback.length} 条）</summary>
            {job.proposalFeedback.map((f, i) => (
              <p key={i}>
                {f.option ? `方案 ${f.option.id}「${f.option.title}」 · ` : ""}
                {f.notes || "确认所选方案"}
              </p>
            ))}
          </details>
        )}
        <label className="field">
          <span>补充想法（选填，调整方案时必填）</span>
          <textarea
            rows={4}
            maxLength={2000}
            disabled={busy}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="例如：选 A，但不去热门商业街；想加上 B 的博物馆；带父母少走路，早上不要太赶……"
          />
        </label>
        <div className="proposal-actions">
          <button
            className="button secondary"
            disabled={busy || !notes.trim()}
            onClick={() => void submit("revise")}
          >
            <RotateCcw size={16} />
            按我的想法调整方案
          </button>
          <button
            className="button primary"
            disabled={busy || !selected}
            onClick={() => void submit("confirm")}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            确认{selected ? `方案 ${selected}` : "方案"}，生成详细行程
            <ArrowRight size={16} />
          </button>
        </div>
        <p className="fineprint">
          选择卡片不会开始详细规划。点击确认会一并采纳补充想法；想先看调整后的方向，请点击“按我的想法调整方案”。
        </p>
      </section>
      <div className="proposal-notices">
        {proposal.notices.map((notice, i) => (
          <p key={i}>{notice}</p>
        ))}
      </div>
      <button
        className="text-btn danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onCancel();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        取消这次规划
      </button>
    </section>
  );
}
