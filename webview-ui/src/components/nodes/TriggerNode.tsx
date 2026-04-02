import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './nodes.css';

function TriggerNode({ data, selected }: NodeProps<GraphNodeData>) {
  return (
    <div className={`node node--trigger ${selected ? 'node--selected' : ''}`}>
      <div className="node__header">
        <span className="node__icon">⚡</span>
        <span className="node__kind-label">Trigger</span>
      </div>
      <div className="node__label">{data.label}</div>
      {data.details?.branches != null ? (
        <div className="node__detail">
          branches: {String(data.details['branches'])}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}

export default memo(TriggerNode);
