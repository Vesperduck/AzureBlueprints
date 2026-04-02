import React, { useCallback } from 'react';
import type { Node } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './PropertiesPanel.css';

// Helper to render a labelled text input row
function TextField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <div className="props-row props-row--col">
      <label className="props-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="props-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

interface PropertiesPanelProps {
  node: Node<GraphNodeData>;
  onDataChange: (nodeId: string, data: Partial<GraphNodeData>) => void;
  onClose: () => void;
}

export default function PropertiesPanel({
  node,
  onDataChange,
  onClose,
}: PropertiesPanelProps) {
  const { data } = node;

  const set = useCallback<(partial: Partial<GraphNodeData>) => void>(
    (partial) => onDataChange(node.id, partial),
    [node.id, onDataChange]
  );

  const isStageOrJob = data.kind === 'stage' || data.kind === 'job';
  const isJob        = data.kind === 'job';
  const isNotTrigger = data.kind !== 'trigger';
  const poolValue    = (data.details?.['pool'] as string | undefined) ?? '';
  const taskName     = (data.details?.['taskName'] as string | undefined) ?? '';

  return (
    <aside className="props-panel">
      <div className="props-panel__header">
        <span className="props-panel__title">Properties</span>
        <button className="props-panel__close" onClick={onClose} title="Close" aria-label="Close panel">
          ✕
        </button>
      </div>

      <div className="props-panel__body">
        {/* Kind badge */}
        <div className="props-row">
          <span className="props-label">Type</span>
          <span className={`props-kind-badge props-kind--${data.kind}`}>{data.kind}</span>
        </div>

        {/* Display name */}
        <TextField
          id="pp-displayName"
          label="Display Name"
          value={data.displayName ?? data.label}
          onChange={(v) => set({ displayName: v, label: v })}
        />

        {/* Raw ID – stage / job only */}
        {isStageOrJob && (
          <TextField
            id="pp-rawId"
            label={data.kind === 'stage' ? 'Stage ID' : 'Job ID'}
            value={data.rawId}
            onChange={(v) => set({ rawId: v })}
          />
        )}

        {/* Condition – not trigger */}
        {isNotTrigger && (
          <TextField
            id="pp-condition"
            label="Condition"
            value={data.condition ?? ''}
            placeholder="succeeded()"
            onChange={(v) => set({ condition: v !== '' ? v : undefined })}
          />
        )}

        {/* dependsOn – stage / job */}
        {isStageOrJob && (
          <TextField
            id="pp-dependsOn"
            label="Depends On (comma-separated)"
            value={(data.dependsOn ?? []).join(', ')}
            placeholder="StageName, AnotherStage"
            onChange={(v) =>
              set({
                dependsOn: v !== ''
                  ? v.split(',').map((s) => s.trim()).filter((s) => s !== '')
                  : [],
              })
            }
          />
        )}

        {/* Pool – job only */}
        {isJob && (
          <TextField
            id="pp-pool"
            label="Pool / vmImage"
            value={poolValue}
            placeholder="ubuntu-latest"
            onChange={(v) => set({ details: { ...data.details, pool: v } })}
          />
        )}

        {/* Enabled toggle – not trigger */}
        {isNotTrigger && (
          <div className="props-row">
            <label className="props-label" htmlFor="pp-enabled">Enabled</label>
            <input
              id="pp-enabled"
              className="props-checkbox"
              type="checkbox"
              checked={data.enabled !== false}
              onChange={(e) => set({ enabled: e.target.checked })}
            />
          </div>
        )}

        {/* Task / script content */}
        {taskName !== '' && (
          <div className="props-row props-row--col">
            <label className="props-label" htmlFor="pp-taskName">Task / Script</label>
            <textarea
              id="pp-taskName"
              className="props-input props-textarea"
              value={taskName}
              onChange={(e) =>
                set({ details: { ...data.details, taskName: e.target.value } })
              }
              rows={4}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
