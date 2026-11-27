import { ArrowClockwise, DownloadSimple, FileArrowUp, Play, Plus, Stop, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { CHAT_MODELS, chatModelByFile } from '@shared/catalog/llm';
import { LOCAL_ENGINE_ID } from '@shared/catalog/providers';
import type { ToolStatus } from '@shared/types';
import { call } from '../lib/api';
import { bytes } from '../lib/format';
import { useBusy, useEvent, useLoad } from '../lib/hooks';
import { isMac } from '../lib/platform';
import { attempt, confirm, setPrefs, useStore } from '../lib/store';
import { Button, Dialog, Menu, NumberInput, Section, Select, SettingRow, Switch } from '../ui';

/** 本机对话引擎：装引擎、下模型、启停。 */
export function ChatEngine() {
  const { data: engine, set } = useLoad(() => call('llm:status'));
  const { data: tools } = useLoad<ToolStatus>(() => call('app:tools'));
  const tasks = useStore((s) => s.tasks);
  const prefs = useStore((s) => s.prefs)!;
  const [pick, setPick] = useState(false);
  const [busy, run] = useBusy();
  useEvent('llm:state', set);
  if (!engine) return null;

  const installing = Object.values(tasks).some((t) => t.kind === 'llm-install' && t.state === 'running');
  const downloading = new Set(Object.values(tasks).filter((t) => t.kind === 'llm-model' && t.state === 'running').map((t) => t.title));
  const current = engine.models.find((m) => m.file === prefs.llm.model)?.file ?? engine.models[0]?.file;
  const label = (file: string | null | undefined) => engine.models.find((m) => m.file === file)?.label ?? '';
  const stale = engine.running && Boolean(current) && engine.activeModel !== current;
  const vram = tools?.gpu?.vramBytes ? tools.gpu.vramBytes / 1024 ** 3 : null;
  const offered = CHAT_MODELS.filter((m) => !m.adult || prefs.adult);
  const mine = prefs.connections.find((c) => c.providerId === LOCAL_ENGINE_ID);
  const inUse = Boolean(mine) && prefs.activeConnectionId === mine!.id;

  const start = () => run(() => attempt(async () => set(await call('llm:start', current!)), '引擎已启动，酒馆已切到本机模型'));
  const importModel = async () => {
    const [file] = await call('app:pickFiles', { title: '选择 GGUF 模型', filters: [{ name: 'GGUF', extensions: ['gguf'] }] });
    if (file) await attempt(() => call('llm:import', file), '模型已加入');
  };

  return (
    <Section title="本机对话引擎" note="模型跑在自己电脑上，不联网、不计费，也没有人审查。">
      <ol className="ladder">
        <li data-done={engine.installed || undefined}>
          <div className="grow">
            <div className="ladder-title">引擎</div>
            <div className="dim">
              {engine.installed
                ? `llama.cpp ${engine.version ?? ''}，${engine.backend ?? ''} 版`
                : isMac
                  ? tools?.gpu
                    ? `约 17 MB，${tools.gpu.name}，将安装 Metal 版，要 macOS 13.3 以上`
                    : '约 13 MB，Intel 芯片的 Mac 只有 CPU 版，说话会比较慢'
                  : tools?.gpu
                    ? `约 40 MB，检测到 ${tools.gpu.name}，将安装 Vulkan 版`
                    : '约 25 MB，未检测到独立显卡，将安装 CPU 版，说话会比较慢'}
            </div>
          </div>
          <Button size="sm" variant={engine.installed ? 'ghost' : 'primary'} icon={DownloadSimple} busy={installing} onClick={() => void attempt(() => call('llm:install'))}>
            {engine.installed ? '更新' : '安装'}
          </Button>
        </li>
        <li data-done={engine.models.length > 0 || undefined}>
          <div className="grow">
            <div className="ladder-title">模型</div>
            {engine.models.length ? (
              <div style={{ maxWidth: 360, marginTop: 6 }}>
                <Select
                  label="对话模型"
                  value={current ?? ''}
                  onChange={(v) => void setPrefs({ llm: { ...prefs.llm, model: v, contextSize: chatModelByFile(v)?.contextSize ?? prefs.llm.contextSize } })}
                  options={engine.models.map((m) => ({ value: m.file, label: m.label, note: bytes(m.sizeBytes) }))}
                />
              </div>
            ) : (
              <div className="dim">下载一个，或导入你已有的 GGUF</div>
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
                  const ok = await confirm({ title: '删除模型文件', body: `${label(current)} 会移到回收站。`, confirm: '删除', danger: true });
                  if (ok) await attempt(() => call('llm:remove', current!));
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
            <div className="ladder-title">{engine.running ? (inUse ? '运行中，酒馆正在用它' : '运行中') : engine.starting ? '正在载入模型' : '启动并接入'}</div>
            <div className="dim num">
              {stale
                ? `正在用 ${label(engine.activeModel)}，重启后换成 ${label(current)}`
                : engine.running
                  ? `端口 ${engine.port}，只监听本机`
                  : engine.starting
                    ? '几 GB 的模型要读十几秒'
                    : (engine.lastError ?? '启动后会自动设为酒馆当前使用的模型')}
            </div>
          </div>
          {stale && (
            <Button size="sm" variant="primary" icon={ArrowClockwise} busy={busy} onClick={() => void start()}>
              重启
            </Button>
          )}
          {engine.running && !inUse && !stale && (
            <Button size="sm" variant="primary" busy={busy} onClick={() => void start()}>
              设为当前
            </Button>
          )}
          {engine.running ? (
            <Button size="sm" icon={Stop} onClick={() => void attempt(async () => set(await call('llm:stop')))}>
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
        <SettingRow title="记得多长的聊天" note="越长越占显存。改了要重启引擎。">
          <NumberInput label="上下文长度" value={prefs.llm.contextSize} min={2048} max={131072} step={1024} unit="token" onChange={(v) => void setPrefs({ llm: { ...prefs.llm, contextSize: v } })} style={{ width: 150 }} />
        </SettingRow>
        <SettingRow title="给本机生图留显存" note="对话会慢一些，但画图不抢显存。生图也在本机时才起作用，改了要重启引擎。">
          <Switch label="给本机生图留显存" checked={prefs.llm.shareGpu} onChange={(v) => void setPrefs({ llm: { ...prefs.llm, shareGpu: v } })} />
        </SettingRow>
        <SettingRow title="酒馆开门时一起启动" note="当前接入是本机引擎，或生图页选了「写提示词用：本机模型」时才会启动，打烊一起停。">
          <Switch label="酒馆开门时一起启动对话引擎" checked={prefs.llm.autoStart} onChange={(v) => void setPrefs({ llm: { ...prefs.llm, autoStart: v } })} />
        </SettingRow>
      </div>

      <Dialog open={pick} onClose={() => setPick(false)} title="下载对话模型" description={vram ? `${tools!.gpu!.name}，${vram.toFixed(0)} GB 显存。放不下的部分会自动留在内存，只是慢一些。` : '自动挑最快的线路，支持断点续传。'} wide>
        <div className="table" style={{ marginBottom: 14 }}>
          {offered.map((m) => {
            const have = engine.models.some((x) => x.file === m.remote.file);
            return (
              <div key={m.id} className="table-row tall">
                <div className="grow">
                  <div className="row">
                    <span style={{ fontWeight: 540 }}>{m.name}</span>
                    <span className="tag">{m.language}</span>
                    {m.adult && <span className="tag">成人</span>}
                    {vram !== null && vram < m.vramGb - 0.5 && <span className="tag gold">部分放内存</span>}
                  </div>
                  <div className="dim">
                    {m.note}。{m.license}
                  </div>
                </div>
                <span className="dim num">{bytes(m.remote.sizeBytes)}</span>
                {have ? (
                  <span className="tag jade">已下载</span>
                ) : (
                  <Button size="sm" busy={downloading.has(`下载 ${m.name}`)} onClick={() => void attempt(() => call('llm:download', m.id), '已加入下载')}>
                    下载
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {!prefs.adult && <p className="dim" style={{ marginBottom: 20 }}>还有几款不会拒答的模型，在「设置 → 内容」里确认年满 18 岁后列出。</p>}
      </Dialog>
    </Section>
  );
}
