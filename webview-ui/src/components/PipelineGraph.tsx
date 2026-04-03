import React, { useCallback, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  updateEdge,
  useReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnConnectStartParams,
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

/**
 * Ensures every stage node has at least one incoming edge. Any stage that has
 * no incoming edges after an edge-removal operation gets a trigger→stage edge
 * added back so the graph remains visually connected.
 */
function ensureStageConnectivity(
  nodes: Node<GraphNodeData>[],
  edges: Edge[]
): Edge[] {
  const triggerNode = nodes.find((n) => n.data.kind === 'trigger');
  if (!triggerNode) { return edges; }
  const extra: Edge[] = [];
  for (const node of nodes) {
    if (node.data.kind !== 'stage') { continue; }
    if (!edges.some((e) => e.target === node.id)) {
      extra.push({
        id: `${triggerNode.id}->${node.id}`,
        source: triggerNode.id,
        target: node.id,
        animated: true,
        style: { stroke: '#0078d4', strokeWidth: 2 },
      });
    }
  }
  return extra.length > 0 ? [...edges, ...extra] : edges;
}

/**
 * Ensures every job node has at least one incoming edge from a stage or another
 * job. Any job that loses all such incoming edges gets reconnected to its
 * parent stage (stored in node.data.parentId) or, for jobs-only pipelines, to
 * the trigger node.
 */
function ensureJobConnectivity(
  nodes: Node<GraphNodeData>[],
  edges: Edge[]
): Edge[] {
  const triggerNode = nodes.find((n) => n.data.kind === 'trigger');
  const extra: Edge[] = [];
  for (const node of nodes) {
    if (node.data.kind !== 'job') { continue; }
    const hasParentEdge = edges.some((e) => {
      if (e.target !== node.id) { return false; }
      const src = nodes.find((n) => n.id === e.source);
      return src?.data.kind === 'stage' || src?.data.kind === 'job';
    });
    if (hasParentEdge) { continue; }
    // Reconnect via parentId (stage or trigger stored at parse time), or
    // fall back to the trigger (jobs-only) / first stage (stage pipeline).
    const parentId = node.data.parentId;
    const parentNode = parentId ? nodes.find((n) => n.id === parentId) : undefined;
    const reconnectTo =
      parentNode ??
      nodes.find((n) => n.data.kind === 'stage') ??
      triggerNode;
    if (!reconnectTo) { continue; }
    extra.push({
      id: `${reconnectTo.id}->${node.id}`,
      source: reconnectTo.id,
      target: node.id,
      animated: true,
      style: { stroke: '#0078d4', strokeWidth: 2 },
    });
  }
  return extra.length > 0 ? [...edges, ...extra] : edges;
}

interface PipelineGraphProps {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
  onNodesChange: (nodes: Node<GraphNodeData>[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  onGraphChange: (nodes: Node<GraphNodeData>[], edges: Edge[]) => void;
  onNodeSelect: (node: Node<GraphNodeData> | null) => void;
  onPaneContextMenu?: (x: number, y: number) => void;
  /** Called when the user drags an edge from a job node and drops it on empty
   *  space. The host should show the task catalog at the given viewport coords
   *  and, on selection, insert a task wired to `sourceNodeId`. */
  onJobConnectEnd?: (sourceNodeId: string, clientX: number, clientY: number) => void;
}

export default function PipelineGraph({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onGraphChange,
  onNodeSelect,
  onPaneContextMenu,
  onJobConnectEnd,
}: PipelineGraphProps) {
  // Refs kept synchronously up-to-date within the same JS tick.
  const currentNodes = useRef<Node<GraphNodeData>[]>(nodes);
  currentNodes.current = nodes;
  const latestEdges = useRef<Edge[]>(edges);
  latestEdges.current = edges;

  const { project } = useReactFlow();

  // Tracks the node that initiated the current connection drag.
  const connectSource = useRef<{ nodeId: string; kind: string } | null>(null);
  // Set to true by handleConnect when a drag lands on a valid target handle.
  const connectCompleted = useRef(false);

  // When ReactFlow deletes a node it calls onEdgesChange FIRST (to remove
  // connected edges), then onNodesChange. To avoid writing the YAML with the
  // deleted node still present, we defer the onGraphChange call that would
  // come from handleEdgesChange. handleNodesChange then cancels that deferred
  // call and fires onGraphChange once with the fully-correct state.
  const deferredSync = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, nodes) as Node<GraphNodeData>[];
      currentNodes.current = updated;
      onNodesChange(updated);

      const hasRemoves = changes.some((c) => c.type === 'remove');
      if (hasRemoves) {
        // Cancel the deferred edge-change sync that fired just before us.
        if (deferredSync.current !== null) {
          clearTimeout(deferredSync.current);
          deferredSync.current = null;
        }
        // latestEdges.current was already updated by handleEdgesChange above.
        onGraphChange(updated, latestEdges.current);
      }
    },
    [nodes, onNodesChange, onGraphChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, edges);
      latestEdges.current = updated;
      onEdgesChange(updated);

      const hasRemoves = changes.some((c) => c.type === 'remove');
      if (!hasRemoves) {
        // Non-removal changes (selection, etc.) — sync immediately.
        onGraphChange(currentNodes.current, updated);
      } else {
        // Removal changes may be caused by a node deletion (in which case
        // handleNodesChange fires synchronously after us in the same tick and
        // will take over). Defer so it gets a chance to cancel this call.
        if (deferredSync.current !== null) clearTimeout(deferredSync.current);
        deferredSync.current = setTimeout(() => {
          deferredSync.current = null;
          let normalized = ensureStageConnectivity(currentNodes.current, latestEdges.current);
          normalized = ensureJobConnectivity(currentNodes.current, normalized);
          if (normalized !== latestEdges.current) {
            latestEdges.current = normalized;
            onEdgesChange(normalized);
          }
          onGraphChange(currentNodes.current, normalized);
        }, 0);
      }
    },
    [edges, onEdgesChange, onGraphChange]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectCompleted.current = true;
      const targetNode = nodes.find((n) => n.id === connection.target);
      const sourceNode = nodes.find((n) => n.id === connection.source);

      let withoutExisting: Edge[];
      if (targetNode?.data.kind === 'stage' && sourceNode?.data.kind === 'stage') {
        // Stage-to-stage connections allow multiple incoming edges (multi-dependsOn).
        // Remove trigger→target edges (stage deps replace them) and deduplicate
        // the same source, but keep any existing stage→target edges from other sources.
        withoutExisting = edges.filter((e) => {
          if (e.target !== connection.target) { return true; }
          const src = nodes.find((n) => n.id === e.source);
          if (src?.data.kind === 'trigger') { return false; }
          if (e.source === connection.source) { return false; } // dedup
          return true;
        });
      } else if (targetNode?.data.kind === 'job' && sourceNode?.data.kind === 'job') {
        // Job-to-job connections also allow multiple incoming dep edges.
        // Remove stage→target and trigger→target edges (job deps replace them)
        // and deduplicate same source, but keep other job→target edges.
        withoutExisting = edges.filter((e) => {
          if (e.target !== connection.target) { return true; }
          const src = nodes.find((n) => n.id === e.source);
          if (src?.data.kind === 'stage' || src?.data.kind === 'trigger') { return false; }
          if (e.source === connection.source) { return false; } // dedup
          return true;
        });
      } else {
        // All other node types: enforce single incoming edge.
        withoutExisting = edges.filter((e) => e.target !== connection.target);
      }

      const updated = addEdge(
        { ...connection, animated: true, style: { stroke: '#0078d4' } },
        withoutExisting
      );
      onEdgesChange(updated);
      onGraphChange(nodes, updated);
    },
    [nodes, edges, onEdgesChange, onGraphChange]
  );

  const handleConnectStart = useCallback(
    (_: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
      connectCompleted.current = false;
      const { nodeId } = params;
      if (!nodeId) { connectSource.current = null; return; }
      const node = currentNodes.current.find((n) => n.id === nodeId);
      connectSource.current = node ? { nodeId, kind: node.data.kind } : null;
    },
    []
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      // Only act when the drag ended without hitting a valid target handle
      // AND the source was a trigger, stage, or job node.
      if (connectCompleted.current) { return; }
      const sourceKind = connectSource.current?.kind;
      if (!connectSource.current || (sourceKind !== 'trigger' && sourceKind !== 'stage' && sourceKind !== 'job')) { return; }
      const target = event.target as Element;
      if (!target.classList.contains('react-flow__pane')) { return; }

      const { clientX, clientY } =
        'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);

      // Job source → delegate to host so the task catalog menu can be shown.
      if (sourceKind === 'job') {
        onJobConnectEnd?.(connectSource.current.nodeId, clientX, clientY);
        return;
      }

      const position = project({ x: clientX, y: clientY });
      const isFromStage = sourceKind === 'stage';
      const newKind = isFromStage ? 'job' : 'stage';
      const newId = `${newKind}-${Date.now()}`;
      const newNode: Node<GraphNodeData> = {
        id: newId,
        type: newKind,
        position,
        data: isFromStage
          ? { kind: 'job', label: 'New Job', rawId: 'NewJob' }
          : { kind: 'stage', label: 'New Stage', rawId: 'NewStage' },
      };
      const newEdge: Edge = {
        id: `e-${connectSource.current.nodeId}-${newId}`,
        source: connectSource.current.nodeId,
        target: newId,
        animated: true,
        style: { stroke: '#0078d4', strokeWidth: 2 },
      };

      const updatedNodes = [...currentNodes.current, newNode];
      const updatedEdges = [...latestEdges.current, newEdge];
      onNodesChange(updatedNodes);
      onEdgesChange(updatedEdges);
      onGraphChange(updatedNodes, updatedEdges);
    },
    [project, onNodesChange, onEdgesChange, onGraphChange, onJobConnectEnd]
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
      // Remove any edge already targeting the new destination (except the edge
      // being moved itself) before handing off to updateEdge.
      const withoutExisting = edges.filter(
        (e) => e.id === oldEdge.id || e.target !== newConnection.target
      );
      const updated = updateEdge(oldEdge, newConnection, withoutExisting);
      onEdgesChange(updated);
      onGraphChange(nodes, updated);
    },
    [nodes, edges, onEdgesChange, onGraphChange]
  );

  const handleEdgeUpdateEnd = useCallback(
    (_: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnected.current) {
        // Dropped on empty space — remove the edge, then restore any trigger→stage
        // or stage/trigger→job edges for nodes that would otherwise become disconnected.
        let updated = edges.filter((e) => e.id !== edge.id);
        updated = ensureStageConnectivity(nodes, updated);
        updated = ensureJobConnectivity(nodes, updated);
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
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
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
