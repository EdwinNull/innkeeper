import {
  ArrowClockwise, ArrowSquareOut, DownloadSimple, FileArrowUp, FilmStrip, FloppyDisk, FolderOpen, Lightning, PaintBrush, Play, Plus, Stop, Trash, WarningCircle,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  derivedParts, ENGINE_MODELS, HIRES_BACKENDS, HIRES_SCALES, HIRES_STRENGTHS, hiresBase, IMAGE_BACKENDS, imageBackendById, imageBackendBySource, kitKey, modelBytes, POLISH_BACKENDS, polishPlan, ratingOf, RATINGS,
  sameStyle, SIZE_PRESETS, STYLE_PRESETS, withRating,
  type ImageBackend, type Rating,
} from '@shared/catalog/imagegen';
import { VIDEO_MODELS, videoBytes, videoSize, videoWorkflowFile, type VideoMode, type VideoOptions } from '@shared/catalog/video';
import { NSFW_SCENES, nsfwTemplatesOn, pickScene } from '@shared/catalog/nsfw-scenes';
import { LOCAL_ENGINE_ID } from '@shared/catalog/providers';
import { MOTION_FALLBACK, WRITER_IDLE_SECONDS, writerReadiness, type PromptStyleChoice, type PromptWriter } from '@shared/catalog/scene';
import type { ComfyStatus, EngineStatus, HiresPrefs, ImagegenProbe, ImagegenRoute, ImagegenTestResult, ImagegenView, PolishPrefs, ScenePrefs, ToolStatus } from '@shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { call } from '../lib/api';
import { bytes, classes } from '../lib/format';
import { useBusy, useDataChanged, useEvent, useLoad } from '../lib/hooks';
import { isMac } from '../lib/platform';
import { attempt, confirm, setPrefs, toast, useStore } from '../lib/store';
import { Button, Combo, Dialog, Empty, Field, IconButton, Menu, NumberInput, Note, PageHead, SecretInput, Select, SettingRow, Slider, Switch, TextInput } from '../ui';
import { reportImport } from './Characters';

const SAMPLE_PROMPT = '1girl, silver hair, tavern interior, warm lantern light, looking at viewer, upper body';

export function ImagePage() {
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const { data: view, set, reload } = useLoad(() => call('img:view'), [instance?.userDir]);
  const [probe, setProbe] = useState<ImagegenProbe | null>(null);
  const [probing, setProbing] = useState(false);
  useDataChanged(['settings', 'resources'], reload);

  const backend = view?.source ? imageBackendBySource(view.source) : undefined;

  const runProbe = useCallback(async (id: string) => {
    setProbing(true);
    try {
      const result = await call('img:probe', id);
      setProbe(result);
      // ComfyUI 的底模会写进工作流，空着或失效时先选第一个
      if (id === 'comfy' && result.ok && result.models.length) {
        const current = await call('img:view');
        if (!result.models.includes(current.model)) set(await call('img:set', { model: result.models[0]! }));
      }
    } catch {
      setProbe(null);
    }
    setProbing(false);
  }, [set]);

  useEffect(() => {
    setProbe(null);
    if (backend) void runProbe(backend.id);
  }, [backend?.id, runProbe]);

  const patch = async (p: Partial<ImagegenView>) => {
    if (view) set({ ...view, ...p });
    try {
      set(await call('img:set', p));
    } catch (e) {
      toast((e as Error).message, 'bad');
      await reload();
    }
  };

  const select = async (b: ImageBackend) => {
    if (b.source === view?.source) return;
    await attempt(async () => {
      const prefs = useStore.getState().prefs!;
      set(await call('img:select', b.id, b.id === 'engine' ? { sdcppUrl: `http://127.0.0.1:${prefs.imagegen.enginePort}` } : {}));
    });
  };

  if (!instance) {
    return (
      <>
        <PageHead title="生图">让聊天有画面。</PageHead>
        <Empty icon={PaintBrush} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          生图设置会写进酒馆自带的图像生成扩展。
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead title="生图">选一个后端，试画满意后，酒馆里就能直接用。</PageHead>
      <div className="studio">
        <div className="studio-left">
          <BackendList current={backend?.id} onPick={(b) => void select(b)} hasKey={view?.hasKey ?? {}} />
          {view && backend && (
            <>
              <BackendPanel backend={backend} view={view} probe={probe} probing={probing} patch={patch} reprobe={() => runProbe(backend.id)} reload={reload} />
              <Params backend={backend} view={view} probe={probe} patch={patch} />
              <ChatScene view={view} />
              <Polish view={view} reload={reload} />
            </>
          )}
        </div>
        <div className="studio-right">
          <Easel view={view} backend={backend} />
        </div>
      </div>
    </>
  );
}

function BackendList({ current, onPick, hasKey }: { current?: string; onPick: (b: ImageBackend) => void; hasKey: Record<string, boolean> }) {
  const [all, setAll] = useState(false);
  const featured = ['engine', 'comfy', 'auto', 'novel', 'pollinations', 'horde'];
  const list = IMAGE_BACKENDS.filter((b) => all || featured.includes(b.id) || b.id === current || hasKey[b.id]);
  return (
    <section>
      <div className="backends">
        {list.map((b) => (
          <button key={b.id} type="button" className="backend" aria-pressed={b.id === current} onClick={() => onPick(b)}>
            <BrandIcon name={b.logo} size={20} />
            <div className="grow">
              <div className="row" style={{ gap: 6 }}>
                <span className="backend-name truncate">{b.name}</span>
                {hasKey[b.id] && <span className="lamp ok" title="已有密钥" />}
              </div>
              <div className="backend-note truncate">{b.headline}</div>
            </div>
            <span className="backend-price">{b.price}</span>
          </button>
        ))}
      </div>
      {!all && (
        <button type="button" className="linkish" style={{ marginTop: 10 }} onClick={() => setAll(true)}>
          显示全部 {IMAGE_BACKENDS.length} 个后端
        </button>
      )}
    </section>
  );
}

interface PanelProps {
  backend: ImageBackend;
  view: ImagegenView;
  probe: ImagegenProbe | null;
  probing: boolean;
  patch: (p: Partial<ImagegenView>) => Promise<void>;
  reprobe: () => Promise<void>;
  reload: () => Promise<void>;
}

function BackendPanel(props: PanelProps) {
  const { backend, probe, probing, reprobe } = props;
  return (
    <section className="studio-block">
      <div className="row" style={{ marginBottom: 4 }}>
        <h2 className="block-title grow">{backend.name}</h2>
        {probing ? (
          <span className="row dim">
            <span className="spinner" /> 检测中
          </span>
        ) : (
          probe && (
            <span className="row" style={{ gap: 7 }}>
              <span className={classes('lamp', probe.ok ? 'ok' : probe.offline ? '' : 'bad')} />
              <span className={probe.ok || probe.offline ? 'muted' : ''} style={probe.ok || probe.offline ? undefined : { color: 'var(--seal)' }}>
                {probe.message}
              </span>
            </span>
          )
        )}
        <IconButton icon={Lightning} size="sm" label="重新检测" disabled={probing} onClick={() => void reprobe()} />
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {backend.detail}
      </p>
      {backend.id === 'engine' ? <EnginePanel {...props} /> : backend.id === 'comfy' ? <ComfyPanel {...props} /> : backend.id === 'auto' ? <UrlPanel {...props} /> : <KeyPanel {...props} />}
    </section>
  );
}

function KeyPanel({ backend, view, reprobe, reload }: PanelProps) {
  const [key, setKey] = useState('');
  const [busy, run] = useBusy();
  const has = view.hasKey[backend.id];
  const save = () =>
    run(async () => {
      const ok = await attempt(() => call('img:saveKey', backend.id, key), '密钥已保存');
      if (!ok) return;
      setKey('');
      await reload();
      await reprobe();
    });
  return (
    <div className="fields">
      <Field
        label="密钥"
        aside={
          backend.keyUrl && (
            <button type="button" className="linkish" onClick={() => void call('app:openExternal', backend.keyUrl!)}>
              去申请 <ArrowSquareOut size={13} />
            </button>
          )
        }
      >
        <div className="row">
          <div className="grow">
            <SecretInput label="密钥" value={key} onChange={setKey} onEnter={() => key && void save()} placeholder={has ? '已保存，粘贴新密钥可替换' : '粘贴密钥'} />
          </div>
          <Button busy={busy} disabled={!key} onClick={() => void save()}>
            保存
          </Button>
        </div>
      </Field>
      {!backend.direct && <p className="dim">海外服务，大陆网络通常需要代理。</p>}
    </div>
  );
}

function UrlPanel({ view, patch, reprobe }: PanelProps) {
  const [url, setUrl] = useState(view.autoUrl);
  useEffect(() => setUrl(view.autoUrl), [view.autoUrl]);
  const commit = async () => {
    if (url !== view.autoUrl) await patch({ autoUrl: url });
    await reprobe();
  };
  return (
    <Field label="地址" help="秋叶启动器：高级选项里勾选「启用 API」。Forge 与原版：启动参数加 --api。">
      <div className="row">
        <TextInput mono aria-label="地址" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void commit()} />
        <Button onClick={() => void commit()}>连接</Button>
      </div>
    </Field>
  );
}

