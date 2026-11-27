import { Archive, ArrowCounterClockwise, DotsThreeOutline, FolderOpen, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import type { BackupItem } from '@shared/types';
import { call } from '../lib/api';
import { ago, bytes, dateTime } from '../lib/format';
import { useDataChanged, useLoad } from '../lib/hooks';
import { attempt, confirm, useStore } from '../lib/store';
import { Button, Empty, Menu, PageHead, TextInput } from '../ui';

export function BackupsPage() {
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const tasks = useStore((s) => s.tasks);
  const { data, reload } = useLoad(() => call('backup:list'), [instance?.userDir]);
  const [note, setNote] = useState('');
  useDataChanged(['backups'], reload);
  const working = Object.values(tasks).some((t) => (t.kind === 'backup' || t.kind === 'restore') && t.state === 'running');

  const create = async () => {
    if (await attempt(() => call('backup:create', note))) setNote('');
  };
  const restore = async (b: BackupItem) => {
    const ok = await confirm({
      title: `恢复到 ${dateTime(b.at)}`,
      body: '当前的角色、聊天、密钥和设置会被这份备份替换。恢复前会自动再备份一次现状，酒馆会先停止。',
      confirm: '恢复',
      danger: true,
    });
    if (ok) await attempt(() => call('backup:restore', b.file));
  };
  const remove = async (b: BackupItem) => {
    const ok = await confirm({ title: '删除这份备份', body: '文件会移到系统回收站。', confirm: '删除', danger: true });
    if (ok) await attempt(() => call('backup:remove', b.file));
  };

  if (!instance) {
    return (
      <>
        <PageHead title="备份">给数据留个退路。</PageHead>
        <Empty icon={Archive} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>} />
      </>
    );
  }

  return (
    <>
      <PageHead title="备份">打包角色、聊天、世界书、预设、插件、密钥与服务器配置。备份里含密钥明文，不要随意发给别人。</PageHead>
      <div className="backup-new">
        <Archive size={26} weight="light" />
        <TextInput aria-label="备注" placeholder="备注，可不填，例如：升级前" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !working && void create()} />
        <Button variant="primary" busy={working} onClick={() => void create()}>
          立即备份
        </Button>
      </div>
      {data && data.length === 0 && (
        <Empty icon={ArrowCounterClockwise} title="还没有备份">
          升级酒馆、批量改卡或装一堆插件之前，先备份一次会安心很多。
        </Empty>
      )}
      <div className="table">
        {data?.map((b) => (
          <div key={b.file} className="table-row tall">
            <div className="grow">
              <div style={{ fontWeight: 540 }} className="truncate">
                {b.note || '手动备份'}
              </div>
              <div className="dim num">
                {dateTime(b.at)}　{ago(b.at)}
              </div>
            </div>
            <span className="dim num">{bytes(b.sizeBytes)}</span>
            <Button size="sm" icon={ArrowCounterClockwise} disabled={working} onClick={() => void restore(b)}>
              恢复
            </Button>
            <Menu
              items={[
                { label: '在文件夹中显示', icon: FolderOpen, onSelect: () => void attempt(() => call('app:reveal', b.path)) },
                { label: '删除', icon: Trash, danger: true, onSelect: () => void remove(b) },
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
