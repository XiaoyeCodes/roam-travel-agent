import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { DATA_DIR } from "./config.js";
import type { Job, TripRequest, TripEvent } from "../../shared/types.js";
import { ensurePlanIdentity, refreshFacts } from "./quality.js";
const jobs = new Map<string, Job>();
export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const controllers = new Map<string, AbortController>();
const directory = path.join(DATA_DIR, "trips");
fs.mkdirSync(directory, { recursive: true });
for (const filename of fs
  .readdirSync(directory)
  .filter((s) => s.endsWith(".json"))) {
  try {
    const job = JSON.parse(
      fs.readFileSync(path.join(directory, filename), "utf8"),
    ) as Job;
    if (job.plan) {
      ensurePlanIdentity(job.plan);
      refreshFacts(job.plan);
    }
    if (job.editDraft?.status === "running") {
      job.editDraft.status = "error";
      job.editDraft.error =
        "服务重启中断了修改预览，原行程已保留，请重新预览。";
    }
    if (job.status === "running" && job.workflow?.version === 1) {
      // The startup queue resumes these jobs after the API starts listening.
      job.error = undefined;
    } else if (job.status === "running") {
      job.status =
        job.proposal && !job.confirmedSelection
          ? "awaiting_confirmation"
          : "error";
      job.error =
        job.status === "awaiting_confirmation"
          ? "服务重启中断了方案调整，已保留上一版方案和你的想法。"
          : "服务重启中断了规划，请重新生成。";
    }
    jobs.set(job.id, job);
  } catch {
    /* Ignore an incomplete local record. */
  }
}
export function saveJob(job: Job) {
  if (job.plan) ensurePlanIdentity(job.plan);
  const target = path.join(directory, `${job.id}.json`);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(job), { mode: 0o600 });
  // Windows indexers can hold the destination briefly; preserve atomic replacement.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(`${target}.tmp`, target);
      break;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 3 ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw error;
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        [10, 30, 60][attempt],
      );
    }
  }
}
export function createJob(request: TripRequest): Job {
  const job: Job = {
    id: randomUUID(),
    request,
    status: "running",
    events: [],
    workflow: { version: 1, evidence: [], reports: {} },
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  saveJob(job);
  return job;
}
export function getJob(id: string) {
  return jobs.get(id);
}
export function publicJob(job: Job) {
  const { editHistory, editDraft, workflow, ...result } = job;
  return {
    ...result,
    ...(editHistory
      ? {
          revisionHistory: editHistory.map((h) => h.summary),
          canUndo: editHistory.length > 0,
        }
      : {}),
    ...(editDraft
      ? {
          editDraft: {
            id: editDraft.id,
            request: editDraft.request,
            status: editDraft.status,
            progress: editDraft.progress,
            error: editDraft.error,
            baseRevision: editDraft.baseRevision,
            createdAt: editDraft.createdAt,
            summary: editDraft.summary,
          },
        }
      : {}),
  };
}
export function allJobs() {
  return [...jobs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
export function emit(job: Job, event: Omit<TripEvent, "id" | "at">) {
  const data: TripEvent = {
    ...event,
    id: job.events.length + 1,
    at: new Date().toISOString(),
  };
  job.events.push(data);
  bus.emit(job.id, data);
  saveJob(job);
  return data;
}
