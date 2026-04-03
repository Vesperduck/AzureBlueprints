/**
 * pipelineConverter.ts
 *
 * Converts between Azure DevOps YAML pipeline text and the ReactFlow
 * nodes/edges graph representation used by the webview.
 */
import * as jsYaml from 'js-yaml';
import type { Edge, Node, XYPosition } from 'reactflow';
import type {
  Pipeline,
  PipelineJob,
  PipelineDeploymentJob,
  PipelineStep,
  PipelineSchedule,
  GraphNodeData,
  GraphNodeKind,
} from './types/pipeline';

// ── Layout constants ──────────────────────────────────────────────────────────

const COL_W = 280;   // horizontal spacing between columns
const ROW_H = 120;   // vertical spacing within a column
const STAGE_X = 0;
const JOB_X = COL_W;
const TASK_X = COL_W * 2;

// ── YAML → Graph ──────────────────────────────────────────────────────────────

export function pipelineToGraph(yaml: string): {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
} {
  const pipeline = jsYaml.load(yaml) as Pipeline | undefined | null;

  const nodes: Node<GraphNodeData>[] = [];
  const edges: Edge[] = [];

  if (!pipeline || typeof pipeline !== 'object') {
    return { nodes, edges };
  }

  let nodeSeq = 0;
  const nextId = (prefix: string) => `${prefix}-${nodeSeq++}`;

  // ── Trigger node ────────────────────────────────────────────────────────────
  const triggerId = nextId('trigger');
  const triggerLabel = describeTrigger(pipeline);
  const triggerType = getTriggerType(pipeline);
  const triggerNode = makeNode(triggerId, 'trigger', triggerLabel, triggerLabel, triggerId, { x: STAGE_X - COL_W, y: 0 });
  const triggerDetails: Record<string, unknown> = { triggerType };
  if (triggerType === 'scheduled' && pipeline.schedules && pipeline.schedules.length > 0) {
    // Store the first schedule entry for editing. Multiple schedules are
    // preserved verbatim in serialisation via the schedules array.
    const s = pipeline.schedules[0];
    triggerDetails['cron'] = s.cron;
    triggerDetails['scheduleDisplayName'] = s.displayName ?? '';
    triggerDetails['branchesInclude'] = (s.branches?.include ?? []).join(', ');
    triggerDetails['branchesExclude'] = (s.branches?.exclude ?? []).join(', ');
    triggerDetails['always'] = s.always ?? false;
    triggerDetails['batch'] = s.batch ?? false;
  }
  triggerNode.data.details = triggerDetails;
  nodes.push(triggerNode);

  // ── Stages pipeline ──────────────────────────────────────────────────────────
  if (pipeline.stages && pipeline.stages.length > 0) {
    let stageY = 0;

    for (const stage of pipeline.stages) {
      const stageId = nextId('stage');
      const stageLabel = stage.displayName ?? stage.stage ?? 'Stage';

      const stageNode = makeNode(stageId, 'stage', stageLabel, stage.stage, stageId, {
        x: STAGE_X,
        y: stageY,
      });
      stageNode.data.displayName = stageLabel;
      stageNode.data.condition = stage.condition;
      stageNode.data.dependsOn = normalizeDependsOn(stage.dependsOn);
      nodes.push(stageNode);

      // Connect trigger → first stage or stage → stage via dependsOn
      if (stageNode.data.dependsOn && stageNode.data.dependsOn.length > 0) {
        for (const dep of stageNode.data.dependsOn) {
          const depNode = nodes.find(
            (n) => n.data.rawId === dep && n.data.kind === 'stage'
          );
          if (depNode) {
            edges.push(makeEdge(depNode.id, stageId));
          }
        }
      } else {
        edges.push(makeEdge(triggerId, stageId));
      }

      // Jobs inside stage
      const stageJobs = stage.jobs ?? [];
      let jobY = stageY;

      for (const job of stageJobs) {
        const jobId = nextId('job');
        const isDeployment = 'deployment' in job;
        const jobKey = isDeployment
          ? (job as PipelineDeploymentJob).deployment
          : (job as PipelineJob).job;
        const jobLabel =
          (job as PipelineJob).displayName ?? jobKey ?? 'Job';

        const jobNode = makeNode(jobId, 'job', jobLabel, jobKey ?? jobId, jobId, {
          x: JOB_X,
          y: jobY,
        });
        jobNode.data.displayName = jobLabel;
        jobNode.data.condition = job.condition;
        jobNode.data.dependsOn = normalizeDependsOn(job.dependsOn);
        jobNode.data.details = {
          pool: describePool(job.pool),
          isDeployment,
        };
        nodes.push(jobNode);
        edges.push(makeEdge(stageId, jobId));

        // Steps / tasks inside job – chained sequentially
        const steps: PipelineStep[] = (job as PipelineJob).steps ?? [];
        let taskY = jobY;
        let prevTaskId: string = jobId;

        for (const step of steps) {
          const taskId = nextId('task');
          const { kind, label, taskName, displayName } = describeStep(step);

          const taskNode = makeNode(taskId, kind, label, label, taskId, {
            x: TASK_X,
            y: taskY,
          });
          taskNode.data.condition = (step as { condition?: string }).condition;
          taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
          taskNode.data.details = { taskName };
          taskNode.data.displayName = displayName;
          taskNode.data.parentId = jobId;
          nodes.push(taskNode);
          edges.push(makeEdge(prevTaskId, taskId));
          prevTaskId = taskId;
          taskY += ROW_H;
        }

        jobY += Math.max(ROW_H, steps.length * ROW_H);
      }

      stageY += Math.max(ROW_H, stageJobs.length * ROW_H * 2);
    }
  } else if (pipeline.jobs && pipeline.jobs.length > 0) {
    // ── Jobs-only pipeline (no stages) ────────────────────────────────────────
    let jobY = 0;

    for (const job of pipeline.jobs) {
      const jobId = nextId('job');
      const isDeployment = 'deployment' in job;
      const jobKey = isDeployment
        ? (job as PipelineDeploymentJob).deployment
        : (job as PipelineJob).job;
      const jobLabel = (job as PipelineJob).displayName ?? jobKey ?? 'Job';

      const jobNode = makeNode(jobId, 'job', jobLabel, jobKey ?? jobId, jobId, {
        x: JOB_X,
        y: jobY,
      });
      jobNode.data.dependsOn = normalizeDependsOn(job.dependsOn);
      jobNode.data.details = { pool: describePool(job.pool), isDeployment };
      nodes.push(jobNode);
      edges.push(makeEdge(triggerId, jobId));

      const steps: PipelineStep[] = (job as PipelineJob).steps ?? [];
      let taskY = jobY;
      let prevTaskId: string = jobId;
      for (const step of steps) {
        const taskId = nextId('task');
        const { kind, label, taskName, displayName } = describeStep(step);
        const taskNode = makeNode(taskId, kind, label, label, taskId, {
          x: TASK_X,
          y: taskY,
        });
        taskNode.data.condition = (step as { condition?: string }).condition;
        taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
        taskNode.data.details = { taskName };
        taskNode.data.displayName = displayName;
        taskNode.data.parentId = jobId;
        nodes.push(taskNode);
        edges.push(makeEdge(prevTaskId, taskId));
        prevTaskId = taskId;
        taskY += ROW_H;
      }

      jobY += Math.max(ROW_H, steps.length * ROW_H);
    }
  } else if (pipeline.steps && pipeline.steps.length > 0) {
    // ── Steps-only pipeline ────────────────────────────────────────────────────
    let taskY = 0;
    let prevTaskId: string = triggerId;
    for (const step of pipeline.steps) {
      const taskId = nextId('task');
      const { kind, label, taskName, displayName } = describeStep(step);
      const taskNode = makeNode(taskId, kind, label, label, taskId, {
        x: TASK_X,
        y: taskY,
      });
      taskNode.data.condition = (step as { condition?: string }).condition;
      taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
      taskNode.data.details = { taskName };
      taskNode.data.displayName = displayName;
      taskNode.data.parentId = triggerId;
      nodes.push(taskNode);
      edges.push(makeEdge(prevTaskId, taskId));
      prevTaskId = taskId;
      taskY += ROW_H;
    }
  }

  return { nodes, edges };
}

