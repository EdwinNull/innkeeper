import {
  BookOpenText, Cards, ChatTeardropText, Copy, DotsThreeOutline, Export, FileArrowUp, FolderOpen, Heart, Image as ImageIcon, LinkSimple, MagicWand, Plus, Trash, UserPlus, X,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { LOOK_RULES, splitOutfit } from '@shared/catalog/scene';
import type { Appearance, CharacterDetail, CharacterPatch, CharacterSummary, ImportOutcome } from '@shared/types';
import { avatarUrl, call } from '../lib/api';
import { ago, bytes, classes, compact } from '../lib/format';
import { useBusy, useDataChanged, useDebounced, useLoad } from '../lib/hooks';
import { attempt, confirm, toast, toastError, useStore } from '../lib/store';
import { Button, Check, Dialog, Empty, Field, IconButton, Menu, PageHead, SearchInput, Select, Sheet, SheetClose, TextInput, Tip } from '../ui';

type Sort = 'recent' | 'name' | 'added' | 'tokens';

export function reportImport(results: ImportOutcome[]) {
  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  if (ok.length) toast(ok.length === 1 ? `${ok[0]!.name ?? ok[0]!.file} 已导入` : `导入了 ${ok.length} 项`, 'ok');
  for (const b of bad.slice(0, 3)) toast(`${b.file} 没有导入`, 'bad', b.message);
}

export function CharactersPage() {
  const instance = useStore((s) => s.tavern?.instance);
  const openSetup = useStore((s) => s.openSetup);
  const takeIntent = useStore((s) => s.takeIntent);
  const { data, loading, reload } = useLoad(() => call('chars:list'), [instance?.userDir]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [tag, setTag] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dropping, setDropping] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const q = useDebounced(query.trim().toLowerCase(), 120);
  useDataChanged(['characters'], reload);

  useEffect(() => {
    const intent = takeIntent();
    if (intent) setOpen(intent);
  }, [takeIntent]);

  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of data ?? []) for (const t of c.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name]) => name);
  }, [data]);

  const shown = useMemo(() => {
    const list = (data ?? []).filter((c) => {
      if (favOnly && !c.fav) return false;
      if (tag && !c.tags.includes(tag)) return false;
      return !q || `${c.name} ${c.creator} ${c.tags.join(' ')} ${c.creatorNotes}`.toLowerCase().includes(q);
    });
    const by: Record<Sort, (a: CharacterSummary, b: CharacterSummary) => number> = {
      recent: (a, b) => (b.lastChat ?? 0) - (a.lastChat ?? 0) || b.modified - a.modified,
      name: (a, b) => a.name.localeCompare(b.name, 'zh-CN'),
      added: (a, b) => b.modified - a.modified,
      tokens: (a, b) => b.tokens - a.tokens,
    };
    return list.sort((a, b) => Number(b.fav) - Number(a.fav) || by[sort](a, b));
  }, [data, q, tag, sort, favOnly]);
  const favCount = useMemo(() => (data ?? []).filter((c) => c.fav).length, [data]);

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      reportImport(await call('chars:importFiles', paths));
    } catch (e) {
      toastError(e);
    }
  };

  const pick = async () => {
    await importPaths(await call('app:pickFiles', { title: '导入角色卡', multi: true, filters: [{ name: '角色卡', extensions: ['png', 'json', 'charx'] }] }));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    void importPaths([...e.dataTransfer.files].map((f) => window.innkeeper.pathForFile(f)).filter(Boolean));
  };

  // 收藏夹里的卡要先取消收藏，批量删除时跳过它们
  const removeSelected = async () => {
    const kept = new Set((data ?? []).filter((c) => c.fav && selected.has(c.file)).map((c) => c.file));
    const files = [...selected].filter((f) => !kept.has(f));
    if (!files.length) {
      toast('选中的都在收藏夹里，先取消收藏才能删除', 'info');
      return;
    }
    const ok = await confirm({
      title: `删除 ${files.length} 张角色卡`,
      body: `卡片会移到系统回收站，聊天记录保留。${kept.size ? `另外 ${kept.size} 张在收藏夹里，不会删除。` : ''}`,
      confirm: '删除',
      danger: true,
    });
    if (!ok) return;
    if (await attempt(() => call('chars:remove', files), '已移到回收站')) setSelected(new Set());
  };

  if (!instance) {
    return (
      <>
        <PageHead title="角色卡">收纳、整理和编辑你的角色。</PageHead>
        <Empty icon={Cards} title="先安装酒馆" actions={<Button variant="primary" onClick={() => openSetup(true)}>一键配置</Button>}>
          角色卡放在酒馆的数据目录里。
        </Empty>
      </>
    );
  }

  return (
    <div
      className="chars"
      onDragEnter={(e) => e.dataTransfer.types.includes('Files') && setDropping(true)}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
      onDrop={onDrop}
    >
      <PageHead
        title="角色卡"
        actions={
          <>
            <Menu
              items={[
                { label: '新建空白角色', icon: UserPlus, onSelect: () => setCreateOpen(true) },
                { label: '从链接导入', icon: LinkSimple, onSelect: () => setLinkOpen(true) },
                { label: '官方示例卡', icon: Cards, onSelect: () => setStarterOpen(true) },
              ]}
            >
              <Button icon={Plus}>更多方式</Button>
            </Menu>
            <Button variant="primary" icon={FileArrowUp} onClick={() => void pick()}>
              导入
            </Button>
          </>
        }
      >
        支持 V1 至 V3 的 PNG、JSON 与 CHARX，把文件拖进窗口也行。
      </PageHead>

      {data && data.length > 0 && (
        <div className="chars-bar">
          <SearchInput value={query} onChange={setQuery} placeholder="按名字、作者、标签搜索" style={{ width: 260 }} />
          <div className="row grow chars-tags">
            <button type="button" className="tag" aria-pressed={favOnly} title="收藏夹里的卡要先取消收藏才能删除" onClick={() => setFavOnly(!favOnly)}>
              <Heart size={11} weight={favOnly ? 'fill' : 'regular'} />
              收藏夹 <span className="num">{favCount}</span>
            </button>
            {tags.map((t) => (
              <button key={t} type="button" className="tag" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                {t}
              </button>
            ))}
          </div>
          <Select
            label="排序"
            value={sort}
            onChange={(v) => setSort(v as Sort)}
            style={{ width: 128 }}
            options={[
              { value: 'recent', label: '最近聊过' },
              { value: 'added', label: '最近修改' },
              { value: 'name', label: '名字' },
              { value: 'tokens', label: '设定长度' },
            ]}
          />
        </div>
      )}

      {data && data.length === 0 && (
        <Empty
          icon={Cards}
          title="还没有角色"
          actions={
            <>
              <Button variant="primary" icon={FileArrowUp} onClick={() => void pick()}>
                导入角色卡
              </Button>
              <Button onClick={() => setStarterOpen(true)}>看看官方示例</Button>
            </>
          }
        >
          把下载好的角色卡图片拖进来即可。注意要用原图，聊天软件转发过的图会丢失角色数据。
        </Empty>
      )}
      {!data && loading && <div className="card-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card skeleton" />)}</div>}

      <div className="card-grid">
        {shown.map((c) => (
          <CharCard
            key={c.file}
            c={c}
            selecting={selected.size > 0}
            selected={selected.has(c.file)}
            onOpen={() => setOpen(c.file)}
            onSelect={(v) =>
              setSelected((s) => {
                const next = new Set(s);
                if (v) next.add(c.file);
                else next.delete(c.file);
                return next;
              })
            }
          />
        ))}
      </div>
      {data && data.length > 0 && shown.length === 0 && (
        <p className="dim" style={{ padding: '60px 0', textAlign: 'center' }}>
          {favOnly && favCount === 0 ? '收藏夹还是空的。点卡片右上角的心形收进来，收藏夹里的卡要先取消收藏才能删除。' : '没有匹配的角色'}
        </p>
      )}

      {selected.size > 0 && (
        <div className="savebar">
          <span className="grow num">选中 {selected.size} 张</span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
          <Button variant="danger" icon={Trash} onClick={() => void removeSelected()}>
            删除
          </Button>
        </div>
      )}

      <AnimatePresence>
        {dropping && (
          <motion.div className="drop-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <FileArrowUp size={44} weight="light" />
            <span className="serif">松手导入角色卡</span>
          </motion.div>
        )}
      </AnimatePresence>

      <CharacterSheet file={open} onClose={() => setOpen(null)} onOpen={setOpen} />
      <LinkImport open={linkOpen} onClose={() => setLinkOpen(false)} />
      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={setOpen} />
      <Starters open={starterOpen} onClose={() => setStarterOpen(false)} existing={data ?? []} />
    </div>
  );
}

