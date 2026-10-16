import type { Job } from "../../shared/types.js";
import type { Config } from "./config.js";
import { allJobs, controllers, emit, saveJob } from "./store.js";
import { checkpointFor, RESTART_REASON } from "./workflow-checkpoint.js";
import { runWorkflow } from "./workflow.js";

const queue = new Map<string, { job: Job; config: Config }>();
let stopped = false;

function drain() {
  if (stopped) return;
  for (const [id, item] of queue) {
    if (controllers.size >= 3) break;
    queue.delete(id);
    if (item.job.status !== "running" || controllers.has(id)) continue;
    void runWorkflow(item.job, item.config).finally(drain);
  }
}

export function queueWorkflow(job: Job, config: Config) {
  if (stopped || controllers.has(job.id) || queue.has(job.id)) return;
  checkpointFor(job);
  queue.set(job.id, { job, config });
  if (controllers.size >= 3)
    emit(job, {
      type: "status",
      agent: "planner",
      state: "running",
      message: "需求已保存，正在排队；轮到后会自动继续生成。",
    });
  drain();
}

export function resumeWorkflows(config: Config) {
  for (const job of allJobs().reverse()) {
    if (job.status !== "running" || job.workflow?.version !== 1) continue;
    emit(job, {
      type: "status",
      agent: "planner",
      state: "running",
      message: "服务已恢复，正在接着保存的进度继续生成。",
    });
    queueWorkflow(job, config);
  }
}

export function pauseWorkflowsForRestart() {
  stopped = true;
  for (const job of allJobs()) {
    if (job.status !== "running") continue;
    checkpointFor(job);
    job.error = undefined;
    saveJob(job);
  }
  for (const controller of controllers.values())
    controller.abort(RESTART_REASON);
}

export function cancelWorkflow(job: Job) {
  queue.delete(job.id);
  job.status = "cancelled";
  job.error = "规划已取消";
  saveJob(job); // Persist the user's intent before any in-flight request unwinds.
  const active = controllers.get(job.id);
  if (active) active.abort("user-cancelled");
  else
    emit(job, {
      type: "error",
      agent: "system",
      state: "error",
      message: job.error,
    });
}
