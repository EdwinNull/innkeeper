import { ArrowLeft, ArrowRight, ArrowSquareOut, Check as CheckMark, CheckCircle, FolderOpen, Lightning, WarningCircle, X } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { EXTENSION_PACKS, extensionById } from '@shared/catalog/extensions';
import { IMAGE_BACKENDS, imageBackendById } from '@shared/catalog/imagegen';
import { PROVIDER_GROUPS, PROVIDERS, providerById, type Provider } from '@shared/catalog/providers';
import type { ProbeResult, SetupPlan } from '@shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { Logo } from '../components/Logo';
import { ReededGlass } from '../components/ReededGlass';
import { StepList, taskProgress, TaskLog } from '../components/TaskDock';
import { call } from '../lib/api';
import { bytes, classes } from '../lib/format';
import { useBusy, useLoad } from '../lib/hooks';
import { attempt, setPrefs, toastError, useStore } from '../lib/store';
import { Button, Check, Combo, Field, Note, Progress, SecretInput, TextInput } from '../ui';

type StepId = 'place' | 'model' | 'image' | 'extras' | 'review';

const STEPS: { id: StepId; title: string; lead: string }[] = [
  { id: 'place', title: '安家', lead: '酒馆装在哪里。' },
  { id: 'model', title: '模型', lead: '谁来说话。' },
  { id: 'image', title: '生图', lead: '要不要配图。' },
  { id: 'extras', title: '插件与角色', lead: '开业备货。' },
  { id: 'review', title: '开工', lead: '核对一遍，一键装好。' },
];

interface Draft {
  mode: 'managed' | 'adopted';
  workspace: string;
  adoptedRoot: string | null;
  adoptedInfo: string;
  userName: string;
  providerId: string | null;
  apiKey: string;
  baseUrl: string;
  model: string;
  imageId: string | null;
  imageKey: string;
  imageUrl: string;
  extensions: string[];
  starters: string[];
}