// ── Trigger type ──────────────────────────────────────────────────────────────

export type TriggerType = 'ci' | 'pr' | 'scheduled' | 'manual' | 'none';

export const TRIGGER_OPTIONS: { type: TriggerType; label: string; description: string }[] = [
  { type: 'ci',        label: 'CI Trigger',          description: 'Runs on every push to main' },
  { type: 'pr',        label: 'Pull Request Trigger', description: 'Runs on pull requests to main' },
  { type: 'scheduled', label: 'Scheduled',            description: 'Runs on a cron schedule (nightly)' },
  { type: 'manual',    label: 'Manual only',          description: 'Disables automatic triggers' },
  { type: 'none',      label: 'No trigger',           description: 'Omits the trigger field entirely' },
];

/**
 * Adds a trigger node to the graph (or replaces the existing one) with the
 * given trigger type, then returns updated nodes + edges.
 */
export function insertTriggerNode(
  currentNodes: Node<GraphNodeData>[],
  currentEdges: Edge[],
  triggerType: TriggerType
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const label = TRIGGER_OPTIONS.find((o) => o.type === triggerType)?.label ?? triggerType;

  // Replace any existing trigger node in-place; otherwise prepend.
  const existingIdx = currentNodes.findIndex((n) => n.data.kind === 'trigger');
  const newNode: Node<GraphNodeData> = {
    id: existingIdx >= 0 ? currentNodes[existingIdx].id : `trigger-${Date.now()}`,
    type: 'trigger',
    position: existingIdx >= 0
      ? currentNodes[existingIdx].position
      : { x: STAGE_X - COL_W, y: 0 },
    data: {
      kind: 'trigger',
      label,
      rawId: 'trigger',
      details: { triggerType },
    },
  };

  const updatedNodes = existingIdx >= 0
    ? currentNodes.map((n, i) => (i === existingIdx ? newNode : n))
    : [newNode, ...currentNodes];

  return { nodes: updatedNodes, edges: currentEdges };
}

