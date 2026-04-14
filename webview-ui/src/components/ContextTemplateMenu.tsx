import React, { useEffect } from 'react';
import './ContextTemplateMenu.css';

interface Props {
  /** Viewport X coordinate (from MouseEvent.clientX) */
  x: number;
  /** Viewport Y coordinate (from MouseEvent.clientY) */
  y: number;
  /** Whether the node is a template node (expand) or an expanded node (collapse). */
  mode: 'expand' | 'collapse';
  /** Human-readable template path shown as a subtitle. */
  templatePath: string;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}

/** Floating context menu shown on right-clicking a template/expanded node. */
export default function ContextTemplateMenu({
  x,
  y,
  mode,
  templatePath,
  onExpand,
  onCollapse,
  onClose,
}: Props) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);

  // Clamp so the menu doesn't overflow the viewport
  const menuWidth = 260;
  const menuHeight = 96;
  const cx = Math.min(x, window.innerWidth - menuWidth - 8);
  const cy = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <>
      <div className="ctx-menu-overlay" onClick={onClose} />
      <div
        className="ctx-tmpl-menu"
        style={{ left: cx, top: cy, width: menuWidth }}
        role="menu"
      >
        <div className="ctx-tmpl-menu__path" title={templatePath}>
          {templatePath}
        </div>
        {mode === 'expand' ? (
          <button
            className="ctx-tmpl-menu__action"
            role="menuitem"
            onClick={() => { onExpand(); onClose(); }}
          >
            Expand template inline
          </button>
        ) : (
          <button
            className="ctx-tmpl-menu__action"
            role="menuitem"
            onClick={() => { onCollapse(); onClose(); }}
          >
            Collapse back to template
          </button>
        )}
      </div>
    </>
  );
}
