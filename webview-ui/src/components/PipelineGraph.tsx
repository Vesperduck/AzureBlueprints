import React, { useCallback } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './PipelineGraph.css';

import type { GraphNodeData } from '../types/pipeline';
import TriggerNode from './nodes/TriggerNode';
import StageNode from './nodes/StageNode';
import JobNode from './nodes/JobNode';
import TaskNode from './nodes/TaskNode';

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  stage: StageNode,
  job: JobNode,
  task: TaskNode,
  script: TaskNode,
  checkout: TaskNode,
  publish: TaskNode,
  download: TaskNode,
};

interface PipelineGraphProps {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
  onNodesChange: (nodes: Node<GraphNodeData>[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  onGraphChange: (nodes: Node<GraphNodeData>[], edges: Edge[]) => void;
  onNodeSelect: (node: Node<GraphNodeData> | null) => void;
  onPaneContextMenu?: (x: number, y: number) => void;
}

export default function PipelineGraph({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onGraphChange,
  onNodeSelect,
  onPaneContextMenu,
}: PipelineGraphProps) {
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, nodes) as Node<GraphNodeData>[];
      onNodesChange(updated);
      // Only emit graph-change for position/data changes (not selection)
      const hasStructuralChange = changes.some(
        (c) => c.type === 'remove' || c.type === 'add'
      );
      if (hasStructuralChange) {
        onGraphChange(updated, edges);
      }
    },
    [nodes, edges, onNodesChange, onGraphChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, edges);
      onEdgesChange(updated);
      onGraphChange(nodes, updated);
    },
    [nodes, edges, onEdgesChange, onGraphChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const updated = addEdge(
        { ...connection, animated: true, style: { stroke: '#0078d4' } },
        edges
      );
      onEdgesChange(updated);
      onGraphChange(nodes, updated);
    },
    [nodes, edges, onEdgesChange, onGraphChange]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<GraphNodeData>) => {
      onNodeSelect(node);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      onPaneContextMenu?.(event.clientX, event.clientY);
    },
    [onPaneContextMenu]
  );

  return (
    <div className="pipeline-graph-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={3}
        deleteKeyCode="Delete"
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#0078d4', strokeWidth: 2 },
        }}
      >
        <Controls
          style={{
            background: 'var(--vscode-sideBar-background)',
            border: '1px solid var(--vscode-widget-border)',
            borderRadius: 4,
          }}
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          style={{
            background: 'var(--vscode-sideBar-background)',
            border: '1px solid var(--vscode-widget-border)',
          }}
          maskColor="rgba(0,0,0,0.4)"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--vscode-editorLineNumber-foreground, #555)"
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="pipeline-graph-empty">
          <p>No pipeline structure detected.</p>
          <p className="pipeline-graph-empty-hint">
            Open a valid Azure DevOps YAML pipeline file to visualise it here.
          </p>
        </div>
      )}
    </div>
  );
}

function miniMapNodeColor(node: Node<GraphNodeData>): string {
  switch (node.data?.kind) {
    case 'trigger':  return '#6b6bff';
    case 'stage':    return '#0078d4';
    case 'job':      return '#107c10';
    case 'task':     return '#d83b01';
    case 'script':   return '#8a2be2';
    case 'checkout': return '#795548';
    case 'publish':  return '#ff8c00';
    case 'download': return '#00ced1';
    default:         return '#555';
  }
}
