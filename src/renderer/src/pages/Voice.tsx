import { ArrowSquareOut, DownloadSimple, FileArrowUp, FolderOpen, Lightning, Microphone, Pause, Play, Plus, SpeakerHigh, Stop, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLONE_LIMITS, CLONE_SCRIPTS, VOICE_BACKENDS, voiceBackendById, type VoiceBackend } from '@shared/catalog/voice';
import type { VoiceClone, VoiceView } from '@shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { call } from '../lib/api';
import { classes } from '../lib/format';
import { useBusy, useDataChanged, useEvent, useLoad } from '../lib/hooks';
import { isMac } from '../lib/platform';
import { attempt, confirm, setPrefs, toast, useStore } from '../lib/store';
import { Button, Check, Combo, Dialog, Empty, Field, IconButton, Note, PageHead, SecretInput, SettingRow, Slider, Switch, TextInput } from '../ui';

const SAMPLE = '门铃响了一声。她从柜台后面抬起头，笑着说：“今天来得真早，老位置给你留着呢。”';

export function VoicePage() {
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const { data: view, set, reload } = useLoad(() => call('voice:view'), [instance?.userDir]);
  useDataChanged(['settings'], reload);
  useEvent('voice:state', () => void reload());
  const { data: clones, set: setClones } = useLoad(() => call('voice:clones'));
  useEvent('voice:clones', setClones);

  if (!instance) {
    return (
      <>
        <PageHead title="配音">让角色开口说话。</PageHead>
        <Empty icon={SpeakerHigh} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          配音设置会写进酒馆自带的 TTS 扩展。
        </Empty>
      </>
    );
  }
  const backend = view?.backendId ? voiceBackendById(view.backendId) : undefined;
  const patch = async (p: Partial<VoiceView>) => void (await attempt(async () => set(await call('voice:set', p))));
  const select = async (b: VoiceBackend) => {
    if (b.id === view?.backendId) return;
    await attempt(async () => set(await call('voice:select', b.id)));
  };
  const voices = backend ? (backend.voices.length ? backend.voices : (view?.voices ?? []).map((v) => ({ id: v, label: v }))) : [];
  // 本机语音还能用克隆声线，排在最前面
  const all = backend?.id === 'local' ? [...(clones ?? []).map((c) => ({ id: c.voice, label: c.voice, group: '克隆声线' })), ...voices] : voices;

  return (
    <>
      <PageHead
        title="配音"
        actions={
          view &&
          backend && (
            <label className="row">
              <span className="muted">在酒馆里朗读</span>
              <Switch label="在酒馆里朗读" checked={view.enabled} onChange={(v) => void patch({ enabled: v })} />
            </label>
          )
        }
      >
        选一个声音来源，给角色分配音色，聊天时自动念出来。
      </PageHead>
      <div className="studio">
        <div className="studio-left">
          <div className="backends">
            {VOICE_BACKENDS.map((b) => (
              <button key={b.id} type="button" className="backend" aria-pressed={b.id === backend?.id} onClick={() => void select(b)}>
                {b.logo ? <BrandIcon name={b.logo} size={20} /> : <SpeakerHigh size={20} weight="light" />}
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <span className="backend-name truncate">{b.name}</span>
                    {view?.hasKey[b.id] && <span className="lamp ok" title="已有密钥" />}
                  </div>
                  <div className="backend-note truncate">{b.headline}</div>
                </div>
                <span className="backend-price">{b.price}</span>
              </button>
            ))}
          </div>
          {view && backend && (
            <>
              <section className="studio-block">
                <div className="row" style={{ marginBottom: 4 }}>
                  <h2 className="block-title grow">{backend.name}</h2>
                  {!backend.phone && <span className="tag gold">手机上不能用</span>}
                </div>
                <p className="muted" style={{ marginBottom: 16 }}>
                  {backend.detail}
                </p>
                {backend.id === 'local' ? <LocalPanel /> : backend.id === 'edge' ? <EdgePanel view={view} /> : <RemotePanel backend={backend} view={view} patch={patch} reload={reload} />}
              </section>
              {backend.id === 'local' && <Clones />}
              <Cast view={view} voices={all} patch={patch} />
              <Reading view={view} patch={patch} />
            </>
          )}
        </div>
        <div className="studio-right">
          <Listen view={view} backend={backend} voices={all} />
        </div>
      </div>
    </>
  );
}