// ── Insert task node ──────────────────────────────────────────────────────────

export interface InsertTaskInput {
  /** YAML task reference, e.g. "DotNetCoreCLI@2" */
  taskName: string;
}

/**
 * Appends a new task node to the current graph, auto-connecting it to the
 * deepest leaf task node in the chain (falling back to the last job node, then
 * the trigger node).  Returns updated nodes + edges ready to be passed to
 * setNodes/setEdges.
 */
export function insertTaskNode(
  currentNodes: Node<GraphNodeData>[],
  currentEdges: Edge[],
  input: InsertTaskInput
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const TASK_KINDS: GraphNodeKind[] = ['task', 'script', 'checkout', 'publish', 'download'];
  const taskKindSet = new Set<string>(TASK_KINDS);

  const taskNodes = currentNodes.filter((n) => taskKindSet.has(n.data.kind));

  // Place the new node one row below the last existing task node
  const maxY =
    taskNodes.length > 0
      ? Math.max(...taskNodes.map((n) => n.position.y))
      : -ROW_H;
  const position = { x: TASK_X, y: maxY + ROW_H };

  // Find the leaf task node (has no outgoing task→task edge) to connect from
  const taskNodeIds = new Set(taskNodes.map((n) => n.id));
  const taskSources = new Set(
    currentEdges
      .filter((e) => taskNodeIds.has(e.source) && taskNodeIds.has(e.target))
      .map((e) => e.source)
  );
  const leafTasks = taskNodes.filter((n) => !taskSources.has(n.id));

  let anchorId: string | undefined;
  if (leafTasks.length > 0) {
    // Pick the leaf with the highest Y (last in the visual chain)
    anchorId = leafTasks.sort((a, b) => b.position.y - a.position.y)[0].id;
  } else {
    // No task nodes yet — connect to job or trigger
    anchorId =
      currentNodes.find((n) => n.data.kind === 'job')?.id ??
      currentNodes.find((n) => n.data.kind === 'trigger')?.id;
  }

  const newId = `task-ctx-${Date.now()}`;
  const newNode: Node<GraphNodeData> = {
    id: newId,
    type: 'task',
    position,
    data: {
      kind: 'task',
      label: input.taskName,
      rawId: input.taskName,
      details: { taskName: input.taskName },
    },
  };

  return {
    nodes: [...currentNodes, newNode],
    edges: anchorId
      ? [...currentEdges, makeEdge(anchorId, newId)]
      : currentEdges,
  };
}

