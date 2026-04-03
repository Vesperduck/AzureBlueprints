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

function CheckboxField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="props-row">
      <input
        id={id}
        className="props-checkbox"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="props-label" htmlFor={id} style={{ opacity: 1, cursor: 'pointer' }}>
        {label}{hint && <span className="props-hint"> — {hint}</span>}
      </label>
    </div>
  );
}

function SectionDivider({ label }: { label: string }): React.ReactElement {
  return <div className="props-section-label">{label}</div>;
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

  const setDetail = useCallback(
    (key: string, value: unknown) =>
      set({ details: { ...data.details, [key]: value } }),
    [data.details, set]
  );

  const isStageOrJob    = data.kind === 'stage' || data.kind === 'job';
  const isJob           = data.kind === 'job';
  const isNotTrigger    = data.kind !== 'trigger';
  const isTrigger       = data.kind === 'trigger';
  const triggerType     = (data.details?.['triggerType'] as string | undefined) ?? 'none';
  const isScheduled     = isTrigger && triggerType === 'scheduled';
  const isCi            = isTrigger && triggerType === 'ci';
  const isPr            = isTrigger && triggerType === 'pr';
  const poolValue       = (data.details?.['pool'] as string | undefined) ?? '';
  const taskName        = (data.details?.['taskName'] as string | undefined) ?? '';

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
          <span className={`props-kind-badge props-kind--${data.kind}`}>
            {isTrigger ? triggerType : data.kind}
          </span>
        </div>

        {/* Display name — non-trigger nodes only */}
        {isNotTrigger && (
          <TextField
            id="pp-displayName"
            label="Display Name"
            value={data.displayName ?? data.label}
            onChange={(v) => set({ displayName: v, label: v })}
          />
        )}

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

        {/* ── PR trigger fields ─────────────────────────────────────────── */}
        {isPr && (
          <>
            <SectionDivider label="Branches" />

            <TextField
              id="pp-pr-branchesInclude"
              label="Include (comma-separated)"
              value={(data.details?.['branchesInclude'] as string | undefined) ?? ''}
              placeholder="main, develop"
              onChange={(v) => setDetail('branchesInclude', v)}
            />

            <TextField
              id="pp-pr-branchesExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['branchesExclude'] as string | undefined) ?? ''}
              placeholder="feature/*, hotfix/*"
              onChange={(v) => setDetail('branchesExclude', v)}
            />

            <SectionDivider label="Paths" />

            <TextField
              id="pp-pr-pathsInclude"
              label="Include (comma-separated)"
              value={(data.details?.['pathsInclude'] as string | undefined) ?? ''}
              placeholder="src/*, docs/*"
              onChange={(v) => setDetail('pathsInclude', v)}
            />

            <TextField
              id="pp-pr-pathsExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['pathsExclude'] as string | undefined) ?? ''}
              placeholder="README.md"
              onChange={(v) => setDetail('pathsExclude', v)}
            />

            <SectionDivider label="Options" />

            <CheckboxField
              id="pp-pr-autoCancel"
              label="Auto Cancel"
              hint="cancel in-progress runs when new commits are pushed"
              checked={(data.details?.['prAutoCancel'] as boolean | undefined) ?? true}
              onChange={(v) => setDetail('prAutoCancel', v)}
            />

            <CheckboxField
              id="pp-pr-drafts"
              label="Drafts"
              hint="trigger on draft pull requests"
              checked={(data.details?.['prDrafts'] as boolean | undefined) ?? true}
              onChange={(v) => setDetail('prDrafts', v)}
            />
          </>
        )}

        {/* ── CI trigger fields ────────────────────────────────────────── */}
        {isCi && (
          <>
            <SectionDivider label="Branches" />

            <TextField
              id="pp-ci-branchesInclude"
              label="Include (comma-separated)"
              value={(data.details?.['branchesInclude'] as string | undefined) ?? ''}
              placeholder="main, develop"
              onChange={(v) => setDetail('branchesInclude', v)}
            />

            <TextField
              id="pp-ci-branchesExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['branchesExclude'] as string | undefined) ?? ''}
              placeholder="feature/*, hotfix/*"
              onChange={(v) => setDetail('branchesExclude', v)}
            />

            <SectionDivider label="Paths" />

            <TextField
              id="pp-ci-pathsInclude"
              label="Include (comma-separated)"
              value={(data.details?.['pathsInclude'] as string | undefined) ?? ''}
              placeholder="src/*, docs/*"
              onChange={(v) => setDetail('pathsInclude', v)}
            />

            <TextField
              id="pp-ci-pathsExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['pathsExclude'] as string | undefined) ?? ''}
              placeholder="README.md"
              onChange={(v) => setDetail('pathsExclude', v)}
            />

            <SectionDivider label="Tags" />

            <TextField
              id="pp-ci-tagsInclude"
              label="Include (comma-separated)"
              value={(data.details?.['tagsInclude'] as string | undefined) ?? ''}
              placeholder="v1.*, release-*"
              onChange={(v) => setDetail('tagsInclude', v)}
            />

            <TextField
              id="pp-ci-tagsExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['tagsExclude'] as string | undefined) ?? ''}
              placeholder="experimental-*"
              onChange={(v) => setDetail('tagsExclude', v)}
            />

            <SectionDivider label="Options" />

            <CheckboxField
              id="pp-ci-batch"
              label="Batch"
              hint="batch changes while a build is running"
              checked={(data.details?.['ciBatch'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('ciBatch', v)}
            />
          </>
        )}

        {/* ── Schedule trigger fields ───────────────────────────────────── */}
        {isScheduled && (
          <>
            <SectionDivider label="Schedule" />

            <TextField
              id="pp-cron"
              label="Cron Expression"
              value={(data.details?.['cron'] as string | undefined) ?? ''}
              placeholder="0 0 * * *"
              onChange={(v) => setDetail('cron', v)}
            />

            <TextField
              id="pp-scheduleDisplayName"
              label="Schedule Name"
              value={(data.details?.['scheduleDisplayName'] as string | undefined) ?? ''}
              placeholder="Nightly"
              onChange={(v) => setDetail('scheduleDisplayName', v)}
            />

            <SectionDivider label="Branches" />

            <TextField
              id="pp-branchesInclude"
              label="Include (comma-separated)"
              value={(data.details?.['branchesInclude'] as string | undefined) ?? ''}
              placeholder="main, develop"
              onChange={(v) => setDetail('branchesInclude', v)}
            />

            <TextField
              id="pp-branchesExclude"
              label="Exclude (comma-separated)"
              value={(data.details?.['branchesExclude'] as string | undefined) ?? ''}
              placeholder="feature/*, hotfix/*"
              onChange={(v) => setDetail('branchesExclude', v)}
            />

            <SectionDivider label="Options" />

            <CheckboxField
              id="pp-always"
              label="Always"
              hint="run even without source changes"
              checked={(data.details?.['always'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('always', v)}
            />

            <CheckboxField
              id="pp-batch"
              label="Batch"
              hint="skip if previous run in-progress"
              checked={(data.details?.['batch'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('batch', v)}
            />
          </>
        )}
      </div>
    </aside>
  );
}