export function Setup() {
  const prefs = useStore((s) => s.prefs)!;
  const tasks = useStore((s) => s.tasks);
  const openSetup = useStore((s) => s.openSetup);
  const [at, setAt] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    mode: prefs.tavernMode,
    workspace: prefs.workspace,
    adoptedRoot: prefs.adoptedRoot,
    adoptedInfo: '',
    userName: '',
    providerId: null,
    apiKey: '',
    baseUrl: '',
    model: '',
    imageId: null,
    imageKey: '',
    imageUrl: '',
    extensions: [...EXTENSION_PACKS[0]!.items],
    starters: ['flux'],
  });
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const task = taskId ? tasks[taskId] : undefined;
  const step = STEPS[at]!;
  const last = at === STEPS.length - 1;
  const provider = draft.providerId ? providerById(draft.providerId) : undefined;
  const image = draft.imageId ? imageBackendById(draft.imageId) : undefined;

  const problem = useMemo((): string | null => {
    if (step.id === 'place') {
      if (draft.mode === 'adopted' && !draft.adoptedRoot) return '请选择已有酒馆的目录';
      if (draft.mode === 'managed' && !draft.workspace.trim()) return '请选择安装位置';
    }
    if (step.id === 'model' && provider) {
      if (provider.needsKey && !draft.apiKey) return '填上密钥，或先跳过';
      if (!draft.model.trim()) return '请选择模型';
      if (provider.source === 'custom' && !draft.baseUrl.trim()) return '请填写接口地址';
    }
    if (step.id === 'image' && image?.secretKey && image.id !== 'horde' && !draft.imageKey) return '填上密钥，或先跳过';
    return null;
  }, [step.id, draft, provider, image]);

  const start = async () => {
    const plan: SetupPlan = {
      workspace: draft.workspace,
      mode: draft.mode,
      adoptedRoot: draft.adoptedRoot,
      version: null,
      userName: draft.userName,
      connection: provider
        ? { providerId: provider.id, label: provider.name, model: draft.model, baseUrl: draft.baseUrl || provider.baseUrl, apiKey: draft.apiKey, activate: true }
        : null,
      imagegen: image ? { backendId: image.id, apiKey: draft.imageKey, url: draft.imageUrl, model: '' } : null,
      extensions: draft.extensions,
      starters: draft.starters,
      launch: true,
    };
    try {
      setTaskId(await call('setup:run', plan));
    } catch (e) {
      toastError(e);
    }
  };

  const leave = async () => {
    if (!prefs.onboarded) await attempt(() => setPrefs({ onboarded: true }));
    openSetup(false);
  };

  const running = task?.state === 'running';
  return (
    <motion.div className="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
      <div className="setup-drag drag" />
      <aside className="setup-side">
        <ReededGlass lit={task?.state === 'done' || running || at > 0} flute={28} unit={430} shade={0.25} className="setup-glass" />
        <div className="setup-side-body">
          <div className="setup-brand">
            <Logo size={30} />
            <span>掌柜</span>
          </div>
          <ol className="setup-steps">
            {STEPS.map((s, i) => (
              <li key={s.id} data-state={task ? 'done' : i < at ? 'done' : i === at ? 'current' : 'todo'}>
                <button type="button" disabled={Boolean(task) || i > at} onClick={() => setAt(i)}>
                  <span className="serif">{s.title}</span>
                  <small>{s.lead}</small>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      <section className="setup-main">
        {!running && (
          <button type="button" className="setup-skip no-drag" onClick={() => void leave()}>
            {prefs.onboarded ? '关闭' : '先逛逛'} <X size={13} />
          </button>
        )}
        {task ? (
          <Running taskId={taskId!} onRetry={() => setTaskId(null)} onLeave={() => void leave()} />
        ) : (
          <>
            <div className="setup-scroll">
              <AnimatePresence mode="wait">
                <motion.div key={step.id} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2, ease: [0.22, 0.8, 0.28, 1] }}>
                  {step.id === 'place' && <Place draft={draft} patch={patch} />}
                  {step.id === 'model' && <ModelStep draft={draft} patch={patch} />}
                  {step.id === 'image' && <ImageStep draft={draft} patch={patch} />}
                  {step.id === 'extras' && <Extras draft={draft} patch={patch} />}
                  {step.id === 'review' && <Review draft={draft} goto={setAt} />}
                </motion.div>
              </AnimatePresence>
            </div>
            <footer className="setup-foot">
              {at > 0 && (
                <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={() => setAt(at - 1)}>
                  上一步
                </Button>
              )}
              <span className="grow dim" style={{ textAlign: 'right' }}>
                {problem}
              </span>
              {(step.id === 'model' || step.id === 'image') && (step.id === 'model' ? draft.providerId : draft.imageId) && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => {
                    patch(step.id === 'model' ? { providerId: null, apiKey: '', model: '' } : { imageId: null, imageKey: '' });
                    setAt(at + 1);
                  }}
                >
                  跳过
                </Button>
              )}
              <Button size="lg" variant="primary" disabled={problem !== null} onClick={() => (last ? void start() : setAt(at + 1))}>
                {last ? '开始安装' : (step.id === 'model' && !draft.providerId) || (step.id === 'image' && !draft.imageId) ? '以后再说' : '下一步'}
                <ArrowRight size={16} weight="bold" />
              </Button>
            </footer>
          </>
        )}
      </section>
    </motion.div>
  );
}

interface StepProps {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}

