import { ArrowsClockwise, Copy, DeviceMobile, ShieldCheck, Trash } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import type { LanStatus } from '@shared/types';
import { call } from '../lib/api';
import { ago, classes } from '../lib/format';
import { useBusy, useEvent, useLoad } from '../lib/hooks';
import { isMac } from '../lib/platform';
import { attempt, confirm, toast, useStore } from '../lib/store';
import { Button, Empty, IconButton, Note, PageHead, Section, Select, Switch } from '../ui';

export function PhonePage() {
  const instance = useStore((s) => s.tavern?.instance);
  const phase = useStore((s) => s.tavern?.phase);
  const openSetup = useStore((s) => s.openSetup);
  const { data: lan, set, reload } = useLoad(() => call('lan:status'));
  const [busy, run] = useBusy();
  useEvent('lan:state', set);

  // 配对码会过期，网络也可能换
  useEffect(() => {
    const t = setInterval(() => void reload(), 15_000);
    return () => clearInterval(t);
  }, [reload]);

  if (!instance) {
    return (
      <>
        <PageHead title="手机">躺着也能进酒馆。</PageHead>
        <Empty icon={DeviceMobile} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          装好之后，手机扫一下码就能连上这台电脑。
        </Empty>
      </>
    );
  }
  if (!lan) return <PageHead title="手机">扫一下码，手机浏览器里就能进酒馆。</PageHead>;

  const toggle = (on: boolean) => run(() => attempt(async () => set(await call('lan:set', on))));

  return (
    <>
      <PageHead title="手机">扫一下码，手机浏览器里就能进酒馆。酒馆仍然只监听本机，由掌柜在中间认人。</PageHead>
      <div className="phone">
        <div className="phone-left">
          <ol className="ladder">
            <li data-done={lan.running || undefined}>
              <div className="grow">
                <div className="ladder-title">打开连接</div>
                <div className="dim">{lan.error ?? (lan.running ? `正在等手机来，端口 ${lan.port}` : (isMac ? '第一次打开时，系统会问是否允许接受传入的网络连接，选允许' : '第一次打开时，Windows 会问是否允许访问网络，选允许'))}</div>
              </div>
              <Switch label="打开手机连接" checked={lan.enabled && lan.running} disabled={busy} onChange={(v) => void toggle(v)} />
            </li>
            <li data-done={(lan.running && Boolean(lan.address)) || undefined}>
              <div className="grow">
                <div className="ladder-title">手机和电脑连同一个路由器</div>
                {lan.addresses.length > 1 ? (
                  <div style={{ maxWidth: 320, marginTop: 6 }}>
                    <Select
                      label="电脑地址"
                      value={lan.address ?? ''}
                      onChange={(v) => void attempt(async () => set(await call('lan:address', v)))}
                      options={lan.addresses.map((a) => ({ value: a.address, label: a.address, note: a.virtual ? `${a.name}，虚拟网卡` : a.name }))}
                    />
                  </div>
                ) : (
                  <div className="dim">{lan.addresses[0] ? `${lan.addresses[0].name}，${lan.addresses[0].address}` : '这台电脑还没有连上网络'}</div>
                )}
              </div>
            </li>
            <li data-done={lan.devices.length > 0 || undefined}>
              <div className="grow">
                <div className="ladder-title">扫码</div>
                <div className="dim">用相机或浏览器扫右边的码。扫过一次，这台手机就一直认得。</div>
              </div>
            </li>
            <li data-done={phase === 'running' || undefined}>
              <div className="grow">
                <div className="ladder-title">{phase === 'running' ? '酒馆营业中' : '酒馆还没开门'}</div>
                <div className="dim">{phase === 'running' ? '手机上直接能聊' : '手机上也能按「开门」，掌柜要留在后台'}</div>
              </div>
            </li>
          </ol>

          <Section title="认得的手机" note={lan.devices.length ? undefined : '还没有手机连过。'}>
            {lan.devices.map((d) => (
              <div key={d.id} className="device">
                <span className={classes('lamp', d.online && 'ok')} />
                <div className="grow">
                  <div>{d.name}</div>
                  <div className="dim">{d.online ? '正在使用' : `上次 ${ago(d.lastSeen)}`}</div>
                </div>
                <IconButton
                  icon={Trash}
                  size="sm"
                  label="取消配对"
                  onClick={async () => {
                    const ok = await confirm({ title: `取消「${d.name}」的配对`, body: '它会立刻断开，要再扫一次码才能进。', confirm: '取消配对', danger: true });
                    if (ok) await attempt(async () => set(await call('lan:removeDevice', d.id)));
                  }}
                />
              </div>
            ))}
          </Section>

          <Section title="连不上的时候">
            <ul className="tips">
              <li>手机关掉流量和代理软件，确认连的是同一个 Wi-Fi。公司、宿舍、酒店的网络常常不让设备互相访问，可以让电脑连手机热点。</li>
              <li>电脑开着代理软件的话，上面的地址要选真实网卡，不选虚拟网卡。</li>
              {isMac ? (
                <li>开了系统防火墙的话，到「系统设置 → 网络 → 防火墙 → 选项」里把「掌柜」设为允许传入连接。</li>
              ) : (
                <li>多半是 Windows 防火墙拦住了，点下面的按钮放行，会弹出管理员确认。只放行同一网段的设备。</li>
              )}
            </ul>
            {!isMac && <Firewall lan={lan} />}
            <Note>手机和电脑不要同时开着同一段聊天，后保存的会盖掉先保存的。电脑上改了设置，手机页面会提示刷新。</Note>
          </Section>
        </div>
        <div className="phone-right">
          <Plate lan={lan} busy={busy} onOpen={() => void toggle(true)} onRenew={() => void attempt(async () => set(await call('lan:renew')))} />
        </div>
      </div>
    </>
  );
}

