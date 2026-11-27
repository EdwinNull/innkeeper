import { ArrowsClockwise, FolderOpen, Monitor, Moon, Key, Sun } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ModelSource, Prefs, ReachResult } from '@shared/types';
import { Logo } from '../components/Logo';
import { call } from '../lib/api';
import { bytes, classes } from '../lib/format';
import { useBusy, useLoad } from '../lib/hooks';
import { attempt, confirm, setPrefs, toast, useStore } from '../lib/store';
import { Button, PageHead, Section, Segmented, Select, SettingRow, Switch, TextInput } from '../ui';

const REGISTRIES = [
  { value: 'https://registry.npmmirror.com', label: '淘宝镜像', note: '国内' },
  { value: 'https://mirrors.cloud.tencent.com/npm', label: '腾讯云', note: '国内' },
  { value: 'https://registry.npmjs.org', label: 'npm 官方', note: '海外' },
];
const MODEL_SOURCES: { value: ModelSource; label: string; note: string }[] = [
  { value: 'auto', label: '自动', note: '测速' },
  { value: 'modelscope', label: 'ModelScope', note: '国内' },
  { value: 'hf-mirror', label: 'hf-mirror', note: '国内' },
  { value: 'huggingface', label: 'Hugging Face', note: '海外' },
];

export function SettingsPage() {
  const prefs = useStore((s) => s.prefs)!;
  const openSetup = useStore((s) => s.openSetup);
  const { data: info } = useLoad(() => call('app:info'));
  const { data: tools, loading, reload } = useLoad(() => call('app:tools'), [prefs.nodeSource, prefs.workspace]);
  const save = (patch: Partial<Prefs>) => void attempt(() => setPrefs(patch));

  const setAdult = async (on: boolean) => {
    if (on) {
      const ok = await confirm({
        title: '确认年满 18 岁',
        body: '打开后会列出能写、能画成人内容的模型。只用于虚构的成年角色，不要用来描绘真实的人。你所在地区的法律和各平台的条款由你自己遵守。',
        confirm: '我已年满 18 岁',
      });
      if (!ok) return;
    }
    save({ adult: on });
  };

  const changeWorkspace = async () => {
    const dir = await call('app:pickDirectory', { title: '选择工作目录', defaultPath: prefs.workspace });
    if (!dir || dir === prefs.workspace) return;
    const ok = await confirm({
      title: '更换工作目录',
      body: '只改变之后安装和读取的位置，不会搬动已有文件。原目录里的酒馆与数据需要你自己移过去，或重新安装。',
      confirm: '更换',
    });
    if (!ok) return;
    await attempt(async () => {
      await setPrefs({ workspace: dir });
      await call('tavern:useManaged');
    }, '工作目录已更换');
  };

  return (
    <>
      <PageHead title="设置" />
      <Section title="外观">
        <SettingRow title="主题">
          <Segmented
            label="主题"
            value={prefs.theme}
            onChange={(theme) => save({ theme })}
            options={[
              { value: 'dark', label: '夜', icon: Moon },
              { value: 'light', label: '昼', icon: Sun },
              { value: 'system', label: '跟随系统', icon: Monitor },
            ]}
          />
        </SettingRow>
      </Section>

      <Section title="习惯">
        <SettingRow title="打开酒馆的方式">
          <Segmented
            label="打开方式"
            value={prefs.openIn}
            onChange={(openIn) => save({ openIn })}
            options={[
              { value: 'window', label: '独立窗口' },
              { value: 'browser', label: '系统浏览器' },
            ]}
          />
        </SettingRow>
        <SettingRow title="打开掌柜时启动酒馆">
          <Switch label="打开掌柜时启动酒馆" checked={prefs.launchTavernOnStart} onChange={(v) => save({ launchTavernOnStart: v })} />
        </SettingRow>
        <SettingRow title="关闭窗口时留在托盘" note="酒馆继续运行，点托盘图标回来。">
          <Switch label="留在托盘" checked={prefs.closeToTray} onChange={(v) => save({ closeToTray: v })} />
        </SettingRow>
      </Section>

      <Section title="内容">
        <SettingRow title="成人内容" note="列出对成人虚构内容友好的模型与服务，生图多一个分级选项。成人档固定排除未成年相关内容。">
          <Switch label="成人内容" checked={prefs.adult} onChange={(v) => void setAdult(v)} />
        </SettingRow>
      </Section>

      <Section title="下载线路" note="影响掌柜下载酒馆、插件与模型。">
        <SettingRow title="npm 镜像">
          <Select label="npm 镜像" value={prefs.npmRegistry} onChange={(v) => save({ npmRegistry: v })} options={REGISTRIES.some((r) => r.value === prefs.npmRegistry) ? REGISTRIES : [...REGISTRIES, { value: prefs.npmRegistry, label: prefs.npmRegistry }]} style={{ width: 200 }} />
        </SettingRow>
        <SettingRow title="GitHub" note="自动模式会给几条加速线路测速，挑最快的用。">
          <Segmented
            label="GitHub 线路"
            value={prefs.githubMirror}
            onChange={(githubMirror) => save({ githubMirror })}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'direct', label: '直连' },
              { value: 'custom', label: '自定义' },
            ]}
          />
        </SettingRow>
        {prefs.githubMirror === 'custom' && <CommitInput value={prefs.githubMirrorCustom} placeholder="https://ghfast.top/" label="加速前缀" onCommit={(v) => save({ githubMirrorCustom: v })} />}
        <SettingRow title="模型下载源" note="几个来源的文件逐字节相同，下完会核对校验值。">
          <Select label="模型下载源" value={prefs.modelSource} onChange={(v) => save({ modelSource: v as ModelSource })} options={MODEL_SOURCES} style={{ width: 200 }} />
        </SettingRow>
        <SettingRow title="代理" note="只影响掌柜自己。酒馆访问模型用的代理在「酒馆本体 → 服务器配置」里设。">
          <Segmented
            label="代理"
            value={prefs.proxyMode}
            onChange={(proxyMode) => save({ proxyMode })}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'none', label: '不用' },
              { value: 'custom', label: '自定义' },
            ]}
          />
        </SettingRow>
        {prefs.proxyMode === 'custom' && <CommitInput value={prefs.proxyUrl} placeholder="http://127.0.0.1:7890" label="代理地址" onCommit={(v) => save({ proxyUrl: v })} />}
      </Section>

      <Reach />

      <Section
        title="运行环境"
        actions={
          <Button size="sm" variant="ghost" icon={ArrowsClockwise} busy={loading} onClick={() => void reload()}>
            重新检测
          </Button>
        }
      >
        <SettingRow title="工作目录" note={<span className="mono selectable">{prefs.workspace}</span>}>
          <div className="row">
            <Button size="sm" icon={FolderOpen} onClick={() => void attempt(() => call('app:reveal', prefs.workspace))}>
              打开
            </Button>
            <Button size="sm" onClick={() => void changeWorkspace()}>
              更换
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          title="Node.js"
          note={tools ? (tools.node.version ? `${tools.node.version}，${tools.node.source === 'system' ? '系统自带' : '便携版'}` : '没有可用版本，安装酒馆时会自动下载') : '检测中'}
        >
          <Segmented
            label="Node 来源"
            value={prefs.nodeSource}
            onChange={(nodeSource) => save({ nodeSource })}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'system', label: '系统' },
              { value: 'portable', label: '便携版' },
            ]}
          />
        </SettingRow>
        <SettingRow title="Git" note={tools ? (tools.git.version ?? '没有安装，插件会用内置实现下载') : '检测中'}>
          <span />
        </SettingRow>
        <SettingRow title="显卡" note={tools ? (tools.gpu ? `${tools.gpu.name}${tools.gpu.vramBytes ? `，${bytes(tools.gpu.vramBytes)} 显存` : ''}` : '未检测到') : '检测中'}>
          <span />
        </SettingRow>
      </Section>

      <section className="about">
        <Logo size={40} />
        <div className="grow">
          <div className="serif" style={{ fontSize: 17, fontWeight: 600 }}>
            掌柜
          </div>
          <div className="dim num">
            版本 {info?.version}　Electron {info?.electron}
          </div>
          <div className="dim">SillyTavern 由其社区开发，采用 AGPL-3.0 许可。掌柜是独立的管理工具，与官方无隶属关系。</div>
        </div>
        <Button icon={Key} onClick={() => openSetup(true)}>
          重新走一遍一键配置
        </Button>
      </section>
    </>
  );
}

