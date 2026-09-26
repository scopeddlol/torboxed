import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Check as CheckIcon, Minus, X } from 'lucide-react';
import type { JobSummary, Tag } from '../../shared/types';

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Check({ on, partial, onChange, label }: { on: boolean; partial?: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={partial ? 'mixed' : on}
      aria-label={label}
      className={`check ${on ? 'on' : ''} ${partial && !on ? 'partial' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      {partial && !on ? <Minus style={{ opacity: 1, transform: 'none' }} /> : <CheckIcon strokeWidth={3.5} />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
          {o.count !== undefined && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  icon,
  tone,
  size,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: string;
  size?: 'wide' | 'narrow';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon && <div className={`icon ${tone ? `tone-${tone}` : ''}`}>{icon}</div>}
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn close" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Sparkline({ data, className, height = 44, color = 'var(--accent)', color2 = 'var(--accent-2)' }: { data: number[]; className?: string; height?: number; color?: string; color2?: string }) {
  const id = useId().replace(/:/g, '');
  const w = 200;
  const pts = data.length > 1 ? data : [0, 0];
  const max = Math.max(...pts, 1);
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => [i * step, height - 3 - (v / max) * (height - 8)] as const);
  let line = `M${coords[0][0]},${coords[0][1]}`;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const cx = (x0 + x1) / 2;
    line += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg className={`spark ${className ?? ''}`} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={{ stopColor: color }} />
          <stop offset="100%" style={{ stopColor: color2 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#f${id})`} />
      <path d={line} fill="none" stroke={`url(#s${id})`} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  );
}

export function TagChip({ tag }: { tag: Tag | undefined | null }) {
  if (!tag) return null;
  return (
    <span className="tag-chip" style={{ '--c': tag.color } as React.CSSProperties}>
      {tag.name}
    </span>
  );
}

export function Empty({ icon, title, children, actions }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, aside, children }: { label: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {aside && <span className="aside">{aside}</span>}
      </div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export type Tone = 'accent' | 'accent2' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export function jobTone(j: JobSummary): Tone {
  if (j.status === 'error') return 'danger';
  if (j.status === 'completed') return 'success';
  if (j.paused) return 'warning';
  if (j.status === 'downloading') return 'accent';
  if (j.status === 'torbox' || j.status === 'submitting') return 'info';
  return 'muted';
}

export function jobLabel(j: JobSummary, globalPaused: boolean): string {
  if (j.status === 'completed') return 'Completed';
  if (j.status === 'error') return 'Failed';
  if (j.paused) return 'Paused';
  switch (j.status) {
    case 'queued':
      return 'Queued';
    case 'submitting':
      return 'Sending to TorBox';
    case 'torbox':
      return j.torboxId === null ? 'Queued on TorBox' : `TorBox ${Math.round(j.torboxProgress * 100)}%`;
    case 'waiting':
      return globalPaused ? 'Paused (all)' : j.nextRetryAt ? 'Retrying soon' : 'Ready · queued';
    case 'downloading':
      return 'Downloading';
  }
}

export function jobProgress(j: JobSummary): number {
  if (j.status === 'completed') return 1;
  if (j.status === 'torbox' || j.status === 'submitting' || j.status === 'queued') return j.torboxProgress;
  return j.size > 0 ? Math.min(1, j.downloaded / j.size) : 0;
}

export function ProgressBar({ job }: { job: JobSummary }) {
  const p = jobProgress(job);
  let cls = '';
  if (job.status === 'completed') cls = 'done';
  else if (job.status === 'error') cls = 'error';
  else if (job.paused) cls = 'paused';
  else if (job.status === 'torbox' || job.status === 'submitting') cls = 'torbox';
  else if (job.status === 'downloading') cls = 'active';
  else cls = 'muted';
  return (
    <div className={`progress ${cls}`}>
      <span style={{ width: `${Math.max(p * 100, job.status === 'torbox' ? 3 : 0)}%` }} />
    </div>
  );
}

export function Ring({ value, tone, children }: { value: number; tone: Tone; children: ReactNode }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const color = tone === 'accent' ? 'url(#ring-grad)' : `rgb(var(--${tone === 'accent2' ? 'accent-2' : tone}-rgb))`;
  return (
    <div className="job-ring">
      <svg className="ring" viewBox="0 0 42 42">
        <circle className="ring-bg" cx="21" cy="21" r={r} fill="none" strokeWidth="3" />
        <circle
          className="ring-fg"
          cx="21"
          cy="21"
          r={r}
          fill="none"
          strokeWidth="3"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0.001, Math.min(1, value)))}
        />
      </svg>
      <div className="ring-icon" style={{ color: tone === 'accent' ? 'var(--accent)' : color }}>
        {children}
      </div>
    </div>
  );
}

/** Shared SVG defs (gradient for rings). Render once. */
export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Logo({ size = 38 }: { size?: number }) {
  return <img src="./favicon.svg" width={size} height={size} alt="" draggable={false} />;
}

export { X };