function LocalPanel() {
  const { data: engine, set } = useLoad(() => call('voice:engine'));
  const tasks = useStore((s) => s.tasks);
  const prefs = useStore((s) => s.prefs)!;
  const [busy, run] = useBusy();
  useEvent('voice:state', set);
  if (!engine) return null;
  const installing = Object.values(tasks).some((t) => t.kind === 'voice-install' && t.state === 'running');
  return (
    <>
      <ol className="ladder">
        <li data-done={engine.installed || undefined}>
          <div className="grow">
            <div className="ladder-title">引擎与模型</div>
            <div className="dim">{engine.installed ? `sherpa-onnx ${engine.version ?? ''}，Kokoro 中英模型` : '下载约 370 MB，装好占 450 MB'}</div>
          </div>
          <Button size="sm" variant={engine.installed ? 'ghost' : 'primary'} icon={DownloadSimple} busy={installing} onClick={() => void attempt(() => call('voice:install'))}>
            {engine.installed ? '重装' : '安装'}
          </Button>
        </li>
        <li data-done={engine.running || undefined}>
          <div className="grow">
            <div className="ladder-title">{engine.running ? '运行中' : engine.starting ? '正在启动' : '启动'}</div>
            <div className="dim num">{engine.running ? `端口 ${engine.port}，只监听本机` : (engine.lastError ?? '试听时会自动启动')}</div>
          </div>
          {engine.running ? (
            <Button size="sm" icon={Stop} onClick={() => void attempt(async () => set(await call('voice:stop')))}>
              停止
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={Play} busy={busy || engine.starting} disabled={!engine.installed} onClick={() => void run(() => attempt(async () => set(await call('voice:start'))))}>
              启动
            </Button>
          )}
        </li>
      </ol>
      <div className="ladder-foot">
        <SettingRow title="酒馆开门时一起启动" note="只占内存，不占显存。">
          <Switch label="酒馆开门时一起启动语音" checked={prefs.voice.autoStart} onChange={(v) => void setPrefs({ voice: { ...prefs.voice, autoStart: v } })} />
        </SettingRow>
      </div>
    </>
  );
}

function EdgePanel({ view }: { view: VoiceView }) {
  const tasks = useStore((s) => s.tasks);
  const installing = Object.values(tasks).some((t) => t.kind === 'voice-edge' && t.state === 'running');
  return (
    <ol className="ladder">
      <li data-done={view.edgeInstalled || undefined}>
        <div className="grow">
          <div className="ladder-title">服务端插件</div>
          <div className="dim">{view.edgeInstalled ? '已装好。音色在下面分配，在酒馆里试听' : '会打开酒馆的服务端插件开关，酒馆在运行的话会重启一次'}</div>
        </div>
        <Button size="sm" variant={view.edgeInstalled ? 'ghost' : 'primary'} icon={DownloadSimple} busy={installing} onClick={() => void attempt(() => call('voice:installEdge'))}>
          {view.edgeInstalled ? '重装' : '安装'}
        </Button>
      </li>
    </ol>
  );
}

