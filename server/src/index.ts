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
import { tripRequestSchema, proposalDecisionSchema } from "./schema.js";
import {
  allJobs,
  createJob,
  getJob,
  bus,
  controllers,
  saveJob,
  emit,
  publicJob,
} from "./store.js";
import {
  queueWorkflow,
  resumeWorkflows,
  pauseWorkflowsForRestart,
  cancelWorkflow,
} from "./workflow-queue.js";
import { acceptProposalDecision, ProposalConflict } from "./proposals.js";
import { completion } from "./llm.js";
import { connectMcp } from "./mcp.js";
import {
  startTicketServices,
  stopTicketServices,
  ticketServiceStatus,
} from "./ticket-runtime.js";
import { ticketQuerySchema } from "./tickets.js";
import { executeTool, makeTools } from "./tools.js";
import { getMap } from "./maps.js";
import { browserMapData } from "./browser-map.js";
import { enrichLocations } from "./places.js";
import { renderPdf } from "./pdf.js";
import { renderHtml } from "./html.js";
import { enrichPhotos, trackPhotoExport } from "./photos.js";
import { demoPlan, exampleRequest } from "./demo.js";
import type { TripEvent } from "../../shared/types.js";
import { refreshFacts, verifyPlan } from "./quality.js";
import { journeyOptions } from "./journey.js";
import { tripSummaries } from "./history.js";
import {
  applyRevision,
  cancelRevision,
  editablePlan,
  editControllers,
  RevisionError,
  revisionPreview,
  startRevision,
  undoRevision,
  verificationLocks,
} from "./revisions.js";
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
app.get("/api/tickets/status", (_req, res) => res.json(ticketServiceStatus()));
app.post(
  "/api/tickets/:kind/query",
  asyncRoute(async (req, res) => {
    const kind = z.enum(["rail", "flight"]).parse(req.params.kind);
    const query = ticketQuerySchema.parse(req.body);
    const controller = new AbortController();
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", close);
    try {
      const name = kind === "rail" ? "search_train_tickets" : "search_flights";
      const tool = makeTools(getConfig()).find(
        (t) => t.definition.function.name === name,
      )!;
      const result = await executeTool(tool, query, controller.signal);
      if (!res.destroyed) res.json(result);
    } finally {
      res.off("close", close);
    }
  }),
);
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
app.get("/api/trips", (_req, res) => res.json(tripSummaries(allJobs())));
app.post(
  "/api/trips",
  asyncRoute(async (req, res) => {
    const request = tripRequestSchema.parse(req.body);
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
    const job = createJob(request);
    queueWorkflow(job, getConfig());
    res.status(202).json({ id: job.id });
  }),
);
app.post("/api/demo", (_req, res) => {
  const job = createJob(exampleRequest());
  job.plan = demoPlan(job.id, job.request);
  job.status = "complete";
  saveJob(job);
  res.json(publicJob(job));
});
app.get("/api/trips/:id", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  if (job.plan) refreshFacts(job.plan);
  res.json(publicJob(job));
});
app.post("/api/trips/:id/revisions", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  startRevision(job, req.body, getConfig());
  res.status(202).json(revisionPreview(job));
});
app.get("/api/trips/:id/revisions/current", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  res.json(revisionPreview(job));
});
app.get("/api/trips/:id/journey-options", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job?.plan) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  res.json(journeyOptions(job.plan));
});
app.post("/api/trips/:id/revisions/:draftId/apply", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  const { baseRevision } = z
    .object({ baseRevision: z.number().int().min(1) })
    .parse(req.body);
  applyRevision(job, String(req.params.draftId), baseRevision);
  res.json(publicJob(job));
});
app.post("/api/trips/:id/revisions/:draftId/cancel", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  cancelRevision(job, String(req.params.draftId));
  res.json({ ok: true });
});
app.post("/api/trips/:id/undo", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  const { baseRevision } = z
    .object({ baseRevision: z.number().int().min(1) })
    .parse(req.body);
  undoRevision(job, baseRevision);
  res.json(publicJob(job));
});
app.post(
  "/api/trips/:id/verify",
  asyncRoute(async (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) {
      res.status(404).json({ error: "行程不存在" });
      return;
    }
    const input = z
      .object({
        baseRevision: z.number().int().min(1),
        day: z.number().int().min(1).max(14).optional(),
        mode: z.enum(["auto", "walking", "driving", "transit"]).optional(),
        force: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const plan = structuredClone(editablePlan(job, input.baseRevision));
    if (input.day && !plan.days.some((d) => d.day === input.day))
      throw new RevisionError("日期不存在", 400);
    if (job.editDraft?.status === "ready")
      throw new RevisionError("请先应用或放弃修改预览，再重新核验");
    verificationLocks.add(job.id);
    try {
      await verifyPlan(plan, getConfig(), {
        ...input,
        signal: AbortSignal.timeout(180000),
      });
      plan.revision = input.baseRevision + 1;
      plan.updatedAt = new Date().toISOString();
      job.plan = plan;
      saveJob(job);
      res.json(publicJob(job));
    } finally {
      verificationLocks.delete(job.id);
    }
  }),
);
app.post("/api/trips/:id/decision", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  const decision = proposalDecisionSchema.parse(req.body);
  if (controllers.has(job.id)) {
    res.status(409).json({ error: "任务仍在处理，请稍后重试。" });
    return;
  }
  const config = getConfig();
  try {
    acceptProposalDecision(job, decision);
  } catch (error) {
    if (error instanceof ProposalConflict) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
  queueWorkflow(job, config);
  res.status(202).json(publicJob(job));
});
app.post("/api/trips/:id/retry", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  if (
    !["error", "cancelled"].includes(job.status) ||
    controllers.has(job.id) ||
    editControllers.has(job.id) ||
    verificationLocks.has(job.id)
  ) {
    res
      .status(409)
      .json({ error: "当前行程不能重新开始，请刷新查看最新进度。" });
    return;
  }
  const config = getConfig();
  job.status = "running";
  job.error = undefined;
  emit(job, {
    type: "status",
    agent: "planner",
    state: "running",
    message: "已恢复原旅行需求与补充意见，继续规划",
  });
  queueWorkflow(job, config);
  res.status(202).json(publicJob(job));
});
app.post("/api/trips/:id/cancel", (req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) {
    res.status(404).json({ error: "行程不存在" });
    return;
  }
  if (["running", "awaiting_confirmation"].includes(job.status))
    cancelWorkflow(job);
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
    if (
      event.type === "complete" ||
      event.type === "error" ||
      event.type === "proposal"
    ) {
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
    const job = getJob(String(req.params.id));
    const plan = job?.plan && structuredClone(job.plan);
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
    const map = await getMap(plan, getConfig(), day);
    res.json({ ...map, interactive: browserMapData(plan, getConfig(), day) });
  }),
);
app.post(
  "/api/trips/:id/locations",
  asyncRoute(async (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job?.plan || job.status !== "complete") {
      res.status(404).json({ error: "行程尚未生成" });
      return;
    }
    const { day } = z
      .object({
        day: z.number().int().min(1).max(job.plan.days.length).optional(),
      })
      .parse(req.body);
    const plan = structuredClone(editablePlan(job, job.plan.revision || 1));
    if (job.editDraft?.status === "ready")
      throw new RevisionError("请先应用或放弃修改预览");
    verificationLocks.add(job.id);
    try {
      await verifyPlan(plan, getConfig(), {
        day,
        force: true,
        signal: AbortSignal.timeout(180000),
      });
      plan.revision = (plan.revision || 1) + 1;
      plan.updatedAt = new Date().toISOString();
      job.plan = plan;
      saveJob(job);
    } finally {
      verificationLocks.delete(job.id);
    }
    res.json({ ok: true });
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
    const plan = structuredClone(editablePlan(job, job.plan.revision || 1));
    if (job.editDraft?.status === "ready")
      throw new RevisionError("请先应用或放弃修改预览");
    verificationLocks.add(job.id);
    try {
      await enrichPhotos(plan, getConfig(), {
        force,
        signal: AbortSignal.timeout(180000),
      });
      refreshFacts(plan);
      plan.revision = (plan.revision || 1) + 1;
      plan.updatedAt = new Date().toISOString();
      job.plan = plan;
      saveJob(job);
    } finally {
      verificationLocks.delete(job.id);
    }
    res.json(publicJob(job));
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
    // Export one immutable applied revision, even if another tab edits the trip.
    const snapshot = structuredClone(job.plan);
    await enrichPhotos(snapshot, config);
    const trackingFailures = await trackPhotoExport(snapshot, config);
    const html = await renderHtml(snapshot, config, trackingFailures);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="roam-${snapshot.request.startDate}.html"; filename*=UTF-8''${encodeURIComponent(`${snapshot.destination}-${snapshot.days.length}日旅行手册.html`)}`,
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
    res
      .status(
        error instanceof RevisionError
          ? error.status
          : error instanceof z.ZodError
            ? 400
            : 500,
      )
      .json({
        error:
          error instanceof z.ZodError
            ? error.issues
                .map((i) => `${i.path.join(".")}：${i.message}`)
                .join("；")
            : safeError(error),
      });
  },
);
const server = app.listen(port, host, () => {
  console.log(`Roam API ready at http://${host}:${port}`);
  startTicketServices();
  resumeWorkflows(getConfig());
});
let shuttingDown = false;
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    pauseWorkflowsForRestart();
    for (const controller of editControllers.values()) controller.abort();
    const timer = setTimeout(() => process.exit(0), 5000);
    timer.unref();
    server.close();
    void stopTicketServices().finally(() => process.exit(0));
  });
