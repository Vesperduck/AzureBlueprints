import React, { useState } from 'react';
import type { GraphNodeKind } from '../types/pipeline';
import './PalettePanel.css';

interface PaletteItem {
  kind: GraphNodeKind;
  label: string;
  desc: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
}

const PALETTE_CATS: { label: string; items: PaletteItem[] }[] = [
  {
    label: 'Structure',
    items: [
      { kind: 'trigger',  label: 'Trigger',  desc: 'CI / PR / Schedule',      icon: '⚡', color: '#a5a5ff', bg: 'rgba(100,100,255,0.13)', border: '#5555cc' },
      { kind: 'stage',    label: 'Stage',    desc: 'Pipeline stage group',     icon: '▣',  color: '#4fc3f7', bg: 'rgba(0,120,212,0.13)',   border: '#0078d4' },
      { kind: 'job',      label: 'Job',      desc: 'Agent job',                icon: '⚙',  color: '#81c784', bg: 'rgba(16,124,16,0.13)',   border: '#107c10' },
    ],
  },
  {
    label: 'Steps',
    items: [
      { kind: 'task',     label: 'Task',     desc: 'ADO catalog task',         icon: '▶',  color: '#ff8a65', bg: 'rgba(216,59,1,0.13)',    border: '#d83b01' },
      { kind: 'script',   label: 'Script',   desc: 'Bash / PowerShell',        icon: '⌨',  color: '#ce93d8', bg: 'rgba(138,43,226,0.13)',  border: '#8a2be2' },
      { kind: 'checkout', label: 'Checkout', desc: 'Checkout repository',      icon: '⇩',  color: '#bcaaa4', bg: 'rgba(121,85,72,0.13)',   border: '#795548' },
      { kind: 'publish',  label: 'Publish',  desc: 'Publish artifact',         icon: '⇧',  color: '#ffcc80', bg: 'rgba(255,140,0,0.13)',   border: '#ff8c00' },
      { kind: 'download', label: 'Download', desc: 'Download artifact',        icon: '⬇',  color: '#80deea', bg: 'rgba(0,206,209,0.13)',   border: '#00ced1' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { kind: 'template', label: 'Template', desc: 'YAML template reference',  icon: '⊡',  color: '#c4a8f5', bg: 'rgba(110,79,179,0.13)', border: '#6e4fb3' },
    ],
  },
];

interface PalettePanelProps {
  onAddNode: (kind: GraphNodeKind) => void;
}

export default function PalettePanel({ onAddNode }: PalettePanelProps) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  const filtered = PALETTE_CATS.map((cat) => ({
    ...cat,
    items: cat.items.filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.desc.toLowerCase().includes(q) ||
        item.kind.includes(q)
    ),
  })).filter((cat) => cat.items.length > 0);

  return (
    <div className="palette-panel">
      <div className="palette-header">
        <span className="palette-header__icon">◈</span> Nodes
      </div>

      <div className="palette-search">
        <input
          type="text"
          placeholder="Filter nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="palette-search__input"
        />
      </div>

      <div className="palette-list">
        {filtered.map((cat) => (
          <div key={cat.label}>
            <div className="palette-category">{cat.label}</div>
            {cat.items.map((item) => (
              <div
                key={item.kind}
                className="palette-item"
                onClick={() => onAddNode(item.kind)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = '#2d2d30';
                  el.style.borderLeftColor = item.border;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = '';
                  el.style.borderLeftColor = 'transparent';
                }}
              >
                <div
                  className="palette-item__icon"
                  style={{ background: item.bg, border: `1px solid ${item.border}`, color: item.color }}
                >
                  {item.icon}
                </div>
                <div>
                  <div className="palette-item__label">{item.label}</div>
                  <div className="palette-item__desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="palette-hint">
        Click to add · Right-click canvas<br />Delete key removes selected
      </div>
    </div>
  );
}
