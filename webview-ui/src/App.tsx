import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { getVsCodeApi, ExtensionToWebviewMessage } from './vscode';
import PipelineGraph from './components/PipelineGraph';
import PropertiesPanel from './components/panels/PropertiesPanel';
import ContextTaskMenu from './components/ContextTaskMenu';
import ContextTriggerMenu from './components/ContextTriggerMenu';
import { pipelineToGraph, graphToPipeline, insertTaskNode, insertTriggerNode, type TriggerType } from './pipelineConverter';
import type { Node, Edge } from 'reactflow';
import type { GraphNodeData, CatalogTask, TaskInputDefinition } from './types/pipeline';
import './App.css';

const vscode = getVsCodeApi();

export default function App() {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  // Track selected node by ID so the panel always reads fresh data from `nodes`
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    loading: boolean;
    tasks: CatalogTask[];
  } | null>(null);

  // Trigger creation menu — shown when there is no trigger node yet
  const [triggerMenu, setTriggerMenu] = useState<{ x: number; y: number } | null>(null);

  // Count of edit messages we've sent that haven't been echoed back yet.
  // Each sent edit increments this; each incoming update decrements and is
  // ignored if the count is still positive. Only updates that arrive when
  // the counter reaches zero are genuine external edits (e.g. the user
  // editing the raw YAML file directly).
  const pendingEditCount = useRef(0);

  // Ref mirror of selectedNodeId so the stale message-handler closure can
  // read the current selection without needing to be added to its deps array.
  const selectedNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  // Ref mirrors of nodes/edges — kept fresh so the stale message-handler
  // closure can read latest state for insertTaskNode.
  const nodesRef = useRef<typeof nodes>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const edgesRef = useRef<typeof edges>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // When a job→empty-space drag spawns the context menu, remember which job
  // node the drag originated from so the inserted task gets wired to it.
  const jobDragSourceRef = useRef<string | null>(null);

  // ── Task input schema (fetched per task reference, cached in-session) ─────
  const [taskInputSchema, setTaskInputSchema] = useState<TaskInputDefinition[] | null>(null);
  const [taskInputsLoading, setTaskInputsLoading] = useState(false);
  // Per-taskRef cache so we don't re-fetch the same schema twice
  const taskInputsCacheRef = useRef<Map<string, TaskInputDefinition[]>>(new Map());

  // ── Listen for messages from the extension host ───────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'update') {
        // Ignore echo-backs of our own edits regardless of order/timing
        if (pendingEditCount.current > 0) {
          pendingEditCount.current -= 1;
          return;
        }
        // Genuine external update (user edited the YAML file directly)
        setFileName(message.fileName);
        try {
          const { nodes: n, edges: e } = pipelineToGraph(message.yaml);
          setNodes(n);
          setEdges(e);
          setParseError(null);
          // Only close the panel if the selected node no longer exists in
          // the re-parsed graph (node IDs are positional and deterministic).
          const selId = selectedNodeIdRef.current;
          if (selId !== null && !n.some((node) => node.id === selId)) {
            setSelectedNodeId(null);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setParseError(msg);
        }
      } else if (message.type === 'taskCatalogReady') {
        // Populate the in-canvas context menu with the fetched catalog.
        setContextMenu((prev) =>
          prev ? { ...prev, loading: false, tasks: message.tasks } : null
        );
      } else if (message.type === 'taskInputsReady') {
        // Cache the schema and update the panel if this task is still selected.
        const { taskRef, inputs } = message;
        taskInputsCacheRef.current.set(taskRef, inputs);
        const selNode = nodesRef.current.find((n) => n.id === selectedNodeIdRef.current);
        const selTaskRef = selNode?.data.details?.['taskName'] as string | undefined;
        if (selTaskRef === taskRef) {
          setTaskInputSchema(inputs);
          setTaskInputsLoading(false);
        }
      }
    };
    window.addEventListener('message', handler);
    // Signal to the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── Fetch task input schema when a task node is selected ──────────────────
  useEffect(() => {
    const node = nodesRef.current.find((n) => n.id === selectedNodeId);
    if (node?.data.kind !== 'task') {
      setTaskInputSchema(null);
      setTaskInputsLoading(false);
      return;
    }
    const taskRef = (node.data.details?.['taskName'] as string | undefined) ?? '';
    if (!taskRef) {
      setTaskInputSchema(null);
      setTaskInputsLoading(false);
      return;
    }
    const cached = taskInputsCacheRef.current.get(taskRef);
    if (cached) {
      setTaskInputSchema(cached);
      setTaskInputsLoading(false);
    } else {
      setTaskInputSchema(null);
      setTaskInputsLoading(true);
      vscode.postMessage({ type: 'requestTaskInputs', taskRef });
    }
  }, [selectedNodeId]);  // Intentionally excludes `nodes`: we only re-fetch on node selection change

  // ── Push graph changes back to the YAML document ─────────────────────────
  const handleGraphChange = useCallback(
    (updatedNodes: Node<GraphNodeData>[], updatedEdges: Edge[]) => {
      try {
        const yaml = graphToPipeline(updatedNodes, updatedEdges);
        pendingEditCount.current += 1;
        vscode.postMessage({ type: 'edit', yaml });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.postMessage({ type: 'showError', text: `Failed to serialize graph: ${msg}` });
      }
    },
    []
  );

  // ── Node property edits ───────────────────────────────────────────────────
  const handleNodeDataChange = useCallback(
    (nodeId: string, data: Partial<GraphNodeData>) => {
      const updated = nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      );
      setNodes(updated);
      handleGraphChange(updated, edges);
    },
    [nodes, edges, handleGraphChange]
  );

  // ── Context menu on empty canvas ───────────────────────────────────────────
  // If there is no trigger yet: show the trigger creation menu.
  // Otherwise: show the task catalog (existing behaviour).
  const handleContextMenu = useCallback((x: number, y: number) => {
    const hasTrigger = nodesRef.current.some((n) => n.data.kind === 'trigger');
    if (!hasTrigger) {
      setTriggerMenu({ x, y });
    } else {
      setContextMenu({ x, y, loading: true, tasks: [] });
      vscode.postMessage({ type: 'requestTaskCatalog' });
    }
  }, []);

  const handleTaskSelect = useCallback((task: CatalogTask) => {
    setContextMenu(null);
    const anchorNodeId = jobDragSourceRef.current ?? undefined;
    jobDragSourceRef.current = null;
    const { nodes: n, edges: e } = insertTaskNode(
      nodesRef.current,
      edgesRef.current,
      { taskName: task.name, anchorNodeId }
    );
    setNodes(n);
    setEdges(e);
    handleGraphChange(n, e);
  }, [handleGraphChange]);

  const handleTriggerSelect = useCallback((triggerType: TriggerType) => {
    setTriggerMenu(null);
    const { nodes: n, edges: e } = insertTriggerNode(
      nodesRef.current,
      edgesRef.current,
      triggerType
    );
    setNodes(n);
    setEdges(e);
    handleGraphChange(n, e);
  }, [handleGraphChange]);

  // Called by PipelineGraph when the user drags an edge from a job or task and
  // drops it on empty space — show the task catalog menu, remembering the source node.
  const handleNodeConnectEnd = useCallback(
    (sourceNodeId: string, clientX: number, clientY: number) => {
      jobDragSourceRef.current = sourceNodeId;
      setContextMenu({ x: clientX, y: clientY, loading: true, tasks: [] });
      vscode.postMessage({ type: 'requestTaskCatalog' });
    },
    []
  );

  // Derive the currently selected node from live `nodes` state so the
  // PropertiesPanel never reads stale data after an edit
  const selectedNode = selectedNodeId != null
    ? (nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;

  return (
    <div className="app-container">
      <header className="app-header">
        <span className="app-title">
          <span className="app-icon">⬡</span> Azure Blueprints
        </span>
        {fileName && <span className="app-filename">{fileName}</span>}
        {parseError && (
          <span className="app-error" title={parseError}>
            ⚠ Parse error
          </span>
        )}
      </header>

      <div className="app-body">
        <ReactFlowProvider>
        <PipelineGraph
          nodes={nodes}
          edges={edges}
          onNodesChange={setNodes}
          onEdgesChange={setEdges}
          onGraphChange={handleGraphChange}
          onNodeSelect={(node) => setSelectedNodeId(node?.id ?? null)}
          onPaneContextMenu={handleContextMenu}
          onNodeConnectEnd={handleNodeConnectEnd}
        />
        </ReactFlowProvider>

        {contextMenu && (
          <ContextTaskMenu
            x={contextMenu.x}
            y={contextMenu.y}
            loading={contextMenu.loading}
            tasks={contextMenu.tasks}
            onSelect={handleTaskSelect}
            onClose={() => { jobDragSourceRef.current = null; setContextMenu(null); }}
          />
        )}

        {triggerMenu && (
          <ContextTriggerMenu
            x={triggerMenu.x}
            y={triggerMenu.y}
            onSelect={handleTriggerSelect}
            onClose={() => setTriggerMenu(null)}
          />
        )}

        {selectedNode && (
          <PropertiesPanel
            node={selectedNode}
            onDataChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
            taskInputSchema={taskInputSchema}
            taskInputsLoading={taskInputsLoading}
          />
        )}
      </div>
    </div>
  );
}