function RemotePanel({ backend, view, patch, reload }: { backend: VoiceBackend; view: VoiceView; patch: (p: Partial<VoiceView>) => Promise<void>; reload: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(view.endpoint);
  const [model, setModel] = useState(view.model);
  const [list, setList] = useState(view.voices.join(', '));
  const [busy, run] = useBusy();
  useEffect(() => setUrl(view.endpoint), [view.endpoint]);
  useEffect(() => setModel(view.model), [view.model]);
  useEffect(() => setList(view.voices.join(', ')), [view.voices]);
  useEffect(() => {
    if (model === view.model || backend.provider === 'GPT-SoVITS-V2 (Unofficial)') return;
    const t = setTimeout(() => void patch({ model }), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  const custom = backend.id === 'custom' || backend.id === 'sovits';
  const has = view.hasKey[backend.id];

  return (
    <div className="fields">
      {custom && (
        <Field label="地址" help={backend.id === 'custom' ? '填完整地址，到 /v1/audio/speech 为止。' : undefined}>
          <TextInput mono aria-label="地址" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url !== view.endpoint && void patch({ endpoint: url })} />
        </Field>
      )}
      {backend.secretKey && (
        <Field
          label={backend.id === 'custom' ? '密钥（可不填）' : '密钥'}
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
              <SecretInput label="密钥" value={key} onChange={setKey} placeholder={has ? '已保存，粘贴新密钥可替换' : '粘贴密钥'} />
            </div>
            <Button
              busy={busy}
              disabled={!key}
              onClick={() =>
                void run(async () => {
                  if (!(await attempt(() => call('voice:saveKey', backend.id, key), '密钥已保存'))) return;
                  setKey('');
                  await reload();
                })
              }
            >
              保存
            </Button>
          </div>
        </Field>
      )}
      {(backend.models || backend.id === 'custom') && (
        <Field label="模型">
          <Combo label="模型" value={model} onChange={setModel} options={(backend.models ?? []).map((value) => ({ value }))} placeholder="模型名称" />
        </Field>
      )}
      {backend.id === 'custom' && (
        <Field label="音色" help="服务支持的音色名，用逗号隔开。">
          <TextInput mono aria-label="音色" value={list} onChange={(e) => setList(e.target.value)} onBlur={() => void patch({ voices: list.split(/[,，]/) })} />
        </Field>
      )}
      {!backend.direct && <p className="dim">海外服务，大陆网络通常需要代理。</p>}
    </div>
  );
}

/** 念克隆声线的 GPT-SoVITS：安装或绑定，启停 */
function GsvEngine() {
  const { data: gsv, set } = useLoad(() => call('gsv:status'));
  useEvent('gsv:state', set);
  const installing = useStore((s) => Object.values(s.tasks).some((t) => t.kind === 'gsv-install' && t.state === 'running'));
  const [busy, run] = useBusy();
  if (!gsv) return null;
  const install = async () => {
    const ok = await confirm({
      title: '下载 GPT-SoVITS v5',
      body: '官方 Windows 整合包约 10.9 GB，解压后约 18 GB，自带 Python 和显卡加速组件。走国内线路，几条连接同时下，断了能接着下。',
      confirm: '开始下载',
    });
    if (ok) await attempt(() => call('gsv:install'));
  };
  const bind = async () => {
    const dir = await call('app:pickDirectory', { title: '选择 GPT-SoVITS 整合包目录' });
    if (dir) await attempt(async () => set(await call('gsv:bind', dir)), '已绑定');
  };
  const note = gsv.running
    ? `端口 ${gsv.port}，只监听本机，约占 3.5 GB 显存`
    : (gsv.lastError ?? (gsv.nvidia ? '本机语音启动时会一起启动，加载要二三十秒' : '没有检测到 N 卡，只能用 CPU，会很慢'));
  return (
    <ol className="ladder" style={{ marginTop: 12 }}>
      <li data-done={gsv.dir || undefined}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ladder-title">GPT-SoVITS v5</div>
          <div className="dim truncate selectable">{gsv.dir ?? (isMac ? '克隆声线由它来念。官方整合包只有 Windows 版，Mac 上暂时用不了' : '克隆声线由它来念。整合包约 10.9 GB，装好占 18 GB')}</div>
        </div>
        {gsv.dir ? (
          <Button size="sm" variant="ghost" onClick={() => void attempt(async () => set(await call('gsv:bind', null)))}>
            解绑
          </Button>
        ) : isMac ? null : (
          <>
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void bind()}>
              绑定已有
            </Button>
            <Button size="sm" variant="primary" icon={DownloadSimple} busy={installing} onClick={() => void install()}>
              安装
            </Button>
          </>
        )}
      </li>
      <li data-done={gsv.running || undefined}>
        <div className="grow">
          <div className="ladder-title">{gsv.running ? '运行中' : gsv.starting ? '正在启动' : '启动'}</div>
          <div className="dim num">{note}</div>
        </div>
        {gsv.running ? (
          <Button size="sm" icon={Stop} onClick={() => void attempt(async () => set(await call('gsv:stop')))}>
            停止
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon={Play} busy={busy || gsv.starting} disabled={!gsv.dir} onClick={() => void run(() => attempt(async () => set(await call('gsv:start'))))}>
            启动
          </Button>
        )}
      </li>
    </ol>
  );
}

/** 克隆声线：录一段或导入一段几秒钟的声音，写下原文。 */
function Clones() {
  const { data: list, set } = useLoad(() => call('voice:clones'));
  useEvent('voice:clones', set);
  const [adding, setAdding] = useState(false);
  const [hearing, setHearing] = useState<{ id: string; url: string } | null>(null);
  const hear = async (id: string) => {
    if (hearing?.id === id) return setHearing(null);
    await attempt(async () => setHearing({ id, url: await call('voice:cloneAudio', id) }));
  };
  const remove = async (id: string, name: string) => {
    if (await confirm({ title: `删除声线「${name}」`, body: '录音一起删掉，已经分配给角色的要重新选音色。', confirm: '删除', danger: true })) {
      await attempt(async () => set(await call('voice:removeClone', id)), '已删除');
    }
  };

  return (
    <section className="studio-block">
      <div className="row">
        <h2 className="block-title grow">克隆声线</h2>
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
          添加声线
        </Button>
      </div>
      <p className="muted" style={{ marginTop: 6 }}>
        录一段五秒左右的声音，写下原文，就能用这个声音给角色配音，由本机的 GPT-SoVITS v5 来念。只克隆你自己的声音，或已经得到本人同意的声音。
      </p>
      <GsvEngine />
      {list && list.length > 0 && (
        <div className="table" style={{ marginTop: 12 }}>
          {list.map((c) => (
            <div key={c.id} className="table-row">
              <IconButton icon={hearing?.id === c.id ? Stop : Play} size="sm" label={hearing?.id === c.id ? '停止' : '听原声'} onClick={() => void hear(c.id)} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 540 }}>{c.name}</span>
                  <span className="dim num">{c.seconds} 秒</span>
                </div>
                <div className="dim truncate">{c.text}</div>
              </div>
              <IconButton icon={Trash} size="sm" label="删除" onClick={() => void remove(c.id, c.name)} />
            </div>
          ))}
        </div>
      )}
      {hearing && <audio key={hearing.url.length} src={hearing.url} autoPlay onEnded={() => setHearing(null)} />}
      <AddClone open={adding} onClose={() => setAdding(false)} onSaved={(next) => set(next)} />
    </section>
  );
}

