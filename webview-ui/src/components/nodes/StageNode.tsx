import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './nodes.css';

function StageNode({ data, selected }: NodeProps<GraphNodeData>) {
  const dependsOn = data.dependsOn ?? [];
  return (
    <div className={`node node--stage ${selected ? 'node--selected' : ''} ${data.enabled === false ? 'node--disabled' : ''}`}>
      <Handle type="target" position={Position.Top} id="in" />

      <div className="node__header">
        <span className="node__icon">▣</span>
        <span className="node__kind-label">Stage</span>
        {data.enabled === false && <span className="node__badge node__badge--disabled">disabled</span>}
      </div>

      <div className="node__label">{data.displayName ?? data.label}</div>
      <div className="node__sub">{data.rawId}</div>

      {data.condition && (
        <div className="node__detail node__detail--condition" title={data.condition}>
          <span className="node__detail-icon">⚙</span> {truncate(data.condition, 28)}
        </div>
      )}

      {dependsOn.length > 0 && (
        <div className="node__depends">
          <span className="node__detail-icon">⤵</span> {dependsOn.join(', ')}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default memo(StageNode);
