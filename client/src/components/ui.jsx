import React from 'react';
import { X } from 'lucide-react';

export function Btn({ variant = '', size = '', children, ...rest }) {
  return (
    <button className={`btn ${variant} ${size}`} {...rest}>{children}</button>
  );
}

export function Badge({ tone = '', dot = false, children }) {
  return <span className={`badge ${tone} ${dot ? 'dot' : ''}`}>{children}</span>;
}

export function Spinner({ size = 14 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon, text }) {
  return (
    <div className="empty">
      {icon}
      <div>{text}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, width, footer }) {
  if (!open) return null;
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div className={`modal ${width ? 'wide' : ''}`} style={width ? { maxWidth: width } : {}}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }} className="grow">{title}</h3>
          <Btn variant="ghost icon" onClick={onClose}><X size={16} /></Btn>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented" style={{ display: 'inline-flex', gap: 2, background: 'var(--card-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            border: 'none', background: value === o.value ? 'var(--card-3)' : 'transparent',
            color: value === o.value ? 'var(--text)' : 'var(--text-3)',
            borderRadius: 5, padding: '4px 12px', fontSize: 12.5, cursor: 'pointer'
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    not_started: { label: '未开始', tone: '' },
    in_progress: { label: '进行中', tone: 'blue' },
    pending_review: { label: '待确认', tone: 'amber' },
    completed: { label: '已完成', tone: 'green' }
  };
  const s = map[status] || map.not_started;
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function GuideBar({ steps, current = -1, warn = false }) {
  if (!steps || !steps.length) return null;
  return (
    <div className={`guide-bar ${warn ? 'warn' : ''}`}>
      {steps.map((s, i) => (
        <div key={i} className={`guide-step ${i === current ? 'cur' : ''} ${i < current ? 'done' : ''}`}>
          <span className="guide-n">{i + 1}</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

export const LIT_STATUS = {
  metadata_only: { label: '仅元数据', tone: '' },
  abstract_obtained: { label: '已获取摘要', tone: 'blue' },
  fulltext_obtained: { label: '已获取全文', tone: 'green' }
};