/** 解码任意浏览器能放的音频，混成单声道，编成 16 位 WAV 的 base64 */
async function toWav(bytes: ArrayBuffer): Promise<{ base64: string; seconds: number; url: string }> {
  const ctx = new AudioContext();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(bytes);
  } finally {
    void ctx.close();
  }
  const n = audio.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i]! / audio.numberOfChannels;
  }
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (o: number, s: string) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  out.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, audio.sampleRate, true);
  out.setUint32(28, audio.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, mono[i]!)) * 32767), true);
  const blob = new Blob([out.buffer], { type: 'audio/wav' });
  const base64 = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return { base64, seconds: n / audio.sampleRate, url: URL.createObjectURL(blob) };
}

function AddClone({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (list: VoiceClone[]) => void }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [clip, setClip] = useState<{ base64: string; seconds: number; url: string } | null>(null);
  const [recording, setRecording] = useState<{ stop: () => void; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState(CLONE_SCRIPTS[0]!);
  const [busy, run] = useBusy();

  useEffect(() => {
    if (!open) return;
    setName('');
    setText('');
    setConsent(false);
    setClip(null);
    setScript(CLONE_SCRIPTS[Math.floor(Math.random() * CLONE_SCRIPTS.length)]!);
  }, [open]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const s = (Date.now() - recording.started) / 1000;
      setElapsed(s);
      if (s >= CLONE_LIMITS.maxSeconds) recording.stop();
    }, 100);
    return () => clearInterval(t);
  }, [recording]);

  const record = async () => {
    if (recording) return recording.stop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return toast('打不开麦克风，检查一下系统的麦克风权限', 'bad');
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(null);
      try {
        setClip(await toWav(await new Blob(chunks).arrayBuffer()));
        if (!text.trim()) setText(script);
      } catch {
        toast('录音解码失败，再录一次', 'bad');
      }
    };
    rec.start();
    setElapsed(0);
    setRecording({ stop: () => rec.state !== 'inactive' && rec.stop(), started: Date.now() });
  };
  const pick = async () => {
    const [file] = await call('app:pickFiles', { title: '选一段录音', filters: [{ name: '音频', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'webm'] }] });
    if (!file) return;
    await attempt(async () => {
      const base64 = await call('voice:readAudioFile', file);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      setClip(await toWav(bytes.buffer));
    });
  };
  const save = () =>
    run(() =>
      attempt(async () => {
        onSaved(await call('voice:addClone', { name, text, wavBase64: clip!.base64, consent }));
        onClose();
      }, '声线已添加'),
    );

  const length = clip?.seconds ?? 0;
  const hint = !clip ? null : length < CLONE_LIMITS.minSeconds ? '太短了，再长一点' : length > CLONE_LIMITS.maxSeconds ? '太长了，剪成一句话' : length > CLONE_LIMITS.bestSeconds[1] + 2 ? '偏长，五秒左右效果最好' : null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        recording?.stop();
        onClose();
      }}
      title="添加克隆声线"
      description="录音要安静、清楚，一句完整的话，三到十秒，五秒左右最好。"
      footer={
        <>
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" busy={busy} disabled={!clip || !name.trim() || !text.trim() || !consent || Boolean(recording)} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="fields">
        <Field label="名字" help="在音色列表里显示为「克隆·名字」。">
          <TextInput aria-label="声线名字" value={name} maxLength={CLONE_LIMITS.maxName} onChange={(e) => setName(e.target.value)} placeholder="比如：我的声音" />
        </Field>
        <Field label="录音" help={recording ? undefined : `可以照着念：「${script}」`}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button icon={recording ? Stop : Microphone} variant={recording ? 'danger' : 'secondary'} onClick={() => void record()}>
              {recording ? `停止 ${elapsed.toFixed(1)} 秒` : '录一段'}
            </Button>
            <Button icon={FileArrowUp} disabled={Boolean(recording)} onClick={() => void pick()}>
              选文件
            </Button>
            {clip && <audio controls src={clip.url} style={{ height: 32 }} />}
            {clip && <span className="dim num">{length.toFixed(1)} 秒</span>}
          </div>
          {hint && <div className="dim" style={{ marginTop: 6, color: 'var(--amber)' }}>{hint}</div>}
        </Field>
        <Field label="录音里说的话" help="一字不差，标点照常写。原文和录音对不上，克隆出来会走调。">
          <textarea className="textarea" rows={2} aria-label="录音原文" value={text} maxLength={CLONE_LIMITS.maxText} onChange={(e) => setText(e.target.value)} />
        </Field>
        <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <Check label="确认授权" checked={consent} onChange={setConsent} />
          <span>这是我自己的声音，或者我已经得到声音主人的同意。不用它冒充别人。</span>
        </label>
      </div>
    </Dialog>
  );
}

