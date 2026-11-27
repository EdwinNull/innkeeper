import { CaretDown, CaretUp, CheckCircle, Circle, MinusCircle, WarningCircle, X, XCircle } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { TaskSnapshot, TaskStep } from '@shared/types';
import { call } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, IconButton, Progress } from '../ui';

export function taskProgress(task: TaskSnapshot): number | null {
  if (task.state === 'done') return 1;
  const total = task.steps.length || 1;
  let sum = 0;
  let known = false;
  for (const s of task.steps) {
    if (s.state === 'done' || s.state === 'skipped') sum += 1;
    else if (s.state === 'running' && s.progress !== null) {
      sum += s.progress;
      known = true;
    }
  }
  return total === 1 && !known ? null : sum / total;
}

export function StepIcon({ state }: { state: TaskStep['state'] }) {
  switch (state) {
    case 'done':
      return <CheckCircle size={17} weight="fill" color="var(--jade)" />;
    case 'failed':
      return <XCircle size={17} weight="fill" color="var(--seal)" />;
    case 'skipped':
      return <MinusCircle size={17} color="var(--fg-4)" />;
    case 'running':
      return <span className="spinner" style={{ width: 15, height: 15, margin: 1, color: 'var(--amber)' }} />;
    default:
      return <Circle size={17} color="var(--fg-4)" weight="light" />;
  }
}

export function StepList({ task }: { task: TaskSnapshot }) {
  const active = useRef<HTMLLIElement>(null);
  const running = task.steps.findIndex((s) => s.state === 'running');
  useEffect(() => {
    void active.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [running]);
  return (
    <ol className="steps">
      {task.steps.map((s) => (
        <li key={s.key} data-state={s.state} ref={s.state === 'running' ? active : undefined}>
          <StepIcon state={s.state} />
          <div className="grow">
            <div className="row">
              <span className="step-title truncate">{s.title}</span>
              {s.detail && s.state !== 'pending' && <span className="step-detail num truncate">{s.detail}</span>}
            </div>
            {s.state === 'running' && <Progress value={s.progress} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TaskLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <div className="task-log mono selectable" ref={ref}>
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function TaskCard({ task }: { task: TaskSnapshot }) {
  const [open, setOpen] = useState(false);
  const current = task.steps.find((s) => s.state === 'running');
  const running = task.state === 'running';

  const dismiss = () => {
    void call('tasks:dismiss', task.id);
    useStore.setState((s) => {
      const { [task.id]: _gone, ...rest } = s.tasks;
      return { tasks: rest };
    });
  };

  useEffect(() => {
    if (task.state !== 'done') return;
    const t = setTimeout(dismiss, 4200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.state]);

  return (
    <motion.div
      layout
      className="task"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: [0.22, 0.8, 0.28, 1] }}
    >
      <div className="row">
        {running ? (
          <span className="spinner" style={{ color: 'var(--amber)' }} />
        ) : task.state === 'done' ? (
          <CheckCircle size={17} weight="fill" color="var(--jade)" />
        ) : task.state === 'failed' ? (
          <WarningCircle size={17} weight="fill" color="var(--seal)" />
        ) : (
          <MinusCircle size={17} color="var(--fg-3)" />
        )}
        <span className="task-title truncate grow">{task.title}</span>
        <IconButton icon={open ? CaretDown : CaretUp} size="sm" label={open ? '收起' : '详情'} onClick={() => setOpen(!open)} />
        {!running && <IconButton icon={X} size="sm" label="关闭" onClick={dismiss} />}
      </div>
      {running && (
        <>
          <Progress value={taskProgress(task)} />
          <div className="task-sub num truncate">{current ? [current.title, current.detail].filter(Boolean).join('　') : '准备中'}</div>
        </>
      )}
      {task.state === 'failed' && <div className="task-error selectable">{task.error}</div>}
      {task.state === 'cancelled' && <div className="task-sub">已取消</div>}
      {open && (
        <div className="task-more">
          <StepList task={task} />
          {task.log.length > 0 && <TaskLog lines={task.log} />}
          {running && (
            <Button size="sm" variant="ghost" icon={X} onClick={() => void call('tasks:cancel', task.id)}>
              取消任务
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** 右下角的任务栏。一键配置有自己的整页进度，不在这里重复。 */
export function TaskDock() {
  const tasks = useStore((s) => s.tasks);
  const setupOpen = useStore((s) => s.setupOpen);
  const list = Object.values(tasks)
    .filter((t) => t.kind !== 'setup' || (!setupOpen && t.state !== 'done'))
    .filter((t) => t.state === 'running' || Date.now() - (t.endedAt ?? 0) < 10 * 60_000)
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-4);
  return (
    <div className="task-dock">
      <AnimatePresence>
        {list.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
