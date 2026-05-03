import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { getVsCodeApi, ExtensionToWebviewMessage } from './vscode';
import PipelineGraph from './components/PipelineGraph';
import PalettePanel from './components/PalettePanel';
import PropertiesPanel from './components/panels/PropertiesPanel';
import ContextTaskMenu from './components/ContextTaskMenu';
import ContextEdgeMenu, { type EdgeDropChoice } from './components/ContextEdgeMenu';
import ContextTriggerMenu from './components/ContextTriggerMenu';
import ContextTemplateMenu from './components/ContextTemplateMenu';
import YamlModal from './components/YamlModal';
import { pipelineToGraph, graphToPipeline, insertTaskNode, insertTriggerNode, expandTemplateNode, collapseTemplateNodes, type TriggerType } from './pipelineConverter';
import type { Node, Edge } from 'reactflow';
import type { GraphNodeData, GraphNodeKind, CatalogTask, TaskInputDefinition, TemplateParamDefinition } from './types/pipeline';
import './App.css';

const vscode = getVsCodeApi();

declare global {
  interface Window { __extIconUri?: string; }
}

export interface GraphTweaks {
  edgeAnimation: boolean;
  showMinimap: boolean;
  showGrid: boolean;
}

/** One level of the in-webview navigation stack. */
interface NavEntry {
  fileName: string;
  absolutePath: string;
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
}

