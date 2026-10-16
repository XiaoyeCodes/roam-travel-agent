import type {
  AgentId,
  AgentReport,
  Evidence,
  Job,
} from "../../shared/types.js";
import { AGENTS } from "../../shared/types.js";
import { saveJob } from "./store.js";

export const stageKey = (agent: AgentId, review = false) =>
  `${agent}:${review ? "review" : "research"}`;
export const RESTART_REASON = "roam-service-restart";

export function checkpointFor(job: Job) {
  const selectionId = job.confirmedSelection?.proposalId;
  if (job.workflow?.version === 1 && job.workflow.selectionId === selectionId)
    return job.workflow;
  const previous = job.workflow;
  job.workflow = {
    version: 1,
    selectionId,
    evidence: [...(job.proposal?.evidence || [])],
    reports: {},
  };
  // Recover legacy records explicitly retried by the user. Older query events
  // only contain evidence IDs, so never manufacture their missing raw results.
  if (!previous && selectionId) {
    const review = new Map<string, boolean>();
    for (const event of job.events) {
      if (!AGENTS.some((a) => a.id === event.agent)) continue;
      const agent = event.agent as AgentId;
      if (event.type === "status" && event.work?.kind === "analysis")
        review.set(agent, /回应审阅|复核路线/.test(event.work.title));
      if (event.type === "report" && event.data) {
        const report = event.data as AgentReport;
        if (
          report.agent === agent &&
          report.status === "done" &&
          Array.isArray(report.findings)
        )
          job.workflow.reports[stageKey(agent, review.get(agent))] = report;
      } else if (
        event.type === "status" &&
        event.state === "error" &&
        event.work?.kind === "analysis"
      ) {
        job.workflow.reports[stageKey(agent, review.get(agent))] = {
          agent,
          status: "error",
          summary: event.work.summary || event.message,
          warnings: event.work.warnings || [event.message],
          findings: [],
          messages: [],
          evidenceIds: [],
        };
      }
    }
  }
  saveJob(job);
  return job.workflow;
}

export function rememberEvidence(job: Job, item: Evidence) {
  const checkpoint = checkpointFor(job);
  if (!checkpoint.evidence.some((e) => e.id === item.id))
    checkpoint.evidence.push(item);
  saveJob(job);
}
