import { EventEmitter } from 'node:events';
import { newId } from './store';

export type JobType = 'ingest' | 'transcribe' | 'render';
export type Job = {
  id: string;
  type: JobType;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string;
  projectId?: string;
  assetId?: string;
  outputId?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

type Task = (update: (progress: number, message?: string) => void) => Promise<unknown>;

const LANES: Record<JobType, number> = { ingest: 2, transcribe: 1, render: 1 };

/** Basit iş kuyruğu: içe aktarma, çözümleme ve render ayrı şeritlerde */
export class Jobs extends EventEmitter {
  jobs = new Map<string, Job>();
  private queues: Record<JobType, { job: Job; task: Task }[]> = { ingest: [], transcribe: [], render: [] };
  private running: Record<JobType, number> = { ingest: 0, transcribe: 0, render: 0 };

  add(type: JobType, title: string, meta: Partial<Job>, task: Task): Job {
    const job: Job = { id: `j_${newId()}`, type, title, status: 'queued', progress: 0, message: 'Sırada', createdAt: new Date().toISOString(), ...meta };
    this.jobs.set(job.id, job);
    this.queues[type].push({ job, task });
    this.emit('job', job);
    this.pump(type);
    return job;
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }

  private pump(type: JobType) {
    while (this.running[type] < LANES[type] && this.queues[type].length) {
      const { job, task } = this.queues[type].shift()!;
      this.running[type]++;
      job.status = 'running';
      job.message = 'Başladı';
      this.emit('job', job);
      let last = 0;
      const update = (progress: number, message?: string) => {
        job.progress = Math.max(0, Math.min(1, progress));
        if (message) job.message = message;
        const now = Date.now();
        if (now - last > 250 || progress >= 1) {
          last = now;
          this.emit('job', job);
        }
      };
      task(update)
        .then((result) => {
          job.status = 'done';
          job.progress = 1;
          job.result = result;
          job.message = 'Tamamlandı';
        })
        .catch((e: Error) => {
          job.status = 'error';
          job.error = e.message;
          job.message = 'Hata';
          console.error(`[iş:${job.type}] ${job.title}:`, e.message, process.env.FABRIKA_DEBUG ? e.stack : '');
        })
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          this.running[type]--;
          this.emit('job', job);
          this.pump(type);
        });
    }
  }
}
