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
