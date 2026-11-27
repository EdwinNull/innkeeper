import { randomUUID } from 'node:crypto';
import type { TaskSnapshot, TaskStep } from '@shared/types';
import { emit } from './bus';
import { CancelledError, describeError, UserError } from './errors';

const tasks = new Map<string, Task>();
const MAX_LOG = 400;

export interface StepHandle {
  detail(text: string): void;
  progress(value: number | null): void;
}

export class Task {
  readonly id = randomUUID();
  readonly controller = new AbortController();
  private readonly snapshot: TaskSnapshot;
  private timer: NodeJS.Timeout | null = null;

  constructor(kind: string, title: string, steps: { key: string; title: string }[]) {
    this.snapshot = {
      id: this.id,
      kind,
      title,
      state: 'running',
      steps: steps.map((s) => ({ ...s, state: 'pending', progress: null })),
      startedAt: Date.now(),
      log: [],
    };
    tasks.set(this.id, this);
    this.flush();
  }

  get signal() {
    return this.controller.signal;
  }

  view(): TaskSnapshot {
    return structuredClone(this.snapshot);
  }

  log(line: string) {
    const text = line.replace(/\s+$/, '');
    if (!text) return;
    this.snapshot.log.push(text);
    if (this.snapshot.log.length > MAX_LOG) this.snapshot.log.splice(0, this.snapshot.log.length - MAX_LOG);
    this.schedule();
  }

  skip(key: string, detail?: string) {
    const step = this.step(key);
    step.state = 'skipped';
    if (detail) step.detail = detail;
    this.schedule();
  }

  async run<T>(key: string, fn: (step: StepHandle) => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new CancelledError();
    const step = this.step(key);
    step.state = 'running';
    this.schedule();
    const handle: StepHandle = {
      detail: (text) => {
        step.detail = text;
        this.schedule();
      },
      progress: (value) => {
        step.progress = value === null ? null : Math.max(0, Math.min(1, value));
        this.schedule();
      },
    };
    try {
      const result = await fn(handle);
      if (this.signal.aborted) throw new CancelledError();
      step.state = 'done';
      step.progress = 1;
      this.schedule();
      return result;
    } catch (error) {
      step.state = 'failed';
      this.schedule();
      throw error;
    }
  }

  finish(state: 'done' | 'failed' | 'cancelled', error?: string) {
    this.snapshot.state = state;
    this.snapshot.error = error;
    this.snapshot.endedAt = Date.now();
    this.flush();
  }

  private step(key: string): TaskStep {
    const step = this.snapshot.steps.find((s) => s.key === key);
    if (!step) throw new Error(`未知步骤 ${key}`);
    return step;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 90);
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    emit('tasks:update', this.view());
  }
}

export interface TaskOutcome {
  id: string;
  finished: Promise<{ ok: boolean; error?: string }>;
}

/** 启动一个后台任务，立刻返回 id，界面通过 tasks:update 跟进。 */
export function startTask(
  kind: string,
  title: string,
  steps: { key: string; title: string }[],
  body: (task: Task) => Promise<void>,
): TaskOutcome {
  const task = new Task(kind, title, steps);
  const finished = (async () => {
    try {
      await body(task);
      task.finish('done');
      return { ok: true };
    } catch (error) {
      if (error instanceof CancelledError || task.signal.aborted) {
        task.finish('cancelled');
        return { ok: false, error: '已取消' };
      }
      const { message, hint } = describeError(error);
      const text = hint ? `${message}。${hint}` : message;
      task.log(`错误：${text}`);
      if (!(error instanceof UserError)) console.error(`[task:${kind}]`, error);
      task.finish('failed', text);
      return { ok: false, error: text };
    }
  })();
  return { id: task.id, finished };
}

export const listTasks = () => [...tasks.values()].map((t) => t.view());

export function cancelTask(id: string) {
  tasks.get(id)?.controller.abort();
}

export function dismissTask(id: string) {
  const task = tasks.get(id);
  if (task && task.view().state !== 'running') tasks.delete(id);
}

export const hasRunning = (kind: string) =>
  [...tasks.values()].some((t) => {
    const v = t.view();
    return v.kind === kind && v.state === 'running';
  });
