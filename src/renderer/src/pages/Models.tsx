import { ArrowSquareOut, CheckCircle, DotsThreeOutline, Lightning, PencilSimple, PlugsConnected, Plus, Trash, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { LOCAL_ENGINE_ID, PROVIDER_GROUPS, PROVIDERS, providerById, type Provider } from '@shared/catalog/providers';
import type { Connection, GenerationView, ProbeResult } from '@shared/types';
import { BrandIcon } from '../components/BrandIcon';
import { ChatEngine } from '../components/ChatEngine';
import { call } from '../lib/api';
import { ago, classes, compact } from '../lib/format';
import { useBusy, useDataChanged, useLoad } from '../lib/hooks';
import { attempt, confirm, useStore } from '../lib/store';
import { Button, Combo, Empty, Field, IconButton, Menu, Note, NumberInput, PageHead, Section, SecretInput, SettingRow, Sheet, SheetClose, Slider, Switch, TextInput } from '../ui';

export function ModelsPage() {
  const prefs = useStore((s) => s.prefs)!;
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const [editing, setEditing] = useState<{ provider: Provider; connection?: Connection } | null>(null);
  const [picking, setPicking] = useState(false);

  if (!instance) {
    return (
      <>
        <PageHead title="模型接入">给酒馆接上会说话的模型。</PageHead>
        <Empty icon={PlugsConnected} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          密钥会写进酒馆自己的 secrets.json，所以要先有酒馆。
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="模型接入"
        actions={
          prefs.connections.length > 0 && (
            <Button variant="primary" icon={Plus} onClick={() => setPicking(true)}>
              新增接入
            </Button>
          )
        }
      >
        密钥只写进本机酒馆的 secrets.json，掌柜不另存副本，也不上传。
      </PageHead>

      {prefs.connections.length === 0 ? (
        <>
          <ProviderGrid onPick={(provider) => setEditing({ provider })} />
          <ChatEngine />
        </>
      ) : (
        <>
          <ConnectionList onEdit={(connection) => setEditing({ provider: providerById(connection.providerId)!, connection })} />
          <ChatEngine />
          <Generation />
        </>
      )}

      <Sheet open={picking} onClose={() => setPicking(false)} title="选择服务商" wide>
        <ProviderGrid
          onPick={(provider) => {
            setPicking(false);
            setEditing({ provider });
          }}
        />
      </Sheet>
      <ConnectionSheet target={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export function ProviderGrid({ onPick, compactGroups }: { onPick: (p: Provider) => void; compactGroups?: boolean }) {
  const adult = useStore((s) => s.prefs?.adult);
  const groups = [
    ...(adult ? [{ id: 'adult' as const, title: '对成人虚构内容友好', note: '依据各家官网与条款整理，平台随时可能调整' }] : []),
    ...PROVIDER_GROUPS,
  ];
  return (
    <div className={classes('providers', compactGroups && 'compact')}>
      {groups.map((g) => {
        const list = PROVIDERS.filter((p) => !p.managed && (g.id === 'adult' ? p.adult : p.group === g.id && !(adult && p.adult) && (adult || !p.adultOnly)));
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <div className="providers-head">
              <h3>{g.title}</h3>
              <span>{g.note}</span>
            </div>
            <div className="providers-grid">
              {list.map((p) => (
                <button key={p.id} type="button" className="provider" onClick={() => onPick(p)}>
                  <BrandIcon name={p.logo} size={22} />
                  <div className="grow">
                    <div className="provider-name">{p.name}</div>
                    <div className="provider-blurb truncate">{g.id === 'adult' ? p.adult!.note : p.blurb}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ConnectionList({ onEdit }: { onEdit: (c: Connection) => void }) {
  const prefs = useStore((s) => s.prefs)!;
  const [checking, setChecking] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const check = async (c: Connection) => {
    setChecking(c.id);
    await attempt(() => call('models:check', c.id));
    setChecking(null);
  };
  const activate = async (c: Connection) => {
    setSwitching(c.id);
    await attempt(() => call('models:activate', c.id), `已切换到 ${c.label}`);
    setSwitching(null);
  };
  const remove = async (c: Connection) => {
    const ok = await confirm({ title: `删除「${c.label}」`, body: '对应的密钥也会从酒馆里移除。', confirm: '删除', danger: true });
    if (ok) await attempt(() => call('models:remove', c.id));
  };

  return (
    <div className="conns">
      {prefs.connections.map((c) => {
        const provider = providerById(c.providerId);
        const active = prefs.activeConnectionId === c.id;
        return (
          <div key={c.id} className={classes('conn', active && 'active')}>
            <span className="conn-logo">
              <BrandIcon name={provider?.logo ?? ''} size={24} />
            </span>
            <div className="conn-main">
              <div className="row">
                <span className="conn-name truncate">{c.label}</span>
                {active && <span className="tag amber">使用中</span>}
              </div>
              <div className="conn-model mono truncate">{c.model}</div>
            </div>
            <div className="conn-state">
              {checking === c.id ? (
                <span className="row dim">
                  <span className="spinner" /> 检测中
                </span>
              ) : c.lastCheck ? (
                <>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={classes('lamp', c.lastCheck.ok ? 'ok' : 'bad')} />
                    <span className="num">{c.lastCheck.ok ? `${c.lastCheck.latencyMs} ms` : '不可用'}</span>
                  </span>
                  <span className="dim truncate" title={c.lastCheck.message}>
                    {c.lastCheck.ok ? ago(c.lastCheck.at) : c.lastCheck.message}
                  </span>
                </>
              ) : (
                <span className="dim">{c.keyTail ? `密钥尾号 ${c.keyTail}` : '无需密钥'}</span>
              )}
            </div>
            <div className="row" style={{ gap: 2 }}>
              {!active && (
                <Button size="sm" busy={switching === c.id} onClick={() => void activate(c)}>
                  设为当前
                </Button>
              )}
              <IconButton icon={Lightning} size="sm" label="检测连通" disabled={checking !== null} onClick={() => void check(c)} />
              <Menu
                items={[
                  ...(c.providerId === LOCAL_ENGINE_ID ? [] : [{ label: '编辑', icon: PencilSimple, onSelect: () => onEdit(c) }, 'sep' as const]),
                  { label: '删除', icon: Trash, danger: true, onSelect: () => void remove(c) },
                ]}
              >
                <Button variant="ghost" size="sm" icon={DotsThreeOutline} aria-label="更多" />
              </Menu>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectionSheet({ target, onClose }: { target: { provider: Provider; connection?: Connection } | null; onClose: () => void }) {
  const [held, setHeld] = useState(target);
  useEffect(() => {
    if (target) setHeld(target);
  }, [target]);
  if (!held) return null;
  return <ConnectionForm key={held.connection?.id ?? held.provider.id} open={target !== null} {...held} onClose={onClose} />;
}

function ConnectionForm({ open, provider, connection, onClose }: { open: boolean; provider: Provider; connection?: Connection; onClose: () => void }) {
  const [label, setLabel] = useState(connection?.label ?? provider.name);
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(connection?.model ?? '');
  const [hints, setHints] = useState<string[]>(provider.models);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [testing, runTest] = useBusy();
  const [saving, runSave] = useBusy();
  const adult = useStore((s) => s.prefs?.adult);

  useEffect(() => {
    void call('models:hints', provider.id).then((found) => {
      const h = adult && provider.adultModels ? [...provider.adultModels, ...found] : found;
      setHints(h);
      setModel((m) => m || (h[0] ?? ''));
    });
  }, [provider.id]);

  const options = useMemo(
    () => (probe?.models.length ? probe.models.map((m) => ({ value: m.id, note: m.context ? `${compact(m.context)} 上下文` : undefined })) : hints.map((value) => ({ value }))),
    [probe, hints],
  );

  const test = () =>
    runTest(async () => {
      await attempt(async () => {
        const result = await call('models:probe', { providerId: provider.id, baseUrl, apiKey, secretId: connection?.secretId });
        setProbe(result);
        if (result.ok && result.models.length && !result.models.some((m) => m.id === model)) {
          const preferred = hints.find((h) => result.models.some((m) => m.id === h));
          setModel(preferred ?? result.models[0]!.id);
        }
      });
    });

  const save = () =>
    runSave(async () => {
      const ok = await attempt(
        () => call('models:save', { id: connection?.id, providerId: provider.id, label, model, baseUrl, apiKey, activate: !connection }),
        connection ? '已保存' : `${label} 已接入并设为当前`,
      );
      if (ok) onClose();
    });

  const showUrl = provider.editableUrl || provider.group === 'custom';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={provider.name}
      head={
        <div className="sheet-head">
          <span className="conn-logo">
            <BrandIcon name={provider.logo} size={26} />
          </span>
          <div className="grow">
            <h2 className="dialog-title">{provider.name}</h2>
            <p className="muted">{provider.blurb}</p>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="sm" icon={X} aria-label="关闭" />
          </SheetClose>
        </div>
      }
      footer={
        <>
          <Button icon={Lightning} busy={testing} onClick={() => void test()}>
            测试
          </Button>
          <span className="grow" />
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" busy={saving} disabled={!model.trim()} onClick={() => void save()}>
            {connection ? '保存' : '保存并启用'}
          </Button>
        </>
      }
    >
      <div className="fields">
        {provider.adult && adult && <Note>{provider.adult.note}。具体能写什么以它当时的条款和所选模型为准。</Note>}
        {!provider.direct && <Note>这家在大陆通常连不上。需要在「酒馆本体 → 服务器配置」里给酒馆设置代理。</Note>}
        {showUrl && (
          <Field label="接口地址" help={provider.group === 'custom' ? '填到 /v1 为止。多余的 /chat/completions 会自动去掉。' : '服务没改过端口就不用动。'}>
            <TextInput mono value={baseUrl} placeholder="https://example.com/v1" aria-label="接口地址" onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
        )}
        {(provider.needsKey || provider.group === 'custom' || provider.group === 'local') && (
          <Field
            label={provider.needsKey ? '密钥' : '密钥（可不填）'}
            aside={
              provider.keyUrl && provider.group !== 'local' ? (
                <button type="button" className="linkish" onClick={() => void call('app:openExternal', provider.keyUrl)}>
                  去申请 <ArrowSquareOut size={13} />
                </button>
              ) : undefined
            }
          >
            <SecretInput
              label="密钥"
              value={apiKey}
              onChange={setApiKey}
              onEnter={() => void test()}
              placeholder={connection?.keyTail ? `已保存，尾号 ${connection.keyTail}，留空则不改` : provider.keyHint ? `${provider.keyHint}…` : '粘贴密钥'}
            />
          </Field>
        )}
        {provider.group === 'local' && provider.keyUrl && (
          <p className="dim">
            还没装？
            <button type="button" className="linkish" onClick={() => void call('app:openExternal', provider.keyUrl)}>
              打开下载页 <ArrowSquareOut size={13} />
            </button>
          </p>
        )}
        {probe && <Note kind={probe.ok ? 'good' : 'bad'}>{probe.ok ? `${probe.message}，用时 ${probe.latencyMs} ms` : probe.message}</Note>}
        <Field label="模型" help={probe?.models.length ? undefined : '点「测试」可以读取这把密钥能用的完整列表，也可以直接填写。'}>
          <Combo label="模型" value={model} onChange={setModel} options={options} placeholder="模型名称" loading={testing} />
        </Field>
        <Field label="显示名称">
          <TextInput value={label} aria-label="显示名称" onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

const CONTEXT_PRESETS = [16_000, 32_000, 64_000, 128_000, 200_000];

function Generation() {
  const instance = useStore((s) => s.tavern?.instance);
  const { data, set, reload } = useLoad(() => call('models:generation'), [instance?.userDir]);
  const [draft, setDraft] = useState<Partial<GenerationView>>({});
  const [busy, run] = useBusy();
  useDataChanged(['settings'], reload);
  if (!data) return null;
  const view = { ...data, ...draft };
  const dirty = (Object.keys(draft) as (keyof GenerationView)[]).some((k) => draft[k] !== data[k]);
  const patch = (p: Partial<GenerationView>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <>
      <Section title="对话参数" note="对应酒馆左侧面板里的设置。启用某个对话预设后，会以预设为准。">
        <SettingRow title="你的称呼" note="角色会这样叫你，也就是 {{user}}。">
          <TextInput aria-label="你的称呼" value={view.userName} onChange={(e) => patch({ userName: e.target.value })} style={{ width: 200 }} />
        </SettingRow>
        <SettingRow title="上下文长度" note="发给模型的最大 token 数。越长记得越多，也越贵。">
          <div className="row">
            <div className="row" style={{ gap: 4 }}>
              {CONTEXT_PRESETS.map((n) => (
                <button key={n} type="button" className="tag num" aria-pressed={view.contextSize === n} onClick={() => patch({ contextSize: n })}>
                  {compact(n)}
                </button>
              ))}
            </div>
            <NumberInput label="上下文长度" value={view.contextSize} min={512} max={2_000_000} step={1000} onChange={(v) => patch({ contextSize: v })} style={{ width: 120 }} />
          </div>
        </SettingRow>
        {view.contextSize >= 2_000_000 && (
          <div className="setting-inset">
            <Note kind="warn">酒馆助手的「最大化预设上下文长度」把它锁在了 200 万。长聊会很费 token，想自己控制就到酒馆的扩展面板里，把酒馆助手的这个选项关掉。</Note>
          </div>
        )}
        <SettingRow title="单次回复上限" note="带思考的模型要把思考也算进去，建议 4000 以上。">
          <NumberInput label="单次回复上限" value={view.maxTokens} min={16} max={200_000} step={100} unit="token" onChange={(v) => patch({ maxTokens: v })} style={{ width: 150 }} />
        </SettingRow>
        <SettingRow title="温度" note="越高越发散。部分思考模型会忽略它。">
          <div className="row" style={{ width: 260 }}>
            <Slider label="温度" value={view.temperature} min={0} max={2} step={0.05} onChange={(v) => patch({ temperature: Math.round(v * 100) / 100 })} />
            <span className="num" style={{ width: 40, textAlign: 'right' }}>
              {view.temperature.toFixed(2)}
            </span>
          </div>
        </SettingRow>
        <SettingRow title="逐字输出">
          <Switch label="逐字输出" checked={view.stream} onChange={(v) => patch({ stream: v })} />
        </SettingRow>
        <SettingRow title="打开酒馆时自动连接" note="不用每次进去都点一下连接。">
          <Switch label="自动连接" checked={view.autoConnect} onChange={(v) => patch({ autoConnect: v })} />
        </SettingRow>
      </Section>
      {dirty && (
        <div className="savebar">
          <span className="grow">对话参数未保存</span>
          <Button variant="ghost" onClick={() => setDraft({})}>
            放弃
          </Button>
          <Button
            variant="primary"
            icon={CheckCircle}
            busy={busy}
            onClick={() =>
              void run(() =>
                attempt(async () => {
                  set(await call('models:setGeneration', draft));
                  setDraft({});
                }, '已写入酒馆。浏览器里开着的页面请刷新'),
              )
            }
          >
            保存
          </Button>
        </div>
      )}
    </>
  );
}