function Place({ draft, patch }: StepProps) {
  const { data: info } = useLoad(() => call('app:info'));
  const drive = info?.drives.find((d) => draft.workspace.toLowerCase().startsWith(d.root.toLowerCase()));

  const chooseWorkspace = async () => {
    const dir = await call('app:pickDirectory', { title: '选择安装位置', defaultPath: draft.workspace });
    if (dir) patch({ workspace: dir });
  };
  const chooseTavern = async () => {
    const dir = await call('app:pickDirectory', { title: '选择已有的 SillyTavern 目录' });
    if (!dir) return;
    const result = await call('setup:inspect', dir);
    patch(result.ok ? { adoptedRoot: dir, adoptedInfo: result.message } : { adoptedRoot: null, adoptedInfo: result.message });
  };

  return (
    <>
      <h1 className="setup-title">酒馆要开在哪儿</h1>
      <p className="setup-lead">全部文件都放在一个文件夹里，不写注册表，不动系统里的 Node。哪天不要了，删掉文件夹就干净了。</p>
      <div className="choice-list">
        <button type="button" className="choice" aria-pressed={draft.mode === 'managed'} onClick={() => patch({ mode: 'managed' })}>
          <span className="choice-dot" />
          <div className="grow">
            <div className="choice-title">全新安装</div>
            <div className="dim">掌柜下载酒馆和运行环境，以后升级、回退都在这里点一下。</div>
          </div>
        </button>
        <button type="button" className="choice" aria-pressed={draft.mode === 'adopted'} onClick={() => patch({ mode: 'adopted' })}>
          <span className="choice-dot" />
          <div className="grow">
            <div className="choice-title">我已经有酒馆</div>
            <div className="dim">直接接管原来的目录，角色、聊天和设置一个不动。</div>
          </div>
        </button>
      </div>
      <div className="fields" style={{ marginTop: 26 }}>
        {draft.mode === 'adopted' && (
          <Field label="酒馆目录" help={draft.adoptedInfo || '选择包含 server.js 的那一层。'}>
            <div className="row">
              <TextInput mono readOnly aria-label="酒馆目录" value={draft.adoptedRoot ?? ''} placeholder="还没有选择" />
              <Button icon={FolderOpen} onClick={() => void chooseTavern()}>
                选择
              </Button>
            </div>
          </Field>
        )}
        <Field
          label={draft.mode === 'managed' ? '安装位置' : '掌柜的工作目录'}
          aside={drive && <span className="num">{drive.root} 剩余 {bytes(drive.freeBytes)}</span>}
          help={draft.mode === 'managed' ? '本体约 600 MB。要在本机生图的话，再给模型留几 GB。' : '用来放备份、运行时和本地生图模型。'}
        >
          <div className="row">
            <TextInput mono aria-label="安装位置" value={draft.workspace} onChange={(e) => patch({ workspace: e.target.value })} />
            <Button icon={FolderOpen} onClick={() => void chooseWorkspace()}>
              更改
            </Button>
          </div>
        </Field>
        <Field label="怎么称呼你" help="角色会这样叫你，之后随时能改。">
          <TextInput aria-label="怎么称呼你" placeholder="旅人" value={draft.userName} onChange={(e) => patch({ userName: e.target.value })} style={{ maxWidth: 260 }} />
        </Field>
      </div>
    </>
  );
}

