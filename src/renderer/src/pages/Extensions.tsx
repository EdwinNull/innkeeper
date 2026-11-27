import { ArrowSquareOut, ArrowUp, ArrowsClockwise, Check, DotsThreeOutline, DownloadSimple, FolderOpen, GithubLogo, LinkSimple, PuzzlePiece, Star, Trash, Warning } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { EXT_CATEGORIES, EXTENSION_PACKS, EXTENSIONS, extensionById } from '@shared/catalog/extensions';
import type { CatalogExtension, ExtCategory, InstalledExtension } from '@shared/types';
import { call } from '../lib/api';
import { classes, compact } from '../lib/format';
import { useDataChanged, useLoad } from '../lib/hooks';
import { attempt, confirm, toast, useStore } from '../lib/store';
import { Button, Dialog, Empty, Field, IconButton, Menu, Note, PageHead, SearchInput, Switch, Tabs, TextInput, Tip } from '../ui';

type Tab = 'market' | 'official' | 'installed';

export function ExtensionsPage() {
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const tasks = useStore((s) => s.tasks);
  const [tab, setTab] = useState<Tab>('market');
  const [manual, setManual] = useState(false);
  const { data: installed = [], reload, set } = useLoad(() => call('ext:list'), [instance?.userDir]);
  useDataChanged(['extensions'], reload);

  /** 正在安装中的插件文件夹名 */
  const pending = useMemo(() => {
    const out = new Set<string>();
    for (const t of Object.values(tasks)) {
      if (t.state !== 'running' || !t.kind.startsWith('ext-')) continue;
      for (const s of t.steps) if (s.state === 'running' || s.state === 'pending') out.add(s.key);
    }
    return out;
  }, [tasks]);

  if (!instance) {
    return (
      <>
        <PageHead title="插件">给酒馆添功能。</PageHead>
        <Empty icon={PuzzlePiece} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          插件装在酒馆的数据目录里，升级酒馆不会丢。
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="插件"
        actions={
          <Button icon={LinkSimple} onClick={() => setManual(true)}>
            从仓库地址安装
          </Button>
        }
      >
        自动挑选最快的下载线路。装完刷新酒馆页面即可生效。
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'market', label: '精选' },
          { value: 'official', label: '官方目录' },
          { value: 'installed', label: '已安装', count: installed.length },
        ]}
      />
      {tab === 'market' && <Market installed={installed} pending={pending} />}
      {tab === 'official' && <Official installed={installed} />}
      {tab === 'installed' && <Installed list={installed} set={set} reload={reload} />}
      <ManualInstall open={manual} onClose={() => setManual(false)} />
    </>
  );
}

async function installWithChecks(ids: string[], installed: InstalledExtension[]): Promise<boolean> {
  const have = new Set(installed.filter((e) => e.enabled).map((e) => e.folder));
  const wanted = ids.filter((id) => !installed.some((e) => e.folder === id));
  if (!wanted.length) {
    toast('这些插件都已经装好了');
    return false;
  }
  const clash: string[] = [];
  for (const id of wanted) {
    const item = extensionById(id);
    for (const other of item?.conflicts ?? []) if (have.has(other)) clash.push(`${item!.name} 与 ${extensionById(other)?.name ?? other}`);
  }
  if (clash.length) {
    const ok = await confirm({
      title: '可能会互相干扰',
      body: `${clash.join('；')} 功能重叠，同时启用容易重复注入提示词。可以先装，再到「已安装」里停用其中一个。`,
      confirm: '仍然安装',
    });
    if (!ok) return false;
  }
  return attempt(() => call('ext:installMany', wanted));
}

