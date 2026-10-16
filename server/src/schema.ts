import { z } from "zod";
export function dateAt(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export const tripRequestSchema = z.object({
  origin: z.string().trim().min(1).max(60),
  destination: z.string().trim().min(1).max(60),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
      "日期无效",
    ),
  days: z.number().int().min(1).max(14),
  travelers: z.number().int().min(1).max(12),
  budget: z.number().min(100).max(1000000),
  preferences: z.array(z.string().max(30)).max(10),
  pace: z.enum(["relaxed", "balanced", "packed"]),
  transport: z.enum(["smart", "train", "flight", "drive"]),
  notes: z.string().max(2000).default(""),
  mode: z.enum(["demo", "live"]),
});
const text = z.string().max(4000);
export const proposalDecisionSchema = z
  .object({
    proposalId: z.string().uuid(),
    action: z.enum(["confirm", "revise"]),
    optionId: z.enum(["A", "B", "C"]).optional(),
    notes: z.string().trim().max(2000).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.action === "confirm" && !value.optionId)
      ctx.addIssue({
        code: "custom",
        path: ["optionId"],
        message: "请先选择一个方案",
      });
    if (value.action === "revise" && !value.notes)
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "请填写希望如何调整",
      });
  });
export const proposalSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  options: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(100),
        summary: z.string().trim().min(1).max(800),
        highlights: z.array(z.string().min(1).max(150)).min(1).max(6),
        outline: z
          .array(
            z.object({
              day: z.number().int().min(1).max(14),
              title: z.string().min(1).max(100),
              places: z.array(z.string().min(1).max(100)).min(1).max(5),
            }),
          )
          .min(1)
          .max(14),
        pace: z.enum(["relaxed", "balanced", "packed"]),
        costNote: z.string().min(1).max(500),
        cautions: z.array(z.string().max(300)).max(5),
        sourceUrls: z.array(z.string().max(2000)).max(8).default([]),
      }),
    )
    .min(2)
    .max(3),
});
export const reportSchema = z.object({
  summary: text,
  findings: z.array(text).max(12).default([]),
  warnings: z.array(text).max(12).default([]),
  messages: z
    .array(
      z.object({
        to: z.enum([
          "attractions",
          "transport",
          "weather",
          "hotel",
          "food",
          "budget",
          "route",
          "planner",
        ]),
        content: text,
      }),
    )
    .max(5)
    .default([]),
});
export const planSchema = z.object({
  title: text,
  subtitle: text,
  summary: text,
  days: z
    .array(
      z.object({
        day: z.number().int(),
        title: text,
        subtitle: text,
        weather: text,
        stops: z
          .array(
            z.object({
              name: z.string().max(150),
              time: z.string().max(30),
              duration: z.string().max(80),
              type: z.enum(["attraction", "food", "hotel", "transport"]),
              description: text,
              cost: z.number().min(0).nullable(),
              tip: text,
              sourceIds: z.array(z.string()).default([]),
              photoQuery: z.string().max(160).optional(),
              poiId: z
                .string()
                .regex(/^[a-zA-Z0-9_-]{1,80}$/)
                .nullable()
                .optional(),
            }),
          )
          .min(1)
          .max(8),
        note: text,
      }),
    )
    .min(1)
    .max(14),
  budget: z
    .array(
      z.object({
        category: z.string().max(100),
        amount: z.number().min(0).nullable(),
        basis: text,
        status: z.enum(["estimate", "verified", "unknown"]),
      }),
    )
    .min(1)
    .max(12),
  tips: z.array(text).max(15),
  warnings: z.array(text).max(20),
  transport: z.object({
    mode: text,
    outbound: text,
    inbound: text,
    note: text,
  }),
  hotel: z.object({
    name: text,
    area: text,
    reason: text,
    nightlyEstimate: z.number().min(0).nullable(),
  }),
});
export function budgetTotals(items: { amount: number | null }[]) {
  return {
    totalEstimate:
      Math.round(items.reduce((sum, i) => sum + (i.amount ?? 0), 0) * 100) /
      100,
    unknownCosts: items.filter((i) => i.amount === null).length,
  };
}