function ModelStep({ draft, patch }: StepProps) {
  const provider = draft.providerId ? providerById(draft.providerId) : undefined;
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [busy, run] = useBusy();

  const choose = (p: Provider) => {
    setProbe(null);
    patch({ providerId: p.id, apiKey: '', baseUrl: p.baseUrl, model: p.models[0] ?? '' });
  };
  const test = () =>
    run(() =>
      attempt(async () => {
        const result = await call('models:probe', { providerId: provider!.id, baseUrl: draft.baseUrl, apiKey: draft.apiKey });
        setProbe(result);
        if (result.ok && result.models.length && !result.models.some((m) => m.id === draft.model)) {
          patch({ model: provider!.models.find((h) => result.models.some((m) => m.id === h)) ?? result.models[0]!.id });
        }
      }),
    );

  if (provider) {
    const options = probe?.models.length ? probe.models.map((m) => ({ value: m.id })) : provider.models.map((value) => ({ value }));
    return (
      <>
        <button type="button" className="linkish" style={{ marginBottom: 18 }} onClick={() => patch({ providerId: null })}>
          <ArrowLeft size={13} /> 换一家
        </button>
        <div className="row" style={{ gap: 14, marginBottom: 24 }}>
          <span className="conn-logo">
            <BrandIcon name={provider.logo} size={28} />
          </span>
          <div>
            <h1 className="setup-title" style={{ margin: 0 }}>
              {provider.name}
            </h1>
            <p className="muted">{provider.blurb}</p>
          </div>
        </div>
        <div className="fields">
          {!provider.direct && <Note>这家在大陆通常连不上。装好后记得到「酒馆本体 → 服务器配置」里设置代理。</Note>}
          {(provider.editableUrl || provider.group === 'custom') && (
            <Field label="接口地址">
              <TextInput mono aria-label="接口地址" placeholder="https://example.com/v1" value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} />
            </Field>
          )}
          {provider.group !== 'local' && (
            <Field
              label={provider.needsKey ? '密钥' : '密钥（可不填）'}
              aside={
                provider.keyUrl && (
                  <button type="button" className="linkish" onClick={() => void call('app:openExternal', provider.keyUrl)}>
                    去申请 <ArrowSquareOut size={13} />
                  </button>
                )
              }
              help="只写进本机酒馆的 secrets.json。"
            >
              <SecretInput label="密钥" value={draft.apiKey} onChange={(apiKey) => patch({ apiKey })} onEnter={() => void test()} placeholder={provider.keyHint ? `${provider.keyHint}…` : '粘贴密钥'} />
            </Field>
          )}
          <Field label="模型">
            <div className="row">
              <div className="grow">
                <Combo label="模型" value={draft.model} onChange={(model) => patch({ model })} options={options} placeholder="模型名称" loading={busy} />
              </div>
              <Button icon={Lightning} busy={busy} onClick={() => void test()}>
                测试并读取列表
              </Button>
            </div>
          </Field>
          {probe && <Note kind={probe.ok ? 'good' : 'bad'}>{probe.ok ? `${probe.message}，用时 ${probe.latencyMs} ms` : probe.message}</Note>}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="setup-title">接哪家的模型</h1>
      <p className="setup-lead">选一家先用着，之后可以再加，随时切换。没有头绪的话，从 DeepSeek 开始。</p>
      {PROVIDER_GROUPS.map((g) => (
        <section key={g.id} style={{ marginBottom: 24 }}>
          <div className="providers-head">
            <h3>{g.title}</h3>
            <span>{g.note}</span>
          </div>
          <div className="providers-grid tight">
            {PROVIDERS.filter((p) => p.group === g.id).map((p) => (
              <button key={p.id} type="button" className="provider slim" onClick={() => choose(p)}>
                <BrandIcon name={p.logo} size={18} />
                <span className="provider-name truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function ImageStep({ draft, patch }: StepProps) {
  const picks = ['engine', 'pollinations', 'novel', 'comfy', 'auto', 'horde'].map((id) => IMAGE_BACKENDS.find((b) => b.id === id)!);
  const backend = draft.imageId ? imageBackendById(draft.imageId) : undefined;
  return (
    <>
      <h1 className="setup-title">要不要给聊天配图</h1>
      <p className="setup-lead">可选。这里先定后端，模型下载和细节参数装好后在「生图」页里调。</p>
      <div className="choice-list">
        {picks.map((b) => (
          <button key={b.id} type="button" className="choice" aria-pressed={draft.imageId === b.id} onClick={() => patch({ imageId: draft.imageId === b.id ? null : b.id, imageKey: '', imageUrl: b.defaultUrl ?? '' })}>
            <span className="choice-dot" />
            <BrandIcon name={b.logo} size={20} />
            <div className="grow">
              <div className="choice-title">{b.name}</div>
              <div className="dim">{b.headline}</div>
            </div>
            <span className="tag">{b.kind === 'local' ? '本机' : '云端'}</span>
            <span className="dim" style={{ width: 72, textAlign: 'right' }}>
              {b.price}
            </span>
          </button>
        ))}
      </div>
      {backend?.secretKey && backend.id !== 'horde' && (
        <div style={{ marginTop: 22 }}>
          <Field
            label={`${backend.name} 密钥`}
            aside={
              <button type="button" className="linkish" onClick={() => void call('app:openExternal', backend.keyUrl!)}>
                去申请 <ArrowSquareOut size={13} />
              </button>
            }
          >
            <SecretInput label="生图密钥" value={draft.imageKey} onChange={(imageKey) => patch({ imageKey })} placeholder="粘贴密钥" />
          </Field>
        </div>
      )}
      {(backend?.id === 'comfy' || backend?.id === 'auto') && (
        <div style={{ marginTop: 22 }}>
          <Field label="地址">
            <TextInput mono aria-label="地址" value={draft.imageUrl} onChange={(e) => patch({ imageUrl: e.target.value })} />
          </Field>
        </div>
      )}
    </>
  );
}

function Extras({ draft, patch }: StepProps) {
  const { data: starters } = useLoad(() => call('chars:starters'));
  const pool = useMemo(() => [...new Set(EXTENSION_PACKS.flatMap((p) => p.items))].map((id) => extensionById(id)!), []);
  const toggle = (id: string) => patch({ extensions: draft.extensions.includes(id) ? draft.extensions.filter((x) => x !== id) : [...draft.extensions, id] });
  const toggleCard = (id: string) => patch({ starters: draft.starters.includes(id) ? draft.starters.filter((x) => x !== id) : [...draft.starters, id] });
  return (
    <>
      <h1 className="setup-title">开业备点什么货</h1>
      <p className="setup-lead">选一套现成的，也可以逐个勾。装好后还能在「插件」页里增减。</p>
      <div className="row wrap" style={{ marginBottom: 18 }}>
        {EXTENSION_PACKS.map((p) => {
          const on = p.items.length === draft.extensions.length && p.items.every((i) => draft.extensions.includes(i));
          return (
            <button key={p.id} type="button" className="pill" aria-pressed={on} title={p.note} onClick={() => patch({ extensions: [...p.items] })}>
              {p.name}
            </button>
          );
        })}
        <button type="button" className="pill" aria-pressed={draft.extensions.length === 0} onClick={() => patch({ extensions: [] })}>
          不装插件
        </button>
      </div>
      <div className="check-grid">
        {pool.map((e) => (
          <label key={e.id} className={classes('check-row', draft.extensions.includes(e.id) && 'on')}>
            <Check label={e.name} checked={draft.extensions.includes(e.id)} onChange={() => toggle(e.id)} />
            <div className="grow">
              <div style={{ fontWeight: 520 }}>{e.name}</div>
              <div className="dim truncate">{e.summary}</div>
            </div>
          </label>
        ))}
      </div>
      <h2 className="block-title" style={{ margin: '28px 0 12px' }}>
        示例角色
      </h2>
      <div className="check-grid">
        {starters?.map((s) => (
          <label key={s.id} className={classes('check-row', draft.starters.includes(s.id) && 'on')}>
            <Check label={s.name} checked={draft.starters.includes(s.id)} onChange={() => toggleCard(s.id)} />
            <div className="grow">
              <div style={{ fontWeight: 520 }}>{s.name}</div>
              <div className="dim truncate">{s.description}</div>
            </div>
          </label>
        ))}
      </div>
    </>
  );
}

function Review({ draft, goto }: { draft: Draft; goto: (i: number) => void }) {
  const provider = draft.providerId ? providerById(draft.providerId) : undefined;
  const image = draft.imageId ? imageBackendById(draft.imageId) : undefined;
  const installed = useStore((s) => s.prefs?.activeVersion && s.prefs.workspace === draft.workspace);
  const rows: { step: number; label: string; value: React.ReactNode; note?: string }[] = [
    {
      step: 0,
      label: '本体',
      value: draft.mode === 'adopted' ? '接管已有酒馆' : installed ? '保持或更新到最新版' : '全新安装最新版',
      note: draft.mode === 'managed' ? draft.workspace : (draft.adoptedRoot ?? ''),
    },
    { step: 1, label: '模型', value: provider ? provider.name : '暂不接入', note: provider ? draft.model : '装好后在「模型接入」里添加' },
    { step: 2, label: '生图', value: image ? image.name : '暂不配置', note: image?.headline },
    {
      step: 3,
      label: '插件',
      value: draft.extensions.length ? `${draft.extensions.length} 个` : '不装',
      note: draft.extensions.map((id) => extensionById(id)?.name).join('、'),
    },
    { step: 3, label: '角色', value: draft.starters.length ? `${draft.starters.length} 张示例卡` : '自己导入' },
  ];
  return (
    <>
      <h1 className="setup-title">核对一遍</h1>
      <p className="setup-lead">确认后全程自动，装好会直接把酒馆打开。中途可以最小化，不影响进度。</p>
      <div className="review">
        {rows.map((r, i) => (
          <button key={i} type="button" className="review-row" onClick={() => goto(r.step)}>
            <span className="review-label">{r.label}</span>
            <span className="grow">
              <span className="review-value">{r.value}</span>
              {r.note && <span className="review-note truncate">{r.note}</span>}
            </span>
            <span className="linkish">修改</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Running({ taskId, onRetry, onLeave }: { taskId: string; onRetry: () => void; onLeave: () => void }) {
  const task = useStore((s) => s.tasks[taskId]);
  const [showLog, setShowLog] = useState(false);
  const tavern = useStore((s) => s.tavern);
  useEffect(() => {
    if (task?.state === 'failed') setShowLog(true);
  }, [task?.state]);
  if (!task) return null;
  const total = taskProgress(task) ?? 0;
  const failedSoft = task.state === 'done' ? task.steps.filter((s) => s.state === 'failed') : [];
  const titles = { running: '正在布置酒馆', queued: '准备中', done: '可以开门迎客了', failed: '卡在了半路', cancelled: '已取消' } as const;

  return (
    <div className="setup-run">
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="grow">
          <h1 className="setup-title" style={{ margin: 0 }}>
            {titles[task.state]}
          </h1>
        </div>
        {task.state === 'running' && <span className="setup-percent serif num">{Math.round(total * 100)}</span>}
        {task.state === 'done' && <CheckCircle size={34} weight="fill" color="var(--jade)" />}
        {task.state === 'failed' && <WarningCircle size={34} weight="fill" color="var(--seal)" />}
      </div>
      <Progress value={task.state === 'done' ? 1 : total} />
      {task.state === 'failed' && (
        <div style={{ marginTop: 16 }}>
          <Note kind="bad">
            <span className="selectable">{task.error}</span>
          </Note>
        </div>
      )}
      {failedSoft.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Note kind="warn">{failedSoft.map((s) => s.title).join('、')} 没有完成，酒馆可以正常用，稍后在对应页面重试即可。</Note>
        </div>
      )}
      <div className="setup-run-body">
        <StepList task={task} />
      </div>
      {showLog && task.log.length > 0 && <TaskLog lines={task.log} />}
      <footer className="setup-foot inline">
        {task.log.length > 0 && (
          <Button variant="ghost" onClick={() => setShowLog(!showLog)}>
            {showLog ? '收起日志' : '查看日志'}
          </Button>
        )}
        <span className="grow" />
        {task.state === 'running' && (
          <Button variant="ghost" onClick={() => void call('tasks:cancel', taskId)}>
            取消
          </Button>
        )}
        {(task.state === 'failed' || task.state === 'cancelled') && (
          <Button variant="primary" size="lg" onClick={onRetry}>
            返回修改后重试
          </Button>
        )}
        {task.state === 'done' && (
          <>
            {tavern?.phase === 'running' && (
              <Button size="lg" onClick={() => void attempt(() => call('tavern:open'))}>
                进入酒馆
              </Button>
            )}
            <Button variant="primary" size="lg" icon={CheckMark} onClick={onLeave}>
              完成
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}