export default function App() {
  const [nodes, setNodes] = useState<Node<GraphNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showYaml, setShowYaml] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showTweaks, setShowTweaks] = useState(false);
  const [tweaks, setTweaks] = useState<GraphTweaks>({
    edgeAnimation: true,
    showMinimap: true,
    showGrid: true,
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Template navigation stack ──────────────────────────────────────────────
  const [navStack, setNavStack] = useState<NavEntry[]>([]);
  const navStackRef = useRef<NavEntry[]>([]);
  const activeDocPathRef = useRef<string>('');
  const fileNameRef = useRef<string>('');
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);

  const [parseError, setParseError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; loading: boolean; tasks: CatalogTask[];
  } | null>(null);
  const [triggerMenu, setTriggerMenu] = useState<{ x: number; y: number } | null>(null);
  const [edgeDropMenu, setEdgeDropMenu] = useState<{
    x: number; y: number; sourceNodeId: string; sourceLabel: string;
    sourceKind: 'stage' | 'job'; flowX: number; flowY: number;
  } | null>(null);
  const [templateContextMenu, setTemplateContextMenu] = useState<{
    x: number; y: number; mode: 'expand' | 'collapse';
    templateNodeId?: string; templatePath: string; fromTemplateId?: string;
  } | null>(null);

  const pendingEditCount = useRef(0);
  const selectedNodeIdRef = useRef<string | null>(null);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  const nodesRef = useRef<typeof nodes>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const edgesRef = useRef<typeof edges>([]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  const jobDragSourceRef = useRef<string | null>(null);

  const [taskInputSchema, setTaskInputSchema] = useState<TaskInputDefinition[] | null>(null);
  const [taskInputsLoading, setTaskInputsLoading] = useState(false);
  const taskInputsCacheRef = useRef<Map<string, TaskInputDefinition[]>>(new Map());
  const [templateParamSchema, setTemplateParamSchema] = useState<TemplateParamDefinition[] | null>(null);
  const [templateParamsLoading, setTemplateParamsLoading] = useState(false);
  const templateParamsCacheRef = useRef<Map<string, TemplateParamDefinition[]>>(new Map());

  // ── Listen for messages from the extension host ───────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'update') {
        if (navStackRef.current.length > 0) { return; }
        if (pendingEditCount.current > 0) {
          pendingEditCount.current -= 1;
          return;
        }
        setFileName(message.fileName);
        activeDocPathRef.current = message.documentPath;
        try {
          const { nodes: n, edges: e } = pipelineToGraph(message.yaml);
          setNodes(n);
          setEdges(e);
          setParseError(null);
          const selId = selectedNodeIdRef.current;
          if (selId !== null && !n.some((node) => node.id === selId)) {
            setSelectedNodeId(null);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setParseError(msg);
        }
      } else if (message.type === 'taskCatalogReady') {
        const BUILTIN_TASKS: import('./types/pipeline').CatalogTask[] = [
          { name: 'checkout: self', friendlyName: 'Checkout repository', category: 'Source Control', nodeKind: 'checkout' },
          { name: 'checkout: none', friendlyName: 'Skip checkout',       category: 'Source Control', nodeKind: 'checkout' },
          { name: 'script',         friendlyName: 'Script',              category: 'Utility',        nodeKind: 'script'   },
        ];
        setContextMenu((prev) =>
          prev ? { ...prev, loading: false, tasks: [...BUILTIN_TASKS, ...message.tasks] } : null
        );
      } else if (message.type === 'taskInputsReady') {
        const { taskRef, inputs } = message;
        taskInputsCacheRef.current.set(taskRef, inputs);
        const selNode = nodesRef.current.find((n) => n.id === selectedNodeIdRef.current);
        const selTaskRef = selNode?.data.details?.['taskName'] as string | undefined;
        if (selTaskRef === taskRef) {
          setTaskInputSchema(inputs);
          setTaskInputsLoading(false);
        }
      } else if (message.type === 'templateParamsReady') {
        const { templatePath, params } = message;
        templateParamsCacheRef.current.set(templatePath, params);
        const selNode = nodesRef.current.find((n) => n.id === selectedNodeIdRef.current);
        const selPath = selNode?.data.details?.['templatePath'] as string | undefined;
        if (selPath === templatePath) {
          setTemplateParamSchema(params);
          setTemplateParamsLoading(false);
        }
      } else if (message.type === 'templateExpansionReady') {
        const result = expandTemplateNode(
          message.templateNodeId, message.yaml, nodesRef.current, edgesRef.current
        );
        setNodes(result.nodes);
        setEdges(result.edges);
      } else if (message.type === 'templateLoaded') {
        const entry: NavEntry = {
          fileName: fileNameRef.current,
          absolutePath: activeDocPathRef.current,
          nodes: nodesRef.current,
          edges: edgesRef.current,
        };
        const newStack = [...navStackRef.current, entry];
        navStackRef.current = newStack;
        setNavStack(newStack);
        activeDocPathRef.current = message.absolutePath;
        setFileName(message.fileName);
        setSelectedNodeId(null);
        setTaskInputSchema(null);
        setTemplateParamSchema(null);
        templateParamsCacheRef.current.clear();
        taskInputsCacheRef.current.clear();
        try {
          const { nodes: n, edges: e } = pipelineToGraph(message.yaml);
          setNodes(n);
          setEdges(e);
          setParseError(null);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setParseError(msg);
          setNodes([]);
          setEdges([]);
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    const node = nodesRef.current.find((n) => n.id === selectedNodeId);
    if (node?.data.kind !== 'task') {
      setTaskInputSchema(null);
      setTaskInputsLoading(false);
      return;
    }
    const taskRef = (node.data.details?.['taskName'] as string | undefined) ?? '';
    if (!taskRef) { setTaskInputSchema(null); setTaskInputsLoading(false); return; }
    const cached = taskInputsCacheRef.current.get(taskRef);
    if (cached) {
      setTaskInputSchema(cached);
      setTaskInputsLoading(false);
    } else {
      setTaskInputSchema(null);
      setTaskInputsLoading(true);
      vscode.postMessage({ type: 'requestTaskInputs', taskRef });
    }
  }, [selectedNodeId]);

  useEffect(() => {
    const node = nodesRef.current.find((n) => n.id === selectedNodeId);
    if (node?.data.kind !== 'template') {
      setTemplateParamSchema(null);
      setTemplateParamsLoading(false);
      return;
    }
    const templatePath = (node.data.details?.['templatePath'] as string | undefined) ?? '';
    if (!templatePath) { setTemplateParamSchema(null); setTemplateParamsLoading(false); return; }
    const cached = templateParamsCacheRef.current.get(templatePath);
    if (cached) {
      setTemplateParamSchema(cached);
      setTemplateParamsLoading(false);
    } else {
      setTemplateParamSchema(null);
      setTemplateParamsLoading(true);
      vscode.postMessage({ type: 'requestTemplateParams', templatePath, documentPath: activeDocPathRef.current });
    }
  }, [selectedNodeId]);

  const handleGraphChange = useCallback(
    (updatedNodes: Node<GraphNodeData>[], updatedEdges: Edge[]) => {
      try {
        const yaml = graphToPipeline(updatedNodes, updatedEdges);
        if (navStackRef.current.length > 0) {
          vscode.postMessage({ type: 'edit', yaml, filePath: activeDocPathRef.current });
        } else {
          pendingEditCount.current += 1;
          vscode.postMessage({ type: 'edit', yaml });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.postMessage({ type: 'showError', text: `Failed to serialize graph: ${msg}` });
      }
    },
    []
  );

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
      nodesRef.current, edgesRef.current,
      { taskName: task.name, anchorNodeId, nodeKind: task.nodeKind }
    );
    setNodes(n);
    setEdges(e);
    handleGraphChange(n, e);
  }, [handleGraphChange]);

  const handleTriggerSelect = useCallback((triggerType: TriggerType) => {
    setTriggerMenu(null);
    const { nodes: n, edges: e } = insertTriggerNode(
      nodesRef.current, edgesRef.current, triggerType
    );
    setNodes(n);
    setEdges(e);
    handleGraphChange(n, e);
  }, [handleGraphChange]);

  const handleTaskConnectEnd = useCallback(
    (sourceNodeId: string, clientX: number, clientY: number) => {
      jobDragSourceRef.current = sourceNodeId;
      setContextMenu({ x: clientX, y: clientY, loading: true, tasks: [] });
      vscode.postMessage({ type: 'requestTaskCatalog' });
    },
    []
  );

  const handleTemplateNodeDoubleClick = useCallback((templatePath: string) => {
    vscode.postMessage({ type: 'loadTemplate', templatePath, documentPath: activeDocPathRef.current });
  }, []);

  const handleTemplateNodeContextMenu = useCallback(
    (nodeId: string, templatePath: string, x: number, y: number) => {
      setTemplateContextMenu({ x, y, mode: 'expand', templateNodeId: nodeId, templatePath });
    },
    []
  );

  const handleExpandedNodeContextMenu = useCallback(
    (fromTemplateId: string, templatePath: string, x: number, y: number) => {
      setTemplateContextMenu({ x, y, mode: 'collapse', templatePath, fromTemplateId });
    },
    []
  );

  const handleExpandTemplate = useCallback(() => {
    if (!templateContextMenu?.templateNodeId) { return; }
    vscode.postMessage({
      type: 'requestTemplateExpansion',
      templatePath: templateContextMenu.templatePath,
      documentPath: activeDocPathRef.current,
      templateNodeId: templateContextMenu.templateNodeId,
    });
  }, [templateContextMenu]);

  const handleCollapseTemplate = useCallback(() => {
    if (!templateContextMenu?.fromTemplateId) { return; }
    const result = collapseTemplateNodes(
      templateContextMenu.fromTemplateId, nodesRef.current, edgesRef.current
    );
    setNodes(result.nodes);
    setEdges(result.edges);
  }, [templateContextMenu]);

  const handleNavigateTo = useCallback((index: number) => {
    const entry = navStackRef.current[index];
    if (!entry) { return; }
    const newStack = navStackRef.current.slice(0, index);
    navStackRef.current = newStack;
    setNavStack(newStack);
    activeDocPathRef.current = entry.absolutePath;
    setFileName(entry.fileName);
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setSelectedNodeId(null);
    setTaskInputSchema(null);
    setTemplateParamSchema(null);
    setParseError(null);
    templateParamsCacheRef.current.clear();
    taskInputsCacheRef.current.clear();
  }, []);

  const handleEdgeDropEnd = useCallback(
    (sourceNodeId: string, sourceKind: 'stage' | 'job', clientX: number, clientY: number, flowX: number, flowY: number) => {
      const sourceNode = nodesRef.current.find((n) => n.id === sourceNodeId);
      const sourceLabel = sourceNode?.data.rawId ?? sourceNode?.data.label ?? sourceKind;
      setEdgeDropMenu({ x: clientX, y: clientY, sourceNodeId, sourceLabel, sourceKind, flowX, flowY });
    },
    []
  );

  const handleEdgeDropSelect = useCallback(
    (choice: EdgeDropChoice) => {
      if (!edgeDropMenu) { return; }
      const { sourceNodeId, sourceLabel, sourceKind, flowX, flowY } = edgeDropMenu;
      setEdgeDropMenu(null);
      const position = { x: flowX, y: flowY };

      if (choice === 'task') {
        jobDragSourceRef.current = sourceNodeId;
        setContextMenu({ x: edgeDropMenu.x, y: edgeDropMenu.y, loading: true, tasks: [] });
        vscode.postMessage({ type: 'requestTaskCatalog' });
        return;
      }

      if (choice === 'job') {
        const newId = `job-${Date.now()}`;
        const newNode = {
          id: newId, type: 'job' as const, position,
          data: {
            kind: 'job' as const,
            label: 'New Job', rawId: 'NewJob',
            ...(sourceKind === 'job' ? { dependsOn: [sourceLabel] } : {}),
          },
        };
        const newEdge = {
          id: `e-${sourceNodeId}-${newId}`, source: sourceNodeId, target: newId,
          animated: true, style: { stroke: '#0078d4', strokeWidth: 2 },
        };
        const n = [...nodesRef.current, newNode];
        const e = [...edgesRef.current, newEdge];
        setNodes(n); setEdges(e); handleGraphChange(n, e);
      } else {
        const newId = `stage-${Date.now()}`;
        const newNode = {
          id: newId, type: 'stage' as const, position,
          data: { kind: 'stage' as const, label: 'New Stage', rawId: 'NewStage', dependsOn: [sourceLabel] },
        };
        const newEdge = {
          id: `e-${sourceNodeId}-${newId}`, source: sourceNodeId, target: newId,
          animated: true, style: { stroke: '#0078d4', strokeWidth: 2 },
        };
        const n = [...nodesRef.current, newNode];
        const e = [...edgesRef.current, newEdge];
        setNodes(n); setEdges(e); handleGraphChange(n, e);
      }
    },
    [edgeDropMenu, handleGraphChange]
  );

  // ── Palette: add a new node from the left panel ───────────────────────────
  const handleAddNodeFromPalette = useCallback((kind: GraphNodeKind) => {
    const newId = `${kind}-${Date.now()}`;
    const kindDefaults: Record<GraphNodeKind, { label: string; rawId: string; details?: Record<string, unknown> }> = {
      trigger:  { label: 'CI Trigger',        rawId: 'Trigger',  details: { triggerType: 'ci', branches: ['main'] } },
      stage:    { label: 'New Stage',         rawId: 'NewStage'  },
      job:      { label: 'New Job',           rawId: 'NewJob',   details: { pool: 'ubuntu-latest' } },
      task:     { label: 'New Task',          rawId: 'NewTask',  details: { taskName: 'Task@0' } },
      script:   { label: 'New Script',        rawId: 'NewScript' },
      checkout: { label: 'Checkout',          rawId: 'checkout', details: { repository: 'self' } },
      publish:  { label: 'Publish Artifact',  rawId: 'Publish',  details: { artifact: 'drop' } },
      download: { label: 'Download Artifact', rawId: 'Download', details: { artifact: 'drop' } },
      template: { label: 'template.yml',      rawId: 'template', details: { templatePath: './templates/template.yml' } },
    };
    const kd = kindDefaults[kind];
    const existing = nodesRef.current;
    const baseY = existing.length > 0 ? Math.max(...existing.map((n) => n.position.y)) + 150 : 200;
    const baseX = existing.length > 0 ? existing[existing.length - 1].position.x + Math.random() * 60 - 30 : 400;

    const newNode: Node<GraphNodeData> = {
      id: newId,
      type: kind,
      position: { x: baseX, y: baseY },
      data: {
        kind,
        label: kd.label,
        rawId: kd.rawId,
        details: kd.details,
      },
    };
    const n = [...nodesRef.current, newNode];
    setNodes(n);
    setSelectedNodeId(newId);
    showToast(`Added ${kind} node`);
  }, [showToast]);

  const selectedNode = selectedNodeId != null
    ? (nodes.find((n) => n.id === selectedNodeId) ?? null)
    : null;

  // ── YAML for export modal ──────────────────────────────────────────────────
  const exportYaml = showYaml ? (() => {
    try { return graphToPipeline(nodes, edges); } catch { return '# Error generating YAML'; }
  })() : '';

  return (
    <div className="app-container">

      {/* ── Header ── */}
      <header className="app-header">
        {window.__extIconUri
          ? <img src={window.__extIconUri} alt="" className="app-header__icon-img" />
          : <span className="app-icon">⬡</span>
        }

        <span className="app-title">Azure Blueprints</span>
        <span className="app-header__sep" />

        {/* Breadcrumb or filename */}
        {navStack.length > 0 ? (
          <nav className="app-breadcrumb" aria-label="Navigation">
            {navStack.map((entry, i) => (
              <React.Fragment key={i}>
                <button
                  className="app-breadcrumb-item app-breadcrumb-link"
                  onClick={() => handleNavigateTo(i)}
                  title={entry.absolutePath}
                >
                  {entry.fileName || 'pipeline'}
                </button>
                <span className="app-breadcrumb-sep" aria-hidden="true">›</span>
              </React.Fragment>
            ))}
            <span className="app-breadcrumb-item app-breadcrumb-current" title={activeDocPathRef.current}>
              {fileName}
            </span>
          </nav>
        ) : (
          fileName && <span className="app-filename">{fileName}</span>
        )}

        {/* Centre hint */}
        <div className="app-header__hint">
          Space+drag to pan · Scroll to zoom · Right-click canvas to add · Delete to remove
        </div>

        {/* Right actions */}
        <div className="app-header__actions">
          {parseError && (
            <span className="app-error" title={parseError}>⚠ Parse error</span>
          )}
          <button
            className="app-header__tweaks-btn"
            onClick={() => setShowTweaks((v) => !v)}
            title="Graph settings"
          >
            ⚙
          </button>
          <button
            className="app-header__save-btn"
            onClick={() => setShowYaml(true)}
          >
            ⬇ Save YAML
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="app-body">
        <PalettePanel onAddNode={handleAddNodeFromPalette} />

        <ReactFlowProvider>
          <PipelineGraph
            nodes={nodes}
            edges={edges}
            tweaks={tweaks}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onGraphChange={handleGraphChange}
            onNodeSelect={(node) => setSelectedNodeId(node?.id ?? null)}
            onPaneContextMenu={handleContextMenu}
            onTaskConnectEnd={handleTaskConnectEnd}
            onEdgeDropEnd={handleEdgeDropEnd}
            onTemplateNodeDoubleClick={handleTemplateNodeDoubleClick}
            onTemplateNodeContextMenu={handleTemplateNodeContextMenu}
            onExpandedNodeContextMenu={handleExpandedNodeContextMenu}
          />
        </ReactFlowProvider>

        {contextMenu && (
          <ContextTaskMenu
            x={contextMenu.x} y={contextMenu.y}
            loading={contextMenu.loading} tasks={contextMenu.tasks}
            onSelect={handleTaskSelect}
            onClose={() => { jobDragSourceRef.current = null; setContextMenu(null); }}
          />
        )}
        {edgeDropMenu && (
          <ContextEdgeMenu
            x={edgeDropMenu.x} y={edgeDropMenu.y}
            sourceLabel={edgeDropMenu.sourceLabel} sourceKind={edgeDropMenu.sourceKind}
            onSelect={handleEdgeDropSelect}
            onClose={() => setEdgeDropMenu(null)}
          />
        )}
        {triggerMenu && (
          <ContextTriggerMenu
            x={triggerMenu.x} y={triggerMenu.y}
            onSelect={handleTriggerSelect}
            onClose={() => setTriggerMenu(null)}
          />
        )}
        {templateContextMenu && (
          <ContextTemplateMenu
            x={templateContextMenu.x} y={templateContextMenu.y}
            mode={templateContextMenu.mode} templatePath={templateContextMenu.templatePath}
            onExpand={handleExpandTemplate}
            onCollapse={handleCollapseTemplate}
            onClose={() => setTemplateContextMenu(null)}
          />
        )}
        {selectedNode && (
          <PropertiesPanel
            node={selectedNode}
            onDataChange={handleNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
            taskInputSchema={taskInputSchema}
            taskInputsLoading={taskInputsLoading}
            templateParamSchema={templateParamSchema}
            templateParamsLoading={templateParamsLoading}
          />
        )}
      </div>

      {/* ── YAML Export Modal ── */}
      {showYaml && (
        <YamlModal
          yaml={exportYaml}
          fileName={fileName || 'azure-pipeline.yml'}
          onClose={() => setShowYaml(false)}
        />
      )}

      {/* ── Tweaks Panel ── */}
      {showTweaks && (
        <div className="tweaks-panel">
          <div className="tweaks-panel__title">Graph Settings</div>
          {([
            { key: 'edgeAnimation' as const, label: 'Animated edges' },
            { key: 'showMinimap'   as const, label: 'Show minimap'   },
            { key: 'showGrid'      as const, label: 'Show dot grid'  },
          ] as { key: keyof GraphTweaks; label: string }[]).map((row) => (
            <div key={row.key} className="tweaks-panel__row">
              <span className="tweaks-panel__label">{row.label}</span>
              <div
                className={`tweaks-toggle${tweaks[row.key] ? ' tweaks-toggle--on' : ''}`}
                onClick={() => setTweaks((t) => ({ ...t, [row.key]: !t[row.key] }))}
              >
                <div className="tweaks-toggle__thumb" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className="app-toast">
          <span className="app-toast__icon">◈</span> {toast}
        </div>
      )}
    </div>
  );
}