function EnginePanel({ reprobe, reload: reloadView }: PanelProps) {
  const { data: engine, set, reload } = useLoad(() => call('img:engine'));
  const { data: tools } = useLoad<ToolStatus>(() => call('app:tools'));
  const tasks = useStore((s) => s.tasks);
  const prefs = useStore((s) => s.prefs)!;
  const [pick, setPick] = useState(false);
  const [busy, run] = useBusy();
  useEvent('engine:state', (s: EngineStatus) => {
    set(s);
    if (s.running) void reprobe();
  });
  const installing = Object.values(tasks).some((t) => t.kind === 'engine-install' && t.state === 'running');
  const downloading = new Set(Object.values(tasks).filter((t) => t.kind === 'engine-model' && t.state === 'running').map((t) => t.title));
  if (!engine) return null;
  const current = prefs.imagegen.engineModel && engine.models.some((m) => m.file === prefs.imagegen.engineModel) ? prefs.imagegen.engineModel : engine.models[0]?.file;
  const vram = tools?.gpu?.vramBytes ? tools.gpu.vramBytes / 1024 ** 3 : null;
  const stale = engine.running && Boolean(current) && engine.activeModel !== current;
  const short = (file: string | null | undefined) => engine.models.find((m) => m.file === file)?.label ?? file?.replace(/\.[^.]+$/, '') ?? '';
  const offered = ENGINE_MODELS.filter((m) => !m.adult || prefs.adult);

  const start = () =>
    run(() =>
      attempt(async () => {
        set(await call('img:engineStart', current!));
        await reprobe();
      }, '引擎已启动'),
    );

  const importModel = async () => {
    const [file] = await call('app:pickFiles', { title: '选择模型', filters: [{ name: '模型', extensions: ['safetensors', 'ckpt', 'gguf'] }] });
    if (file) await attempt(() => call('img:engineImportModel', file), '模型已加入');
    await reload();
  };

  return (
    <>
      <ol className="ladder">
        <li data-done={engine.installed || undefined}>
          <div className="grow">
            <div className="ladder-title">引擎</div>
            <div className="dim">
              {engine.installed
                ? `${engine.backend ?? ''} 版，${engine.version ?? ''}`
                : isMac
                  ? '约 40 MB，将安装 Metal 版，要 macOS 26 以上'
                  : tools?.gpu
                    ? `检测到 ${tools.gpu.name}，将安装 Vulkan 版`
                    : '未检测到独立显卡，将安装 CPU 版，出图很慢'}
            </div>
          </div>
          <Button size="sm" variant={engine.installed ? 'ghost' : 'primary'} icon={DownloadSimple} busy={installing} onClick={() => void attempt(() => call('img:engineInstall'))}>
            {engine.installed ? '更新' : '安装'}
          </Button>
        </li>
        <li data-done={engine.models.length > 0 || undefined}>
          <div className="grow">
            <div className="ladder-title">模型</div>
            {engine.models.length ? (
              <div style={{ maxWidth: 360, marginTop: 6 }}>
                <Select
                  label="模型"
                  value={current ?? ''}
                  onChange={(v) =>
                    void attempt(async () => {
                      await call('img:engineUse', v);
                      await reloadView();
                    })
                  }
                  options={engine.models.map((m) => ({ value: m.file, label: m.label, note: `${m.family ? `${m.family}，` : ''}${bytes(m.sizeBytes)}` }))}
                />
              </div>
            ) : (
              <div className="dim">下载一个，或导入你已有的 safetensors</div>
            )}
          </div>
          <Menu
            items={[
              { label: '下载推荐模型', icon: DownloadSimple, onSelect: () => setPick(true) },
              { label: '导入本地文件', icon: FileArrowUp, onSelect: () => void importModel() },
              {
                label: '删除当前模型',
                icon: Trash,
                danger: true,
                disabled: !current || engine.running,
                onSelect: async () => {
                  const ok = await confirm({ title: '删除模型文件', body: `${short(current)} 会移到回收站。`, confirm: '删除', danger: true });
                  if (ok) await attempt(() => call('img:engineRemoveModel', current!));
                  await reload();
                },
              },
            ]}
          >
            <Button size="sm" variant={engine.models.length ? 'ghost' : 'secondary'} icon={Plus}>
              添加
            </Button>
          </Menu>
        </li>
        <li data-done={engine.running || undefined}>
          <div className="grow">
            <div className="ladder-title">{engine.running ? '运行中' : engine.starting ? '正在启动' : '启动'}</div>
            <div className="dim num">
              {stale
                ? `正在用 ${short(engine.activeModel)}，重启后换成 ${short(current)}`
                : engine.running
                  ? `端口 ${engine.port}，只监听本机。第一张要先载入模型，会慢一些`
                  : (engine.lastError ?? '启动只要一两秒，画第一张时才载入模型')}
            </div>
          </div>
          {stale && (
            <Button size="sm" variant="primary" icon={ArrowClockwise} busy={busy} onClick={() => void start()}>
              重启
            </Button>
          )}
          {engine.running ? (
            <Button size="sm" icon={Stop} onClick={() => void attempt(async () => set(await call('img:engineStop')))}>
              停止
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Play} busy={busy || engine.starting} disabled={!engine.installed || !current} onClick={() => void start()}>
              启动
            </Button>
          )}
        </li>
      </ol>
      <div className="ladder-foot">
        <SettingRow title="酒馆开门时一起启动" note="闲着不占显存，酒馆打烊时一起停。">
          <Switch label="酒馆开门时一起启动引擎" checked={prefs.imagegen.engineAutoStart} onChange={(v) => void setPrefs({ imagegen: { ...prefs.imagegen, engineAutoStart: v } })} />
        </SettingRow>
      </div>
      <Dialog open={pick} onClose={() => setPick(false)} title="下载模型" description={vram ? `${tools!.gpu!.name}，${vram.toFixed(0)} GB 显存` : '自动挑最快的线路，支持断点续传。'} wide>
        <div className="table" style={{ marginBottom: 20 }}>
          {offered.map((m) => {
            const have = engine.models.some((x) => x.file === (m.single?.file ?? kitKey(m)));
            const tight = vram !== null && vram < m.minVramGb - 0.5;
            return (
              <div key={m.id} className="table-row tall">
                <div className="grow">
                  <div className="row">
                    <span style={{ fontWeight: 540 }}>{m.name}</span>
                    <span className="tag">{m.family}</span>
                    {m.adult && <span className="tag">成人</span>}
                    {tight && <span className="tag gold">显存偏小</span>}
                  </div>
                  <div className="dim">
                    {m.note}。{m.license}
                  </div>
                </div>
                <span className="dim num">{bytes(modelBytes(m))}</span>
                {have ? (
                  <span className="tag jade">已下载</span>
                ) : (
                  <Button size="sm" busy={downloading.has(`下载 ${m.name}`)} onClick={() => void attempt(() => call('img:engineModelDownload', m.id), '已加入下载')}>
                    下载
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}

function ComfyPanel({ view, patch, reprobe }: PanelProps) {
  const { data: comfy, set, reload } = useLoad(() => call('img:comfy'), [view.comfyUrl]);
  const { data: workflows, reload: reloadFlows } = useLoad(() => call('res:list', 'workflows'));
  const { data: tools } = useLoad<ToolStatus>(() => call('app:tools'));
  const prefs = useStore((s) => s.prefs)!;
  const installing = useStore((s) => Object.values(s.tasks).some((t) => t.kind === 'comfy-install' && t.state === 'running'));
  const [url, setUrl] = useState(view.comfyUrl);
  const [busy, run] = useBusy();
  useEffect(() => setUrl(view.comfyUrl), [view.comfyUrl]);
  useEvent('comfy:state', (s: ComfyStatus) => {
    set(s);
    void reprobe();
  });
  useDataChanged(['resources'], reloadFlows);

  const bind = async () => {
    const dir = await call('app:pickDirectory', { title: '选择 ComfyUI 目录' });
    if (dir) await attempt(async () => set(await call('img:comfyBind', dir)), '已绑定');
  };
  const importFlow = async () => {
    const files = await call('app:pickFiles', { title: '导入 API 格式工作流', multi: true, filters: [{ name: '工作流', extensions: ['json'] }] });
    if (files.length) {
      const results = await call('res:import', 'workflows', files);
      reportImport(results);
      for (const r of results.filter((x) => x.ok && x.message !== '已导入')) toast(r.message, 'ok');
      await reloadFlows();
    }
  };
  const install = async () => {
    const vendor = tools?.gpu?.vendor;
    const variant = vendor === 'amd' ? 'amd' : vendor === 'intel' ? 'intel' : 'nvidia';
    const ok = await confirm({
      title: '下载 ComfyUI 便携版',
      body: `官方便携包约 2 GB，解压后约 4.5 GB，按你的显卡选择 ${variant} 版。几条线路同时下载，支持断点续传。`,
      confirm: '开始下载',
    });
    if (ok) await attempt(() => call('img:comfyInstall', variant));
  };

  return (
    <div className="fields">
      <Field label="地址">
        <div className="row">
          <TextInput mono aria-label="地址" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button
            onClick={async () => {
              if (url !== view.comfyUrl) await patch({ comfyUrl: url });
              await reprobe();
              await reload();
            }}
          >
            连接
          </Button>
        </div>
      </Field>
      <Field label="本机 ComfyUI" aside={comfy?.dir ? `${comfy.layout === 'portable' ? '便携版' : '源码版'}，${comfy.checkpoints} 个底模` : undefined}>
        {comfy?.dir ? (
          <div className="row">
            <span className="mono dim truncate grow selectable">{comfy.dir}</span>
            {comfy.running ? (
              comfy.managed ? (
                <Button size="sm" icon={Stop} onClick={() => void attempt(async () => set(await call('img:comfyStop')))}>
                  停止
                </Button>
              ) : (
                <span className="tag jade">已在运行</span>
              )
            ) : (
              <Button size="sm" variant="primary" icon={Play} busy={busy || comfy.starting} onClick={() => void run(() => attempt(async () => set(await call('img:comfyStart'))))}>
                启动
              </Button>
            )}
            <IconButton icon={FolderOpen} size="sm" label="打开目录" onClick={() => void attempt(() => call('app:reveal', comfy.dir!))} />
            <Button size="sm" variant="ghost" onClick={() => void attempt(async () => set(await call('img:comfyBind', null)))}>
              解绑
            </Button>
          </div>
        ) : (
          <div className="row">
            <Button size="sm" icon={FolderOpen} onClick={() => void bind()}>
              绑定已有目录
            </Button>
            {isMac ? (
              <span className="dim">便携版只有 Windows 版。Mac 上先按 ComfyUI 官方说明装好源码版（带 venv），再绑定它的目录。</span>
            ) : (
              <Button size="sm" icon={DownloadSimple} busy={installing} onClick={() => void install()}>
                下载便携版
              </Button>
            )}
          </div>
        )}
        {comfy?.dir && (
          <div style={{ marginTop: 10 }}>
            <SettingRow title="酒馆开门时一起启动" note={comfy.lastError ?? '第一次启动要一分钟左右，之后十几秒。轻量引擎下载的模型这里也能用。'}>
              <Switch label="酒馆开门时一起启动 ComfyUI" checked={prefs.imagegen.engineAutoStart} onChange={(v) => void setPrefs({ imagegen: { ...prefs.imagegen, engineAutoStart: v } })} />
            </SettingRow>
          </div>
        )}
      </Field>
      <Field
        label="工作流"
        aside={derivedNote(view.comfyWorkflow)}
        help="从 ComfyUI 用「导出（API）」得到的 JSON。导入时会自动把提示词、种子、尺寸等换成酒馆占位符。"
      >
        <div className="row">
          <Select
            label="工作流"
            // 高清修复、读 LoRA 用的是掌柜改写出的副本，这里显示原来那份
            value={hiresBase(view.comfyWorkflow)}
            onChange={(v) => void patch({ comfyWorkflow: v })}
            options={[
              ...(workflows ?? []).filter((w) => hiresBase(w.file) === w.file).map((w) => ({ value: w.file, label: w.name.replace(/_/g, ' ') })),
              ...((workflows ?? []).some((w) => w.file === hiresBase(view.comfyWorkflow))
                ? []
                : [{ value: hiresBase(view.comfyWorkflow), label: hiresBase(view.comfyWorkflow).replace(/\.json$/, '').replace(/_/g, ' ') }]),
            ]}
          />
          <Button icon={FileArrowUp} onClick={() => void importFlow()}>
            导入
          </Button>
        </div>
      </Field>
      <VideoPanel view={view} patch={patch} vram={tools?.gpu?.vramBytes ? tools.gpu.vramBytes / 1024 ** 3 : null} reprobe={reprobe} />
    </div>
  );
}

/** 掌柜改写出的副本里加了什么 */
function derivedNote(workflow: string): string | undefined {
  const d = derivedParts(workflow);
  const parts = [d.hires && '已加高清修复', d.lora && '读外貌里的 LoRA'].filter(Boolean);
  return parts.length ? parts.join('，') : undefined;
}

/** 视频：下载模型、写工作流、在聊天框加按钮。 */
const MODE_LABEL: Record<VideoMode, string> = { scene: '拍这一幕', animate: '动起来' };
const LORA_STRENGTHS = [0.6, 0.8, 1];
const EVERY = [
  { value: 0, label: '不做' },
  { value: 1, label: '每张' },
  { value: 3, label: '每 3 张' },
  { value: 5, label: '每 5 张' },
];

function VideoPanel({ view, patch, vram, reprobe }: { view: ImagegenView; patch: PanelProps['patch']; vram: number | null; reprobe: () => Promise<void> }) {
  const { data: status, set } = useLoad(() => call('video:status'));
  const tasks = useStore((s) => s.tasks);
  const auto = useStore((s) => s.prefs?.imagegen.scene.auto);
  const [restarting, runRestart] = useBusy();
  useEvent('video:state', set);
  if (!status) return null;
  const downloading = new Set(Object.values(tasks).filter((t) => t.kind === 'video-model' && t.state === 'running').map((t) => t.title));
  const readyFor = (mode: VideoMode) => VIDEO_MODELS.filter((m) => m.modes.includes(mode) && status.models.find((x) => x.id === m.id)?.ready);
  // 按钮用当前工作流的那个模型，没有就用列表里第一个下好的（显存要求低的排在前面）
  const pick = (mode: VideoMode) => {
    const list = readyFor(mode);
    return (list.find((m) => videoWorkflowFile(m, mode) === view.comfyWorkflow) ?? list[0])?.id ?? null;
  };
  const isVideo = /^掌柜_视频_/.test(view.comfyWorkflow);
  const toggle = (mode: VideoMode, on: boolean) => void attempt(async () => set(await call('video:buttons', mode, on ? pick(mode) : null)));
  const anyReady = readyFor('scene').length + readyFor('animate').length > 0;

  return (
    <Field label="视频" help="短片由 ComfyUI 生成，出好后和图片一样贴进聊天。「动起来」从聊天里最后一张图开始拍，人物和那张图一样。8 GB 显存拍 2 秒要一两分钟。">
      <div className="table">
        {VIDEO_MODELS.map((m) => {
          const s = status.models.find((x) => x.id === m.id)!;
          const options: VideoOptions = s.options ?? { orientation: 'portrait', frames: m.lengths[1]!.frames, format: m.modes[0] === 'animate' ? 'webp' : 'mp4', lora: null };
          const write = (o: Partial<VideoOptions>) => void attempt(async () => set(await call('video:workflow', m.id, { ...options, ...o })));
          return (
            <div key={m.id} className="table-row tall">
              <div className="grow">
                <div className="row wrap" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 540 }}>{m.name}</span>
                  {m.modes.map((mode) => (
                    <span key={mode} className="tag">
                      {MODE_LABEL[mode]}
                    </span>
                  ))}
                  {vram !== null && vram < m.minVramGb - 0.5 && <span className="tag gold">显存偏小</span>}
                </div>
                {s.ready ? (
                  <>
                    <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                      {(['portrait', 'landscape'] as const).map((o) => (
                        <button key={o} type="button" className="tag" aria-pressed={options.orientation === o} onClick={() => write({ orientation: o })}>
                          {o === 'portrait' ? '竖' : '横'} {videoSize(m, m.modes.at(-1)!, { orientation: o }).join('×')}
                        </button>
                      ))}
                      <span className="dim">|</span>
                      {m.lengths.map((l) => (
                        <button key={l.frames} type="button" className="tag" aria-pressed={options.frames === l.frames} onClick={() => write({ frames: l.frames })}>
                          {l.seconds} 秒
                        </button>
                      ))}
                      <span className="dim">|</span>
                      {(['mp4', 'webp'] as const).map((f) => (
                        <button key={f} type="button" className="tag" aria-pressed={(options.format ?? 'mp4') === f} onClick={() => write({ format: f })}>
                          {f === 'mp4' ? '视频' : '动图'}
                        </button>
                      ))}
                    </div>
                    {status.loras.length > 0 && (
                      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                        <Select
                          label="LoRA"
                          style={{ minWidth: 200 }}
                          value={options.lora?.file ?? 'none'}
                          options={[{ value: 'none', label: '不加 LoRA' }, ...status.loras.map((f) => ({ value: f, label: f.replace(/\.safetensors$/i, '') }))]}
                          onChange={(v) => write({ lora: v === 'none' ? null : { file: v, strength: options.lora?.strength ?? 0.8 } })}
                        />
                        {options.lora &&
                          LORA_STRENGTHS.map((w) => (
                            <button key={w} type="button" className="tag" aria-pressed={options.lora!.strength === w} onClick={() => write({ lora: { ...options.lora!, strength: w } })}>
                              {w}
                            </button>
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="dim">
                    {m.note}。{m.license}
                  </div>
                )}
              </div>
              {s.ready ? (
                !m.modes.includes('scene') ? (
                  <span className="dim">试画后点「让它动起来」</span>
                ) : view.comfyWorkflow === videoWorkflowFile(m, 'scene') ? (
                  <span className="tag amber">当前工作流</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!s.options) await attempt(async () => set(await call('video:workflow', m.id, options)));
                      await patch({ comfyWorkflow: videoWorkflowFile(m, 'scene') });
                      await reprobe();
                    }}
                  >
                    用来试拍
                  </Button>
                )
              ) : (
                <>
                  <span className="dim num">{bytes(videoBytes(m))}</span>
                  <Button size="sm" busy={downloading.has(`下载 ${m.name}`)} onClick={() => void attempt(() => call('video:download', m.id), '已加入下载')}>
                    下载
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6 }}>
        {status.nodes === 'restart' && (
          <SettingRow title="ComfyUI 要重启一次" note="「动起来」要用掌柜放进 ComfyUI 的一个小节点，ComfyUI 启动时才会载入它。">
            <Button size="sm" busy={restarting} onClick={() => void runRestart(() => attempt(async () => set(await call('video:restartComfy')), '已重启'))}>
              重启 ComfyUI
            </Button>
          </SettingRow>
        )}
        {readyFor('scene').length > 0 && (
          <SettingRow title="聊天框上加「拍这一幕」" note="按最后一条消息拍一段短片。对话模型先写好画面和动作，拍完自动换回画图工作流。">
            <Switch label="拍这一幕按钮" checked={Boolean(status.scene)} onChange={(v) => toggle('scene', v)} />
          </SettingRow>
        )}
        {readyFor('animate').length > 0 && (
          <SettingRow title="聊天框上加「动起来」" note="让聊天里最后一张图动起来，人物、衣服和场景跟那张图一样，对话模型只写怎么动。">
            <Switch label="动起来按钮" checked={Boolean(status.animate)} onChange={(v) => toggle('animate', v)} />
          </SettingRow>
        )}
        {status.animate && auto && (
          <SettingRow title="自动配图后做成动图" note="每隔几张，把刚画好的配图接着做成动图。每段要多等一两分钟。">
            <div className="row wrap" style={{ gap: 6 }}>
              {EVERY.map((e) => (
                <button
                  key={e.value}
                  type="button"
                  className="tag"
                  aria-pressed={status.animateEvery === e.value}
                  onClick={() => void attempt(async () => set(await call('video:every', e.value)))}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </SettingRow>
        )}
        {anyReady && (
          <SettingRow
            title="视频 LoRA"
            note={
              status.loras.length
                ? `共 ${status.loras.length} 个。动作、画风或成人内容的 LoRA 要和模型版本对应（Wan 2.1 1.3B 或 Wan 2.2 5B）。`
                : '把 .safetensors 放进这个文件夹，就能在上面的模型里选。要和模型版本对应。'
            }
          >
            <Button size="sm" icon={FolderOpen} onClick={() => void attempt(() => call('app:reveal', status.loraDir))}>
              打开文件夹
            </Button>
          </SettingRow>
        )}
        {isVideo && (
          <SettingRow title="现在用的是视频工作流" note="这时酒馆里要图也会出视频。">
            <Button
              size="sm"
              onClick={async () => {
                await patch({ comfyWorkflow: 'Default_Comfy_Workflow.json' });
                await reprobe();
              }}
            >
              换回画图
            </Button>
          </SettingRow>
        )}
      </div>
    </Field>
  );
}

function Params({ backend, view, probe, patch }: { backend: ImageBackend; view: ImagegenView; probe: ImagegenProbe | null; patch: (p: Partial<ImagegenView>) => Promise<void> }) {
  const [prefix, setPrefix] = useState(view.promptPrefix);
  const [negative, setNegative] = useState(view.negativePrompt);
  const [model, setModel] = useState(view.model);
  useEffect(() => setPrefix(view.promptPrefix), [view.promptPrefix]);
  useEffect(() => setNegative(view.negativePrompt), [view.negativePrompt]);
  useEffect(() => setModel(view.model), [view.model]);

  const models = useMemo(() => {
    const labels = new Map(backend.models.map((m) => [m.id, m.label]));
    const ids = probe?.models.length ? probe.models : backend.models.map((m) => m.id);
    return [...new Set(ids)].map((id) => ({ value: id, note: labels.get(id) }));
  }, [backend, probe]);

  useEffect(() => {
    if (model === view.model) return;
    const t = setTimeout(() => void patch({ model }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const samplers = (probe?.samplers.length ? probe.samplers : backend.samplers) ?? [];
  const schedulers = (probe?.schedulers.length ? probe.schedulers : backend.schedulers) ?? [];
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list).map((x) => ({ value: x, label: x }));
  const prefs = useStore((s) => s.prefs)!;
  const { data: engine, reload: reloadEngine } = useLoad(() => call('img:engine'), [prefs.imagegen.engineModel]);
  useEvent('engine:state', () => void reloadEngine());
  const chosen = engine?.models.find((m) => m.file === (backend.id === 'engine' ? (prefs.imagegen.engineModel ?? engine.models[0]?.file) : view.model));
  const small =
    backend.id === 'engine' || (backend.id === 'comfy' && chosen)
      ? chosen?.family === 'SD 1.5'
      : backend.id === 'horde' && !/xl/i.test(view.model);
  const style = STYLE_PRESETS.find((s) => sameStyle(s, view.promptPrefix, view.negativePrompt));
  const rating = ratingOf(view.promptPrefix, view.negativePrompt);
  const setWords = (prefix: string, negative: string, r: Rating) => {
    const w = withRating(prefix, negative, r);
    void patch({ promptPrefix: w.prefix, negativePrompt: w.negative });
  };

  return (
    <section className="studio-block">
      <h2 className="block-title">画面</h2>
      <div className="fields" style={{ marginTop: 14 }}>
        {backend.id !== 'engine' && (
          <Field label="模型">
            <Combo label="模型" value={model} onChange={setModel} options={models} placeholder={backend.id === 'comfy' || backend.id === 'auto' ? '留空用默认' : '模型名称'} />
          </Field>
        )}
        <Field label="画风" aside={style ? undefined : '自定义'}>
          <div className="row wrap" style={{ gap: 6 }}>
            {STYLE_PRESETS.map((s) => (
              <button key={s.id} type="button" className="tag" title={s.note} aria-pressed={style?.id === s.id} onClick={() => setWords(s.prefix, s.negative, rating)}>
                {s.name}
              </button>
            ))}
          </div>
        </Field>
        {prefs.adult && backend.negative && (
          <Field label="分级" help={RATINGS.find((r) => r.id === rating)!.note}>
            <div className="row wrap" style={{ gap: 6 }}>
              {RATINGS.map((r) => (
                <button key={r.id} type="button" className="tag" aria-pressed={rating === r.id} onClick={() => setWords(view.promptPrefix, view.negativePrompt, r.id)}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label="通用前缀" help="加在每条提示词最前面。">
          <textarea className="textarea mono" rows={2} aria-label="通用前缀" value={prefix} onChange={(e) => setPrefix(e.target.value)} onBlur={() => prefix !== view.promptPrefix && void patch({ promptPrefix: prefix })} />
        </Field>
        {backend.negative && (
          <Field label="负面提示词">
            <textarea className="textarea mono" rows={2} aria-label="负面提示词" value={negative} onChange={(e) => setNegative(e.target.value)} onBlur={() => negative !== view.negativePrompt && void patch({ negativePrompt: negative })} />
          </Field>
        )}
        <Field label="尺寸">
          <div className="row">
            {SIZE_PRESETS.map((s) => {
              const [w, h] = small ? s.sd15 : s.xl;
              return (
                <button key={s.id} type="button" className="size-chip" aria-pressed={view.width === w && view.height === h} onClick={() => void patch({ width: w, height: h })}>
                  <i style={{ width: 18 * Math.min(1, w / h), height: 18 * Math.min(1, h / w) }} />
                  {s.label}
                </button>
              );
            })}
            <span className="grow" />
            <NumberInput label="宽" value={view.width} min={64} max={2048} step={8} onChange={(v) => void patch({ width: Math.round(v / 8) * 8 })} style={{ width: 82 }} />
            <span className="dim">×</span>
            <NumberInput label="高" value={view.height} min={64} max={2048} step={8} onChange={(v) => void patch({ height: Math.round(v / 8) * 8 })} style={{ width: 82 }} />
          </div>
        </Field>
        {samplers.length > 0 && (
          <>
            <div className="grid-2">
              <Field label="采样器">
                <Select label="采样器" value={view.sampler} onChange={(v) => void patch({ sampler: v })} options={withCurrent(samplers, view.sampler)} placeholder="选择" />
              </Field>
              {schedulers.length > 0 && (
                <Field label="调度器">
                  <Select label="调度器" value={view.scheduler} onChange={(v) => void patch({ scheduler: v })} options={withCurrent(schedulers, view.scheduler)} placeholder="选择" />
                </Field>
              )}
            </div>
            <div className="grid-2">
              <Dial label="步数" value={view.steps} min={1} max={60} step={1} onCommit={(v) => void patch({ steps: v })} />
              <Dial label="引导强度" value={view.scale} min={1} max={15} step={0.5} onCommit={(v) => void patch({ scale: v })} />
            </div>
          </>
        )}
        <Hires backend={backend} view={view} />
      </div>
      <p className="dim" style={{ marginTop: 20 }}>
        在酒馆里点输入框旁的魔棒，选「生成图片」；也可以输入 <span className="mono">/imagine</span> 加描述。
      </p>
      <div style={{ marginTop: 8 }}>
        <SettingRow title="用英文要图时直接出图" note="例如 draw a picture of a cat。酒馆只认英文句式，中文不会触发。">
          <Switch label="交互模式" checked={view.interactiveMode} onChange={(v) => void patch({ interactiveMode: v })} />
        </SettingRow>
        <SettingRow title="让模型自己决定何时画" note="通过函数调用触发，需要模型支持，并在酒馆里打开函数调用。">
          <Switch label="函数调用生图" checked={view.functionTool} onChange={(v) => void patch({ functionTool: v })} />
        </SettingRow>
      </div>
    </section>
  );
}

const PROMPT_STYLES: { id: PromptStyleChoice; label: string }[] = [
  { id: 'auto', label: '自动' },
  { id: 'tags', label: '标签' },
  { id: 'prose', label: '句子' },
];

/** 按聊天上下文画图：酒馆让对话模型写提示词，掌柜管写法、按钮和自动配图。 */
function ChatScene({ view }: { view: ImagegenView }) {
  const { data: scene, set } = useLoad(() => call('scene:status'), [view.source, view.promptPrefix, view.negativePrompt, view.comfyWorkflow]);
  useEvent('scene:state', set);
  const go = useStore((s) => s.go);
  const adult = useStore((s) => s.prefs?.adult);
  const [busy, run] = useBusy();
  if (!scene) return null;
  const save = (p: Partial<ScenePrefs>) => run(() => attempt(async () => set(await call('scene:set', p))));
  const written = scene.effective === 'tags' ? ' Danbooru 标签，适合 WAI、Illustrious、Anything 这类二次元模型' : '一段英文描述，适合 FLUX、Z-Image 和各家云端模型';
  const nsfw = nsfwTemplatesOn(Boolean(adult), ratingOf(view.promptPrefix, view.negativePrompt));

  return (
    <section className="studio-block">
      <h2 className="block-title">聊天里配图</h2>
      <p className="dim" style={{ marginTop: 6 }}>
        酒馆会把聊天上下文交给模型，让它把这一幕写成画图提示词，再交给上面选的后端。魔棒菜单里的「最后一条消息」「整个故事」走的都是这条路。
      </p>
      {adult && (
        <p className="dim" style={{ marginTop: 6 }}>
          {nsfw
            ? `分级不是全年龄时，画这一幕、自动配图、拍短片和试画会按原文自己选模板：${NSFW_SCENES.map((s) => s.name).join('、')}。日常句子不套。外貌仍用角色卡里存的。提到未成年人不套，并按原规则拒绝。酒馆已经开着的话，重新打开一次才用新的选模板。`
            : '当前分级是全年龄，不会套成人模板。'}
        </p>
      )}
      <div style={{ marginTop: 12 }}>
        <SettingRow title="聊天框上加「画这一幕」" note="点一下就按最后一条消息出图，不用打开魔棒菜单。">
          <Switch label="画这一幕按钮" checked={scene.button} disabled={busy} onChange={(v) => void save({ button: v })} />
        </SettingRow>
        <SettingRow title="每条回复后自动配一张图" note="每条回复后多等十几秒到一分钟，看后端和高清修复。配图不进对话上下文，不影响后面的回复。">
          <Switch label="自动配图" checked={scene.auto} disabled={busy} onChange={(v) => void save({ auto: v })} />
        </SettingRow>
      </div>
      <div className="fields" style={{ marginTop: 14 }}>
        <PromptWriterField scene={scene} busy={busy} save={save} />
        <Field
          label="提示词写法"
          help={scene.customized ? '你在酒馆里改过写提示词的说明，掌柜不会覆盖改过的那几条。' : `现在让对话模型写${written}。`}
        >
          <div className="row wrap" style={{ gap: 6 }}>
            {PROMPT_STYLES.map((s) => (
              <button key={s.id} type="button" className="tag" aria-pressed={scene.promptStyle === s.id} disabled={busy} onClick={() => void save({ promptStyle: s.id })}>
                {s.id === 'auto' ? `自动（${scene.effective === 'tags' ? '标签' : '句子'}）` : s.label}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="短片"
          help={
            view.source === 'comfy'
              ? '「拍这一幕」「动起来」的模型、时长、动图和聊天框按钮，在上面 ComfyUI 面板最下面的「视频」里。'
              : '「拍这一幕」「动起来」要用 ComfyUI：在上面的后端列表里选 ComfyUI，下载便携版或绑定已有目录，它的面板最下面有「视频」，在那里下载视频模型、打开聊天框按钮。'
          }
        >
          <div className="dim">{view.source === 'comfy' ? '视频在 ComfyUI 面板里配置' : '当前后端不能拍短片'}</div>
        </Field>
        <Field label="角色长相" help="每个角色可以存一组外貌标签，画到他时自动带上，长相才不会每张都变。">
          <div>
            <Button size="sm" onClick={() => go('characters')}>
              去角色卡里设置
            </Button>
          </div>
        </Field>
      </div>
    </section>
  );
}

/** 精绘的候选：常用的三家，加上已经填了密钥的云端服务 */
const POLISH_FEATURED = ['novel', 'auto', 'horde'];

/**
 * 精绘：日常配图用上面的后端，看中哪一幕时点聊天框上的「精绘」，交给这里选的后端画一张。
 * 设置存在掌柜，由主进程写进酒馆里的扩展，扩展画那一张时临时换上、画完换回。
 */
function Polish({ view, reload }: { view: ImagegenView; reload: () => Promise<void> }) {
  const prefs = useStore((s) => s.prefs)!;
  const p = prefs.imagegen.polish;
  const [busy, run] = useBusy();
  const [url, setUrl] = useState(p.url);
  useEffect(() => setUrl(p.url), [p.url]);
  const [probe, setProbe] = useState<ImagegenProbe | null>(null);
  const backend = imageBackendById(p.backend) ?? imageBackendById('novel')!;
  const needsKey = Boolean(backend.secretKey) && backend.id !== 'horde';
  const hasKey = Boolean(view.hasKey[backend.id]);
  const plan = polishPlan(p, view, prefs.imagegen.hires);
  const save = (patch: Partial<PolishPrefs>) => run(() => attempt(() => call('img:polish', patch)));

  const reprobe = useCallback(async () => {
    setProbe(null);
    if (backend.id === 'auto') return;
    setProbe(await call('img:probe', backend.id).catch(() => null));
  }, [backend.id]);
  useEffect(() => {
    if (p.enabled && (!needsKey || hasKey)) void reprobe();
    else setProbe(null);
  }, [p.enabled, needsKey, hasKey, reprobe]);

  const choices = POLISH_BACKENDS.map((id) => imageBackendById(id)!).filter((b) => POLISH_FEATURED.includes(b.id) || view.hasKey[b.id] || b.id === p.backend);
  const models = backend.models.filter((m) => !m.video).map((m) => ({ value: m.id, label: m.label }));
  const words = plan ? String(plan.sd.prompt_prefix).trim().replace(/,$/, '') : '';
  const missing = backend.id === 'auto' ? !p.url.trim() && '填好地址后按钮才会出现。' : needsKey && !hasKey && '填好密钥后按钮才会出现。';

  return (
    <section className="studio-block">
      <h2 className="block-title">精绘</h2>
      <p className="dim" style={{ marginTop: 6 }}>
        日常配图照旧用上面的后端，看中哪一幕时点聊天框上的「精绘」，交给下面这家画一张。最后一条是图就照它的提示词重画，新图加进这张图的翻页里，左右翻能对比；最后一条是文字就按它画一张。
      </p>
      <div style={{ marginTop: 12 }}>
        <SettingRow title="聊天框上加「精绘」" note="只跟着按钮走，不参与自动配图。">
          <Switch label="精绘按钮" checked={p.enabled} disabled={busy} onChange={(v) => void save({ enabled: v })} />
        </SettingRow>
      </div>
      {p.enabled && (
        <div className="fields" style={{ marginTop: 14 }}>
          <Field label="交给">
            <div className="row wrap" style={{ gap: 6 }}>
              {choices.map((b) => (
                <button key={b.id} type="button" className="tag" aria-pressed={b.id === backend.id} disabled={busy} onClick={() => void save({ backend: b.id })}>
                  {b.id === 'auto' ? '自己的 SD WebUI' : b.name}
                </button>
              ))}
            </div>
          </Field>
          {backend.id === 'auto' ? (
            <Field label="地址" help={`另一台装着 SD WebUI 或 Forge 的机器，比如租的云显卡，启动参数要带 --api 和 --listen。用它当前载入的模型，自动开 ${prefs.imagegen.hires.scale} 倍高清修复。`}>
              <div className="row">
                <TextInput mono aria-label="精绘地址" placeholder="http://地址:7860" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save({ url })} onBlur={() => url !== p.url && void save({ url })} />
              </div>
            </Field>
          ) : (
            models.length > 0 && (
              <Field label="模型">
                <Select label="精绘模型" value={plan?.model ?? models[0]!.value} onChange={(v) => void save({ model: v })} options={models} />
              </Field>
            )
          )}
          {/* 密钥失效时也要能换 */}
          {needsKey && (!hasKey || probe?.ok === false) && <KeyPanel backend={backend} view={view} probe={probe} probing={false} patch={async () => undefined} reprobe={reprobe} reload={reload} />}
          {probe && (
            <div className="row" style={{ gap: 7 }}>
              <span className={classes('lamp', probe.ok ? 'ok' : 'bad')} />
              <span className={probe.ok ? 'muted' : ''} style={probe.ok ? undefined : { color: 'var(--seal)' }}>
                {probe.message}
              </span>
            </div>
          )}
          {missing && <Note kind="warn">{missing}</Note>}
          {prefs.adult && !backend.adult && backend.id !== 'auto' && (
            <Note kind="warn">这家不画成人内容，成人场面会被拒绝或打码。能画的是 NovelAI、AI Horde，或你自己的 SD WebUI。</Note>
          )}
          {backend.id === 'novel' && (
            <Note>Opus 订阅下 832×1216 以内、28 步以内不耗 Anlas，精绘按日常的横竖选尺寸，都在这个范围内。NovelAI 要求每张图都由人点出来，精绘只跟着按钮走正好合适。</Note>
          )}
          {backend.source === view.source && backend.id !== 'auto' && <Note>和日常后端是同一家，精绘只换尺寸、步数和前缀。</Note>}
          {plan && (
            <p className="dim">
              {plan.sd.width}×{plan.sd.height}，{plan.sd.steps} 步。前缀{words ? <span className="mono">：{words}</span> : '不加'}。分级跟着日常设置。
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const WRITERS: { id: PromptWriter; label: string }[] = [
  { id: 'chat', label: '当前对话模型' },
  { id: 'local', label: '本机模型' },
];

/**
 * 写提示词用谁：酒馆当前接入的对话模型，或本机对话引擎。主聊天始终用当前接入。
 * 选本机时把引擎的情况说清楚：没装、没模型、没运行时酒馆里照旧用当前对话模型写，并弹提示。
 */
function PromptWriterField({ scene, busy, save }: { scene: ScenePrefs; busy: boolean; save: (p: Partial<ScenePrefs>) => Promise<unknown> }) {
  const { data: engine, set } = useLoad(() => call('llm:status'));
  useEvent('llm:state', set);
  const prefs = useStore((s) => s.prefs);
  const go = useStore((s) => s.go);
  const [starting, run] = useBusy();
  if (!engine || !prefs) return null;
  const local = scene.writer === 'local';
  const ready = writerReadiness(engine);
  const mine = prefs.connections.find((c) => c.providerId === LOCAL_ENGINE_ID);
  const isMain = Boolean(mine) && prefs.activeConnectionId === mine!.id;
  const model = engine.models.find((m) => m.file === (engine.activeModel ?? prefs.llm.model))?.label ?? engine.models[0]?.label ?? '';
  const start = () => run(() => attempt(async () => set(await call('scene:startWriter')), '本机引擎已启动，提示词改由它来写'));

  let status: ReactNode = null;
  if (local && isMain) status = <Note>酒馆当前接入的就是本机引擎，两种选法效果一样。</Note>;
  else if (local && ready === 'no-engine') {
    status = (
      <Note kind="warn">
        还没装本机对话引擎。到「模型接入」页最下面安装引擎、下载一个模型。装好之前酒馆里仍由当前对话模型写，并会提示。
        <div style={{ marginTop: 8 }}>
          <Button size="sm" onClick={() => go('models')}>去安装</Button>
        </div>
      </Note>
    );
  } else if (local && ready === 'no-model') {
    status = (
      <Note kind="warn">
        本机对话引擎还没有模型。到「模型接入」页最下面下载一个，写提示词 4B 就够用，9B 写得更准。没有模型之前仍由当前对话模型写。
        <div style={{ marginTop: 8 }}>
          <Button size="sm" onClick={() => go('models')}>去下载</Button>
        </div>
      </Note>
    );
  } else if (local && ready === 'stopped') {
    status = (
      <Note kind="warn">
        {engine.lastError ? `本机引擎没有启动起来：${engine.lastError}。` : '本机引擎没在运行。'}
        {prefs.llm.autoStart ? '酒馆开门时会自动启动它；' : '「模型接入」页里关掉了「酒馆开门时一起启动」，要用时先在这里启动；'}
        没运行时酒馆里仍由当前对话模型写，并会提示。
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="primary" icon={Play} busy={starting} onClick={() => void start()}>
            启动
          </Button>
        </div>
      </Note>
    );
  } else if (local && ready === 'starting') status = <Note>正在载入 {model}，几 GB 的模型要读十几秒。</Note>;
  else if (local) {
    status = (
      <Note kind="good">
        由本机的 {model} 写，端口 {engine.port}。主聊天仍用当前接入。
        {engine.sleepsWhenIdle ? `写完约 ${WRITER_IDLE_SECONDS} 秒就让出显存，下次写要多等几秒载入。` : ''}
      </Note>
    );
  }

  return (
    <Field
      label="写提示词用"
      help={
        local
          ? '画这一幕、自动配图、魔棒菜单和拍短片的提示词改由本机模型写，不再按次调用付费接口。主聊天不受影响。'
          : '用酒馆当前接入的对话模型写。按次计费的接口，每画一张图、拍一段短片都会多调用一次。'
      }
    >
      <div className="row wrap" style={{ gap: 6 }}>
        {WRITERS.map((w) => (
          <button key={w.id} type="button" className="tag" aria-pressed={scene.writer === w.id} disabled={busy} onClick={() => void save({ writer: w.id })}>
            {w.label}
          </button>
        ))}
      </div>
      {status && <div style={{ marginTop: 10 }}>{status}</div>}
      {local && !isMain && (
        <div style={{ marginTop: 6 }}>
          <SettingRow title="写完就让出显存" note={`写完约 ${WRITER_IDLE_SECONDS} 秒后把模型移出显存留给生图，下次写多等几秒。8 GB 显存建议打开。改了会重开引擎。`}>
            <Switch label="写完就让出显存" checked={scene.writerSleeps} disabled={busy} onChange={(v) => void save({ writerSleeps: v })} />
          </SettingRow>
        </div>
      )}
    </Field>
  );
}

/** 高清修复：先按原尺寸出图，再放大重画一遍。设置存在掌柜，由主进程落到当前后端。 */
function Hires({ backend, view }: { backend: ImageBackend; view: ImagegenView }) {
  const h = useStore((s) => s.prefs)!.imagegen.hires;
  const [busy, run] = useBusy();
  const supported = HIRES_BACKENDS.includes(backend.id);
  const save = (p: Partial<HiresPrefs>) => run(() => attempt(() => call('img:hires', p)));
  const size = (n: number) => Math.round((n * h.scale) / 8) * 8;
  const strength = HIRES_STRENGTHS.find((s) => s.value === h.denoise);

  return (
    <div>
      <SettingRow
        title="高清修复"
        note={
          supported
            ? `先按原尺寸出图，再放大重画一遍，线条、发丝和眼睛更细。出图约 ${size(view.width)}×${size(view.height)}，用时是原来的两到三倍。`
            : '云端服务不支持。本机的轻量引擎、ComfyUI 和 SD WebUI 可以用。'
        }
      >
        <Switch label="高清修复" checked={supported && h.enabled} disabled={!supported || busy} onChange={(v) => void save({ enabled: v })} />
      </SettingRow>
      {supported && h.enabled && (
        <div className="grid-2" style={{ marginTop: 10 }}>
          <Field label="放大" help={h.scale >= 2 ? '适合 SD 1.5 的小图。SDXL 放大 2 倍一张要两三分钟。' : '832×1216 这类 SDXL 尺寸用 1.5 倍正好。'}>
            <div className="row wrap" style={{ gap: 6 }}>
              {HIRES_SCALES.map((s) => (
                <button key={s} type="button" className="tag" aria-pressed={h.scale === s} disabled={busy} onClick={() => void save({ scale: s })}>
                  {s} 倍
                </button>
              ))}
            </div>
          </Field>
          <Field label="重画力度" help={strength?.note}>
            <div className="row wrap" style={{ gap: 6 }}>
              {HIRES_STRENGTHS.map((s) => (
                <button key={s.value} type="button" className="tag" aria-pressed={h.denoise === s.value} disabled={busy} onClick={() => void save({ denoise: s.value })}>
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}

function Dial({ label, value, min, max, step, onCommit }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onCommit(v), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <Field label={label} aside={<span className="num">{v}</span>}>
      <Slider label={label} value={v} min={min} max={max} step={step} onChange={setV} />
    </Field>
  );
}

function Easel({ view, backend }: { view?: ImagegenView; backend?: ImageBackend }) {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [result, setResult] = useState<ImagegenTestResult | null>(null);
  const adult = useStore((s) => s.prefs?.adult);
  const picked = view && nsfwTemplatesOn(Boolean(adult), ratingOf(view.promptPrefix, view.negativePrompt)) ? pickScene(prompt) : null;
  // 最近一张静态图，「让它动起来」从它开始拍
  const [still, setStill] = useState<string | null>(null);
  const [filming, setFilming] = useState(false);
  const [busy, run] = useBusy();
  const [elapsed, setElapsed] = useState(0);
  const { data: video, set: setVideo } = useLoad(() => call('video:status'));
  useEvent('video:state', setVideo);
  const animator = VIDEO_MODELS.find((m) => m.modes.includes('animate') && video?.models.find((x) => x.id === m.id)?.ready);
  // 开了精绘时可以切过去试一张，不用改日常后端
  const imagegen = useStore((s) => s.prefs?.imagegen);
  const plan = view && imagegen?.polish.enabled ? polishPlan(imagegen.polish, view, imagegen.hires) : null;
  const [chosenRoute, setRoute] = useState<ImagegenRoute>('main');
  const route: ImagegenRoute = plan ? chosenRoute : 'main';

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(t);
  }, [busy]);

  const draw = () =>
    run(async () => {
      setFilming(false);
      const r = await call('img:test', prompt, route).catch((e: Error) => ({ ok: false, message: e.message }) as ImagegenTestResult);
      setResult(r);
      setStill(r.ok && r.dataUrl && /^data:image\/(png|jpeg)/.test(r.dataUrl) ? r.dataUrl : null);
    });
  const animate = () =>
    run(async () => {
      setFilming(true);
      const motion = `${MOTION_FALLBACK}, ${prompt}`;
      setResult(await call('video:animate', animator!.id, still!, motion).catch((e: Error) => ({ ok: false, message: e.message })));
    });
  const size = route === 'polish' && plan ? { width: Number(plan.sd.width), height: Number(plan.sd.height) } : view;
  const ratio = Math.max(0.6, Math.min(1.7, size ? size.width / size.height : 0.7));

  return (
    <div className="easel">
      <div className="easel-canvas" style={{ aspectRatio: String(ratio), width: `min(100%, calc((100vh - 318px) * ${ratio}))` }}>
        <AnimatePresence mode="wait">
          {result?.ok && result.dataUrl && !busy ? (
            result.dataUrl.startsWith('data:video') ? (
              <motion.video key={result.dataUrl.length} src={result.dataUrl} autoPlay loop muted controls initial={{ opacity: 0, filter: 'blur(14px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }} />
            ) : (
              <motion.img key={result.dataUrl.length} src={result.dataUrl} alt="试画结果" initial={{ opacity: 0, filter: 'blur(14px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }} />
            )
          ) : (
            <motion.div key={busy ? 'busy' : 'idle'} className="easel-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {busy ? (
                <>
                  <span className="easel-wash" />
                  <span className="num serif easel-timer">{(elapsed / 1000).toFixed(1)}</span>
                  <span className="dim">{filming ? '正在拍' : '正在作画'}</span>
                </>
              ) : result && !result.ok ? (
                <>
                  <WarningCircle size={30} weight="light" color="var(--seal)" />
                  <p className="selectable">{result.message}</p>
                </>
              ) : (
                <>
                  <PaintBrush size={30} weight="light" />
                  <p>{backend ? '试画的图只在这里预览，不会进聊天。' : '先在左边选一个后端。'}</p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {plan && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button type="button" className="tag" aria-pressed={route === 'main'} disabled={busy} onClick={() => setRoute('main')}>
            日常{backend ? `：${backend.name}` : ''}
          </button>
          <button type="button" className="tag" aria-pressed={route === 'polish'} disabled={busy} onClick={() => setRoute('polish')}>
            精绘：{plan.label}
          </button>
        </div>
      )}
      <textarea className="textarea mono" rows={3} aria-label="试画提示词" value={prompt} spellCheck={false} onChange={(e) => setPrompt(e.target.value)} />
      {picked && <p className="dim">试画会套用「{picked.name}」模板{animator && still ? '，动起来用同一场的动作' : ''}。</p>}
      <div className="row">
        <Button variant="primary" icon={PaintBrush} busy={busy} disabled={!backend || !prompt.trim()} onClick={() => void draw()}>
          试画
        </Button>
        {result?.ok && result.ms && !busy && <span className="dim num">用时 {(result.ms / 1000).toFixed(1)} 秒</span>}
        <span className="grow" />
        {animator && still && !busy && (
          <Button icon={FilmStrip} onClick={() => void animate()}>
            让它动起来
          </Button>
        )}
        {result?.ok && result.dataUrl && !busy && (
          <Button icon={FloppyDisk} onClick={() => void attempt(async () => (await call('img:saveImage', result.dataUrl!)) && toast('已保存', 'ok'))}>
            保存
          </Button>
        )}
      </div>
    </div>
  );
}
