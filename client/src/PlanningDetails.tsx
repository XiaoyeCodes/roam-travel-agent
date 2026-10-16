import {
  COST_CATEGORIES,
  COST_UNITS,
  DEFAULT_JOURNEY,
  costAmount,
  costFormula,
  journeyBuffer,
  type CostInput,
  type CostLedger,
  type JourneyConstraints,
  type JourneyOption,
} from "../../shared/planning";
import type { Plan } from "../../shared/types";
import { checkedLabel } from "../../shared/quality";
const money = (n: number | null) =>
  n === null
    ? "待查"
    : `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
export function CostDetails({
  costs,
  travelers,
  budget,
}: {
  costs?: CostLedger;
  travelers: number;
  budget: number;
}) {
  if (!costs) return null;
  return (
    <section className="cost-details">
      <div className="revision-impact">
        <span>
          已知费用区间
          <b>
            {money(costs.low)} — {money(costs.high)}
          </b>
        </span>
        <span>
          按已知上限计算的余量<b>{money(budget - costs.high)}</b>
        </span>
      </div>
      <p className="schedule-note">
        {travelers} 人 · {costs.rooms} 间 × {costs.nights} 晚 · {costs.unknown}{" "}
        项金额未知 · {costs.review}{" "}
        项口径待核对。未知金额未计入区间，余量可能减少。
      </p>
      <div className="cost-list">
        {costs.entries.map((e) => (
          <article key={e.id}>
            <div>
              <strong>{e.label}</strong>
              <span>
                {COST_CATEGORIES[e.category]} ·{" "}
                {e.source === "user" ? "用户填写" : "计划估算"}
                {e.review ? " · 待核对" : ""}
              </span>
            </div>
            <b>
              {money(costAmount(e, travelers, costs.rooms, costs.nights))}
              {e.highPrice !== e.unitPrice
                ? ` — ${money(costAmount(e, travelers, costs.rooms, costs.nights, true))}`
                : ""}
            </b>
            <p>
              {costFormula(e, travelers, costs.rooms, costs.nights)}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
export function JourneyDetails({ journey }: { journey?: JourneyConstraints }) {
  return (
    <section className="journey-details">
      {(["arrival", "departure"] as const).map((kind) => {
        const b = journey?.[kind];
        return (
          <article key={kind}>
            <strong>{kind === "arrival" ? "到达目的地" : "离开目的地"}</strong>
            <p>
              {b
                ? `${b.at.replace("T", " ")} · ${b.serviceNumber || "班次号未填"} · ${b.station}`
                : "尚未确认班次时间"}
            </p>
            {b && journey && (
              <small>
                北京时间 ·{" "}
                {b.source === "ticket"
                  ? `查询结果，${checkedLabel(b.queriedAt)}`
                  : "用户填写"}{" "}
                · 预留 {journeyBuffer(journey, kind)} 分钟 · 未代表已购票
              </small>
            )}
          </article>
        );
      })}
      {journey && (
        <p className="schedule-note">
          出行情况：
          {[
            journey.withChildren && "带儿童",
            journey.withSeniors && "带长者",
            journey.largeLuggage && "大件行李",
          ]
            .filter(Boolean)
            .join("、") || "一般出行"}{" "}
          · 公交换乘偏好：
          {journey.transferPreference === "less" ? "少换乘" : "综合考虑"}
        </p>
      )}
    </section>
  );
}
export function JourneyFields({
  plan,
  value,
  onChange,
  options,
}: {
  plan: Plan;
  value: JourneyConstraints;
  onChange: (v: JourneyConstraints) => void;
  options: JourneyOption[];
}) {
  function setBoundary(
    kind: "arrival" | "departure",
    patch: Record<string, unknown>,
  ) {
    const b = value[kind];
    if (!b) return;
    onChange({
      ...value,
      [kind]: {
        ...b,
        ...patch,
        ticketRef: undefined,
        source: "user",
        queriedAt: undefined,
      },
    });
  }
  return (
    <div className="planning-fields">
      <p className="schedule-note">
        分别填写目的地到达时间和返程出发时间（北京时间）。已有车站需位于当天首/末站；选择“新增”会在预览中补入地图与时间轴。解除关联不会自动删除已有停留点。
      </p>
      {(["arrival", "departure"] as const).map((kind) => {
        const b = value[kind],
          label = kind === "arrival" ? "到达" : "返程",
          day = plan.days.find((d) => d.day === b?.day);
        const eligible =
          day?.stops.filter(
            (s, i) =>
              s.type === "transport" &&
              (kind === "arrival" ? i === 0 : i === day.stops.length - 1),
          ) || [];
        return (
          <fieldset key={kind}>
            <legend>{label}班次</legend>
            <label className="planning-checkbox">
              <input
                type="checkbox"
                checked={!!b}
                onChange={(e) => {
                  const d =
                    kind === "arrival" ? plan.days[0] : plan.days.at(-1)!;
                  onChange({
                    ...value,
                    ...(e.target.checked && plan.request.transport === "flight"
                      ? {
                          [kind === "arrival"
                            ? "arrivalBuffer"
                            : "departureBuffer"]: kind === "arrival" ? 45 : 120,
                        }
                      : {}),
                    [kind]: e.target.checked
                      ? {
                          day: d.day,
                          station: "",
                          mode:
                            plan.request.transport === "flight"
                              ? "flight"
                              : "rail",
                          at: `${d.date}T${kind === "arrival" ? "09:00" : "18:00"}`,
                          serviceNumber: "",
                        }
                      : null,
                  });
                }}
              />
              设置{label}时间约束
            </label>
            {b && (
              <>
                <label className="field">
                  <span>引用已查询的{label}班次（可选）</span>
                  <select
                    value={
                      b.ticketRef
                        ? `${b.ticketRef.evidenceId}:${b.ticketRef.index}`
                        : ""
                    }
                    onChange={(e) => {
                      const o = options.find((o) => o.id === e.target.value);
                      if (!o) {
                        setBoundary(kind, {});
                        return;
                      }
                      const matched = plan.days.find(
                        (d) => d.date === o.at.slice(0, 10),
                      );
                      onChange({
                        ...value,
                        [kind]: {
                          ...b,
                          day: matched?.day || b.day,
                          at: o.at,
                          mode: o.mode,
                          station: o.station,
                          serviceNumber: o.serviceNumber,
                          stopId: undefined,
                          ticketRef: {
                            evidenceId: o.evidenceId,
                            index: o.index,
                          },
                        },
                        ...(o.mode === "flight"
                          ? {
                              [kind === "arrival"
                                ? "arrivalBuffer"
                                : "departureBuffer"]:
                                kind === "arrival" ? 45 : 120,
                            }
                          : {}),
                      });
                    }}
                  >
                    <option value="">手动填写 / 尚无可用查询</option>
                    {options
                      .filter((o) => o.direction === kind)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.description}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="edit-field-grid">
                  <label className="field">
                    <span>{label}日期</span>
                    <select
                      value={b.day}
                      onChange={(e) => {
                        const d = plan.days.find(
                          (d) => d.day === Number(e.target.value),
                        )!;
                        setBoundary(kind, {
                          day: d.day,
                          at: `${d.date}T${b.at.slice(11)}`,
                          stopId: undefined,
                        });
                      }}
                    >
                      {plan.days.map((d) => (
                        <option key={d.day} value={d.day}>
                          第{d.day}天 · {d.date}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{label}方式</span>
                    <select
                      value={b.mode}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          [kind]: {
                            ...b,
                            mode: e.target.value as "rail" | "flight",
                            ticketRef: undefined,
                            source: "user",
                          },
                          [kind === "arrival"
                            ? "arrivalBuffer"
                            : "departureBuffer"]:
                            e.target.value === "flight"
                              ? kind === "arrival"
                                ? 45
                                : 120
                              : kind === "arrival"
                                ? 20
                                : 45,
                        })
                      }
                    >
                      <option value="rail">铁路</option>
                      <option value="flight">飞机</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{label}班次号</span>
                    <input
                      value={b.serviceNumber}
                      onChange={(e) =>
                        setBoundary(kind, { serviceNumber: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>{label}班次时间</span>
                  <input
                    type="datetime-local"
                    value={b.at}
                    onChange={(e) => setBoundary(kind, { at: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{label}关联站点</span>
                  <select
                    value={b.stopId || ""}
                    onChange={(e) => {
                      const s = eligible.find((s) => s.id === e.target.value);
                      onChange({
                        ...value,
                        [kind]: {
                          ...b,
                          stopId: s?.id,
                          station: s?.name || b.station,
                        },
                      });
                    }}
                  >
                    <option value="">新增车站 / 机场停留点</option>
                    {eligible.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{label}车站或机场名称</span>
                  <input
                    value={b.station}
                    disabled={!!b.stopId}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        [kind]: { ...b, station: e.target.value },
                      })
                    }
                    placeholder="填写具体车站或机场航站楼，勿用城市名"
                  />
                </label>
              </>
            )}
          </fieldset>
        );
      })}
      <div className="edit-field-grid">
        <label className="field">
          <span>出站 / 行李基础预留（分钟）</span>
          <input
            type="number"
            min="0"
            max="240"
            value={value.arrivalBuffer}
            onChange={(e) =>
              onChange({ ...value, arrivalBuffer: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>进站 / 安检基础预留（分钟）</span>
          <input
            type="number"
            min="0"
            max="240"
            value={value.departureBuffer}
            onChange={(e) =>
              onChange({ ...value, departureBuffer: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>额外预留（分钟）</span>
          <input
            type="number"
            min="0"
            max="120"
            value={value.extraBuffer}
            onChange={(e) =>
              onChange({ ...value, extraBuffer: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="planning-checks">
        {(
          [
            ["withChildren", "带儿童 +15分钟"],
            ["withSeniors", "带长者 +15分钟"],
            ["largeLuggage", "大件行李 +10分钟"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="field">
        <span>公交换乘偏好</span>
        <select
          value={value.transferPreference}
          onChange={(e) =>
            onChange({
              ...value,
              transferPreference: e.target
                .value as JourneyConstraints["transferPreference"],
            })
          }
        >
          <option value="balanced">综合考虑</option>
          <option value="less">少换乘</option>
        </select>
      </label>
      <p className="schedule-note">
        以上预留是可调整的规划参数，请按实际车站、机场和同行情况确认。
      </p>
    </div>
  );
}
export function CostFields({
  plan,
  value,
  onChange,
}: {
  plan: Plan;
  value: CostInput;
  onChange: (v: CostInput) => void;
}) {
  const update = (id: string, patch: Record<string, unknown>) =>
    onChange({
      ...value,
      entries: value.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  return (
    <div className="planning-fields">
      <p className="schedule-note">
        按人金额随人数重算；住宿按间数 ×
        晚数计算；整笔费用保持不变。原行程无法准确拆分的分类保留总额，请核对未分配部分。每个景点/餐饮停留点最多关联一笔费用，酒店和跨城交通单独列项。
      </p>
      <div className="edit-field-grid">
        {(
          [
            ["travelers", "同行人数", 1, 20],
            ["rooms", "住宿间数", 1, 20],
            ["nights", "住宿晚数", 0, 30],
          ] as const
        ).map(([key, label, min, max]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              value={value[key]}
              onChange={(e) =>
                onChange({ ...value, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      {value.entries.map((e) => (
        <fieldset key={e.id} className="cost-edit-row">
          <legend>{e.label}</legend>
          <div className="edit-field-grid">
            <label className="field">
              <span>项目名称</span>
              <input
                value={e.label}
                onChange={(v) => update(e.id, { label: v.target.value })}
              />
            </label>
            <label className="field">
              <span>费用分类</span>
              <select
                value={e.category}
                onChange={(v) =>
                  update(e.id, { category: v.target.value, stopId: undefined })
                }
              >
                {Object.entries(COST_CATEGORIES).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>计费单位</span>
              <select
                value={e.unit}
                onChange={(v) => update(e.id, { unit: v.target.value })}
              >
                {Object.entries(COST_UNITS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="edit-field-grid">
            <label className="field">
              <span>参考单价下限</span>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="未知留空"
                value={e.unitPrice ?? ""}
                onChange={(v) => {
                  const price =
                    v.target.value === "" ? null : Number(v.target.value);
                  update(e.id, {
                    unitPrice: price,
                    highPrice:
                      price === null
                        ? null
                        : e.highPrice === e.unitPrice || e.highPrice === null
                          ? price
                          : e.highPrice,
                  });
                }}
              />
            </label>
            <label className="field">
              <span>参考单价上限</span>
              <input
                type="number"
                min="0"
                step="any"
                value={e.highPrice ?? ""}
                placeholder="未知留空"
                onChange={(v) =>
                  update(e.id, {
                    highPrice:
                      v.target.value === "" ? null : Number(v.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              <span>关联停留点</span>
              <select
                value={e.stopId || ""}
                onChange={(v) =>
                  update(e.id, { stopId: v.target.value || undefined })
                }
              >
                <option value="">不关联 / 全程费用</option>
                {plan.days.flatMap((d) =>
                  d.stops
                    .filter(
                      (s) =>
                        (e.category === "tickets" && s.type === "attraction") ||
                        (e.category === "food" && s.type === "food"),
                    )
                    .map((s) => (
                      <option value={s.id} key={s.id}>
                        第{d.day}天 · {s.name}
                      </option>
                    )),
                )}
              </select>
            </label>
          </div>
          <label className="field">
            <span>计算依据 / 票种说明</span>
            <input
              value={e.note}
              onChange={(v) => update(e.id, { note: v.target.value })}
            />
          </label>
          <div className="cost-edit-actions">
            <label>
              <input
                type="checkbox"
                checked={!e.review}
                onChange={(v) => update(e.id, { review: !v.target.checked })}
              />
              我已核对计费口径（不代表实时成交价）
            </label>
            <button
              className="text-btn negative"
              onClick={() =>
                onChange({
                  ...value,
                  entries: value.entries.filter((x) => x.id !== e.id),
                })
              }
            >
              移除费用项目
            </button>
          </div>
          <p className="schedule-note">
            {costFormula(e, value.travelers, value.rooms, value.nights)} ={" "}
            {money(costAmount(e, value.travelers, value.rooms, value.nights))}
          </p>
        </fieldset>
      ))}
      <button
        className="button secondary small"
        onClick={() =>
          onChange({
            ...value,
            entries: [
              ...value.entries,
              {
                id: crypto.randomUUID(),
                label: "新增费用",
                category: "other",
                unit: "fixed",
                unitPrice: null,
                highPrice: null,
                source: "user",
                note: "",
                review: true,
              },
            ],
          })
        }
      >
        添加费用项目
      </button>
    </div>
  );
}
