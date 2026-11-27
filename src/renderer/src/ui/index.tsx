import {
  CaretDown, CaretUpDown, Check as CheckIcon, CheckCircle, DotsThreeOutline, Eye, EyeSlash, Info, MagnifyingGlass, Warning, WarningCircle, X, type Icon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Checkbox as RCheckbox, Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Select as RSelect, Slider as RSlider, Switch as RSwitch,
  Tooltip as RTooltip,
} from 'radix-ui';
import {
  forwardRef, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { classes } from '../lib/format';
import { dismissToast, useStore } from '../lib/store';

export const TipProvider = RTooltip.Provider;

export function Tip({ text, children, side = 'top' }: { text: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!text) return <>{children}</>;
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={10}>
          {text}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: Icon;
  busy?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: IconCmp, busy, block, className, children, ...rest },
  ref,
) {
  const v = variant === 'danger-solid' ? 'danger solid' : variant === 'secondary' ? '' : variant;
  return (
    <button
      ref={ref}
      type="button"
      className={classes('btn', v, size !== 'md' && size, !children && 'icon', block && 'block', className)}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" /> : IconCmp && <IconCmp size={size === 'lg' ? 18 : children ? 16 : 18} weight={variant === 'primary' ? 'bold' : IconCmp === DotsThreeOutline ? 'fill' : 'regular'} />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { icon: Icon; label: string; tipSide?: 'top' | 'bottom' | 'left' | 'right' }>(
  function IconButton({ icon, label, variant = 'ghost', tipSide, ...rest }, ref) {
    return (
      <Tip text={label} side={tipSide}>
        <Button ref={ref} variant={variant} icon={icon} aria-label={label} {...rest} />
      </Tip>
    );
  },
);

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <RSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label}>
      <RSwitch.Thumb />
    </RSwitch.Root>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <RCheckbox.Root className="check" checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-label={label}>
      <RCheckbox.Indicator>
        <CheckIcon size={12} weight="bold" style={{ display: 'block' }} />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Slider({ value, min, max, step, onChange, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }) {
  return (
    <RSlider.Root className="slider" value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v!)}>
      <RSlider.Track className="slider-track">
        <RSlider.Range className="slider-range" />
      </RSlider.Track>
      <RSlider.Thumb className="slider-thumb" aria-label={label} />
    </RSlider.Root>
  );
}

export interface Option {
  value: string;
  label: string;
  note?: string;
}