function CharCard({ c, selecting, selected, onOpen, onSelect }: { c: CharacterSummary; selecting: boolean; selected: boolean; onOpen: () => void; onSelect: (v: boolean) => void }) {
  return (
    <div className={classes('card', selected && 'selected', selecting && 'selecting')}>
      <button type="button" className="card-hit" aria-label={c.name} onClick={() => (selecting ? onSelect(!selected) : onOpen())}>
        <img src={avatarUrl(c.file, 420, c.modified)} alt="" loading="lazy" draggable={false} />
        <span className="card-shade" />
        <span className="card-text">
          <span className="card-name">{c.name}</span>
          <span className="card-meta num">{[c.creator, c.lastChat ? ago(c.lastChat) : `${compact(c.tokens)} token`].filter(Boolean).join('　')}</span>
        </span>
      </button>
      <span className="card-check">
        <Check label={`选择 ${c.name}`} checked={selected} onChange={onSelect} />
      </span>
      <span className="card-flags">
        {c.bookEntries > 0 && (
          <Tip text={`内嵌世界书 ${c.bookEntries} 条`}>
            <span className="card-flag">
              <BookOpenText size={13} />
            </span>
          </Tip>
        )}
        <button type="button" className={classes('card-flag fav', c.fav && 'on')} aria-label={c.fav ? '移出收藏夹' : '收进收藏夹'} title={c.fav ? '移出收藏夹' : '收进收藏夹'} onClick={() => void attempt(() => call('chars:setFav', c.file, !c.fav))}>
          <Heart size={13} weight={c.fav ? 'fill' : 'regular'} />
        </button>
      </span>
    </div>
  );
}