function Firewall({ lan }: { lan: LanStatus }) {
  const { data: open, reload } = useLoad(() => call('lan:firewall'), [lan.port]);
  const [busy, run] = useBusy();
  return (
    <div className="row" style={{ margin: '4px 0 16px' }}>
      <Button icon={ShieldCheck} busy={busy} onClick={() => void run(() => attempt(async () => { await call('lan:allowFirewall'); await reload(); }, '已放行'))}>
        放行防火墙
      </Button>
      {open && <span className="tag jade">已有放行规则</span>}
    </div>
  );
}

/** 二维码画成一整条路径，缩放时不会有缝。 */
function Qr({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const { data, size } = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { path: d, size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label="手机连接二维码">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function Plate({ lan, busy, onOpen, onRenew }: { lan: LanStatus; busy: boolean; onOpen: () => void; onRenew: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = lan.expiresAt ? Math.max(0, Math.ceil((lan.expiresAt - now) / 60_000)) : 0;

  return (
    <div className={classes('plate', lan.pairUrl && 'lit')}>
      {lan.pairUrl ? (
        <>
          <motion.div key={lan.pairUrl} className="plate-code" initial={{ opacity: 0, filter: 'blur(10px)' }} animate={{ opacity: 1, filter: 'blur(0px)' }} transition={{ duration: 0.5 }}>
            <Qr text={lan.pairUrl} />
          </motion.div>
          <div className="plate-pin num" aria-label="配对码">
            {lan.code!.slice(0, 3)} <i /> {lan.code!.slice(3)}
          </div>
          <div className="dim">扫不了就在手机浏览器打开下面的地址，输入这个码</div>
          <button
            type="button"
            className="plate-url mono"
            onClick={() => void navigator.clipboard.writeText(lan.url!).then(() => toast('地址已复制', 'ok'))}
          >
            {lan.url} <Copy size={13} />
          </button>
          <button type="button" className="linkish" onClick={onRenew}>
            <ArrowsClockwise size={13} /> 换一个码，{left} 分钟后也会自动换
          </button>
        </>
      ) : lan.running ? (
        <p className="dim">这台电脑还没有连上网络</p>
      ) : (
        <>
          <div className="plate-code off">
            <DeviceMobile size={56} weight="thin" />
          </div>
          <Button variant="primary" busy={busy} onClick={onOpen}>
            打开连接
          </Button>
          <div className="dim">只有配对过的手机能进</div>
        </>
      )}
    </div>
  );
}
