import { create } from 'zustand';
import type { LogLine, Prefs, TaskSnapshot, TavernStatus } from '@shared/types';
import { ApiError, call, on } from './api';

export type Page = 'home' | 'tavern' | 'phone' | 'models' | 'image' | 'voice' | 'extensions' | 'characters' | 'resources' | 'backups' | 'settings';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'bad';
  text: string;
  hint?: string;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface State {
  ready: boolean;
  page: Page;
  /** 跳转时带给目标页的参数，用完即清 */
  intent: string | null;
  prefs: Prefs | null;
  tavern: TavernStatus | null;
  tasks: Record<string, TaskSnapshot>;
  logs: LogLine[];
  toasts: Toast[];
  confirming: ConfirmRequest | null;
  setupOpen: boolean;
  go: (page: Page, intent?: string) => void;
  takeIntent: () => string | null;
  openSetup: (open: boolean) => void;
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  page: 'home',
  intent: null,
  prefs: null,
  tavern: null,
  tasks: {},
  logs: [],
  toasts: [],
  confirming: null,
  setupOpen: false,
  go: (page, intent) => set({ page, intent: intent ?? null }),
  takeIntent: () => {
    const value = get().intent;
    if (value) set({ intent: null });
    return value;
  },
  openSetup: (open) => set({ setupOpen: open }),
}));

let toastId = 0;

export function toast(text: string, kind: Toast['kind'] = 'info', hint?: string) {
  const id = ++toastId;
  useStore.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text, hint }] }));
  setTimeout(() => dismissToast(id), kind === 'bad' ? 7000 : 3200);
}

export const dismissToast = (id: number) => useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

export function toastError(error: unknown) {
  const e = error as ApiError;
  toast(e.message || '操作失败', 'bad', e.hint);
}

export function confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.setState({
      confirming: {
        ...request,
        resolve: (ok) => {
          useStore.setState({ confirming: null });
          resolve(ok);
        },
      },
    });
  });
}

/** 执行一个操作，失败时弹出提示。成功返回 true。 */
export async function attempt(fn: () => Promise<unknown>, okText?: string): Promise<boolean> {
  try {
    await fn();
    if (okText) toast(okText, 'ok');
    return true;
  } catch (error) {
    toastError(error);
    return false;
  }
}

export async function setPrefs(patch: Partial<Prefs>) {
  useStore.setState({ prefs: await call('app:setPrefs', patch) });
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const mode = useStore.getState().prefs?.theme ?? 'dark';
  const light = mode === 'light' || (mode === 'system' && !systemDark.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
}

export async function boot() {
  on('tavern:state', (tavern) => useStore.setState({ tavern }));
  on('tavern:log', (batch) => useStore.setState((s) => ({ logs: [...s.logs, ...batch].slice(-3000) })));
  on('tasks:update', (task) => useStore.setState((s) => ({ tasks: { ...s.tasks, [task.id]: task } })));
  on('prefs:changed', (prefs) => {
    useStore.setState({ prefs });
    applyTheme();
  });
  systemDark.addEventListener('change', applyTheme);

  const [prefs, tavern, tasks, logs] = await Promise.all([call('app:prefs'), call('tavern:status'), call('tasks:list'), call('tavern:logs')]);
  useStore.setState({
    prefs,
    tavern,
    logs,
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    setupOpen: !prefs.onboarded,
    ready: true,
  });
  applyTheme();
}

export async function toggleTavern() {
  const phase = useStore.getState().tavern?.phase;
  if (phase === 'running') {
    await attempt(() => call('tavern:stop'));
    return;
  }
  if (phase === 'absent') {
    useStore.getState().openSetup(true);
    return;
  }
  const ok = await attempt(() => call('tavern:start'));
  if (ok) await attempt(() => call('tavern:open'));
}
