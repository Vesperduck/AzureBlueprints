import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { GraphNodeData } from '../../types/pipeline';
import './nodes.css';

function TemplateNode({ data, selected }: NodeProps<GraphNodeData>) {
  const templatePath = (data.details?.['templatePath'] as string | undefined) ?? data.label;
  const level = (data.details?.['templateLevel'] as string | undefined) ?? 'step';
  const hasParams = !!(data.details?.['parametersRaw'] as string | undefined);

  return (
    <div
      className={[
        'node',
        'node--template',
        selected ? 'node--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Top} id="in" />

      <div className="node__header">
        <span className="node__icon">⇒</span>
        <span className="node__kind-label">template:{level}</span>
      </div>

      <div className="node__label" title={templatePath}>
        {truncate(templatePath, 32)}
      </div>

      {hasParams && (
        <div className="node__sub">+ parameters</div>
      )}

      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}

function truncate(s: string, max: number) {
  return s.length > max ? '…' + s.slice(-(max - 1)) : s;
}

export default memo(TemplateNode);