// ── Graph → YAML ──────────────────────────────────────────────────────────────

export function graphToPipeline(
  nodes: Node<GraphNodeData>[],
  _edges: Edge[]
): string {
  // Rebuild a minimal pipeline structure from the graph nodes.
  // Positional layout information is intentionally not persisted to YAML.

  const stageNodes = nodes.filter((n) => n.data.kind === 'stage');
  const jobNodes = nodes.filter((n) => n.data.kind === 'job');
  const taskNodes = nodes.filter((n) =>
    ['task', 'script', 'bash', 'powershell', 'checkout', 'publish', 'download'].includes(
      n.data.kind
    )
  );

  // Build edge map: parentId → childIds
  const childMap = new Map<string, string[]>();
  for (const edge of _edges) {
    const list = childMap.get(edge.source) ?? [];
    list.push(edge.target);
    childMap.set(edge.source, list);
  }

  // ── Trigger ───────────────────────────────────────────────────────────────
  const triggerNode = nodes.find((n) => n.data.kind === 'trigger');
  const triggerType = (triggerNode?.data.details?.['triggerType'] as string | undefined) ?? 'none';
  const triggerYaml = buildTriggerYaml(triggerType, triggerNode?.data.details);

  // ── Stages ────────────────────────────────────────────────────────────────
  if (stageNodes.length > 0) {
    const stages = stageNodes.map((sn) => {
      const jobChildren = (childMap.get(sn.id) ?? [])
        .map((jid) => jobNodes.find((j) => j.id === jid))
        .filter((j): j is Node<GraphNodeData> => !!j);

      const jobs = jobChildren.map((jn) => buildJobObject(jn, childMap, taskNodes));

      const stageObj: Record<string, unknown> = {
        stage: sn.data.rawId,
      };
      if (sn.data.displayName && sn.data.displayName !== sn.data.rawId) {
        stageObj['displayName'] = sn.data.displayName;
      }
      if (sn.data.dependsOn && sn.data.dependsOn.length > 0) {
        stageObj['dependsOn'] =
          sn.data.dependsOn.length === 1 ? sn.data.dependsOn[0] : sn.data.dependsOn;
      }
      if (sn.data.condition) {
        stageObj['condition'] = sn.data.condition;
      }
      if (jobs.length > 0) {
        stageObj['jobs'] = jobs;
      }
      return stageObj;
    });

    return jsYaml.dump({ ...triggerYaml, stages }, { lineWidth: 120, noRefs: true });
  }

  // ── Jobs only ─────────────────────────────────────────────────────────────
  if (jobNodes.length > 0) {
    const jobs = jobNodes.map((jn) => buildJobObject(jn, childMap, taskNodes));
    return jsYaml.dump({ ...triggerYaml, jobs }, { lineWidth: 120, noRefs: true });
  }

  // ── Steps only ────────────────────────────────────────────────────────────
  if (taskNodes.length > 0) {
    const steps = taskNodes.map((tn) => buildStepObject(tn));
    return jsYaml.dump({ ...triggerYaml, steps }, { lineWidth: 120, noRefs: true });
  }

  return jsYaml.dump({ ...triggerYaml }, { lineWidth: 120 });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function makeNode(
  id: string,
  kind: GraphNodeKind,
  label: string,
  rawId: string,
  _displayId: string,
  position: XYPosition
): Node<GraphNodeData> {
  return {
    id,
    type: kind,
    position,
    data: {
      kind,
      label,
      rawId,
    },
  };
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    animated: true,
    style: { stroke: '#0078d4', strokeWidth: 2 },
  };
}

