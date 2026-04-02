import React, { useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  updateEdge,
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
  // Keep a ref that is always the latest nodes array.
  // We update it synchronously inside handleNodesChange so that
  // handleEdgesChange (which fires in the same JS tick after a node deletion)
  // reads the post-deletion nodes rather than the stale closure value.
  const currentNodes = useRef<Node<GraphNodeData>[]>(nodes);
  currentNodes.current = nodes; // stays in sync after every render

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, nodes) as Node<GraphNodeData>[];
      // Synchronously update the ref so handleEdgesChange sees removed nodes.
      currentNodes.current = updated;
      onNodesChange(updated);

      // For node removals where there are no connected edges (isolated nodes),
      // handleEdgesChange will never fire, so we must sync the YAML here.
      const removedIds = changes
        .filter((c) => c.type === 'remove')
        .map((c) => (c as { type: 'remove'; id: string }).id);

      if (removedIds.length > 0) {
        const removedSet = new Set(removedIds);
        const hasOrphanEdges = edges.some(
          (e) => removedSet.has(e.source) || removedSet.has(e.target)
        );
        if (!hasOrphanEdges) {
          onGraphChange(updated, edges);
        }
      }
    },
    [nodes, edges, onNodesChange, onGraphChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, edges);
      onEdgesChange(updated);
      // Use currentNodes.current instead of the closure `nodes` so that when
      // this fires synchronously after a node deletion, deleted nodes are
      // already absent from the serialised YAML.
      onGraphChange(currentNodes.current, updated);
    },
    [edges, onEdgesChange, onGraphChange]
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

  // ── Edge drag-to-disconnect ───────────────────────────────────────────────
  // Track whether the in-flight drag successfully reconnected to a node.
  // If the drag ends without reconnecting (dropped on empty space), delete.
  const edgeReconnected = useRef(false);

  const handleEdgeUpdateStart = useCallback(() => {
    edgeReconnected.current = false;
  }, []);

  const handleEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnected.current = true;
      const updated = updateEdge(oldEdge, newConnection, edges);
      onEdgesChange(updated);
      onGraphChange(nodes, updated);
    },
    [nodes, edges, onEdgesChange, onGraphChange]
  );

  const handleEdgeUpdateEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnected.current) {
        // Dropped on empty space — remove the edge
        const updated = edges.filter((e) => e.id !== edge.id);
        onEdgesChange(updated);
        onGraphChange(nodes, updated);
      }
    },
    [nodes, edges, onEdgesChange, onGraphChange]
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
        onEdgeUpdateStart={handleEdgeUpdateStart}
        onEdgeUpdate={handleEdgeUpdate}
        onEdgeUpdateEnd={handleEdgeUpdateEnd}
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
