import {
  Archive, Cards, Cube, DeviceMobile, GearSix, House, Images, PaintBrush, Play, PlugsConnected, Power, PuzzlePiece, SpeakerHigh, type Icon,
} from '@phosphor-icons/react';
import { classes } from '../lib/format';
import { toggleTavern, useStore, type Page } from '../lib/store';
import { IconButton } from '../ui';
import { Logo } from './Logo';

const NAV: { id: Page; label: string; icon: Icon }[][] = [
  [
    { id: 'home', label: '总览', icon: House },
    { id: 'tavern', label: '酒馆本体', icon: Cube },
    { id: 'phone', label: '手机', icon: DeviceMobile },
  ],
  [
    { id: 'models', label: '模型接入', icon: PlugsConnected },
    { id: 'image', label: '生图', icon: PaintBrush },
    { id: 'voice', label: '配音', icon: SpeakerHigh },
    { id: 'extensions', label: '插件', icon: PuzzlePiece },
  ],
  [
    { id: 'characters', label: '角色卡', icon: Cards },
    { id: 'resources', label: '资源', icon: Images },
    { id: 'backups', label: '备份', icon: Archive },
  ],
];

const PHASE_TEXT = {
  absent: '尚未安装',
  stopped: '已打烊',
  starting: '正在开门',
  running: '营业中',
  stopping: '正在打烊',
  crashed: '意外退出',
} as const;

export function Sidebar() {
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const tavern = useStore((s) => s.tavern);
  const phase = tavern?.phase ?? 'absent';
  const busy = phase === 'starting' || phase === 'stopping';
  const lamp = phase === 'running' ? 'on' : busy ? 'wait' : phase === 'crashed' ? 'bad' : '';

  const item = ({ id, label, icon: I }: (typeof NAV)[number][number]) => (
    <button key={id} type="button" className="nav-item" aria-current={page === id ? 'page' : undefined} onClick={() => go(id)}>
      <I size={18} weight={page === id ? 'fill' : 'regular'} />
      {label}
    </button>
  );

  return (
    <nav className="sidebar drag" aria-label="主导航">
      <div className="brand">
        <Logo size={26} lit={phase === 'running' || phase === 'starting'} />
        <span>掌柜</span>
      </div>
      <div className="nav no-drag">
        {NAV.map((group, i) => (
          <div key={i} className="nav-group">
            {group.map(item)}
          </div>
        ))}
      </div>
      <div className="nav-foot no-drag">
        {item({ id: 'settings', label: '设置', icon: GearSix })}
        <div className={classes('status', phase === 'running' && 'lit')}>
          <span className={classes('lamp', lamp)} />
          <div className="grow">
            <div className="status-main">{PHASE_TEXT[phase]}</div>
            <div className="status-sub num truncate">
              {phase === 'running' ? `端口 ${tavern?.port}` : tavern?.instance ? `SillyTavern ${tavern.instance.version}` : '点右侧开始配置'}
            </div>
          </div>
          <IconButton
            icon={phase === 'running' ? Power : Play}
            size="sm"
            busy={busy}
            tipSide="right"
            label={phase === 'running' ? '停止酒馆' : phase === 'absent' ? '一键配置' : '启动酒馆'}
            onClick={() => void toggleTavern()}
          />
        </div>
      </div>
    </nav>
  );
}