function normalizeDependsOn(raw: unknown): string[] {
  if (!raw) { return []; }
  if (typeof raw === 'string') { return [raw]; }
  if (Array.isArray(raw)) { return raw as string[]; }
  return [];
}

function describePool(pool: unknown): string {
  if (!pool) { return ''; }
  if (typeof pool === 'string') { return pool; }
  if (typeof pool === 'object' && pool !== null) {
    const p = pool as Record<string, unknown>;
    return (p['vmImage'] as string) ?? (p['name'] as string) ?? 'custom pool';
  }
  return '';
}

function describeTrigger(pipeline: Pipeline): string {
  if (pipeline.schedules && pipeline.schedules.length > 0) {
    const cron = pipeline.schedules[0].cron;
    return `schedule: ${cron}`;
  }
  const t = pipeline.trigger;
  if (!t) { return 'no trigger'; }
  if (t === 'none') { return 'none'; }
  if (Array.isArray(t)) { return `branches: ${t.join(', ')}`; }
  if (typeof t === 'object' && t.branches?.include) {
    return `branches: ${t.branches.include.join(', ')}`;
  }
  return 'CI trigger';
}

/** Returns a canonical trigger type string stored on the trigger node. */
function getTriggerType(pipeline: Pipeline): TriggerType {
  if (pipeline.schedules && pipeline.schedules.length > 0) { return 'scheduled'; }
  const t = pipeline.trigger;
  if (!t) { return 'none'; }
  if (t === 'none') { return 'manual'; }
  return 'ci';
}