/** 给角色分配音色。 */
function Cast({ view, voices, patch }: { view: VoiceView; voices: { id: string; label: string; group?: string }[]; patch: (p: Partial<VoiceView>) => Promise<void> }) {
  const { data: cards } = useLoad(() => call('chars:list'));
  const [adding, setAdding] = useState('');
  const options = useMemo(() => voices.map((v) => ({ value: v.id, note: v.label !== v.id ? v.label : v.group })), [voices]);
  const names = useMemo(() => [...new Set((cards ?? []).map((c) => c.name))], [cards]);
  const rows = Object.entries(view.voiceMap);
  if (!voices.length) return null;
  const setOne = (who: string, voice: string) => void patch({ voiceMap: { ...view.voiceMap, [who]: voice } });
  const drop = (who: string) => {
    const { [who]: _, ...rest } = view.voiceMap;
    void patch({ voiceMap: rest });
  };

  return (
    <section className="studio-block">
      <h2 className="block-title">音色</h2>
      <div className="cast" style={{ marginTop: 14 }}>
        <div className="cast-row">
          <span className="cast-name">没指定的角色</span>
          <Combo label="默认音色" value={view.defaultVoice} onChange={(v) => void patch({ defaultVoice: v })} options={options} placeholder="选择音色" />
          <span style={{ width: 28 }} />
        </div>
        {rows.map(([who, voice]) => (
          <div key={who} className="cast-row">
            <span className="cast-name truncate">{who}</span>
            <Combo label={`${who} 的音色`} value={voice} onChange={(v) => setOne(who, v)} options={options} placeholder="选择音色" />
            <IconButton icon={X} size="sm" label="移除" onClick={() => drop(who)} />
          </div>
        ))}
        <div className="cast-row add">
          <Combo label="角色名" value={adding} onChange={setAdding} options={names.filter((n) => !(n in view.voiceMap)).map((value) => ({ value }))} placeholder="选一个角色" />
          <Button
            size="sm"
            icon={Plus}
            disabled={!adding.trim() || adding in view.voiceMap}
            onClick={() => {
              setOne(adding.trim(), view.defaultVoice || voices[0]!.id);
              setAdding('');
            }}
          >
            单独指定
          </Button>
        </div>
      </div>
    </section>
  );
}

