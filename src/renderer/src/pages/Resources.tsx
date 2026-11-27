import { Book, CheckCircle, DotsThreeOutline, Export, FileArrowUp, GitFork, Images, Palette, SlidersHorizontal, Trash, type Icon } from '@phosphor-icons/react';
import { useEffect, useState, type DragEvent } from 'react';
import type { ResourceItem, ResourceKind } from '@shared/types';
import { call } from '../lib/api';
import { ago, bytes, classes } from '../lib/format';
import { useDataChanged, useLoad } from '../lib/hooks';
import { attempt, confirm, toast, toastError, useStore } from '../lib/store';
import { Button, Empty, Menu, PageHead, SearchInput, Segmented } from '../ui';
import { reportImport } from './Characters';

interface KindInfo {
  label: string;
  icon: Icon;
  note: string;
  empty: string;
  use: string;
  used: string;
  ext: string[];
}

const KINDS: Record<ResourceKind, KindInfo> = {
  worlds: { label: '世界书', icon: Book, note: '全局启用后，所有角色共享这些设定。', empty: '世界书是按关键词触发的设定集。', use: '全局启用', used: '取消全局启用', ext: ['json'] },
  presets: { label: '对话预设', icon: SlidersHorizontal, note: '社区常说的「预设」，决定提示词结构与采样参数。', empty: '导入社区分享的预设 JSON。', use: '设为当前预设', used: '', ext: ['json'] },
  themes: { label: '主题', icon: Palette, note: '酒馆界面的配色与自定义 CSS。', empty: '导入主题 JSON，一键换肤。', use: '启用主题', used: '', ext: ['json'] },
  backgrounds: { label: '背景', icon: Images, note: '酒馆聊天界面的背景图。', empty: '支持 PNG、JPG、WebP、GIF 与 MP4。', use: '设为背景', used: '', ext: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4'] },
  workflows: { label: 'ComfyUI 工作流', icon: GitFork, note: '导入时自动补齐酒馆占位符。', empty: '在 ComfyUI 里用「导出（API）」得到 JSON 再导入。', use: '设为当前工作流', used: '', ext: ['json'] },
};

export function ResourcesPage() {
  const instance = useStore((s) => s.tavern?.instance);
  const running = useStore((s) => s.tavern?.phase === 'running');
  const openSetup = useStore((s) => s.openSetup);
  const [kind, setKind] = useState<ResourceKind>('worlds');
  const [query, setQuery] = useState('');
  const { data, reload, set } = useLoad(() => call('res:list', kind), [kind, instance?.userDir]);
  const info = KINDS[kind];
  useDataChanged(['resources', 'settings'], reload);
  useEffect(() => setQuery(''), [kind]);

  if (!instance) {
    return (
      <>
        <PageHead title="资源">世界书、预设、主题与背景。</PageHead>
        <Empty icon={Images} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>} />
      </>
    );
  }

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      reportImport(await call('res:import', kind, paths));
      await reload();
    } catch (e) {
      toastError(e);
    }
  };
  const pick = async () => importPaths(await call('app:pickFiles', { title: `导入${info.label}`, multi: true, filters: [{ name: info.label, extensions: info.ext }] }));
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    void importPaths([...e.dataTransfer.files].map((f) => window.innkeeper.pathForFile(f)).filter(Boolean));
  };

  const use = async (item: ResourceItem) => {
    const ok = await attempt(() => call('res:use', kind, item.file));
    if (ok) {
      toast(item.active ? '已取消' : running ? '已生效。浏览器里开着的页面请刷新' : '已生效', 'ok');
      await reload();
    }
  };
  const remove = async (item: ResourceItem) => {
    const ok = await confirm({ title: `删除「${item.name}」`, body: '文件会移到系统回收站。', confirm: '删除', danger: true });
    if (!ok) return;
    set((data ?? []).filter((x) => x.file !== item.file));
    await attempt(() => call('res:remove', kind, item.file));
    await reload();
  };

  const shown = (data ?? []).filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div onDrop={onDrop} onDragOver={(e) => e.preventDefault()} style={{ minHeight: '70vh' }}>
      <PageHead
        title="资源"
        actions={
          <Button variant="primary" icon={FileArrowUp} onClick={() => void pick()}>
            导入{info.label}
          </Button>
        }
      >
        {info.note}
      </PageHead>
      <div className="row" style={{ marginBottom: 18 }}>
        <Segmented label="资源类型" value={kind} onChange={setKind} options={(Object.keys(KINDS) as ResourceKind[]).map((k) => ({ value: k, label: KINDS[k].label, icon: KINDS[k].icon }))} />
        <span className="grow" />
        {(data?.length ?? 0) > 6 && <SearchInput value={query} onChange={setQuery} placeholder="搜索" style={{ width: 200 }} />}
      </div>
      {data && data.length === 0 && (
        <Empty icon={info.icon} title={`还没有${info.label}`} actions={<Button icon={FileArrowUp} onClick={() => void pick()}>导入</Button>}>
          {info.empty}
        </Empty>
      )}
      <div className="table">
        {shown.map((item) => (
          <div key={item.file} className={classes('table-row', item.active && 'active')}>
            <info.icon size={17} color="var(--fg-3)" />
            <span className="grow row">
              <span className="truncate" style={{ fontWeight: 520 }}>
                {item.name}
              </span>
              {item.active && (
                <span className="tag amber">
                  <CheckCircle size={11} weight="fill" /> {kind === 'worlds' ? '全局' : '当前'}
                </span>
              )}
            </span>
            <span className="dim num" style={{ width: 170 }}>
              {item.note}
            </span>
            <span className="dim num" style={{ width: 76, textAlign: 'right' }}>
              {bytes(item.sizeBytes)}
            </span>
            <span className="dim num" style={{ width: 92, textAlign: 'right' }}>
              {ago(item.modified)}
            </span>
            <span className="row" style={{ width: 168, justifyContent: 'flex-end', gap: 2 }}>
              {(!item.active || info.used) && (
                <Button size="sm" variant={item.active ? 'ghost' : 'secondary'} onClick={() => void use(item)}>
                  {item.active ? info.used : info.use}
                </Button>
              )}
              <Menu
                items={[
                  { label: '导出', icon: Export, onSelect: () => void attempt(() => call('res:export', kind, item.file)) },
                  { label: '删除', icon: Trash, danger: true, onSelect: () => void remove(item) },
                ]}
              >
                <Button variant="ghost" size="sm" icon={DotsThreeOutline} aria-label="更多" />
              </Menu>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