export function Select({ value, options, onChange, placeholder, label, style }: {
  value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string; label: string; style?: CSSProperties;
}) {
  return (
    <RSelect.Root value={value} onValueChange={onChange}>
      <RSelect.Trigger className="select-trigger" aria-label={label} style={style}>
        <RSelect.Value placeholder={placeholder} />
        <CaretDown size={13} />
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="pop" position="popper" sideOffset={5} style={{ minWidth: 'var(--radix-select-trigger-width)' }}>
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item key={o.value} value={o.value} className="pop-item">
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                {o.note && <span className="dim" style={{ marginLeft: 'auto', fontSize: 12 }}>{o.note}</span>}
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/** 可输入也可挑选，用于模型名这类「有列表但不限于列表」的字段。 */
export function Combo({ value, options, onChange, placeholder, label, loading }: {
  value: string; options: { value: string; note?: string }[]; onChange: (v: string) => void; placeholder?: string; label: string; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (q ? options.filter((o) => o.value.toLowerCase().includes(q)) : options).slice(0, 200);
  }, [options, filter]);
  useEffect(() => setCursor(0), [filter, open]);
  useEffect(() => {
    listRef.current?.querySelector('.hl')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const pick = (v: string) => {
    onChange(v);
    setFilter('');
    setOpen(false);
  };
  return (
    <RPopover.Root open={open && shown.length > 0}>
      <RPopover.Anchor asChild>
        <div className="input-group">
          <input
            className="input mono"
            aria-label={label}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => {
              onChange(e.target.value);
              setFilter(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setFilter('');
              if (options.length) setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onClick={() => options.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (!open) return;
              if (e.key === 'Escape') {
                // 只收起下拉，不连带关掉外层抽屉
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                setOpen(false);
                return;
              }
              if (e.key === 'ArrowDown') setCursor((c) => Math.min(shown.length - 1, c + 1));
              else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
              else if (e.key === 'Enter' && shown[cursor]) pick(shown[cursor]!.value);
              else return;
              e.preventDefault();
            }}
            style={{ paddingRight: 32 }}
          />
          <span className="trail" style={{ right: 10, color: 'var(--fg-3)', pointerEvents: 'none' }}>
            {loading ? <span className="spinner" /> : <CaretUpDown size={14} />}
          </span>
        </div>
      </RPopover.Anchor>
      <RPopover.Portal>
        <RPopover.Content
          className="pop"
          sideOffset={5}
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          style={{ width: 'var(--radix-popover-trigger-width)' }}
        >
          <div className="combo-list" ref={listRef}>
            {shown.map((o, i) => (
              <div
                key={o.value}
                className={classes('pop-item', i === cursor && 'hl')}
                onMouseEnter={() => setCursor(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.value);
                }}
              >
                <span className="mono truncate">{o.value}</span>
                {o.note && <span className="dim num" style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>{o.note}</span>}
              </div>
            ))}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export function SecretInput({ value, onChange, placeholder, label, onEnter }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; onEnter?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input
        className="input mono"
        type={show ? 'text' : 'password'}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{ paddingRight: 40 }}
        onChange={(e) => onChange(e.target.value.trim())}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      <span className="trail">
        <Button size="sm" variant="ghost" icon={show ? EyeSlash : Eye} aria-label={show ? '隐藏' : '显示'} onClick={() => setShow(!show)} />
      </span>
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, unit, label, style }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; label: string; style?: CSSProperties;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || Number.isNaN(n)) return setText(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <div className="input-group" style={style}>
      <input
        className="input num"
        type="number"
        aria-label={label}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        style={unit ? { paddingRight: 16 + unit.length * 13 } : undefined}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: CSSProperties }) {
  return (
    <div className="input-group" style={style}>
      <span className="lead">
        <MagnifyingGlass size={15} />
      </span>
      <input className="input" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      {value && (
        <span className="trail">
          <Button size="sm" variant="ghost" icon={X} aria-label="清空" onClick={() => onChange('')} />
        </span>
      )}
    </div>
  );
}

export const TextInput = (props: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) => {
  const { mono, className, ...rest } = props;
  return <input className={classes('input', mono && 'mono', className)} spellCheck={false} autoComplete="off" {...rest} />;
};

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; icon?: Icon }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(({ value: v, label: text, icon: I }) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {I && <I size={14} />}
          {text}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: Icon;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function Menu({ items, children }: { items: (MenuItem | 'sep')[]; children: ReactNode }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{children}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className="pop" sideOffset={6} align="end" collisionPadding={12} style={{ minWidth: 168 }}>
          {items.map((item, i) =>
            item === 'sep' ? (
              <RMenu.Separator key={i} className="pop-sep" />
            ) : (
              <RMenu.Item key={i} className={classes('pop-item', item.danger && 'danger')} disabled={item.disabled} onSelect={item.onSelect}>
                {item.icon && <item.icon size={15} />}
                {item.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

const spring = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 } as const;

export function Dialog({ open, onClose, title, description, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={classes('dialog', wide && 'wide')}
                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.99 }}
                transition={{ duration: 0.18, ease: [0.22, 0.8, 0.28, 1] }}
              >
                <div className="dialog-head">
                  <RDialog.Title className="dialog-title">{title}</RDialog.Title>
                  {description && <div className="dialog-desc">{description}</div>}
                </div>
                {children && <div className="dialog-body">{children}</div>}
                {footer && <div className="dialog-foot">{footer}</div>}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

export function Sheet({ open, onClose, title, head, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; head?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <AnimatePresence>
        {open && (
          <RDialog.Portal forceMount>
            <RDialog.Overlay asChild forceMount>
              <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
            </RDialog.Overlay>
            <RDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div className={classes('sheet', wide && 'wide')} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}>
                {head ? (
                  <>
                    <RDialog.Title className="sr-only">{title}</RDialog.Title>
                    {head}
                  </>
                ) : (
                  <div className="sheet-head">
                    <RDialog.Title className="dialog-title grow">{title}</RDialog.Title>
                    <RDialog.Close asChild>
                      <Button variant="ghost" size="sm" icon={X} aria-label="关闭" />
                    </RDialog.Close>
                  </div>
                )}
                <div className="sheet-body">{children}</div>
                {footer && <div className="sheet-foot">{footer}</div>}
              </motion.div>
            </RDialog.Content>
          </RDialog.Portal>
        )}
      </AnimatePresence>
    </RDialog.Root>
  );
}

export const SheetClose = RDialog.Close;

export function ConfirmHost() {
  const request = useStore((s) => s.confirming);
  const last = useRef(request);
  if (request) last.current = request;
  const view = request ?? last.current;
  return (
    <Dialog
      open={request !== null}
      onClose={() => request?.resolve(false)}
      title={view?.title ?? ''}
      description={view?.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => request?.resolve(false)}>
            取消
          </Button>
          <Button variant={view?.danger ? 'danger-solid' : 'primary'} onClick={() => request?.resolve(true)} autoFocus>
            {view?.confirm}
          </Button>
        </>
      }
    />
  );
}

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className="toast"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            onClick={() => dismissToast(t.id)}
          >
            {t.kind === 'ok' && <CheckCircle size={17} color="var(--jade)" weight="fill" />}
            {t.kind === 'bad' && <WarningCircle size={17} color="var(--seal)" weight="fill" />}
            {t.kind === 'info' && <Info size={17} color="var(--mist)" weight="fill" />}
            <div>
              {t.text}
              {t.hint && <div className="hint">{t.hint}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className={classes('bar', value === null && 'indeterminate')} role="progressbar" aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      <i style={{ width: `${(value ?? 0) * 100}%` }} />
    </div>
  );
}

export function Empty({ icon: IconCmp, title, children, actions }: { icon: Icon; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <IconCmp size={40} weight="light" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Note({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const I = kind === 'warn' ? Warning : kind === 'bad' ? WarningCircle : kind === 'good' ? CheckCircle : Info;
  return (
    <div className={classes('note', kind !== 'info' && kind)}>
      <I size={16} weight={kind === 'info' ? 'regular' : 'fill'} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Field({ label, aside, help, children }: { label: string; aside?: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {aside && <span className="aside">{aside}</span>}
      </div>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="row no-drag">{actions}</div>}
    </header>
  );
}

export function Section({ title, note, actions, children }: { title: string; note?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div className="grow">
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function SettingRow({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="grow">
        <div className="setting-title">{title}</div>
        {note && <div className="setting-note">{note}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
