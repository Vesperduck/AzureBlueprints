import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getVsCodeApi, ExtensionToWebviewMessage } from './vscode';
import PipelineGraph from './components/PipelineGraph';
import PropertiesPanel from './components/panels/PropertiesPanel';
import { pipelineToGraph, graphToPipeline, insertTaskNode } from './pipelineConverter';
import type { Node, Edge } from 'reactflow';
import type { GraphNodeData } from './types/pipeline';
import './App.css';

const vscode = getVsCodeApi();

export default function App() {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  // Track selected node by ID so the panel always reads fresh data from `nodes`
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);

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
      } else if (message.type === 'addTask') {
        // Extension host picked a task via QuickPick — insert a new node.
        const { nodes: n, edges: e } = insertTaskNode(
          nodesRef.current,
          edgesRef.current,
          { taskName: message.task.name }
        );
        setNodes(n);
        setEdges(e);
        handleGraphChange(n, e);
      }
    };
    window.addEventListener('message', handler);
    // Signal to the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

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

  // ── Context menu on empty canvas — request task catalog from extension ───
  const handleContextMenu = useCallback(() => {
    vscode.postMessage({ type: 'requestTaskCatalog' });
  }, []);

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
        <PipelineGraph
          nodes={nodes}
          edges={edges}
          onNodesChange={setNodes}
          onEdgesChange={setEdges}
          onGraphChange={handleGraphChange}
          onNodeSelect={(node) => setSelectedNodeId(node?.id ?? null)}
          onPaneContextMenu={handleContextMenu}
        />

        {selectedNode && (
          <PropertiesPanel
            node={selectedNode}
            onDataChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
