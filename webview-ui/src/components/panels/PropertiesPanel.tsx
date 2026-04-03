import React, { useCallback } from 'react';
import type { Node } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import CronPicker from './CronPicker';
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

function NumberField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: number | undefined;
  placeholder?: string;
  onChange: (v: number | undefined) => void;
}): React.ReactElement {
  return (
    <div className="props-row props-row--col">
      <label className="props-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="props-input"
        type="number"
        min={0}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          onChange(isNaN(n) ? undefined : n);
        }}
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

  const setDetail = useCallback(
    (key: string, value: unknown) =>
      set({ details: { ...data.details, [key]: value } }),
    [data.details, set]
  );

  const isStageOrJob    = data.kind === 'stage' || data.kind === 'job';
  const isStage         = data.kind === 'stage';
  const isJob           = data.kind === 'job';
  const isNotTrigger    = data.kind !== 'trigger';
  const isTrigger       = data.kind === 'trigger';
  const triggerType     = (data.details?.['triggerType'] as string | undefined) ?? 'none';
  const isScheduled     = isTrigger && triggerType === 'scheduled';
  const isCi            = isTrigger && triggerType === 'ci';
  const isPr            = isTrigger && triggerType === 'pr';
  const isManual        = isTrigger && triggerType === 'manual';
  const poolValue       = (data.details?.['pool'] as string | undefined) ?? '';
  const taskName        = (data.details?.['taskName'] as string | undefined) ?? '';
  const stepKind        = (data.details?.['stepKind'] as string | undefined) ?? data.kind as string;
  const isAzureTask     = data.kind === 'task';
  const isScriptStep    = data.kind === 'script';
  const isCheckout      = data.kind === 'checkout';
  const isPublish       = data.kind === 'publish';
  const isDownload      = data.kind === 'download';

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

        {/* ── Job-specific fields ────────────────────────────────────── */}
        {isJob && (
          <>
            <TextField
              id="pp-pool"
              label="Pool / vmImage"
              value={poolValue}
              placeholder="ubuntu-latest"
              onChange={(v) => setDetail('pool', v !== '' ? v : undefined)}
            />

            <TextField
              id="pp-job-container"
              label="Container"
              value={(data.details?.['container'] as string | undefined) ?? ''}
              placeholder="mcr.microsoft.com/dotnet/sdk:8.0"
              onChange={(v) => setDetail('container', v !== '' ? v : undefined)}
            />

            <TextField
              id="pp-job-environment"
              label="Environment (deployment)"
              value={(data.details?.['environment'] as string | undefined) ?? ''}
              placeholder="production"
              onChange={(v) => setDetail('environment', v !== '' ? v : undefined)}
            />

            <SectionDivider label="Timeouts &amp; Strategy" />

            <NumberField
              id="pp-job-timeout"
              label="Timeout (minutes)"
              value={data.details?.['timeoutInMinutes'] as number | undefined}
              placeholder="60"
              onChange={(v) => setDetail('timeoutInMinutes', v)}
            />

            <NumberField
              id="pp-job-cancelTimeout"
              label="Cancel Timeout (minutes)"
              value={data.details?.['cancelTimeoutInMinutes'] as number | undefined}
              placeholder="5"
              onChange={(v) => setDetail('cancelTimeoutInMinutes', v)}
            />

            <NumberField
              id="pp-job-strategyParallel"
              label="Parallel Strategy (count)"
              value={data.details?.['strategyParallel'] as number | undefined}
              placeholder="0"
              onChange={(v) => setDetail('strategyParallel', v)}
            />

            <SectionDivider label="Options" />

            <CheckboxField
              id="pp-job-continueOnError"
              label="Continue on Error"
              hint="continue pipeline even if this job fails"
              checked={data.continueOnError ?? false}
              onChange={(v) => set({ continueOnError: v })}
            />

            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-job-workspaceClean">Workspace Clean</label>
              <select
                id="pp-job-workspaceClean"
                className="props-input"
                value={(data.details?.['workspaceClean'] as string | undefined) ?? ''}
                onChange={(e) => setDetail('workspaceClean', e.target.value !== '' ? e.target.value : undefined)}
              >
                <option value="">default</option>
                <option value="outputs">outputs</option>
                <option value="resources">resources</option>
                <option value="all">all</option>
              </select>
            </div>

            <SectionDivider label="Variables (YAML)" />

            <div className="props-row props-row--col">
              <textarea
                id="pp-job-variables"
                className="props-input props-textarea"
                value={(data.details?.['variablesRaw'] as string | undefined) ?? ''}
                placeholder={'myVar: value\notherVar: 123'}
                onChange={(e) => setDetail('variablesRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={4}
                spellCheck={false}
              />
            </div>

            <SectionDivider label="Template Context (YAML)" />

            <div className="props-row props-row--col">
              <textarea
                id="pp-job-templateContext"
                className="props-input props-textarea"
                value={(data.details?.['templateContextRaw'] as string | undefined) ?? ''}
                placeholder={'key: value'}
                onChange={(e) => setDetail('templateContextRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={3}
                spellCheck={false}
              />
            </div>
          </>
        )}

        {/* ── Stage-specific fields ──────────────────────────────────── */}
        {isStage && (
          <>
            <TextField
              id="pp-stage-pool"
              label="Pool / vmImage"
              value={(data.details?.['stagePool'] as string | undefined) ?? ''}
              placeholder="ubuntu-latest"
              onChange={(v) => setDetail('stagePool', v !== '' ? v : undefined)}
            />

            <SectionDivider label="Stage Options" />

            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-stage-lockBehavior">Lock Behavior</label>
              <select
                id="pp-stage-lockBehavior"
                className="props-input"
                value={(data.details?.['lockBehavior'] as string | undefined) ?? ''}
                onChange={(e) => setDetail('lockBehavior', e.target.value !== '' ? e.target.value : undefined)}
              >
                <option value="">default</option>
                <option value="sequential">sequential</option>
                <option value="runLatest">runLatest</option>
              </select>
            </div>

            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-stage-trigger">Stage Trigger</label>
              <select
                id="pp-stage-trigger"
                className="props-input"
                value={(data.details?.['stageTrigger'] as string | undefined) ?? ''}
                onChange={(e) => setDetail('stageTrigger', e.target.value !== '' ? e.target.value : undefined)}
              >
                <option value="">default (automatic)</option>
                <option value="automatic">automatic</option>
                <option value="manual">manual</option>
              </select>
            </div>

            <CheckboxField
              id="pp-stage-isSkippable"
              label="Is Skippable"
              hint="allow this stage to be skipped"
              checked={(data.details?.['isSkippable'] as boolean | undefined) ?? true}
              onChange={(v) => setDetail('isSkippable', v)}
            />

            <SectionDivider label="Variables (YAML)" />

            <div className="props-row props-row--col">
              <textarea
                id="pp-stage-variables"
                className="props-input props-textarea"
                value={(data.details?.['variablesRaw'] as string | undefined) ?? ''}
                placeholder={'myVar: value\notherVar: 123'}
                onChange={(e) => setDetail('variablesRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={4}
                spellCheck={false}
              />
            </div>

            <SectionDivider label="Template Context (YAML)" />

            <div className="props-row props-row--col">
              <textarea
                id="pp-stage-templateContext"
                className="props-input props-textarea"
                value={(data.details?.['templateContextRaw'] as string | undefined) ?? ''}
                placeholder={'key: value'}
                onChange={(e) => setDetail('templateContextRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={3}
                spellCheck={false}
              />
            </div>
          </>
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

        {/* ── Azure DevOps task step ──────────────────────────────────── */}
        {isAzureTask && (
          <>
            <SectionDivider label="Task" />
            <TextField
              id="pp-task-ref"
              label="Task Reference"
              value={taskName}
              placeholder="DotNetCoreCLI@2"
              onChange={(v) => setDetail('taskName', v)}
            />
            <TextField
              id="pp-task-name"
              label="Step ID (name)"
              value={(data.details?.['name'] as string | undefined) ?? ''}
              placeholder="myStep"
              onChange={(v) => setDetail('name', v !== '' ? v : undefined)}
            />
            <SectionDivider label="Options" />
            <CheckboxField
              id="pp-task-continueOnError"
              label="Continue on Error"
              checked={(data.details?.['continueOnError'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('continueOnError', v ? true : undefined)}
            />
            <NumberField
              id="pp-task-timeout"
              label="Timeout (minutes)"
              value={data.details?.['timeoutInMinutes'] as number | undefined}
              onChange={(v) => setDetail('timeoutInMinutes', v)}
            />
            <NumberField
              id="pp-task-retry"
              label="Retry Count on Task Failure"
              value={data.details?.['retryCountOnTaskFailure'] as number | undefined}
              onChange={(v) => setDetail('retryCountOnTaskFailure', v)}
            />
            <SectionDivider label="Inputs (YAML)" />
            <div className="props-row props-row--col">
              <textarea
                id="pp-task-inputs"
                className="props-input props-textarea"
                value={(data.details?.['inputsRaw'] as string | undefined) ?? ''}
                placeholder={"command: restore\nprojects: '**/*.csproj'"}
                onChange={(e) => setDetail('inputsRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={4}
                spellCheck={false}
              />
            </div>
            <SectionDivider label="Environment Variables (YAML)" />
            <div className="props-row props-row--col">
              <textarea
                id="pp-task-env"
                className="props-input props-textarea"
                value={(data.details?.['envRaw'] as string | undefined) ?? ''}
                placeholder={'MY_VAR: value'}
                onChange={(e) => setDetail('envRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={3}
                spellCheck={false}
              />
            </div>
          </>
        )}

        {/* ── Script / Bash / PowerShell step ────────────────────────── */}
        {isScriptStep && (
          <>
            <SectionDivider label="Script" />
            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-script-kind">Script Type</label>
              <select
                id="pp-script-kind"
                className="props-input"
                value={stepKind}
                onChange={(e) => setDetail('stepKind', e.target.value)}
              >
                <option value="script">script (sh)</option>
                <option value="bash">bash</option>
                <option value="powershell">powershell</option>
              </select>
            </div>
            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-script-content">Script Content</label>
              <textarea
                id="pp-script-content"
                className="props-input props-textarea"
                value={taskName}
                onChange={(e) => setDetail('taskName', e.target.value)}
                rows={5}
                spellCheck={false}
              />
            </div>
            <TextField
              id="pp-script-name"
              label="Step ID (name)"
              value={(data.details?.['name'] as string | undefined) ?? ''}
              placeholder="myStep"
              onChange={(v) => setDetail('name', v !== '' ? v : undefined)}
            />
            <TextField
              id="pp-script-workingDir"
              label="Working Directory"
              value={(data.details?.['workingDirectory'] as string | undefined) ?? ''}
              placeholder="$(Build.SourcesDirectory)"
              onChange={(v) => setDetail('workingDirectory', v !== '' ? v : undefined)}
            />
            <SectionDivider label="Options" />
            <CheckboxField
              id="pp-script-continueOnError"
              label="Continue on Error"
              checked={(data.details?.['continueOnError'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('continueOnError', v ? true : undefined)}
            />
            <NumberField
              id="pp-script-timeout"
              label="Timeout (minutes)"
              value={data.details?.['timeoutInMinutes'] as number | undefined}
              onChange={(v) => setDetail('timeoutInMinutes', v)}
            />
            <CheckboxField
              id="pp-script-failOnStderr"
              label="Fail on Stderr"
              checked={(data.details?.['failOnStderr'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('failOnStderr', v ? true : undefined)}
            />
            {stepKind === 'powershell' && (
              <>
                <TextField
                  id="pp-ps-errorActionPreference"
                  label="Error Action Preference"
                  value={(data.details?.['errorActionPreference'] as string | undefined) ?? ''}
                  placeholder="stop"
                  onChange={(v) => setDetail('errorActionPreference', v !== '' ? v : undefined)}
                />
                <CheckboxField
                  id="pp-ps-ignoreLASTEXITCODE"
                  label="Ignore LASTEXITCODE"
                  checked={(data.details?.['ignoreLASTEXITCODE'] as boolean | undefined) ?? false}
                  onChange={(v) => setDetail('ignoreLASTEXITCODE', v ? true : undefined)}
                />
              </>
            )}
            <SectionDivider label="Environment Variables (YAML)" />
            <div className="props-row props-row--col">
              <textarea
                id="pp-script-env"
                className="props-input props-textarea"
                value={(data.details?.['envRaw'] as string | undefined) ?? ''}
                placeholder={'MY_VAR: value'}
                onChange={(e) => setDetail('envRaw', e.target.value !== '' ? e.target.value : undefined)}
                rows={3}
                spellCheck={false}
              />
            </div>
          </>
        )}

        {/* ── Checkout step ────────────────────────────────────────────── */}
        {isCheckout && (
          <>
            <SectionDivider label="Checkout" />
            <TextField
              id="pp-checkout-ref"
              label="Repository"
              value={taskName}
              placeholder="self"
              onChange={(v) => setDetail('taskName', v !== '' ? v : 'self')}
            />
            <SectionDivider label="Options" />
            <NumberField
              id="pp-checkout-fetchDepth"
              label="Fetch Depth"
              value={data.details?.['fetchDepth'] as number | undefined}
              placeholder="1"
              onChange={(v) => setDetail('fetchDepth', v)}
            />
            <TextField
              id="pp-checkout-path"
              label="Path"
              value={(data.details?.['path'] as string | undefined) ?? ''}
              placeholder="s"
              onChange={(v) => setDetail('path', v !== '' ? v : undefined)}
            />
            <div className="props-row props-row--col">
              <label className="props-label" htmlFor="pp-checkout-submodules">Submodules</label>
              <select
                id="pp-checkout-submodules"
                className="props-input"
                value={String(data.details?.['submodules'] ?? '')}
                onChange={(e) => {
                  const val = e.target.value;
                  setDetail('submodules', val === '' ? undefined : val === 'recursive' ? 'recursive' : val === 'true' ? true : false);
                }}
              >
                <option value="">default</option>
                <option value="true">true</option>
                <option value="false">false</option>
                <option value="recursive">recursive</option>
              </select>
            </div>
            <CheckboxField
              id="pp-checkout-clean"
              label="Clean"
              checked={(data.details?.['clean'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('clean', v)}
            />
            <CheckboxField
              id="pp-checkout-lfs"
              label="LFS"
              checked={(data.details?.['lfs'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('lfs', v ? true : undefined)}
            />
            <CheckboxField
              id="pp-checkout-persistCredentials"
              label="Persist Credentials"
              checked={(data.details?.['persistCredentials'] as boolean | undefined) ?? false}
              onChange={(v) => setDetail('persistCredentials', v ? true : undefined)}
            />
          </>
        )}

        {/* ── Publish step ─────────────────────────────────────────────── */}
        {isPublish && (
          <>
            <SectionDivider label="Publish" />
            <TextField
              id="pp-publish-path"
              label="Publish Path"
              value={taskName}
              placeholder="$(Build.ArtifactStagingDirectory)"
              onChange={(v) => setDetail('taskName', v)}
            />
            <TextField
              id="pp-publish-artifact"
              label="Artifact Name"
              value={(data.details?.['artifact'] as string | undefined) ?? ''}
              placeholder="drop"
              onChange={(v) => setDetail('artifact', v !== '' ? v : undefined)}
            />
          </>
        )}

        {/* ── Download step ────────────────────────────────────────────── */}
        {isDownload && (
          <>
            <SectionDivider label="Download" />
            <TextField
              id="pp-download-ref"
              label="Pipeline Ref"
              value={taskName}
              placeholder="current"
              onChange={(v) => setDetail('taskName', v !== '' ? v : 'current')}
            />
            <TextField
              id="pp-download-artifact"
              label="Artifact Name"
              value={(data.details?.['artifact'] as string | undefined) ?? ''}
              placeholder="drop"
              onChange={(v) => setDetail('artifact', v !== '' ? v : undefined)}
            />
            <TextField
              id="pp-download-path"
              label="Download Path"
              value={(data.details?.['path'] as string | undefined) ?? ''}
              placeholder="$(Pipeline.Workspace)/drop"
              onChange={(v) => setDetail('path', v !== '' ? v : undefined)}
            />
            <TextField
              id="pp-download-patterns"
              label="Patterns"
              value={(data.details?.['patterns'] as string | undefined) ?? ''}
              placeholder="**"
              onChange={(v) => setDetail('patterns', v !== '' ? v : undefined)}
            />
          </>
        )}

        {/* ── Step node shared: enabled toggle shown earlier covers non-step nodes;
               for step nodes Enabled is already handled by the isNotTrigger block above ── */}

        {/* ── Manual trigger ───────────────────────────────────────────── */}
        {isManual && (
          <div className="props-info-box">
            <strong>trigger: none</strong>
            <p>
              Automatic CI runs are disabled. The pipeline will only execute
              when triggered manually from Azure DevOps or via the REST API.
            </p>
            <p>
              To pass runtime inputs to manual runs, add a top-level{' '}
              <code>parameters:</code> block to the YAML.
            </p>
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

            <CronPicker
              value={(data.details?.['cron'] as string | undefined) ?? '0 0 * * *'}
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
