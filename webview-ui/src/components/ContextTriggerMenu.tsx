import React, { useCallback, useEffect, useRef } from 'react';
import { TRIGGER_OPTIONS, type TriggerType } from '../pipelineConverter';
import './ContextTaskMenu.css';
import './ContextTriggerMenu.css';

interface Props {
  x: number;
  y: number;
  onSelect: (type: TriggerType) => void;
  onClose: () => void;
}

/** Floating menu shown on right-click when no trigger node exists yet. */
export default function ContextTriggerMenu({ x, y, onSelect, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  const menuWidth = 280;
  const menuMaxHeight = 320;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuMaxHeight - 8);

  return (
    <>
      <div className="ctx-menu-overlay" onMouseDown={onClose} />
      <div
        ref={menuRef}
        className="ctx-menu ctx-trigger-menu"
        style={{ left: clampedX, top: clampedY, width: menuWidth }}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="ctx-trigger-menu__header">Add Trigger</div>
        <div className="ctx-menu__list">
          {TRIGGER_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              className="ctx-menu__item"
              onClick={() => onSelect(opt.type)}
            >
              <span className="ctx-menu__item-label">{opt.label}</span>
              <span className="ctx-menu__item-sub">{opt.description}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
