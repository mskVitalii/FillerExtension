import type { JobSearchStageTiming } from "@/types/job-search";

/** Runs `fn`, appending its wall-clock duration to `stages` under `label` (also when it throws). */
export async function timeStage<T>(stages: JobSearchStageTiming[] | undefined, label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    stages?.push({ label, ms: performance.now() - start });
  }
}
