import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { DATA_DIR } from "./config.js";
import type { Job, TripRequest, TripEvent } from "../../shared/types.js";
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
    if (job.status === "running") {
      job.status = "error";
      job.error = "服务重启中断了规划，请重新生成。";
    }
    jobs.set(job.id, job);
  } catch {
    /* Ignore an incomplete local record. */
  }
}
export function saveJob(job: Job) {
  const target = path.join(directory, `${job.id}.json`);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(job), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}
export function createJob(request: TripRequest): Job {
  const job: Job = {
    id: randomUUID(),
    request,
    status: "running",
    events: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  saveJob(job);
  return job;
}
export function getJob(id: string) {
  return jobs.get(id);
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