const TEXT_FIELDS: { key: keyof CharacterPatch & keyof CharacterDetail; label: string; rows: number; help?: string }[] = [
  { key: 'description', label: '角色设定', rows: 8, help: '始终在上下文里，是角色的核心。' },
  { key: 'firstMessage', label: '开场白', rows: 6 },
  { key: 'personality', label: '性格', rows: 3 },
  { key: 'scenario', label: '场景', rows: 3 },
  { key: 'mesExample', label: '对话示例', rows: 5 },
  { key: 'creatorNotes', label: '作者说明', rows: 4, help: '只给你看，不会发给模型。' },
  { key: 'systemPrompt', label: '系统提示词', rows: 4 },
  { key: 'postHistory', label: '历史后指令', rows: 3, help: '插在聊天历史之后，约束力最强。' },
];

function CharacterSheet({ file, onClose, onOpen }: { file: string | null; onClose: () => void; onOpen: (f: string) => void }) {
  const [held, setHeld] = useState(file);
  useEffect(() => {
    if (file) setHeld(file);
  }, [file]);
  const { data, error, set, reload } = useLoad(() => (held ? call('chars:detail', held) : Promise.resolve(undefined)), [held]);
  const [draft, setDraft] = useState<CharacterPatch>({});
  const [tab, setTab] = useState<'profile' | 'greetings' | 'book' | 'image'>('profile');
  const [busy, run] = useBusy();
  const go = useStore((s) => s.go);

  useEffect(() => {
    setDraft({});
    setTab('profile');
  }, [held]);
  useDataChanged(['characters'], () => file && reload());

  const c = data && data.file === held ? data : undefined;
  const dirty = c ? (Object.keys(draft) as (keyof CharacterPatch)[]).some((k) => JSON.stringify(draft[k]) !== JSON.stringify(c[k])) : false;
  const value = <K extends keyof CharacterPatch>(key: K) => (draft[key] ?? (c as CharacterDetail | undefined)?.[key as keyof CharacterDetail]) as NonNullable<CharacterPatch[K]>;
  const patch = (p: CharacterPatch) => setDraft((d) => ({ ...d, ...p }));

  const close = async () => {
    if (dirty) {
      const ok = await confirm({ title: '放弃未保存的修改', body: '这张卡有改动还没保存。', confirm: '放弃', danger: true });
      if (!ok) return;
      setDraft({});
    }
    onClose();
  };

  const save = () =>
    run(() =>
      attempt(async () => {
        set(await call('chars:update', held!, draft));
        setDraft({});
      }, '已保存到卡片'),
    );

  const changeAvatar = async () => {
    const [image] = await call('app:pickFiles', { title: '选择立绘', filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }] });
    if (image && held) await attempt(() => call('chars:setAvatar', held, image), '立绘已更换');
  };

  const remove = async () => {
    if (!held || !c) return;
    const ok = await confirm({ title: `删除「${c.name}」`, body: '卡片会移到系统回收站，聊天记录保留。', confirm: '删除', danger: true });
    if (ok && (await attempt(() => call('chars:remove', [held]), '已移到回收站'))) onClose();
  };

  return (
    <Sheet
      open={file !== null}
      onClose={() => void close()}
      title={c?.name ?? '角色'}
      wide
      head={
        <div className="char-head">
          {held && <img className="char-head-bg" src={avatarUrl(held, 800, c?.modified)} alt="" />}
          <div className="char-head-veil" />
          <div className="char-head-main">
            <button type="button" className="char-portrait" onClick={() => void changeAvatar()} aria-label="更换立绘">
              {held && <img src={avatarUrl(held, 520, c?.modified)} alt="" />}
              <span>
                <ImageIcon size={16} /> 更换立绘
              </span>
            </button>
            <div className="grow">
              <div className="char-title">{c?.name ?? ' '}</div>
              <div className="char-sub num">
                {c && [c.creator, c.version && `版本 ${c.version}`, c.spec, `约 ${compact(c.tokens)} token`, bytes(c.sizeBytes)].filter(Boolean).join('　')}
              </div>
              <div className="row wrap" style={{ gap: 5, marginTop: 10 }}>
                {c?.tags.slice(0, 10).map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="char-head-tools">
            <IconButton icon={Heart} size="sm" label={c?.fav ? '移出收藏夹' : '收进收藏夹'} onClick={() => c && void attempt(() => call('chars:setFav', c.file, !c.fav))} style={c?.fav ? { color: 'var(--amber)' } : undefined} />
            <Menu
              items={[
                { label: '导出 PNG', icon: Export, onSelect: () => held && void attempt(() => call('chars:export', held, 'png')) },
                { label: '导出 JSON', icon: Export, onSelect: () => held && void attempt(() => call('chars:export', held, 'json')) },
                {
                  label: '复制一份',
                  icon: Copy,
                  onSelect: () => held && void attempt(async () => onOpen(await call('chars:duplicate', held)), '已复制'),
                },
                {
                  label: '提取内嵌世界书',
                  icon: BookOpenText,
                  disabled: !c?.book,
                  onSelect: () =>
                    held &&
                    void attempt(async () => {
                      const name = await call('chars:extractBook', held);
                      toast(`已存为 ${name}`, 'ok');
                    }),
                },
                'sep',
                c?.fav
                  ? { label: '在收藏夹里，先取消收藏才能删除', icon: Trash, disabled: true, onSelect: () => undefined }
                  : { label: '删除', icon: Trash, danger: true, onSelect: () => void remove() },
              ]}
            >
              <Button variant="ghost" size="sm" icon={DotsThreeOutline} aria-label="更多" />
            </Menu>
            <SheetClose asChild>
              <Button variant="ghost" size="sm" icon={X} aria-label="关闭" />
            </SheetClose>
          </div>
        </div>
      }
      footer={
        dirty ? (
          <>
            <span className="grow dim">修改会直接写进卡片文件</span>
            <Button variant="ghost" onClick={() => setDraft({})}>
              放弃
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              保存
            </Button>
          </>
        ) : undefined
      }
    >
      {error && !c && <p className="dim">读取失败：{error.message}</p>}
      {c && (
        <>
          <div className="char-stats num">
            <div>
              <b>{c.chats}</b>
              <span>段聊天</span>
            </div>
            <div>
              <b>{c.greetings}</b>
              <span>个开场</span>
            </div>
            <div>
              <b>{c.bookEntries}</b>
              <span>条世界书</span>
            </div>
            <div>
              <b>{c.lastChat ? ago(c.lastChat) : '从未'}</b>
              <span>上次聊天</span>
            </div>
          </div>
          <div className="seg" role="tablist" style={{ margin: '0 0 22px' }}>
            {(
              [
                ['profile', '设定'],
                ['greetings', `开场 ${c.greetings}`],
                ['book', `世界书 ${c.bookEntries}`],
                ['image', '画图'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'profile' && (
            <div className="fields">
              <div className="grid-2">
                <Field label="名字">
                  <TextInput aria-label="名字" value={value('name')} onChange={(e) => patch({ name: e.target.value })} />
                </Field>
                <Field label="作者">
                  <TextInput aria-label="作者" value={value('creator')} onChange={(e) => patch({ creator: e.target.value })} />
                </Field>
              </div>
              <Field label="标签" help="用逗号分隔。">
                <TextInput aria-label="标签" value={value('tags').join('，')} onChange={(e) => patch({ tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter((t, i, a) => t || i === a.length - 1) })} onBlur={() => draft.tags && patch({ tags: draft.tags.filter(Boolean) })} />
              </Field>
              {TEXT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} help={f.help} aside={<span className="num">{String(value(f.key as keyof CharacterPatch) ?? '').length || ''}</span>}>
                  <textarea className="textarea" rows={f.rows} aria-label={f.label} spellCheck={false} value={String(value(f.key as keyof CharacterPatch) ?? '')} onChange={(e) => patch({ [f.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          )}
          {tab === 'greetings' && (
            <div className="fields">
              <Field label="主开场白">
                <textarea className="textarea" rows={7} aria-label="主开场白" value={value('firstMessage')} onChange={(e) => patch({ firstMessage: e.target.value })} />
              </Field>
              {value('alternateGreetings').map((g, i) => (
                <Field
                  key={i}
                  label={`备选 ${i + 1}`}
                  aside={
                    <button type="button" className="linkish" onClick={() => patch({ alternateGreetings: value('alternateGreetings').filter((_, j) => j !== i) })}>
                      移除
                    </button>
                  }
                >
                  <textarea className="textarea" rows={6} aria-label={`备选开场 ${i + 1}`} value={g} onChange={(e) => patch({ alternateGreetings: value('alternateGreetings').map((x, j) => (j === i ? e.target.value : x)) })} />
                </Field>
              ))}
              <div>
                <Button size="sm" icon={Plus} onClick={() => patch({ alternateGreetings: [...value('alternateGreetings'), ''] })}>
                  添加开场
                </Button>
              </div>
            </div>
          )}
          {tab === 'image' && held && <AppearanceTab file={held} />}
          {tab === 'book' &&
            (c.book ? (
              <>
                <p className="muted" style={{ marginBottom: 14 }}>
                  内嵌在卡里的世界书，这里只读。要修改请先从右上角菜单提取成独立世界书，再到酒馆里编辑。
                </p>
                <div className="book">
                  {c.book.entries.map((e, i) => (
                    <details key={i} className={classes(!e.enabled && 'off')}>
                      <summary>
                        <span className="truncate grow">{e.comment || e.keys[0] || `条目 ${i + 1}`}</span>
                        <span className="dim truncate" style={{ maxWidth: 260 }}>
                          {e.keys.join('、')}
                        </span>
                      </summary>
                      <div className="book-text selectable">{e.content}</div>
                    </details>
                  ))}
                </div>
              </>
            ) : (
              <Empty icon={BookOpenText} title="没有内嵌世界书">独立的世界书在「资源」页管理。<br /><Button style={{ marginTop: 16 }} size="sm" onClick={() => { onClose(); go('resources'); }}>去资源页</Button></Empty>
            ))}
        </>
      )}
    </Sheet>
  );
}

/** 画图外貌：存在酒馆的生图设置里，画到这个角色时自动带上 */
function AppearanceTab({ file }: { file: string }) {
  const { data, set } = useLoad(() => call('chars:appearance', file), [file]);
  const [draft, setDraft] = useState<Appearance | null>(null);
  const [busy, run] = useBusy();
  const [extracting, runExtract] = useBusy();
  // 钩子都要在提前返回之前：外貌还没读到时少调一个，读到后多调一个，React 会直接崩掉整个页面
  const { data: loras } = useLoad(() => call('img:loras'), [file]);
  useEffect(() => setDraft(null), [file]);
  if (!data) return null;
  const v = draft ?? data;
  const dirty = draft !== null && (draft.prompt !== data.prompt || draft.negative !== data.negative || draft.outfit !== data.outfit);
  const extract = () =>
    runExtract(() =>
      attempt(async () => {
        const got = await call('chars:extractAppearance', file);
        setDraft({ ...v, ...got });
      }),
    );
  const addLora = (f: string) => {
    const tag = `<lora:${f.replace(/\.safetensors$/i, '')}:0.8>`;
    if (!v.prompt.includes(tag)) setDraft({ ...v, prompt: [v.prompt.trim().replace(/,\s*$/, ''), tag].filter(Boolean).join(', ') });
  };
  // 旧版本存的外貌里混着衣服，拆出来之后换装、裸体的场景才不会被衣服盖住
  const mixed = splitOutfit(v.prompt, LOOK_RULES);
  const split = () => setDraft({ ...v, prompt: mixed.look, outfit: [v.outfit, mixed.outfit].filter(Boolean).join(', ') });
  const save = () =>
    run(() =>
      attempt(async () => {
        set(await call('chars:setAppearance', file, v));
        setDraft(null);
      }, '已保存'),
    );

  return (
    <div className="fields">
      <p className="muted">
        画到这个角色时，外貌会加在通用前缀后面；对话模型这一幕写的发色、瞳色、身材和这里对不上时，以这里为准，长相才不会每张都变。存在酒馆的生图设置里，不改动卡片文件。
      </p>
      <Field
        label="外貌"
        help="只写不会变的：发色、发型、瞳色、身材、角、耳朵、伤疤。「从设定提取」会用当前接入的对话模型读这张卡的设定，看一眼再保存。角色 LoRA 写成 <lora:文件名:0.8>，轻量引擎、ComfyUI 和 SD WebUI 都认，记得把它的触发词也写上。"
        aside={
          <Button size="sm" icon={MagicWand} busy={extracting} onClick={() => void extract()}>
            从设定提取
          </Button>
        }
      >
        <textarea className="textarea mono" rows={3} aria-label="外貌" spellCheck={false} placeholder="1girl, long brown hair, pink eyes, medium breasts" value={v.prompt} onChange={(e) => setDraft({ ...v, prompt: e.target.value })} />
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {loras?.files.length ? (
            <Select label="加入角色 LoRA" placeholder="加入角色 LoRA" style={{ minWidth: 220 }} value="" options={loras.files.map((f) => ({ value: f, label: f.replace(/\.safetensors$/i, '') }))} onChange={addLora} />
          ) : (
            <span className="dim">没有 LoRA 文件。放进右边这个文件夹后，这里就能选。</span>
          )}
          {loras && (
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => void attempt(() => call('app:reveal', loras.dir))}>
              打开 LoRA 文件夹
            </Button>
          )}
        </div>
      </Field>
      <Field
        label="常穿的衣服"
        help="对话模型这一幕没写穿什么时才加上；写了换装、泳装或者全裸，就听这一幕的。"
        aside={
          mixed.outfit ? (
            <Button size="sm" onClick={split}>
              把外貌里的衣服挪过来
            </Button>
          ) : undefined
        }
      >
        <textarea className="textarea mono" rows={2} aria-label="常穿的衣服" spellCheck={false} placeholder="white shirt, beige trench coat, black thighhighs" value={v.outfit} onChange={(e) => setDraft({ ...v, outfit: e.target.value })} />
      </Field>
      <Field label="不想出现的" help="只对这个角色生效的负面提示词，比如 glasses、hat。">
        <textarea className="textarea mono" rows={2} aria-label="不想出现的" spellCheck={false} value={v.negative} onChange={(e) => setDraft({ ...v, negative: e.target.value })} />
      </Field>
      <div className="row">
        <span className="grow" />
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            放弃
          </Button>
        )}
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => void save()}>
          保存外貌
        </Button>
      </div>
    </div>
  );
}

function LinkImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, run] = useBusy();
  const go = () =>
    run(async () => {
      try {
        reportImport([await call('chars:importUrl', url)]);
        setUrl('');
        onClose();
      } catch (e) {
        toastError(e);
      }
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="从链接导入"
      description="支持 Chub 与 AI Character Cards 的角色页，以及任意 PNG、JSON 直链。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" busy={busy} disabled={!/^https?:\/\//i.test(url.trim())} onClick={() => void go()}>
            导入
          </Button>
        </>
      }
    >
      <TextInput mono autoFocus aria-label="链接" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} />
    </Dialog>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (f: string) => void }) {
  const [name, setName] = useState('');
  const [busy, run] = useBusy();
  const go = () =>
    run(() =>
      attempt(async () => {
        const created = await call('chars:create', { name });
        setName('');
        onClose();
        onCreated(created.file);
      }),
    );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="新建角色"
      description="先起个名字，接着填设定和立绘。"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void go()}>
            创建
          </Button>
        </>
      }
    >
      <TextInput autoFocus aria-label="名字" placeholder="角色名字" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && void go()} />
    </Dialog>
  );
}

function Starters({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: CharacterSummary[] }) {
  const { data } = useLoad(() => call('chars:starters'));
  const [busy, setBusy] = useState<string | null>(null);
  const names = new Set(existing.map((c) => c.name));
  return (
    <Dialog open={open} onClose={onClose} title="官方示例卡" description="来自 SillyTavern 官方资源库，英文对话。适合用来熟悉酒馆。" wide>
      <div className="table" style={{ marginBottom: 18 }}>
        {data?.map((s) => (
          <div key={s.id} className="table-row tall">
            <div className="grow">
              <div style={{ fontWeight: 540 }}>{s.name}</div>
              <div className="dim">{s.description}</div>
            </div>
            {names.has(s.name) ? (
              <span className="tag jade">已有</span>
            ) : (
              <Button
                size="sm"
                busy={busy === s.id}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(s.id);
                  try {
                    reportImport([await call('chars:installStarter', s.id)]);
                  } catch (e) {
                    toastError(e);
                  }
                  setBusy(null);
                }}
              >
                添加
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="dim row" style={{ paddingBottom: 20 }}>
        <ChatTeardropText size={15} />
        想要中文角色？把下载好的 PNG 原图拖进角色卡页面即可。
      </p>
    </Dialog>
  );
}