function CommitInput({ value, placeholder, label, onCommit }: { value: string; placeholder: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim();
    if (v === value) return;
    if (v && !/^(https?|socks[45]?):\/\//i.test(v)) return toast('地址要以 http:// 或 socks5:// 开头', 'bad');
    onCommit(v);
  };
  return (
    <div className="setting-inset">
      <TextInput mono aria-label={label} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} style={{ maxWidth: 360 }} />
    </div>
  );
}

const GROUPS: { id: ReachResult['group']; title: string }[] = [
  { id: 'infra', title: '下载' },
  { id: 'model', title: '模型' },
  { id: 'image', title: '生图' },
];

function Reach() {
  const [data, setData] = useState<ReachResult[] | null>(null);
  const [busy, run] = useBusy();
  const test = () => run(() => attempt(async () => setData(await call('app:reach'))));
  return (
    <Section
      title="网络体检"
      note="看看哪些服务从这台电脑能连上。不会带上你的密钥。"
      actions={
        <Button size="sm" busy={busy} onClick={() => void test()}>
          {data ? '再测一次' : '开始检测'}
        </Button>
      }
    >
      {data && (
        <div className="reach">
          {GROUPS.map((g) => (
            <div key={g.id}>
              <h4>{g.title}</h4>
              {data
                .filter((r) => r.group === g.id)
                .map((r) => (
                  <div key={r.id} className="reach-row" title={r.note || r.url}>
                    <span className={classes('lamp', r.ok ? 'ok' : 'bad')} />
                    <span className="grow truncate">{r.label}</span>
                    <span className="num dim">{r.ms !== null ? `${r.ms} ms` : '不通'}</span>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