/** Produces the trigger YAML fragment to merge into the top-level document. */
function buildTriggerYaml(
  triggerType: string,
  details?: Record<string, unknown>
): Record<string, unknown> {
  switch (triggerType) {
    case 'ci':   return { trigger: { branches: { include: ['main'] } } };
    case 'pr':   return { pr: { branches: { include: ['main'] } } };
    case 'scheduled': {
      const schedule: PipelineSchedule = {
        cron: (details?.['cron'] as string | undefined) || '0 0 * * *',
      };
      const dn = details?.['scheduleDisplayName'] as string | undefined;
      if (dn) { schedule.displayName = dn; }
      const inc = splitList(details?.['branchesInclude'] as string | undefined);
      const exc = splitList(details?.['branchesExclude'] as string | undefined);
      if (inc.length > 0 || exc.length > 0) {
        schedule.branches = {};
        if (inc.length > 0) { schedule.branches.include = inc; }
        if (exc.length > 0) { schedule.branches.exclude = exc; }
      }
      if (details?.['always'] === true) { schedule.always = true; }
      if (details?.['batch']  === true) { schedule.batch  = true; }
      return { schedules: [schedule] };
    }
    case 'manual': return { trigger: 'none' };
    case 'none':
    default:       return {};
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) { return []; }
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

function describeStep(step: PipelineStep): {
  kind: GraphNodeKind;
  label: string;
  taskName?: string;
  displayName?: string;
} {
  if ('task' in step) {
    return {
      kind: 'task',
      label: step.displayName ?? step.task,
      taskName: step.task,
      displayName: step.displayName,
    };
  }
  if ('script' in step) {
    return {
      kind: 'script',
      label: step.displayName ?? 'Script',
      taskName: truncateScript(step.script),
      displayName: step.displayName,
    };
  }
  if ('bash' in step) {
    return {
      kind: 'script',
      label: step.displayName ?? 'Bash',
      taskName: truncateScript(step.bash),
      displayName: step.displayName,
    };
  }
  if ('powershell' in step) {
    return {
      kind: 'script',
      label: step.displayName ?? 'PowerShell',
      taskName: truncateScript(step.powershell),
      displayName: step.displayName,
    };
  }
  if ('checkout' in step) {
    return { kind: 'checkout', label: `checkout: ${step.checkout}` };
  }
  if ('publish' in step) {
    return {
      kind: 'publish',
      label: step.displayName ?? `publish: ${step.artifact}`,
      taskName: step.publish,
      displayName: step.displayName,
    };
  }
  if ('download' in step) {
    return {
      kind: 'download',
      label: step.displayName ?? `download: ${step.download}`,
      displayName: step.displayName,
    };
  }
  return { kind: 'task', label: 'Unknown step' };
}

function truncateScript(s: string, max = 40): string {
  const first = s.split('\n')[0].trim();
  return first.length > max ? first.slice(0, max) + '…' : first;
}

function buildJobObject(
  jn: Node<GraphNodeData>,
  childMap: Map<string, string[]>,
  taskNodes: Node<GraphNodeData>[]
): Record<string, unknown> {
  // Tasks are chained sequentially (job→task1→task2→…), not as a flat
  // hub-and-spoke from the job. Walk the linked chain to collect all steps.
  const taskNodeIdSet = new Set(taskNodes.map((t) => t.id));
  const taskChildren: Node<GraphNodeData>[] = [];
  let currentId: string | undefined = (childMap.get(jn.id) ?? []).find((id) => taskNodeIdSet.has(id));
  while (currentId !== undefined) {
    const taskNode = taskNodes.find((t) => t.id === currentId);
    if (!taskNode) { break; }
    taskChildren.push(taskNode);
    currentId = (childMap.get(currentId) ?? []).find((id) => taskNodeIdSet.has(id));
  }

  // Fallback: if no tasks found via edges (e.g. connecting edge was deleted),
  // use the parentId stored on each task node at parse time.
  if (taskChildren.length === 0) {
    const byParent = taskNodes
      .filter((t) => t.data.parentId === jn.id)
      .sort((a, b) => a.position.y - b.position.y);
    taskChildren.push(...byParent);
  }

  const steps = taskChildren.map((tn) => buildStepObject(tn));

  const jobObj: Record<string, unknown> = {
    job: jn.data.rawId,
  };
  if (jn.data.displayName && jn.data.displayName !== jn.data.rawId) {
    jobObj['displayName'] = jn.data.displayName;
  }
  if (jn.data.dependsOn && jn.data.dependsOn.length > 0) {
    jobObj['dependsOn'] =
      jn.data.dependsOn.length === 1
        ? jn.data.dependsOn[0]
        : jn.data.dependsOn;
  }
  if (jn.data.condition) {
    jobObj['condition'] = jn.data.condition;
  }
  const pool = jn.data.details?.pool as string | undefined;
  if (pool) {
    jobObj['pool'] = { vmImage: pool };
  }
  if (steps.length > 0) {
    jobObj['steps'] = steps;
  }
  return jobObj;
}

function buildStepObject(tn: Node<GraphNodeData>): Record<string, unknown> {
  const taskName = tn.data.details?.taskName as string | undefined;
  const step: Record<string, unknown> = {};

  switch (tn.data.kind) {
    case 'task':
      step['task'] = taskName ?? tn.data.rawId;
      break;
    case 'script':
      step['script'] = taskName ?? tn.data.label;
      break;
    case 'checkout':
      step['checkout'] = tn.data.rawId.replace(/^checkout:\s?/, '').trim() || 'self';
      break;
    case 'publish':
      step['publish'] = taskName ?? '.';
      step['artifact'] = tn.data.rawId;
      break;
    case 'download':
      step['download'] = tn.data.rawId.replace(/^download:\s?/, '').trim() || 'current';
      break;
    default:
      step['task'] = tn.data.rawId;
  }

  // Write displayName whenever present – comparing to label is wrong because
  // label IS set from displayName during parsing, so they would always match.
  if (tn.data.displayName) {
    step['displayName'] = tn.data.displayName;
  }
  if (tn.data.condition) {
    step['condition'] = tn.data.condition;
  }
  if (tn.data.enabled === false) {
    step['enabled'] = false;
  }

  return step;
}
