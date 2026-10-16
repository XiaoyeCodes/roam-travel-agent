import type { Stop } from "../../shared/types";
import {
  checkedLabel,
  effectiveFact,
  FACT_LABELS,
  safeSourceUrl,
  TRUST_LABELS,
  type Fact,
} from "../../shared/quality";
import { stopTrustSummary } from "../../shared/quality-presentation";

export function FactBadge({ label, fact }: { label: string; fact?: Fact }) {
  const value = effectiveFact(
    fact || { status: "unknown", detail: "尚未核验" },
  );
  const link = safeSourceUrl(value.url);
  return (
    <details className={`fact-detail fact-${value.status}`}>
      <summary>
        <span>{label}</span>
        <b>{TRUST_LABELS[value.status]}</b>
      </summary>
      <div className="fact-explanation">
        <p>{value.detail}</p>
        {value.source && <span>来源：{value.source}</span>}
        {value.checkedAt && <span>查询：{checkedLabel(value.checkedAt)}</span>}
        {value.expiresAt && (
          <span>建议更新：{checkedLabel(value.expiresAt)}</span>
        )}
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            查看来源 ↗
          </a>
        )}
      </div>
    </details>
  );
}
export function StopTrust({ stop }: { stop: Stop }) {
  return (
    <details className="stop-trust" aria-label={`${stop.name}信息可信状态`}>
      <summary>{stopTrustSummary(stop)}</summary>
      <div className="stop-facts">
        {(Object.keys(FACT_LABELS) as (keyof typeof FACT_LABELS)[]).map(
          (key) => (
            <FactBadge
              key={key}
              label={FACT_LABELS[key]}
              fact={stop.facts?.[key]}
            />
          ),
        )}
      </div>
    </details>
  );
}
