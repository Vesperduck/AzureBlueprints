import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { getVsCodeApi, ExtensionToWebviewMessage } from './vscode';
import PipelineGraph from './components/PipelineGraph';
import PropertiesPanel from './components/panels/PropertiesPanel';
import ContextTaskMenu from './components/ContextTaskMenu';
import ContextEdgeMenu, { type EdgeDropChoice } from './components/ContextEdgeMenu';
import ContextTriggerMenu from './components/ContextTriggerMenu';
import { pipelineToGraph, graphToPipeline, insertTaskNode, insertTriggerNode, type TriggerType } from './pipelineConverter';
import type { Node, Edge } from 'reactflow';
import type { GraphNodeData, CatalogTask, TaskInputDefinition, TemplateParamDefinition } from './types/pipeline';
import './App.css';

const vscode = getVsCodeApi();

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
  // Track selected node by ID so the panel always reads fresh data from `nodes`
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [documentPath, setDocumentPath] = useState<string>('');

  // ── Template navigation stack ──────────────────────────────────────────────
  // Each entry captures the view that was pushed aside when navigating into a
  // template. navStack[0] = root document, navStack[n-1] = direct parent.
  const [navStack, setNavStack] = useState<NavEntry[]>([]);
  const navStackRef = useRef<NavEntry[]>([]);

  // The absolute path of the document currently being viewed and edited
  // (the original pipeline path at root, or the template's path when navigated).
  const activeDocPathRef = useRef<string>('');

  // Ref mirror of fileName so the stale message-handler closure can read it.
  const fileNameRef = useRef<string>('');
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    loading: boolean;
    tasks: CatalogTask[];
  } | null>(null);

  // Trigger creation menu — shown when there is no trigger node yet
  const [triggerMenu, setTriggerMenu] = useState<{ x: number; y: number } | null>(null);

  // Edge-drop menu — shown when user drags from a stage or job onto empty space
  const [edgeDropMenu, setEdgeDropMenu] = useState<{
    x: number;
    y: number;
    sourceNodeId: string;
    sourceLabel: string;
    sourceKind: 'stage' | 'job';
    flowX: number;
    flowY: number;
  } | null>(null);

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

  // ── Template parameter schema (fetched when a template node is selected) ──
  const [templateParamSchema, setTemplateParamSchema] = useState<TemplateParamDefinition[] | null>(null);
  const [templateParamsLoading, setTemplateParamsLoading] = useState(false);
  // Per-templatePath cache (keyed by templatePath string)
  const templateParamsCacheRef = useRef<Map<string, TemplateParamDefinition[]>>(new Map());

  // ── Listen for messages from the extension host ───────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'update') {
        // While navigated into a template, suppress incoming updates about the
        // primary document so the graph doesn't revert to the root pipeline.
        if (navStackRef.current.length > 0) { return; }
        // Ignore echo-backs of our own edits regardless of order/timing
        if (pendingEditCount.current > 0) {
          pendingEditCount.current -= 1;
          return;
        }
        // Genuine external update (user edited the YAML file directly)
        setFileName(message.fileName);
        setDocumentPath(message.documentPath);
        activeDocPathRef.current = message.documentPath;
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
        // Prepend built-in step types, then append the fetched ADO catalog.
        const BUILTIN_TASKS: import('./types/pipeline').CatalogTask[] = [
          { name: 'checkout: self',       friendlyName: 'Checkout repository',   category: 'Source Control', nodeKind: 'checkout' },
          { name: 'checkout: none',       friendlyName: 'Skip checkout',          category: 'Source Control', nodeKind: 'checkout' },
          { name: 'script',               friendlyName: 'Script',                 category: 'Utility',        nodeKind: 'script'   },
        ];
        setContextMenu((prev) =>
          prev ? { ...prev, loading: false, tasks: [...BUILTIN_TASKS, ...message.tasks] } : null
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
      } else if (message.type === 'templateParamsReady') {
        const { templatePath, params } = message;
        templateParamsCacheRef.current.set(templatePath, params);
        const selNode = nodesRef.current.find((n) => n.id === selectedNodeIdRef.current);
        const selPath = selNode?.data.details?.['templatePath'] as string | undefined;
        if (selPath === templatePath) {
          setTemplateParamSchema(params);
          setTemplateParamsLoading(false);
        }
      } else if (message.type === 'templateLoaded') {
        // Push current view onto the nav stack and switch to the template graph.
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

  // ── Fetch template parameter schema when a template node is selected ──────
  useEffect(() => {
    const node = nodesRef.current.find((n) => n.id === selectedNodeId);
    if (node?.data.kind !== 'template') {
      setTemplateParamSchema(null);
      setTemplateParamsLoading(false);
      return;
    }
    const templatePath = (node.data.details?.['templatePath'] as string | undefined) ?? '';
    if (!templatePath) {
      setTemplateParamSchema(null);
      setTemplateParamsLoading(false);
      return;
    }
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

  // ── Push graph changes back to the YAML document ─────────────────────────
  const handleGraphChange = useCallback(
    (updatedNodes: Node<GraphNodeData>[], updatedEdges: Edge[]) => {
      try {
        const yaml = graphToPipeline(updatedNodes, updatedEdges);
        if (navStackRef.current.length > 0) {
          // Editing a navigated template file — send with explicit filePath so
          // the extension writes to the right file. Don't increment
          // pendingEditCount: the extension won't echo this back via 'update'.
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
      { taskName: task.name, anchorNodeId, nodeKind: task.nodeKind }
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

  // Called by PipelineGraph when the user drags an edge from a task node onto empty space.
  const handleTaskConnectEnd = useCallback(
    (sourceNodeId: string, clientX: number, clientY: number) => {
      jobDragSourceRef.current = sourceNodeId;
      setContextMenu({ x: clientX, y: clientY, loading: true, tasks: [] });
      vscode.postMessage({ type: 'requestTaskCatalog' });
    },
    []
  );

  // Called when the user double-clicks a template node — navigate into it.
  const handleTemplateNodeDoubleClick = useCallback(
    (templatePath: string) => {
      vscode.postMessage({ type: 'loadTemplate', templatePath, documentPath: activeDocPathRef.current });
    },
    []
  );

  // Navigate back to a specific breadcrumb level.
  // `index` is the position in navStack whose state we want to restore.
  const handleNavigateTo = useCallback(
    (index: number) => {
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
    },
    []
  );

  // Called by PipelineGraph when the user drags an edge from a stage or job onto empty space.
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
        // Open the task catalog; the selected task will be wired to the source job.
        jobDragSourceRef.current = sourceNodeId;
        setContextMenu({ x: edgeDropMenu.x, y: edgeDropMenu.y, loading: true, tasks: [] });
        vscode.postMessage({ type: 'requestTaskCatalog' });
        return;
      }

      if (choice === 'job') {
        const newId = `job-${Date.now()}`;
        const newNode = {
          id: newId,
          type: 'job' as const,
          position,
          data: {
            kind: 'job' as const,
            label: 'New Job',
            rawId: 'NewJob',
            // When dragging from a job, the new job depends on that job
            ...(sourceKind === 'job' ? { dependsOn: [sourceLabel] } : {}),
          },
        };
        const newEdge = {
          id: `e-${sourceNodeId}-${newId}`,
          source: sourceNodeId,
          target: newId,
          animated: true,
          style: { stroke: '#0078d4', strokeWidth: 2 },
        };
        const n = [...nodesRef.current, newNode];
        const e = [...edgesRef.current, newEdge];
        setNodes(n);
        setEdges(e);
        handleGraphChange(n, e);
      } else {
        // choice === 'stage': new stage that depends on the source stage
        const newId = `stage-${Date.now()}`;
        const newNode = {
          id: newId,
          type: 'stage' as const,
          position,
          data: {
            kind: 'stage' as const,
            label: 'New Stage',
            rawId: 'NewStage',
            dependsOn: [sourceLabel],
          },
        };
        const newEdge = {
          id: `e-${sourceNodeId}-${newId}`,
          source: sourceNodeId,
          target: newId,
          animated: true,
          style: { stroke: '#0078d4', strokeWidth: 2 },
        };
        const n = [...nodesRef.current, newNode];
        const e = [...edgesRef.current, newEdge];
        setNodes(n);
        setEdges(e);
        handleGraphChange(n, e);
      }
    },
    [edgeDropMenu, handleGraphChange]
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

        {/* Breadcrumb trail — shown when navigated into template(s) */}
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
          onTaskConnectEnd={handleTaskConnectEnd}
          onEdgeDropEnd={handleEdgeDropEnd}
          onTemplateNodeDoubleClick={handleTemplateNodeDoubleClick}
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

        {edgeDropMenu && (
          <ContextEdgeMenu
            x={edgeDropMenu.x}
            y={edgeDropMenu.y}
            sourceLabel={edgeDropMenu.sourceLabel}
            sourceKind={edgeDropMenu.sourceKind}
            onSelect={handleEdgeDropSelect}
            onClose={() => setEdgeDropMenu(null)}
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
            templateParamSchema={templateParamSchema}
            templateParamsLoading={templateParamsLoading}
          />
        )}
      </div>
    </div>
  );
}
