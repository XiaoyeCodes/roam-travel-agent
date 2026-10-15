import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  ROOT,
  getConfig,
  publicConfig,
  updateConfig,
  safeError,
} from "./config.js";
import { tripRequestSchema } from "./schema.js";
import {
  allJobs,
  createJob,
  getJob,
  bus,
  controllers,
  saveJob,
} from "./store.js";
import { runWorkflow } from "./workflow.js";
import { completion } from "./llm.js";
import { connectMcp } from "./mcp.js";
import { getMap } from "./maps.js";
import { renderPdf } from "./pdf.js";
import { renderHtml } from "./html.js";
import { enrichPhotos, trackPhotoExport } from "./photos.js";
import { demoPlan, exampleRequest } from "./demo.js";
import type { TripEvent } from "../../shared/types.js";
const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT || 8787),
  host = process.env.HOST || "127.0.0.1";
const token = process.env.APP_ACCESS_TOKEN;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !token)
  throw new Error(
    "非本地监听必须配置 APP_ACCESS_TOKEN，并通过 HTTPS 反向代理访问。",
  );
const origins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
  ...(process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
]);
app.use(
  cors({ origin: (origin, cb) => cb(null, !origin || origins.has(origin)) }),
);
app.use(express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.headers.origin && !origins.has(req.headers.origin)) {
    res.status(403).json({ error: "不允许的请求来源" });
    return;
  }
  const supplied = req.headers.authorization?.replace(/^Bearer /, "") || "";
  if (
    token &&
    (Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token)))
  ) {
    res.status(401).json({ error: "需要访问口令", requiresToken: true });
    return;
  }
  if (
    ["POST", "PATCH", "PUT"].includes(req.method) &&
    !req.is("application/json")
  ) {
    res.status(415).json({ error: "请求必须使用 application/json" });
    return;
  }
  next();
});
const asyncRoute =
  (
    fn: (req: express.Request, res: express.Response) => Promise<unknown>,
  ): express.RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "roam-travel", version: "1.0.0" }),
);
app.get("/api/config", (_req, res) => res.json(publicConfig()));
app.patch("/api/config", (req, res) => res.json(updateConfig(req.body)));
app.post(
  "/api/config/test",
  asyncRoute(async (_req, res) => {
    const start = Date.now();
    await completion(
      getConfig(),
      [{ role: "user", content: "Reply with exactly OK." }],
      { maxTokens: 20 },
    );
    res.json({
      ok: true,
      model: getConfig().model,
      latencyMs: Date.now() - start,
    });
  }),
);
app.post(
  "/api/mcp/:id/test",
  asyncRoute(async (req, res) => {
    const config = getConfig().mcpServers.find((s) => s.id === req.params.id);
    if (!config) {
      res.status(404).json({ error: "服务不存在" });
      return;
    }
    const c = await connectMcp(config);
    try {
      res.json({ ok: true, tools: [...c.originalNames.values()] });
    } finally {
      await c.client.close();
    }
  }),
);
app.get("/api/trips", (_req, res) =>
  res.json(
    allJobs().map((j) => ({
      id: j.id,
      destination: j.request.destination,
      days: j.request.days,
      travelers: j.request.travelers,
      startDate: j.request.startDate,
      title: j.plan?.title,
      status: j.status,
      mode: j.request.mode,
      createdAt: j.createdAt,
    })),
  ),
);
app.post(
  "/api/trips",
  asyncRoute(async (req, res) => {
    const request = tripRequestSchema.parse(req.body);
    if (controllers.size >= 3) {
      res
        .status(429)
        .json({ error: "已有 3 个规划进行中，请等待或取消一个任务。" });
      return;
    }
    if (
      request.mode === "demo" &&
      (request.destination !== "南京" ||
        request.days !== 3 ||
        request.travelers !== 2 ||
        request.origin !== "上海")
    ) {
      res.status(400).json({
        error:
          "演示模式是上海出发、2 人南京三日固定示例；自定义需求请使用智能规划。",
      });
      return;
    }
    if (request.mode === "live" && !getConfig().apiKey) {
      res.status(400).json({ error: "请先配置模型 API Key，或选择体验示例。" });
      return;
    }
    const job = createJob(request);
    void runWorkflow(job, getConfig());
    res.status(202).json({ id: job.id });
  }),
);
app.post("/api/demo", (_req, res) => {
  const job = createJob(exampleRequest());
  job.plan = demoPlan(job.id, job.request);
  job.status = "complete";
  saveJob(job);
  res.json(job);
});
app.get("/api/trips/:id", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  res.json(job);
});
app.post("/api/trips/:id/cancel", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  controllers.get(job.id)?.abort();
  res.json({ ok: true });
});
app.get("/api/trips/:id/events", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const after = Number(req.headers["last-event-id"] || req.query.after || 0);
  const send = (event: TripEvent) =>
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  job.events.filter((e) => e.id > after).forEach(send);
  if (job.status !== "running") {
    res.write("event: closed\ndata: {}\n\n");
    res.end();
    return;
  }
  const listener = (event: TripEvent) => {
    send(event);
    if (event.type === "complete" || event.type === "error") {
      cleanup();
      res.end();
    }
  };
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off(job.id, listener);
  };
  bus.on(job.id, listener);
  req.on("close", cleanup);
});
app.get(
  "/api/trips/:id/map",
  asyncRoute(async (req, res) => {
    const plan = getJob(String(req.params.id))?.plan;
    if (!plan) {
      res.status(404).json({ error: "行程尚未生成" });
      return;
    }
    const day = req.query.day
      ? z.coerce
          .number()
          .int()
          .min(1)
          .max(plan.days.length)
          .parse(req.query.day)
      : undefined;
    res.json(await getMap(plan, getConfig(), day));
  }),
);
app.post(
  "/api/trips/:id/photos",
  asyncRoute(async (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job?.plan || job.status !== "complete") {
      res.status(404).json({ error: "行程尚未生成" });
      return;
    }
    const { force } = z
      .object({ force: z.boolean().optional() })
      .parse(req.body);
    await enrichPhotos(job.plan, getConfig(), { force });
    saveJob(job);
    res.json(job);
  }),
);
app.get(
  "/api/trips/:id/html",
  asyncRoute(async (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job?.plan || job.status !== "complete") {
      res.status(404).json({ error: "行程尚未生成" });
      return;
    }
    const config = getConfig();
    await enrichPhotos(job.plan, config);
    saveJob(job);
    const trackingFailures = await trackPhotoExport(job.plan, config);
    const html = await renderHtml(job.plan, config, trackingFailures);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="roam-${job.plan.request.startDate}.html"; filename*=UTF-8''${encodeURIComponent(`${job.plan.destination}-${job.plan.days.length}日旅行手册.html`)}`,
    );
    res.send(html);
  }),
);
let pdfBusy = false;
app.get(
  "/api/trips/:id/pdf",
  asyncRoute(async (req, res) => {
    const plan = getJob(String(req.params.id))?.plan;
    if (!plan) {
      res.status(404).json({ error: "行程尚未生成" });
      return;
    }
    if (pdfBusy) {
      res.status(429).json({ error: "正在导出另一份 PDF，请稍后重试。" });
      return;
    }
    pdfBusy = true;
    try {
      const pdf = await renderPdf(plan, getConfig());
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="roam-${plan.request.startDate}.pdf"; filename*=UTF-8''${encodeURIComponent(`${plan.destination}-${plan.days.length}日旅行计划.pdf`)}`,
      );
      res.send(pdf);
    } finally {
      pdfBusy = false;
    }
  }),
);
const client = path.join(ROOT, "client", "dist");
if (fs.existsSync(client)) {
  app.use(express.static(client));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "接口不存在" });
      return;
    }
    res.sendFile(path.join(client, "index.html"));
  });
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    res.status(error instanceof z.ZodError ? 400 : 500).json({
      error:
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}：${i.message}`)
              .join("；")
          : safeError(error),
    });
  },
);
app.listen(port, host, () =>
  console.log(`Roam API ready at http://${host}:${port}`),
);
