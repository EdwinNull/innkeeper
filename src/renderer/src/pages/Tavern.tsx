import {
  ArrowsClockwise, Code, Cube, DownloadSimple, FolderOpen, GitBranch, Key, Swap, Trash, Wrench,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLine, TavernConfigView, TavernVersion } from '@shared/types';
import { call } from '../lib/api';
import { bytes, classes, clock, date } from '../lib/format';
import { useBusy, useDataChanged, useLoad } from '../lib/hooks';
import { attempt, confirm, toast, useStore } from '../lib/store';
import { Button, Empty, IconButton, Note, NumberInput, PageHead, SearchInput, Section, SecretInput, Segmented, SettingRow, Slider, Switch, Tabs, TextInput } from '../ui';

type Tab = 'versions' | 'config' | 'logs';

export function TavernPage() {
  const takeIntent = useStore((s) => s.takeIntent);
  const [tab, setTab] = useState<Tab>('versions');
  useEffect(() => {
    const intent = takeIntent();
    if (intent === 'logs' || intent === 'config') setTab(intent);
  }, [takeIntent]);

  return (
    <>
      <PageHead title="酒馆本体">SillyTavern 的安装、版本、服务器配置与运行日志。</PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'versions', label: '安装与版本' },
          { value: 'config', label: '服务器配置' },
          { value: 'logs', label: '运行日志' },
        ]}
      />
      {tab === 'versions' && <Versions />}
      {tab === 'config' && <Config />}
      {tab === 'logs' && <Logs />}
    </>
  );
}

