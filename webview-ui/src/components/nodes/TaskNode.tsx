import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './nodes.css';

const KIND_ICONS: Record<string, string> = {
  task:     '⬢',
  script:   '>_',
  bash:     '$',
  powershell: 'PS',
  checkout: '⎇',
  publish:  '↑',
  download: '↓',
};

function TaskNode({ data, selected }: NodeProps<GraphNodeData>) {
  const icon = KIND_ICONS[data.kind] ?? '●';
  const taskName = data.details?.taskName as string | undefined;
  return (
    <div
      className={[
        'node',
        `node--task`,
        `node--${data.kind}`,
        selected ? 'node--selected' : '',
        data.enabled === false ? 'node--disabled' : '',
        data.fromTemplateId ? 'node--from-template' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Top} id="in" />

      <div className="node__header">
        <span className="node__icon node__icon--mono">{icon}</span>
        <span className="node__kind-label">{data.kind}</span>
        {data.enabled === false && (
          <span className="node__badge node__badge--disabled">disabled</span>
        )}
        {data.continueOnError && (
          <span className="node__badge node__badge--warn">↷ skip</span>
        )}
      </div>

      <div className="node__label">{data.displayName ?? data.label}</div>

      {taskName && <div className="node__sub">{truncate(taskName, 28)}</div>}

      {data.condition && (
        <div className="node__detail node__detail--condition" title={data.condition}>
          <span className="node__detail-icon">⚙</span> {truncate(data.condition, 26)}
        </div>
      )}

      {data.fromTemplateId && (
        <div
          className="node__from-template-badge"
          title={(data.details?.['__fromTemplatePath'] as string | undefined) ?? ''}
        >
          ⇒ {truncate((data.details?.['__fromTemplatePath'] as string | undefined) ?? 'template', 26)}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default memo(TaskNode);
