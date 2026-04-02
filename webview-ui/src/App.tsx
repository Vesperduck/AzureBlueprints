import React, { useCallback, useEffect, useState } from 'react';
import { getVsCodeApi, ExtensionToWebviewMessage } from './vscode';
import PipelineGraph from './components/PipelineGraph';
import PropertiesPanel from './components/panels/PropertiesPanel';
import { pipelineToGraph, graphToPipeline } from './pipelineConverter';
import type { Node, Edge } from 'reactflow';
import type { GraphNodeData } from './types/pipeline';
import './App.css';

const vscode = getVsCodeApi();

export default function App() {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node<GraphNodeData> | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);

  // ── Listen for messages from the extension host ───────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'update') {
        setFileName(message.fileName);
        try {
          const { nodes: n, edges: e } = pipelineToGraph(message.yaml);
          setNodes(n);
          setEdges(e);
          setParseError(null);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setParseError(msg);
        }
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
      setNodes((prev) => {
        const updated = prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
        );
        handleGraphChange(updated, edges);
        return updated;
      });
    },
    [edges, handleGraphChange]
  );

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
          onNodeSelect={setSelectedNode}
        />

        {selectedNode && (
          <PropertiesPanel
            node={selectedNode}
            onDataChange={handleNodeDataChange}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