function Versions() {
  const tavern = useStore((s) => s.tavern);
  const prefs = useStore((s) => s.prefs)!;
  const tasks = useStore((s) => s.tasks);
  const openSetup = useStore((s) => s.openSetup);
  const installing = Object.values(tasks).some((t) => t.kind.startsWith('tavern-') && t.state === 'running');
  const { data, loading, reload } = useLoad(() => call('tavern:versions'), [prefs.activeVersion, installing, prefs.workspace]);
  const [busy, run] = useBusy();
  const instance = tavern?.instance;

  const install = (version: string | null) => attempt(() => call('tavern:install', version));

  const adopt = async () => {
    const dir = await call('app:pickDirectory', { title: '选择已有的 SillyTavern 目录' });
    if (dir) await attempt(() => call('tavern:adopt', dir), '已接管这个酒馆');
  };

  const activate = async (v: TavernVersion) => {
    const ok = await confirm({
      title: `切换到 ${v.version}`,
      body: '数据不会动，酒馆会先停止。降级到更旧的版本时，建议先做一次备份。',
      confirm: '切换',
    });
    if (ok) await run(() => attempt(() => call('tavern:activate', v.version), `已切换到 ${v.version}`));
    await reload();
  };

  const remove = async (v: TavernVersion) => {
    const ok = await confirm({ title: `删除 ${v.version} 的程序文件`, body: '只删除这个版本的程序，角色、聊天和设置都保留。', confirm: '删除', danger: true });
    if (ok) await attempt(() => call('tavern:removeVersion', v.version));
    await reload();
  };

  return (
    <>
      {instance ? (
        <div className="instance">
          <div className="instance-version serif num">{instance.version}</div>
          <div className="grow">
            <dl className="facts">
              <dt>管理方式</dt>
              <dd>{instance.kind === 'managed' ? '由掌柜托管，程序与数据分开存放，可随时换版本' : '接管已有目录，掌柜只读写它的配置与数据'}</dd>
              <dt>程序</dt>
              <dd className="mono truncate selectable">{instance.root}</dd>
              <dt>数据</dt>
              <dd className="mono truncate selectable">{instance.userDir}</dd>
              {instance.git && (
                <>
                  <dt>分支</dt>
                  <dd className="mono">
                    {instance.git.branch} @ {instance.git.commit.slice(0, 7)}
                  </dd>
                </>
              )}
            </dl>
            <div className="row wrap" style={{ marginTop: 18 }}>
              <Button size="sm" icon={FolderOpen} onClick={() => void attempt(() => call('app:reveal', instance.userDir))}>
                打开数据目录
              </Button>
              <Button size="sm" icon={Wrench} disabled={installing} onClick={() => void attempt(() => call('tavern:repair'))}>
                修复依赖
              </Button>
              {instance.kind === 'adopted' && instance.git && (
                <Button size="sm" icon={GitBranch} disabled={installing} onClick={() => void attempt(() => call('tavern:updateAdopted'))}>
                  用 git 更新
                </Button>
              )}
              {instance.kind === 'adopted' ? (
                <Button size="sm" icon={Swap} onClick={() => void attempt(() => call('tavern:useManaged'), '已切回托管模式')}>
                  改为掌柜托管
                </Button>
              ) : (
                <Button size="sm" icon={Swap} onClick={() => void adopt()}>
                  接管已有酒馆
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Empty
          icon={Cube}
          title="还没有安装酒馆"
          actions={
            <>
              <Button variant="primary" icon={Key} onClick={() => openSetup(true)}>
                一键配置
              </Button>
              <Button icon={DownloadSimple} disabled={installing} onClick={() => void install(null)}>
                只装本体
              </Button>
              <Button variant="ghost" onClick={() => void adopt()}>
                我已经装过
              </Button>
            </>
          }
        >
          一键配置会连同模型、插件和角色一起装好。已经有酒馆的话，直接接管原目录即可。
        </Empty>
      )}

      <Section
        title="可用版本"
        note="从 npm 镜像下载，依赖随装随用。多个版本可以并存，切换即生效。"
        actions={
          <Button size="sm" variant="ghost" icon={ArrowsClockwise} busy={loading} onClick={() => void reload()}>
            刷新
          </Button>
        }
      >
        {data && data.length === 0 && <Note kind="warn">读不到版本列表。检查网络，或在设置里换一个 npm 镜像。</Note>}
        <div className="table">
          {data?.map((v) => (
            <div key={v.version} className={classes('table-row', v.active && instance?.kind === 'managed' && 'active')}>
              <span className="num" style={{ width: 84, fontWeight: 560 }}>
                {v.version}
              </span>
              <span className="row" style={{ width: 160 }}>
                {v.latest && <span className="tag amber">最新</span>}
                {v.active && instance?.kind === 'managed' && <span className="tag jade">使用中</span>}
                {v.installed && !(v.active && instance?.kind === 'managed') && <span className="tag">已安装</span>}
              </span>
              <span className="dim grow num">{v.publishedAt && date(v.publishedAt)}</span>
              <span className="dim num" style={{ width: 80, textAlign: 'right' }}>
                {bytes(v.sizeBytes)}
              </span>
              <span className="row" style={{ width: 168, justifyContent: 'flex-end' }}>
                {v.installed ? (
                  <>
                    {!(v.active && instance?.kind === 'managed') && (
                      <>
                        <Button size="sm" busy={busy} onClick={() => void activate(v)}>
                          切换
                        </Button>
                        <IconButton size="sm" icon={Trash} label="删除程序文件" onClick={() => void remove(v)} />
                      </>
                    )}
                    {v.active && instance?.kind === 'managed' && (
                      <Button size="sm" variant="ghost" disabled={installing} onClick={() => void install(v.version)}>
                        重装
                      </Button>
                    )}
                  </>
                ) : (
                  <Button size="sm" variant={v.latest ? 'primary' : 'secondary'} icon={DownloadSimple} disabled={installing} onClick={() => void install(v.version)}>
                    {v.latest && instance ? '更新' : '安装'}
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function Config() {
  const instance = useStore((s) => s.tavern?.instance);
  const running = useStore((s) => s.tavern?.phase === 'running');
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const { data, error, reload } = useLoad(() => call('tavern:config'), [instance?.configPath, mode]);
  const [draft, setDraft] = useState<Partial<TavernConfigView>>({});
  const [busy, run] = useBusy();
  useDataChanged(['settings'], reload);

  if (!instance) return <Empty icon={Cube} title="还没有安装酒馆">安装后才有配置可改。</Empty>;
  if (error && mode === 'form') {
    return (
      <Section title="配置读取失败">
        <Note kind="bad">{error.message}</Note>
        <div className="row">
          <Button icon={Code} onClick={() => setMode('yaml')}>
            直接编辑 YAML
          </Button>
        </div>
      </Section>
    );
  }
  const view = data ? { ...data, ...draft } : null;
  const changed = view && data ? (Object.keys(draft) as (keyof TavernConfigView)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(data[k])) : [];
  const set = <K extends keyof TavernConfigView>(key: K, value: TavernConfigView[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = (restart: boolean) =>
    run(() =>
      attempt(async () => {
        const patch = Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<TavernConfigView>;
        await call('tavern:setConfig', patch);
        setDraft({});
        await reload();
        if (restart) await call('tavern:restart');
      }, restart ? '已保存并重启' : '已保存，重启酒馆后生效'),
    );

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', margin: '22px 0 -8px' }}>
        <Segmented
          label="编辑方式"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'form', label: '表单' },
            { value: 'yaml', label: 'YAML', icon: Code },
          ]}
        />
        <span className="dim mono truncate selectable">{instance.configPath}</span>
      </div>
      {mode === 'yaml' ? (
        <YamlEditor running={running} />
      ) : (
        view && (
          <>
            <Section title="访问">
              <SettingRow title="端口" note="默认 8000。被占用时掌柜会临时顺延到下一个可用端口。">
                <NumberInput label="端口" value={view.port} min={1} max={65535} onChange={(v) => set('port', v)} style={{ width: 110 }} />
              </SettingRow>
              <SettingRow title="允许局域网访问" note="让手机、平板通过这台电脑的 IP 打开酒馆。开启后至少要启用一种下面的防护。">
                <Switch label="允许局域网访问" checked={view.listen} onChange={(v) => set('listen', v)} />
              </SettingRow>
              <SettingRow title="IP 白名单" note={
                  <>
                    只有名单里的地址能访问。支持 <span className="mono">192.168.1.0/24</span> 或 <span className="mono">192.168.1.*</span> 写法。
                  </>
                }>
                <Switch label="IP 白名单" checked={view.whitelistMode} onChange={(v) => set('whitelistMode', v)} />
              </SettingRow>
              {view.whitelistMode && <Whitelist value={view.whitelist} onChange={(v) => set('whitelist', v)} />}
              <SettingRow title="访问密码" note="浏览器打开时要求输入用户名和密码。掌柜自带的窗口会自动填写。">
                <Switch label="访问密码" checked={view.basicAuthMode} onChange={(v) => set('basicAuthMode', v)} />
              </SettingRow>
              {view.basicAuthMode && (
                <div className="setting-inset grid-2">
                  <TextInput aria-label="用户名" placeholder="用户名" value={view.basicAuthUser} onChange={(e) => set('basicAuthUser', e.target.value)} />
                  <SecretInput label="密码" placeholder="密码" value={view.basicAuthPassword} onChange={(v) => set('basicAuthPassword', v)} />
                </div>
              )}
              <SettingRow title="多用户" note="每个人独立的角色、聊天和设置，需要登录。">
                <Switch label="多用户" checked={view.enableUserAccounts} onChange={(v) => set('enableUserAccounts', v)} />
              </SettingRow>
              {view.enableUserAccounts && (
                <SettingRow title="隐藏登录页用户列表" note="访客需要手动输入用户名。">
                  <Switch label="隐藏登录页用户列表" checked={view.enableDiscreetLogin} onChange={(v) => set('enableDiscreetLogin', v)} />
                </SettingRow>
              )}
            </Section>

            <Section title="代理" note="酒馆访问海外模型时走的代理。与掌柜自身下载用的代理互不影响。">
              <SettingRow title="启用代理" note="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891">
                <Switch label="启用代理" checked={view.proxyEnabled} onChange={(v) => set('proxyEnabled', v)} />
              </SettingRow>
              {view.proxyEnabled && (
                <div className="setting-inset">
                  <TextInput mono aria-label="代理地址" placeholder="http://127.0.0.1:7890" value={view.proxyUrl} onChange={(e) => set('proxyUrl', e.target.value)} />
                </div>
              )}
            </Section>

            <Section title="Claude 提示词缓存" note="只在提示词前段稳定不变时省钱。用了随机宏或会变动的世界书，反而更贵。">
              <SettingRow title="缓存系统提示词">
                <Switch label="缓存系统提示词" checked={view.claudeSystemCache} onChange={(v) => set('claudeSystemCache', v)} />
              </SettingRow>
              <SettingRow title="缓存聊天历史" note="从倒数第几条开始缓存，0 适合多数情况，-1 为关闭。">
                <NumberInput label="缓存深度" value={view.claudeCachingAtDepth} min={-1} max={100} onChange={(v) => set('claudeCachingAtDepth', Math.round(v))} style={{ width: 90 }} />
              </SettingRow>
              <SettingRow title="缓存保留一小时" note="写入价格从 1.25 倍升到 2 倍，聊得慢时更划算。">
                <Switch label="缓存保留一小时" checked={view.claudeExtendedTTL} onChange={(v) => set('claudeExtendedTTL', v)} />
              </SettingRow>
              <SettingRow title="自适应思考" note="Opus 4.6 及以上由模型自行决定思考长度。">
                <Switch label="自适应思考" checked={view.claudeAdaptiveThinking} onChange={(v) => set('claudeAdaptiveThinking', v)} />
              </SettingRow>
            </Section>

            <Section title="性能与备份">
              <SettingRow title="延迟加载角色" note="角色多时明显加快打开速度，个别旧插件不兼容。">
                <Switch label="延迟加载角色" checked={view.lazyLoadCharacters} onChange={(v) => set('lazyLoadCharacters', v)} />
              </SettingRow>
              <SettingRow title="角色磁盘缓存">
                <Switch label="角色磁盘缓存" checked={view.useDiskCache} onChange={(v) => set('useDiskCache', v)} />
              </SettingRow>
              <SettingRow title="缩略图质量">
                <div className="row" style={{ width: 220 }}>
                  <Slider label="缩略图质量" value={view.thumbnailsQuality} min={50} max={100} step={1} onChange={(v) => set('thumbnailsQuality', v)} />
                  <span className="num dim" style={{ width: 32, textAlign: 'right' }}>
                    {view.thumbnailsQuality}
                  </span>
                </div>
              </SettingRow>
              <SettingRow title="自动备份聊天" note="酒馆自带的滚动备份，存在数据目录的 backups 里。">
                <Switch label="自动备份聊天" checked={view.chatBackups} onChange={(v) => set('chatBackups', v)} />
              </SettingRow>
              {view.chatBackups && (
                <SettingRow title="每个聊天保留份数">
                  <NumberInput label="保留份数" value={view.numberOfBackups} min={1} max={500} onChange={(v) => set('numberOfBackups', Math.round(v))} style={{ width: 90 }} />
                </SettingRow>
              )}
            </Section>

            <Section title="高级">
              <SettingRow title="启动时更新插件" note="会访问 GitHub，网络不好时拖慢启动，建议关闭后在插件页手动更新。">
                <Switch label="启动时更新插件" checked={view.extensionsAutoUpdate} onChange={(v) => set('extensionsAutoUpdate', v)} />
              </SettingRow>
              <SettingRow title="服务端插件" note="允许加载 plugins 目录里的代码，它们拥有完整的系统权限。">
                <Switch label="服务端插件" checked={view.enableServerPlugins} onChange={(v) => set('enableServerPlugins', v)} />
              </SettingRow>
              <SettingRow title="CORS 代理" note="少数插件抓取网页时需要。">
                <Switch label="CORS 代理" checked={view.enableCorsProxy} onChange={(v) => set('enableCorsProxy', v)} />
              </SettingRow>
              <SettingRow title="允许查看已存密钥" note="开启后酒馆界面能读出密钥明文，插件也能。不需要就别开。">
                <Switch label="允许查看已存密钥" checked={view.allowKeysExposure} onChange={(v) => set('allowKeysExposure', v)} />
              </SettingRow>
            </Section>
          </>
        )
      )}
      {changed.length > 0 && mode === 'form' && (
        <div className="savebar">
          <span className="grow num">{changed.length} 项修改未保存</span>
          <Button variant="ghost" onClick={() => setDraft({})}>
            放弃
          </Button>
          <Button variant={running ? 'secondary' : 'primary'} busy={busy} onClick={() => void save(false)}>
            保存
          </Button>
          {running && (
            <Button variant="primary" busy={busy} onClick={() => void save(true)}>
              保存并重启
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function Whitelist({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = (ip: string) => {
    const v = ip.trim();
    if (!v) return;
    if (!/^[0-9a-fA-F:.*/]+$/.test(v)) return toast('不是有效的 IP 或网段', 'bad');
    if (!value.includes(v)) onChange([...value, v]);
    setText('');
  };
  return (
    <div className="setting-inset">
      <div className="row wrap" style={{ gap: 6 }}>
        {value.map((ip) => (
          <button key={ip} type="button" className="tag mono" title="点击移除" onClick={() => onChange(value.filter((x) => x !== ip))}>
            {ip} ×
          </button>
        ))}
        {!value.includes('192.168.0.0/16') && (
          <button type="button" className="tag outline" onClick={() => add('192.168.0.0/16')}>
            + 家庭局域网
          </button>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <TextInput mono aria-label="新增地址" placeholder="192.168.1.23" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(text)} style={{ maxWidth: 240 }} />
        <Button onClick={() => add(text)}>添加</Button>
      </div>
    </div>
  );
}

function YamlEditor({ running }: { running: boolean | undefined }) {
  const { data, reload } = useLoad(() => call('tavern:configText'));
  const [text, setText] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const dirty = text !== null && text !== data;
  const save = (restart: boolean) =>
    run(() =>
      attempt(async () => {
        await call('tavern:setConfigText', text ?? '');
        await reload();
        setText(null);
        if (restart) await call('tavern:restart');
      }, restart ? '已保存并重启' : '已保存，重启酒馆后生效'),
    );
  return (
    <>
      <textarea className="textarea mono yaml" spellCheck={false} aria-label="config.yaml" value={text ?? data ?? ''} onChange={(e) => setText(e.target.value)} />
      {dirty && (
        <div className="savebar">
          <span className="grow">YAML 已修改，保存前会检查格式</span>
          <Button variant="ghost" onClick={() => setText(null)}>
            放弃
          </Button>
          <Button variant={running ? 'secondary' : 'primary'} busy={busy} onClick={() => void save(false)}>
            保存
          </Button>
          {running && (
            <Button variant="primary" busy={busy} onClick={() => void save(true)}>
              保存并重启
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function Logs() {
  const logs = useStore((s) => s.logs);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pass = (l: LogLine) =>
      (level === 'all' || l.level === 'error' || (level === 'warn' && l.level === 'warn')) && (!q || l.text.toLowerCase().includes(q));
    return logs.filter(pass).slice(-1200);
  }, [logs, query, level]);

  useEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [shown]);

  return (
    <div className="logs">
      <div className="row" style={{ margin: '20px 0 12px' }}>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索日志" style={{ width: 240 }} />
        <Segmented
          label="日志级别"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: '全部' },
            { value: 'warn', label: '警告以上' },
            { value: 'error', label: '仅错误' },
          ]}
        />
        <span className="grow" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(shown.map((l) => `${clock(l.at)} ${l.text}`).join('\n'));
            toast('已复制到剪贴板', 'ok');
          }}
        >
          复制
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void call('tavern:clearLogs');
            useStore.setState({ logs: [] });
          }}
        >
          清空
        </Button>
      </div>
      <div
        className="log-view mono selectable"
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.length === 0 && <div className="dim" style={{ padding: '40px 0', textAlign: 'center' }}>{logs.length ? '没有匹配的日志' : '启动酒馆后，这里会实时显示它的输出'}</div>}
        {shown.map((l) => (
          <div key={l.seq} className={classes('log-line', l.level)}>
            <time>{clock(l.at)}</time>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