function Reading({ view, patch }: { view: VoiceView; patch: (p: Partial<VoiceView>) => Promise<void> }) {
  const [rate, setRate] = useState(view.rate);
  useEffect(() => setRate(view.rate), [view.rate]);
  useEffect(() => {
    if (rate === view.rate) return;
    const t = setTimeout(() => void patch({ rate }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);
  return (
    <section className="studio-block">
      <h2 className="block-title">念什么</h2>
      <div style={{ marginTop: 8 }}>
        <SettingRow title="新消息自动念" note="关掉后，点消息上的小喇叭才念。">
          <Switch label="自动念" checked={view.autoGeneration} onChange={(v) => void patch({ autoGeneration: v })} />
        </SettingRow>
        <SettingRow title="只念引号里的对话" note="动作和旁白跳过。">
          <Switch label="只念对话" checked={view.quotedOnly} onChange={(v) => void patch({ quotedOnly: v })} />
        </SettingRow>
        <SettingRow title="跳过星号里的动作">
          <Switch label="跳过动作" checked={view.dialoguesOnly} onChange={(v) => void patch({ dialoguesOnly: v })} />
        </SettingRow>
        <SettingRow title="旁白和对话用不同音色" note="在酒馆里可以为一个角色的引号内外分别指定。">
          <Switch label="多音色" checked={view.multiVoice} onChange={(v) => void patch({ multiVoice: v })} />
        </SettingRow>
        <SettingRow title="跳过代码块和标签" note="状态栏一类的内容不念。">
          <Switch label="跳过代码" checked={view.skipCode && view.skipTags} onChange={(v) => void patch({ skipCode: v, skipTags: v })} />
        </SettingRow>
        <SettingRow title="自己的话也念">
          <Switch label="念自己的话" checked={view.narrateUser} onChange={(v) => void patch({ narrateUser: v })} />
        </SettingRow>
        <SettingRow title="播放速度">
          <div className="row" style={{ width: 220 }}>
            <Slider label="播放速度" value={rate} min={0.5} max={2} step={0.05} onChange={(v) => setRate(Math.round(v * 100) / 100)} />
            <span className="num" style={{ width: 44, textAlign: 'right' }}>
              {rate.toFixed(2)}
            </span>
          </div>
        </SettingRow>
      </div>
    </section>
  );
}

function Listen({ view, backend, voices }: { view?: VoiceView; backend?: VoiceBackend; voices: { id: string; label: string; group?: string }[] }) {
  const [text, setText] = useState(SAMPLE);
  const [voice, setVoice] = useState('');
  const [error, setError] = useState('');
  const [clip, setClip] = useState<{ url: string; ms: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [length, setLength] = useState(0);
  const [busy, run] = useBusy();
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => setVoice(view?.defaultVoice || voices[0]?.id || ''), [view?.defaultVoice, backend?.id]);

  const speak = () =>
    run(async () => {
      setError('');
      const r = await call('voice:test', text, voice).catch((e: Error) => ({ ok: false, message: e.message }) as Awaited<ReturnType<typeof call<'voice:test'>>>);
      if (!r.ok || !r.dataUrl) return setError(r.message);
      setClip({ url: r.dataUrl, ms: r.ms ?? 0 });
    });

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="listen">
      <div className={classes('listen-card', playing && 'on')}>
        <textarea className="listen-text serif" aria-label="试听文字" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
        <div className="listen-bar">
          <IconButton
            icon={playing ? Pause : Play}
            label={playing ? '暂停' : '播放'}
            disabled={!clip}
            onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}
          />
          <div className="listen-track">
            <i style={{ width: length ? `${(at / length) * 100}%` : 0 }} />
          </div>
          <span className="num dim">{length ? `${fmt(at)} / ${fmt(length)}` : '0:00'}</span>
        </div>
        {clip && (
          <audio
            ref={audio}
            key={clip.url.length + clip.ms}
            src={clip.url}
            autoPlay
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
          />
        )}
      </div>
      {voices.length > 0 && <Combo label="试听音色" value={voice} onChange={setVoice} options={voices.map((v) => ({ value: v.id, note: v.label !== v.id ? v.label : v.group }))} placeholder="选择音色" />}
      <div className="row">
        <Button variant="primary" icon={Lightning} busy={busy} disabled={!backend?.testable || !text.trim()} onClick={() => void speak()}>
          试听
        </Button>
        {clip && !busy && <span className="dim num">用时 {(clip.ms / 1000).toFixed(1)} 秒</span>}
        {backend && !backend.testable && <span className="dim">这个后端在酒馆的 TTS 面板里试听</span>}
      </div>
      {error && (
        <Note kind="bad">
          <WarningCircle size={14} /> {error}
        </Note>
      )}
    </div>
  );
}