function Market({ installed, pending }: { installed: InstalledExtension[]; pending: Set<string> }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<ExtCategory | 'all'>('all');
  const have = useMemo(() => new Set(installed.map((e) => e.folder)), [installed]);
  const shown = EXTENSIONS.filter((e) => {
    if (cat !== 'all' && e.category !== cat) return false;
    const q = query.trim().toLowerCase();
    return !q || `${e.name} ${e.nameEn ?? ''} ${e.summary} ${e.author}`.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="packs">
        {EXTENSION_PACKS.map((p) => {
          const done = p.items.filter((i) => have.has(i)).length;
          const all = done === p.items.length;
          return (
            <div key={p.id} className="pack">
              <div className="pack-name">{p.name}</div>
              <div className="pack-note">{p.note}</div>
              <div className="pack-list">{p.items.map((i) => extensionById(i)?.name).join('、')}</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                {all ? (
                  <span className="tag jade">
                    <Check size={11} weight="bold" /> 已装齐
                  </span>
                ) : (
                  <>
                    <span className="dim num">
                      {done} / {p.items.length}
                    </span>
                    <Button size="sm" onClick={() => void installWithChecks(p.items, installed)}>
                      {done ? '补齐' : '安装'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="row wrap" style={{ margin: '30px 0 14px', gap: 6 }}>
        <button type="button" className="tag" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>
          全部
        </button>
        {EXT_CATEGORIES.map((c) => (
          <button key={c.id} type="button" className="tag" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.title}
          </button>
        ))}
        <span className="grow" />
        <SearchInput value={query} onChange={setQuery} placeholder="搜索插件" style={{ width: 220 }} />
      </div>
      <div className="ext-grid">
        {shown.map((e) => (
          <ExtCard key={e.id} item={e} installed={installed} have={have.has(e.id)} pending={pending.has(e.id)} />
        ))}
      </div>
      {shown.length === 0 && <p className="dim" style={{ padding: '40px 0', textAlign: 'center' }}>没有匹配的插件</p>}
    </>
  );
}

function ExtCard({ item, installed, have, pending }: { item: CatalogExtension; installed: InstalledExtension[]; have: boolean; pending: boolean }) {
  return (
    <article className="ext">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h3 className="ext-name truncate">{item.name}</h3>
        {item.nameEn && <span className="ext-en truncate">{item.nameEn}</span>}
        <span className="grow" />
        <button type="button" className="ext-star num" onClick={() => void call('app:openExternal', item.repo)} title="打开仓库主页">
          {item.stars ? (
            <>
              <Star size={12} weight="fill" /> {compact(item.stars)}
            </>
          ) : (
            <GithubLogo size={14} />
          )}
        </button>
      </div>
      <p className="ext-summary">{item.summary}</p>
      {item.detail && <p className="ext-detail clamp-2">{item.detail}</p>}
      <div className="row ext-foot">
        <span className="dim truncate">{item.author}</span>
        {item.conflicts && (
          <Tip text={`与 ${item.conflicts.map((c) => extensionById(c)?.name ?? c).join('、')} 功能重叠，只用一个就好`}>
            <span className="tag gold">
              <Warning size={11} weight="fill" /> 择一
            </span>
          </Tip>
        )}
        {item.caution && (
          <Tip text={item.caution}>
            <span className="tag">须知</span>
          </Tip>
        )}
        <span className="grow" />
        {have ? (
          <span className="tag jade">
            <Check size={11} weight="bold" /> 已安装
          </span>
        ) : (
          <Button size="sm" icon={DownloadSimple} busy={pending} onClick={() => void installWithChecks([item.id], installed)}>
            安装
          </Button>
        )}
      </div>
    </article>
  );
}

function Official({ installed }: { installed: InstalledExtension[] }) {
  const { data, error, loading, reload } = useLoad(() => call('ext:officialCatalog'));
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (data ?? []).filter((e) => !q || `${e.name} ${e.description}`.toLowerCase().includes(q));
  const have = new Set(installed.map((e) => e.folder));
  return (
    <>
      <div className="row" style={{ margin: '22px 0 14px' }}>
        <p className="muted grow">SillyTavern 官方资源索引里的其余插件，说明为原文。</p>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索" style={{ width: 220 }} />
      </div>
      {loading && !data && <p className="dim">正在读取官方目录…</p>}
      {error && (
        <Note kind="bad">
          读取失败：{error.message}
          <button type="button" className="linkish" style={{ marginLeft: 8 }} onClick={() => void reload()}>
            重试
          </button>
        </Note>
      )}
      <div className="table">
        {shown.map((e) => {
          const folder = e.url.split('/').pop()!.replace(/\.git$/, '');
          return (
            <div key={e.id} className="table-row tall">
              <div className="grow">
                <div style={{ fontWeight: 540 }}>{e.name}</div>
                <div className="dim clamp-2">{e.description}</div>
              </div>
              <IconButton icon={ArrowSquareOut} size="sm" label="仓库主页" onClick={() => void call('app:openExternal', e.url)} />
              {have.has(folder) ? (
                <span className="tag jade">已安装</span>
              ) : (
                <Button size="sm" onClick={() => void attempt(() => call('ext:install', { repo: e.url, title: e.name }))}>
                  安装
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Installed({ list, set, reload }: { list: InstalledExtension[]; set: (v: InstalledExtension[]) => void; reload: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const running = useStore((s) => s.tavern?.phase === 'running');
  const outdated = list.filter((e) => e.hasUpdate);

  const check = async () => {
    setChecking(true);
    await attempt(async () => {
      const result = await call('ext:checkUpdates');
      set(result);
      const n = result.filter((e) => e.hasUpdate).length;
      const unknown = result.filter((e) => e.remote && e.hasUpdate === null).length;
      toast(n ? `${n} 个插件有更新` : unknown ? `${unknown} 个插件没能查到更新` : '都是最新的', n || unknown ? 'info' : 'ok');
    });
    setChecking(false);
  };

  const toggle = async (e: InstalledExtension, enabled: boolean) => {
    set(list.map((x) => (x.folder === e.folder ? { ...x, enabled } : x)));
    const ok = await attempt(() => call('ext:setEnabled', e.folder, enabled), running ? '已生效。浏览器里开着的页面请刷新' : undefined);
    if (!ok) await reload();
  };

  const remove = async (e: InstalledExtension) => {
    const ok = await confirm({ title: `卸载「${e.displayName}」`, body: '插件文件会移到回收站，它在酒馆里的设置会保留。', confirm: '卸载', danger: true });
    if (ok) await attempt(() => call('ext:remove', e.folder, e.scope === 'global' ? 'global' : 'user'), '已卸载');
  };

  if (!list.length) return <Empty icon={PuzzlePiece} title="还没有插件">到「精选」里挑几个，或者先装上「开箱必备」。</Empty>;
  return (
    <>
      <div className="row" style={{ margin: '20px 0 12px' }}>
        <Button size="sm" icon={ArrowsClockwise} busy={checking} onClick={() => void check()}>
          检查更新
        </Button>
        {outdated.length > 0 && (
          <Button size="sm" variant="primary" icon={ArrowUp} onClick={() => void attempt(() => call('ext:update', outdated.map((e) => e.folder)))}>
            全部更新（{outdated.length}）
          </Button>
        )}
      </div>
      <div className="table">
        {list.map((e) => (
          <div key={`${e.scope}/${e.folder}`} className={classes('table-row tall', !e.enabled && 'off')}>
            <Switch label={`启用 ${e.displayName}`} checked={e.enabled} onChange={(v) => void toggle(e, v)} />
            <div className="grow">
              <div className="row">
                <span className="truncate" style={{ fontWeight: 540 }}>
                  {e.displayName}
                </span>
                {e.hasUpdate && <span className="tag amber">有更新</span>}
                {e.scope === 'global' && <span className="tag">所有用户</span>}
              </div>
              <div className="dim truncate num">
                {[e.version && `v${e.version.replace(/^v/i, '')}`, e.author, e.commit && e.commit.slice(0, 7), !e.remote && '非 git 安装，无法自动更新'].filter(Boolean).join('　')}
              </div>
            </div>
            {e.hasUpdate && (
              <Button size="sm" icon={ArrowUp} onClick={() => void attempt(() => call('ext:update', [e.folder]))}>
                更新
              </Button>
            )}
            <Menu
              items={[
                ...(e.homePage ? [{ label: '仓库主页', icon: ArrowSquareOut, onSelect: () => void attempt(() => call('app:openExternal', e.homePage)) }] : []),
                ...(e.remote ? [{ label: '更新到最新', icon: ArrowUp, onSelect: () => void attempt(() => call('ext:update', [e.folder])) }] : []),
                { label: '打开文件夹', icon: FolderOpen, onSelect: () => void attempt(() => call('app:reveal', e.path)) },
                'sep' as const,
                { label: '卸载', icon: Trash, danger: true, onSelect: () => void remove(e) },
              ]}
            >
              <Button variant="ghost" size="sm" icon={DotsThreeOutline} aria-label="更多" />
            </Menu>
          </div>
        ))}
      </div>
    </>
  );
}

function ManualInstall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const install = async () => {
    const ok = await attempt(() => call('ext:install', { repo, branch: branch.trim() || undefined }));
    if (ok) {
      setRepo('');
      setBranch('');
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="从仓库地址安装"
      description="插件能读取你的聊天与密钥状态，只装你信得过的来源。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={!repo.trim()} onClick={() => void install()}>
            安装
          </Button>
        </>
      }
    >
      <div className="fields">
        <Field label="仓库地址">
          <TextInput mono autoFocus aria-label="仓库地址" placeholder="https://github.com/作者/插件名" value={repo} onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && repo.trim() && void install()} />
        </Field>
        <Field label="分支" help="留空使用默认分支。贴 /tree/分支名 的网址会自动识别。">
          <TextInput mono aria-label="分支" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
