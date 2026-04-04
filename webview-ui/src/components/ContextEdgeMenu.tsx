import React, { useCallback, useEffect, useRef } from 'react';
import './ContextTaskMenu.css';
import './ContextEdgeMenu.css';

export type EdgeDropChoice = 'stage' | 'job' | 'task';

/** Whether the menu was triggered by dragging from a stage or a job node. */
export type EdgeDropSourceKind = 'stage' | 'job';

interface Props {
  x: number;
  y: number;
  /** rawId or label of the source node, shown in item subtitles */
  sourceLabel: string;
  /** Which node kind initiated the drag — controls which options are shown */
  sourceKind: EdgeDropSourceKind;
  onSelect: (choice: EdgeDropChoice) => void;
  onClose: () => void;
}

/** Menu shown when the user drags an edge from a stage or job onto empty canvas space. */
export default function ContextEdgeMenu({ x, y, sourceLabel, sourceKind, onSelect, onClose }: Props) {
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
  const menuMaxHeight = 200;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuMaxHeight - 8);

  return (
    <>
      <div className="ctx-menu-overlay" onMouseDown={onClose} />
      <div
        ref={menuRef}
        className="ctx-menu ctx-edge-menu"
        style={{ left: clampedX, top: clampedY, width: menuWidth }}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="ctx-edge-menu__header">Add connected node</div>
        <div className="ctx-menu__list">
          {sourceKind === 'stage' && (
            <>
              <button className="ctx-menu__item" onClick={() => onSelect('stage')}>
                <span className="ctx-menu__item-label">New Stage</span>
                <span className="ctx-menu__item-sub">Depends on {sourceLabel}</span>
              </button>
              <button className="ctx-menu__item" onClick={() => onSelect('job')}>
                <span className="ctx-menu__item-label">New Job</span>
                <span className="ctx-menu__item-sub">Added to {sourceLabel}</span>
              </button>
            </>
          )}
          {sourceKind === 'job' && (
            <>
              <button className="ctx-menu__item" onClick={() => onSelect('job')}>
                <span className="ctx-menu__item-label">New Job</span>
                <span className="ctx-menu__item-sub">Depends on {sourceLabel}</span>
              </button>
              <button className="ctx-menu__item" onClick={() => onSelect('task')}>
                <span className="ctx-menu__item-label">New Task</span>
                <span className="ctx-menu__item-sub">Added to {sourceLabel}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
