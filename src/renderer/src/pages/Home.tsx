import { AppWindow, ArrowRight, ArrowsClockwise, Browser, CaretDown, ChatTeardropText, Power, Key } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { providerById } from '@shared/catalog/providers';
import type { Overview, TavernPhase } from '@shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { ReededGlass } from '../components/ReededGlass';
import { avatarUrl, call } from '../lib/api';
import { ago, bytes, classes, duration } from '../lib/format';
import { useDataChanged, useEvent, useLoad, useNow } from '../lib/hooks';
import { attempt, toggleTavern, useStore, type Page } from '../lib/store';
import { Button, Menu } from '../ui';

const HEADLINE: Record<TavernPhase, string> = {
  absent: '先把酒馆搭起来',
  stopped: '酒馆已打烊',
  starting: '正在生火开门',
  running: '酒馆营业中',
  stopping: '正在收拾打烊',
  crashed: '酒馆出了点状况',
};

function Hero({ data }: { data?: Overview }) {
  const tavern = useStore((s) => s.tavern);
  const openSetup = useStore((s) => s.openSetup);
  const phase = tavern?.phase ?? 'absent';
  const now = useNow(1000);
  const lit = phase === 'running' || phase === 'starting';
  const busy = phase === 'starting' || phase === 'stopping';
  const url = tavern?.url?.replace(/^https?:\/\//, '');
  const update = data?.latestVersion && tavern?.instance && data.latestVersion !== tavern.instance.version ? data.latestVersion : null;

  return (
    <section className="hero">
      <ReededGlass lit={lit} className="hero-glass" />
      <div className="hero-body">
        <h1>{HEADLINE[phase]}</h1>
        <p className="hero-sub num">
          {phase === 'absent' && '装本体、接模型、配插件和角色，一次走完，大约五分钟。'}
          {phase === 'stopped' && `SillyTavern ${tavern?.instance?.version ?? ''} 已就绪，随时可以开门。`}
          {phase === 'starting' && '首次启动需要编译前端，大约半分钟。'}
          {phase === 'running' && `${url}　已开门 ${duration(now - (tavern?.startedAt ?? now))}`}
          {phase === 'stopping' && '等酒馆把数据写完。'}
          {phase === 'crashed' && (tavern?.lastError ?? '进程意外退出。')}
        </p>
        <div className="row hero-actions">
          {phase === 'absent' && (
            <Button variant="primary" size="lg" icon={Key} onClick={() => openSetup(true)}>
              一键配置
            </Button>
          )}
          {phase === 'running' && (
            <>
              <div className="split">
                <Button variant="primary" size="lg" icon={ArrowRight} onClick={() => void attempt(() => call('tavern:open'))}>
                  进入酒馆
                </Button>
                <Menu
                  items={[
                    { label: '在独立窗口打开', icon: AppWindow, onSelect: () => void attempt(() => call('tavern:open', 'window')) },
                    { label: '在浏览器打开', icon: Browser, onSelect: () => void attempt(() => call('tavern:open', 'browser')) },
                    'sep',
                    { label: '重启酒馆', icon: ArrowsClockwise, onSelect: () => void attempt(() => call('tavern:restart')) },
                  ]}
                >
                  <Button variant="primary" size="lg" icon={CaretDown} aria-label="更多打开方式" />
                </Menu>
              </div>
              <Button size="lg" className="glass" icon={Power} onClick={() => void toggleTavern()}>
                打烊
              </Button>
            </>
          )}
          {(phase === 'stopped' || phase === 'crashed' || busy) && (
            <Button variant="primary" size="lg" icon={Power} busy={busy} onClick={() => void toggleTavern()}>
              {phase === 'starting' ? '启动中' : phase === 'stopping' ? '停止中' : '启动酒馆'}
            </Button>
          )}
          {phase === 'crashed' && (
            <Button size="lg" className="glass" onClick={() => useStore.getState().go('tavern', 'logs')}>
              查看日志
            </Button>
          )}
          {update && !busy && (
            <button type="button" className="hero-update" onClick={() => useStore.getState().go('tavern')}>
              {update} 可更新
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

interface LedgerRow {
  page: Page;
  intent?: string;
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  state: 'ok' | 'todo' | 'idle';
}

function ledger(data: Overview, backupNote: string): LedgerRow[] {
  const c = data.connection;
  const provider = c ? providerById(c.providerId) : undefined;
  return [
    {
      page: 'tavern',
      label: '本体',
      value: data.tavern.instance ? <span className="num">{data.tavern.instance.version}</span> : '未安装',
      detail: data.tavern.instance ? (data.tavern.instance.kind === 'managed' ? '由掌柜托管' : '接管已有目录') : '下载并安装 SillyTavern',
      state: data.tavern.instance ? 'ok' : 'todo',
    },
    {
      page: 'models',
      label: '模型',
      value: c ? (
        <span className="row" style={{ gap: 7, minWidth: 0 }}>
          <BrandIcon name={provider?.logo ?? ''} size={16} />
          <span className="truncate">{c.label}</span>
        </span>
      ) : (
        '未接入'
      ),
      detail: c ? <span className="mono truncate">{c.model}</span> : '没有模型就没法聊天',
      state: c ? 'ok' : 'todo',
    },
    {
      page: 'image',
      label: '生图',
      value: data.imagegen ? data.imagegen.source : '未配置',
      detail: data.imagegen ? (data.imagegen.ready ? <span className="mono truncate">{data.imagegen.model || '使用后端默认模型'}</span> : data.imagegen.missing) : '可选，聊天时配图',
      state: data.imagegen ? (data.imagegen.ready ? 'ok' : 'todo') : 'idle',
    },
    {
      page: 'voice',
      label: '配音',
      value: data.voice ? data.voice.name : '未配置',
      detail: data.voice ? (data.voice.enabled ? <span className="truncate">{data.voice.voice || '自动朗读'}</span> : '没有打开朗读') : '可选，让角色开口',
      state: data.voice?.enabled ? 'ok' : 'idle',
    },
    {
      page: 'phone',
      label: '手机',
      value: data.phone.on ? (data.phone.online ? <span className="num">{data.phone.online} 台在线</span> : '等待连接') : '未打开',
      detail: data.phone.devices ? <span className="num">认得 {data.phone.devices} 台</span> : '可选，扫码就能在手机上玩',
      state: data.phone.on ? 'ok' : 'idle',
    },
    {
      page: 'extensions',
      label: '插件',
      value: <span className="num">{data.extensions.installed ? `${data.extensions.enabled} 个启用` : '无'}</span>,
      detail: data.extensions.installed > data.extensions.enabled ? `另有 ${data.extensions.installed - data.extensions.enabled} 个停用` : data.extensions.installed ? '全部启用' : '多数中文卡需要酒馆助手',
      state: data.extensions.installed ? 'ok' : 'idle',
    },
    {
      page: 'characters',
      label: '角色',
      value: <span className="num">{data.characters} 张</span>,
      detail: data.worlds ? `世界书 ${data.worlds} 本` : '还没有世界书',
      state: data.characters ? 'ok' : 'idle',
    },
    {
      page: 'backups',
      label: '备份',
      value: data.lastBackup ? ago(data.lastBackup) : '从未备份',
      detail: backupNote,
      state: data.lastBackup && Date.now() - data.lastBackup < 14 * 86400_000 ? 'ok' : 'idle',
    },
  ];
}

export function HomePage() {
  const go = useStore((s) => s.go);
  const phase = useStore((s) => s.tavern?.phase);
  const prefs = useStore((s) => s.prefs);
  const { data, reload } = useLoad(() => call('app:overview'), [prefs?.activeConnectionId, prefs?.activeVersion, prefs?.tavernMode]);
  useDataChanged(['characters', 'extensions', 'settings', 'resources', 'backups'], reload);
  useEffect(() => {
    void reload();
  }, [phase, reload]);
  // 从酒馆窗口切回来时，最近聊天多半变了
  useEvent('window:state', ({ focused }) => focused && void reload());

  return (
    <>
      <Hero data={data} />
      {data && (
        <div className="home-grid">
          <section>
            <h2 className="home-title">营业清单</h2>
            <div className="ledger">
              {ledger(data, data.dataBytes ? `数据共 ${bytes(data.dataBytes)}` : '还没有数据').map((r) => (
                <button key={r.page} type="button" className="ledger-row" onClick={() => go(r.page, r.intent)}>
                  <span className={classes('ledger-mark', r.state)} />
                  <span className="ledger-label">{r.label}</span>
                  <span className="ledger-value truncate">{r.value}</span>
                  <span className="ledger-detail truncate">{r.detail}</span>
                  <ArrowRight className="ledger-go" size={14} />
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2 className="home-title">最近的客人</h2>
            {data.recent.length ? (
              <div className="recent">
                {data.recent.map((r) => (
                  <button key={r.character} type="button" className="recent-row" onClick={() => go('characters', r.avatar ?? undefined)}>
                    {r.avatar ? <img src={avatarUrl(r.avatar, 120)} alt="" loading="lazy" /> : <span className="recent-blank" />}
                    <div className="grow">
                      <div className="row">
                        <span className="recent-name truncate">{r.character}</span>
                        <span className="recent-time num">{ago(r.at)}</span>
                      </div>
                      <div className="recent-text truncate">{r.preview || `${r.messages} 条消息`}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="recent-empty">
                <ChatTeardropText size={26} weight="light" />
                <p>还没有聊天记录。进酒馆和谁聊上几句，这里就会出现。</p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
