import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './nodes.css';

function JobNode({ data, selected }: NodeProps<GraphNodeData>) {
  const pool = data.details?.pool as string | undefined;
  const dependsOn = data.dependsOn ?? [];
  return (
    <div className={`node node--job ${selected ? 'node--selected' : ''} ${data.enabled === false ? 'node--disabled' : ''} ${data.fromTemplateId ? 'node--from-template' : ''}`}>
      <Handle type="target" position={Position.Top} id="in" />

      <div className="node__header">
        <span className="node__icon">⬡</span>
        <span className="node__kind-label">Job</span>
        {data.enabled === false && <span className="node__badge node__badge--disabled">disabled</span>}
        {!!data.details?.isDeployment && (
          <span className="node__badge node__badge--deploy">deploy</span>
        )}
      </div>

      <div className="node__label">{data.displayName ?? data.label}</div>
      <div className="node__sub">{data.rawId}</div>

      {pool && (
        <div className="node__detail">
          <span className="node__detail-icon">☁</span> {truncate(pool, 26)}
        </div>
      )}

      {data.condition && (
        <div className="node__detail node__detail--condition" title={data.condition}>
          <span className="node__detail-icon">⚙</span> {truncate(data.condition, 26)}
        </div>
      )}

      {dependsOn.length > 0 && (
        <div className="node__depends">
          <span className="node__detail-icon">⤵</span> {dependsOn.join(', ')}
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

export default memo(JobNode);
