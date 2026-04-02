import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogTask } from '../types/pipeline';
import './ContextTaskMenu.css';

interface Props {
  /** Viewport X coordinate (from MouseEvent.clientX) */
  x: number;
  /** Viewport Y coordinate (from MouseEvent.clientY) */
  y: number;
  loading: boolean;
  tasks: CatalogTask[];
  onSelect: (task: CatalogTask) => void;
  onClose: () => void;
}

/** Floating in-canvas task search menu shown on right-click. */
export default function ContextTaskMenu({ x, y, loading, tasks, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus search input as soon as the menu appears
  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  // Auto-focus once tasks load
  useEffect(() => {
    if (!loading && tasks.length > 0) {
      inputRef.current?.focus();
    }
  }, [loading, tasks.length]);

  const filtered = tasks.filter((t) => {
    const q = query.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.friendlyName.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });

  // Reset active index when filter changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[activeIndex]) {
          onSelect(filtered[activeIndex]);
        }
      }
    },
    [filtered, activeIndex, onClose, onSelect]
  );

  // Clamp position so the menu never overflows the viewport
  const menuWidth = 320;
  const menuMaxHeight = 400;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuMaxHeight - 8);

  return (
    <>
      {/* Invisible overlay that catches clicks outside the menu */}
      <div className="ctx-menu-overlay" onMouseDown={onClose} />

      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left: clampedX, top: clampedY }}
        onKeyDown={handleKeyDown}
        // Prevent the overlay's mousedown from firing when clicking inside
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ctx-menu__search">
          <input
            ref={inputRef}
            type="text"
            placeholder={loading ? 'Loading tasks…' : 'Search tasks…'}
            value={query}
            disabled={loading}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && <div className="ctx-menu__loading">Fetching task catalog…</div>}

        {!loading && filtered.length === 0 && (
          <div className="ctx-menu__empty">No tasks match &ldquo;{query}&rdquo;</div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="ctx-menu__list">
            {filtered.map((task, i) => (
              <button
                key={task.name}
                className={`ctx-menu__item${i === activeIndex ? ' ctx-menu__item--active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => onSelect(task)}
              >
                <span className="ctx-menu__item-label">{task.name}</span>
                <span className="ctx-menu__item-sub">{task.friendlyName} · {task.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
