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
  PipelineTrigger,
  PipelinePrTrigger,
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
  if (triggerType === 'ci' && typeof pipeline.trigger === 'object' && pipeline.trigger !== null && !Array.isArray(pipeline.trigger)) {
    const t = pipeline.trigger as PipelineTrigger;
    triggerDetails['ciBatch'] = t.batch ?? false;
    triggerDetails['branchesInclude'] = (t.branches?.include ?? []).join(', ');
    triggerDetails['branchesExclude'] = (t.branches?.exclude ?? []).join(', ');
    triggerDetails['pathsInclude'] = (t.paths?.include ?? []).join(', ');
    triggerDetails['pathsExclude'] = (t.paths?.exclude ?? []).join(', ');
    triggerDetails['tagsInclude'] = (t.tags?.include ?? []).join(', ');
    triggerDetails['tagsExclude'] = (t.tags?.exclude ?? []).join(', ');
  }
  if (triggerType === 'pr' && pipeline.pr) {
    const p = pipeline.pr as PipelinePrTrigger;
    triggerDetails['prAutoCancel'] = p.autoCancel ?? true;
    triggerDetails['prDrafts'] = p.drafts ?? true;
    triggerDetails['branchesInclude'] = (p.branches?.include ?? []).join(', ');
    triggerDetails['branchesExclude'] = (p.branches?.exclude ?? []).join(', ');
    triggerDetails['pathsInclude'] = (p.paths?.include ?? []).join(', ');
    triggerDetails['pathsExclude'] = (p.paths?.exclude ?? []).join(', ');
  }
  triggerNode.data.details = triggerDetails;
  nodes.push(triggerNode);

  // ── Stages pipeline ──────────────────────────────────────────────────────────
  if (pipeline.stages && pipeline.stages.length > 0) {
    let stageY = 0;
    // Maps stage rawId → direct dependsOn list; used for transitive reduction.
    const stageDepMap = new Map<string, string[]>();
    const stageTransitiveCache = new Map<string, Set<string>>();

    for (const stage of pipeline.stages) {
      // ── Stage-level template reference ─────────────────────────────────────
      if ((stage as unknown as { template?: unknown }).template !== undefined) {
        const stageRaw = stage as unknown as { template: string; parameters?: Record<string, unknown> };
        const tId = nextId('template');
        const tNode = makeNode(tId, 'template', stageRaw.template, stageRaw.template, tId, { x: STAGE_X, y: stageY });
        tNode.data.displayName = stageRaw.template;
        tNode.data.details = {
          templatePath: stageRaw.template,
          parametersRaw: stageRaw.parameters ? jsYaml.dump(stageRaw.parameters, { lineWidth: 120 }).trim() : undefined,
          templateLevel: 'stage',
        };
        nodes.push(tNode);
        edges.push(makeEdge(triggerId, tId));
        stageY += ROW_H;
        continue;
      }

      const stageId = nextId('stage');
      const stageLabel = stage.displayName ?? stage.stage ?? 'Stage';

      const stageNode = makeNode(stageId, 'stage', stageLabel, stage.stage, stageId, {
        x: STAGE_X,
        y: stageY,
      });
      stageNode.data.displayName = stageLabel;
      stageNode.data.condition = stage.condition;
      stageNode.data.dependsOn = normalizeDependsOn(stage.dependsOn);
      // Register in the dependency map for transitive-reduction lookups.
      if (stage.stage) { stageDepMap.set(stage.stage, stageNode.data.dependsOn); }

      // Store extended stage fields in details
      const stageDetails: Record<string, unknown> = {};
      if (stage.pool) { stageDetails['stagePool'] = describePool(stage.pool); }
      if (stage.variables !== undefined) {
        stageDetails['variablesRaw'] = jsYaml.dump(stage.variables, { lineWidth: 120 }).trim();
      }
      if (stage.lockBehavior) { stageDetails['lockBehavior'] = stage.lockBehavior; }
      if (stage.trigger) { stageDetails['stageTrigger'] = stage.trigger; }
      if (stage.isSkippable === false) { stageDetails['isSkippable'] = false; }
      if (stage.templateContext !== undefined) {
        stageDetails['templateContextRaw'] = jsYaml.dump(stage.templateContext, { lineWidth: 120 }).trim();
      }
      if (Object.keys(stageDetails).length > 0) {
        stageNode.data.details = stageDetails;
      }

      nodes.push(stageNode);

      // Connect trigger → first stage or stage → stage via dependsOn.
      // Apply transitive reduction: if dep D is already reachable transitively
      // through another direct dependency of this stage, skip the D→stage edge
      // so the graph renders a clean linear chain instead of a diamond.
      if (stageNode.data.dependsOn && stageNode.data.dependsOn.length > 0) {
        for (const dep of stageNode.data.dependsOn) {
          const isRedundant = stageNode.data.dependsOn.some(
            (otherDep) =>
              otherDep !== dep &&
              computeTransitiveDeps(otherDep, stageDepMap, stageTransitiveCache).has(dep)
          );
          if (!isRedundant) {
            const depNode = nodes.find(
              (n) => n.data.rawId === dep && n.data.kind === 'stage'
            );
            if (depNode) {
              edges.push(makeEdge(depNode.id, stageId));
            }
          }
        }
      } else {
        edges.push(makeEdge(triggerId, stageId));
      }

      // Jobs inside stage
      const stageJobs = stage.jobs ?? [];
      let jobY = stageY;
      // Maps job rawId → direct dependsOn list; scoped per stage for transitive reduction.
      const jobDepMap = new Map<string, string[]>();
      const jobTransitiveCache = new Map<string, Set<string>>();

      for (const job of stageJobs) {
        // ── Job-level template reference ──────────────────────────────────────
        if ((job as unknown as { template?: unknown }).template !== undefined) {
          const jobRaw = job as unknown as { template: string; parameters?: Record<string, unknown> };
          const tId = nextId('template');
          const tNode = makeNode(tId, 'template', jobRaw.template, jobRaw.template, tId, { x: JOB_X, y: jobY });
          tNode.data.displayName = jobRaw.template;
          tNode.data.parentId = stageId;
          tNode.data.details = {
            templatePath: jobRaw.template,
            parametersRaw: jobRaw.parameters ? jsYaml.dump(jobRaw.parameters, { lineWidth: 120 }).trim() : undefined,
            templateLevel: 'job',
          };
          nodes.push(tNode);
          edges.push(makeEdge(stageId, tNode.id));
          jobY += ROW_H;
          continue;
        }
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
        jobNode.data.continueOnError = (job as PipelineJob).continueOnError;
        jobNode.data.dependsOn = normalizeDependsOn(job.dependsOn);
        jobNode.data.parentId = stageId;
        jobNode.data.details = {
          pool: describePool(job.pool),
          isDeployment,
          timeoutInMinutes: job.timeoutInMinutes,
          cancelTimeoutInMinutes: (job as PipelineJob).cancelTimeoutInMinutes,
          variablesRaw: job.variables != null
            ? jsYaml.dump(job.variables, { lineWidth: 120 }).trim() : undefined,
          workspaceClean: (job as PipelineJob).workspace?.clean,
          container: (job as PipelineJob).container,
          environment: (job as PipelineDeploymentJob).environment,
          strategyParallel: (job as PipelineJob).strategy?.parallel,
        };
        nodes.push(jobNode);
        // Connect via dependsOn edges if present, else connect to parent stage.
        // Apply transitive reduction: skip edge D→job when D is already reachable
        // through another direct dependency of this job.
        const jobDeps = normalizeDependsOn(job.dependsOn);
        if (jobKey) { jobDepMap.set(jobKey, jobDeps); }
        if (jobDeps.length > 0) {
          for (const dep of jobDeps) {
            const isRedundant = jobDeps.some(
              (otherDep) =>
                otherDep !== dep &&
                computeTransitiveDeps(otherDep, jobDepMap, jobTransitiveCache).has(dep)
            );
            if (!isRedundant) {
              const depNode = nodes.find((n) => n.data.rawId === dep && n.data.kind === 'job');
              if (depNode) { edges.push(makeEdge(depNode.id, jobId)); }
            }
          }
        } else {
          edges.push(makeEdge(stageId, jobId));
        }

        // Steps / tasks inside job – chained sequentially
        const steps: PipelineStep[] = (job as PipelineJob).steps ?? [];
        let taskY = jobY;
        let prevTaskId: string = jobId;

        for (const step of steps) {
          // ── Step-level template reference ─────────────────────────────────
          if ((step as unknown as { template?: unknown }).template !== undefined) {
            const stepRaw = step as unknown as { template: string; parameters?: Record<string, unknown> };
            const tId = nextId('template');
            const tNode = makeNode(tId, 'template', stepRaw.template, stepRaw.template, tId, { x: TASK_X, y: taskY });
            tNode.data.displayName = stepRaw.template;
            tNode.data.parentId = jobId;
            tNode.data.details = {
              templatePath: stepRaw.template,
              parametersRaw: stepRaw.parameters ? jsYaml.dump(stepRaw.parameters, { lineWidth: 120 }).trim() : undefined,
              templateLevel: 'step',
            };
            nodes.push(tNode);
            edges.push(makeEdge(prevTaskId, tNode.id));
            prevTaskId = tNode.id;
            taskY += ROW_H;
            continue;
          }
          const taskId = nextId('task');
          const { kind, label, displayName } = describeStep(step);

          const taskNode = makeNode(taskId, kind, label, label, taskId, {
            x: TASK_X,
            y: taskY,
          });
          taskNode.data.condition = (step as { condition?: string }).condition;
          taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
          taskNode.data.details = buildTaskDetails(step);
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
    // Maps job rawId → direct dependsOn list; used for transitive reduction.
    const jobsOnlyDepMap = new Map<string, string[]>();
    const jobsOnlyTransitiveCache = new Map<string, Set<string>>();

    for (const job of pipeline.jobs) {
      // ── Job-level template reference ───────────────────────────────────────
      if ((job as unknown as { template?: unknown }).template !== undefined) {
        const jobRaw = job as unknown as { template: string; parameters?: Record<string, unknown> };
        const tId = nextId('template');
        const tNode = makeNode(tId, 'template', jobRaw.template, jobRaw.template, tId, { x: JOB_X, y: jobY });
        tNode.data.displayName = jobRaw.template;
        tNode.data.parentId = triggerId;
        tNode.data.details = {
          templatePath: jobRaw.template,
          parametersRaw: jobRaw.parameters ? jsYaml.dump(jobRaw.parameters, { lineWidth: 120 }).trim() : undefined,
          templateLevel: 'job',
        };
        nodes.push(tNode);
        edges.push(makeEdge(triggerId, tNode.id));
        jobY += ROW_H;
        continue;
      }
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
      jobNode.data.continueOnError = (job as PipelineJob).continueOnError;
      jobNode.data.parentId = triggerId;
      jobNode.data.details = {
        pool: describePool(job.pool),
        isDeployment,
        timeoutInMinutes: job.timeoutInMinutes,
        cancelTimeoutInMinutes: (job as PipelineJob).cancelTimeoutInMinutes,
        variablesRaw: job.variables != null
          ? jsYaml.dump(job.variables, { lineWidth: 120 }).trim() : undefined,
        workspaceClean: (job as PipelineJob).workspace?.clean,
        container: (job as PipelineJob).container,
        environment: (job as PipelineDeploymentJob).environment,
        strategyParallel: (job as PipelineJob).strategy?.parallel,
      };
      nodes.push(jobNode);
      // Connect via dependsOn edges if present, else connect to trigger.
      // Apply transitive reduction: skip edge D→job when D is already reachable
      // through another direct dependency of this job.
      const jobDepsOnly = normalizeDependsOn(job.dependsOn);
      if (jobKey) { jobsOnlyDepMap.set(jobKey, jobDepsOnly); }
      if (jobDepsOnly.length > 0) {
        for (const dep of jobDepsOnly) {
          const isRedundant = jobDepsOnly.some(
            (otherDep) =>
              otherDep !== dep &&
              computeTransitiveDeps(otherDep, jobsOnlyDepMap, jobsOnlyTransitiveCache).has(dep)
          );
          if (!isRedundant) {
            const depNode = nodes.find((n) => n.data.rawId === dep && n.data.kind === 'job');
            if (depNode) { edges.push(makeEdge(depNode.id, jobId)); }
          }
        }
      } else {
        edges.push(makeEdge(triggerId, jobId));
      }

      const steps: PipelineStep[] = (job as PipelineJob).steps ?? [];
      let taskY = jobY;
      let prevTaskId: string = jobId;
      for (const step of steps) {
        // ── Step-level template reference ─────────────────────────────────
        if ((step as unknown as { template?: unknown }).template !== undefined) {
          const stepRaw = step as unknown as { template: string; parameters?: Record<string, unknown> };
          const tId = nextId('template');
          const tNode = makeNode(tId, 'template', stepRaw.template, stepRaw.template, tId, { x: TASK_X, y: taskY });
          tNode.data.displayName = stepRaw.template;
          tNode.data.parentId = jobId;
          tNode.data.details = {
            templatePath: stepRaw.template,
            parametersRaw: stepRaw.parameters ? jsYaml.dump(stepRaw.parameters, { lineWidth: 120 }).trim() : undefined,
            templateLevel: 'step',
          };
          nodes.push(tNode);
          edges.push(makeEdge(prevTaskId, tNode.id));
          prevTaskId = tNode.id;
          taskY += ROW_H;
          continue;
        }
        const taskId = nextId('task');
        const { kind, label, displayName } = describeStep(step);
        const taskNode = makeNode(taskId, kind, label, label, taskId, {
          x: TASK_X,
          y: taskY,
        });
        taskNode.data.condition = (step as { condition?: string }).condition;
        taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
        taskNode.data.details = buildTaskDetails(step);
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
      // ── Step-level template reference ─────────────────────────────────────
      if ((step as unknown as { template?: unknown }).template !== undefined) {
        const stepRaw = step as unknown as { template: string; parameters?: Record<string, unknown> };
        const tId = nextId('template');
        const tNode = makeNode(tId, 'template', stepRaw.template, stepRaw.template, tId, { x: TASK_X, y: taskY });
        tNode.data.displayName = stepRaw.template;
        tNode.data.parentId = triggerId;
        tNode.data.details = {
          templatePath: stepRaw.template,
          parametersRaw: stepRaw.parameters ? jsYaml.dump(stepRaw.parameters, { lineWidth: 120 }).trim() : undefined,
          templateLevel: 'step',
        };
        nodes.push(tNode);
        edges.push(makeEdge(prevTaskId, tNode.id));
        prevTaskId = tNode.id;
        taskY += ROW_H;
        continue;
      }
      const taskId = nextId('task');
      const { kind, label, displayName } = describeStep(step);
      const taskNode = makeNode(taskId, kind, label, label, taskId, {
        x: TASK_X,
        y: taskY,
      });
      taskNode.data.condition = (step as { condition?: string }).condition;
      taskNode.data.enabled = (step as { enabled?: boolean }).enabled !== false;
      taskNode.data.details = buildTaskDetails(step);
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
  /** YAML task reference, e.g. "DotNetCoreCLI@2", or checkout ref e.g. "self" */
  taskName: string;
  /** When provided, connect the new task to this node instead of auto-detecting the anchor. */
  anchorNodeId?: string;
  /** Node kind to create. Defaults to 'task'. Use 'checkout' for checkout steps. */
  nodeKind?: GraphNodeKind;
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
  if (input.anchorNodeId) {
    const anchorNode = currentNodes.find((n) => n.id === input.anchorNodeId);
    if (anchorNode?.data.kind === 'job') {
      // 1:1 job→task enforcement: if this job already has a task chain, append
      // to the leaf task rather than creating a second direct job→task edge.
      const firstTaskEdgeTarget = currentEdges
        .find((e) => e.source === input.anchorNodeId && taskNodeIds.has(e.target))
        ?.target;
      if (firstTaskEdgeTarget) {
        // Walk the task chain to find the leaf
        let leafId = firstTaskEdgeTarget;
        let nextId: string | undefined;
        do {
          nextId = currentEdges
            .find((e) => e.source === leafId && taskNodeIds.has(e.target))
            ?.target;
          if (nextId) { leafId = nextId; }
        } while (nextId);
        anchorId = leafId;
      } else {
        anchorId = input.anchorNodeId;
      }
    } else if (anchorNode && taskNodeIds.has(anchorNode.id)) {
      // 1:1 task→task enforcement: walk forward from the anchor task to the
      // leaf so the new task is appended at the end of the chain.
      let leafId = anchorNode.id;
      let nextId: string | undefined;
      do {
        nextId = currentEdges
          .find((e) => e.source === leafId && taskNodeIds.has(e.target))
          ?.target;
        if (nextId) { leafId = nextId; }
      } while (nextId);
      anchorId = leafId;
    } else {
      anchorId = input.anchorNodeId;
    }
  } else if (leafTasks.length > 0) {
    // Pick the leaf with the highest Y (last in the visual chain)
    anchorId = leafTasks.sort((a, b) => b.position.y - a.position.y)[0].id;
  } else {
    // No task nodes yet — connect to job or trigger
    anchorId =
      currentNodes.find((n) => n.data.kind === 'job')?.id ??
      currentNodes.find((n) => n.data.kind === 'trigger')?.id;
  }

  const newId = `task-ctx-${Date.now()}`;
  const nodeKind = input.nodeKind ?? 'task';

  let newNode: Node<GraphNodeData>;
  if (nodeKind === 'checkout') {
    // Strip 'checkout: ' prefix if present — the catalog entry name IS the full label
    const ref = input.taskName.startsWith('checkout: ')
      ? input.taskName.slice('checkout: '.length)
      : input.taskName;
    newNode = {
      id: newId,
      type: 'checkout',
      position,
      data: {
        kind: 'checkout',
        label: `checkout: ${ref}`,
        rawId: `checkout: ${ref}`,
        details: { taskName: ref, stepKind: 'checkout' },
      },
    };
  } else if (nodeKind === 'script') {
    newNode = {
      id: newId,
      type: 'script',
      position,
      data: {
        kind: 'script',
        label: 'Script',
        rawId: 'script',
        details: { taskName: '', stepKind: 'script' },
      },
    };
  } else {
    newNode = {
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
  }

  return {
    nodes: [...currentNodes, newNode],
    edges: anchorId
      ? [...currentEdges, makeEdge(anchorId, newId)]
      : currentEdges,
  };
}

// ── Input parsing utility ─────────────────────────────────────────────────────

/**
 * Parses a YAML-encoded task inputs string (as stored in `details.inputsRaw`)
 * into a plain object of string-keyed values.  Non-string values are coerced
 * to strings. Returns an empty object on malformed YAML or wrong type.
 *
 * Used by PropertiesPanel to hydrate individual input fields from the stored
 * YAML blob, and by tests to verify round-trip fidelity.
 */
export function parseInputsRaw(raw: string | undefined): Record<string, string> {
  if (!raw) { return {}; }
  try {
    const val = jsYaml.load(raw);
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, String(v)])
      );
    }
    return {};
  } catch {
    return {};
  }
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
    ['task', 'script', 'bash', 'powershell', 'checkout', 'publish', 'download'].includes(n.data.kind) ||
    (n.data.kind === 'template' && n.data.details?.['templateLevel'] === 'step')
  );
  // Template nodes grouped by pipeline level
  const stageLevelTemplateNodes = nodes.filter(
    (n) => n.data.kind === 'template' && n.data.details?.['templateLevel'] === 'stage'
  );
  const jobLevelTemplateNodes = nodes.filter(
    (n) => n.data.kind === 'template' && n.data.details?.['templateLevel'] === 'job'
  );
  const jobLevelTemplateNodeIdSet = new Set(jobLevelTemplateNodes.map((n) => n.id));
  const allStageLevelNodes = [...stageNodes, ...stageLevelTemplateNodes]
    .sort((a, b) => a.position.y - b.position.y);

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
  if (allStageLevelNodes.length > 0) {
    const stages = allStageLevelNodes.map((sn) => {
      // Stage-level template: emit { template, parameters } directly
      if (sn.data.kind === 'template') {
        return buildTemplateObject(sn);
      }

      // Collect all jobs belonging to this stage by BFS through stage->job
      // and job->job edges (jobs that depend on another job are connected
      // job->job rather than stage->job).
      const jobNodeIdSet = new Set(jobNodes.map((j) => j.id));
      const stageJobNodes: Node<GraphNodeData>[] = [];
      const visitedJobs = new Set<string>();
      const jobQueue: Node<GraphNodeData>[] = (childMap.get(sn.id) ?? [])
        .map((id) => {
          if (jobNodeIdSet.has(id)) { return jobNodes.find((j) => j.id === id); }
          if (jobLevelTemplateNodeIdSet.has(id)) { return jobLevelTemplateNodes.find((j) => j.id === id); }
          return undefined;
        })
        .filter((j): j is Node<GraphNodeData> => !!j);
      while (jobQueue.length > 0) {
        const jn = jobQueue.shift()!;
        if (visitedJobs.has(jn.id)) { continue; }
        visitedJobs.add(jn.id);
        stageJobNodes.push(jn);
        // Only real jobs participate in job->job dependsOn chains
        const depJobChildren = (childMap.get(jn.id) ?? [])
          .filter((id) => jobNodeIdSet.has(id))
          .map((id) => jobNodes.find((j) => j.id === id))
          .filter((j): j is Node<GraphNodeData> => !!j);
        jobQueue.push(...depJobChildren);
      }

      const jobs = stageJobNodes.map((jn) =>
        jn.data.kind === 'template'
          ? buildTemplateObject(jn)
          : buildJobObject(jn, childMap, taskNodes, nodes, _edges)
      );

      const stageObj: Record<string, unknown> = {
        stage: sn.data.rawId,
      };
      if (sn.data.displayName && sn.data.displayName !== sn.data.rawId) {
        stageObj['displayName'] = sn.data.displayName;
      }
      if (sn.data.condition) {
        stageObj['condition'] = sn.data.condition;
      }
      // Derive dependsOn from incoming stage-to-stage edges so that drawing
      // edges in the graph is the authoritative way to express stage ordering.
      const stageDeps = _edges
        .filter((e) => e.target === sn.id)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is Node<GraphNodeData> => !!n && n.data.kind === 'stage');
      if (stageDeps.length > 0) {
        stageObj['dependsOn'] =
          stageDeps.length === 1 ? stageDeps[0].data.rawId : stageDeps.map((n) => n.data.rawId);
      }
      const stagePool = sn.data.details?.['stagePool'] as string | undefined;
      if (stagePool) { stageObj['pool'] = { vmImage: stagePool }; }
      const lockBehavior = sn.data.details?.['lockBehavior'] as string | undefined;
      if (lockBehavior) { stageObj['lockBehavior'] = lockBehavior; }
      const stageTrigger = sn.data.details?.['stageTrigger'] as string | undefined;
      if (stageTrigger) { stageObj['trigger'] = stageTrigger; }
      if (sn.data.details?.['isSkippable'] === false) { stageObj['isSkippable'] = false; }
      const variablesRaw = sn.data.details?.['variablesRaw'] as string | undefined;
      if (variablesRaw) {
        try { stageObj['variables'] = jsYaml.load(variablesRaw); } catch { /* skip malformed */ }
      }
      const templateContextRaw = sn.data.details?.['templateContextRaw'] as string | undefined;
      if (templateContextRaw) {
        try { stageObj['templateContext'] = jsYaml.load(templateContextRaw); } catch { /* skip malformed */ }
      }
      if (jobs.length > 0) {
        stageObj['jobs'] = jobs;
      }
      return stageObj;
    });

    return jsYaml.dump({ ...triggerYaml, stages }, { lineWidth: 120, noRefs: true });
  }

  // ── Jobs only ─────────────────────────────────────────────────────────────
  const allJobLevelNodes = [...jobNodes, ...jobLevelTemplateNodes]
    .sort((a, b) => a.position.y - b.position.y);
  if (allJobLevelNodes.length > 0) {
    const jobs = allJobLevelNodes.map((jn) =>
      jn.data.kind === 'template'
        ? buildTemplateObject(jn)
        : buildJobObject(jn, childMap, taskNodes, nodes, _edges)
    );
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

/**
 * Returns the full transitive dependency set for a given stage rawId by
 * recursively walking `depMap`. Results are memoised in `cache`.
 */
export function computeTransitiveDeps(
  rawId: string,
  depMap: Map<string, string[]>,
  cache: Map<string, Set<string>>
): Set<string> {
  const hit = cache.get(rawId);
  if (hit) { return hit; }
  const result = new Set<string>();
  for (const dep of depMap.get(rawId) ?? []) {
    result.add(dep);
    for (const transitive of computeTransitiveDeps(dep, depMap, cache)) {
      result.add(transitive);
    }
  }
  cache.set(rawId, result);
  return result;
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
  if (pipeline.pr) {
    const p = pipeline.pr as PipelinePrTrigger;
    if (p.branches?.include) { return `PR: ${p.branches.include.join(', ')}`; }
    return 'PR trigger';
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
  // If trigger is absent or explicitly 'none' but a pr block exists, treat as PR trigger
  if (pipeline.pr && (!t || t === 'none')) { return 'pr'; }
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
    case 'ci': {
      const trigger: PipelineTrigger = {};
      if (details?.['ciBatch'] === true) { trigger.batch = true; }
      const branchInc = splitList(details?.['branchesInclude'] as string | undefined);
      const branchExc = splitList(details?.['branchesExclude'] as string | undefined);
      if (branchInc.length > 0 || branchExc.length > 0) {
        trigger.branches = {};
        if (branchInc.length > 0) { trigger.branches.include = branchInc; }
        if (branchExc.length > 0) { trigger.branches.exclude = branchExc; }
      }
      const pathInc = splitList(details?.['pathsInclude'] as string | undefined);
      const pathExc = splitList(details?.['pathsExclude'] as string | undefined);
      if (pathInc.length > 0 || pathExc.length > 0) {
        trigger.paths = {};
        if (pathInc.length > 0) { trigger.paths.include = pathInc; }
        if (pathExc.length > 0) { trigger.paths.exclude = pathExc; }
      }
      const tagInc = splitList(details?.['tagsInclude'] as string | undefined);
      const tagExc = splitList(details?.['tagsExclude'] as string | undefined);
      if (tagInc.length > 0 || tagExc.length > 0) {
        trigger.tags = {};
        if (tagInc.length > 0) { trigger.tags.include = tagInc; }
        if (tagExc.length > 0) { trigger.tags.exclude = tagExc; }
      }
      return { trigger };
    }
    case 'pr': {
      const pr: PipelinePrTrigger = {};
      if (details?.['prAutoCancel'] === false) { pr.autoCancel = false; }
      if (details?.['prDrafts'] === false) { pr.drafts = false; }
      const branchInc = splitList(details?.['branchesInclude'] as string | undefined);
      const branchExc = splitList(details?.['branchesExclude'] as string | undefined);
      if (branchInc.length > 0 || branchExc.length > 0) {
        pr.branches = {};
        if (branchInc.length > 0) { pr.branches.include = branchInc; }
        if (branchExc.length > 0) { pr.branches.exclude = branchExc; }
      }
      const pathInc = splitList(details?.['pathsInclude'] as string | undefined);
      const pathExc = splitList(details?.['pathsExclude'] as string | undefined);
      if (pathInc.length > 0 || pathExc.length > 0) {
        pr.paths = {};
        if (pathInc.length > 0) { pr.paths.include = pathInc; }
        if (pathExc.length > 0) { pr.paths.exclude = pathExc; }
      }
      return { pr };
    }
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

/** Extract all serialisable fields from a pipeline step into a details record. */
function buildTaskDetails(step: PipelineStep): Record<string, unknown> {
  // Common optional shared fields across most step types
  const common = (s: { name?: string; continueOnError?: boolean; timeoutInMinutes?: number }) => ({
    name: s.name,
    continueOnError: s.continueOnError,
    timeoutInMinutes: s.timeoutInMinutes,
  });

  if ('task' in step) {
    const s = step as import('./types/pipeline').PipelineTaskStep;
    return {
      stepKind: 'task',
      taskName: s.task,
      ...common(s),
      retryCountOnTaskFailure: s.retryCountOnTaskFailure,
      inputsRaw: s.inputs != null ? jsYaml.dump(s.inputs, { lineWidth: 120 }).trim() : undefined,
      envRaw: s.env != null ? jsYaml.dump(s.env, { lineWidth: 120 }).trim() : undefined,
    };
  }
  if ('script' in step) {
    const s = step as import('./types/pipeline').PipelineScriptStep;
    return {
      stepKind: 'script',
      taskName: s.script,
      ...common(s),
      workingDirectory: s.workingDirectory,
      failOnStderr: s.failOnStderr,
      envRaw: s.env != null ? jsYaml.dump(s.env, { lineWidth: 120 }).trim() : undefined,
    };
  }
  if ('bash' in step) {
    const s = step as import('./types/pipeline').PipelineBashStep;
    return {
      stepKind: 'bash',
      taskName: s.bash,
      ...common(s),
      workingDirectory: s.workingDirectory,
      failOnStderr: s.failOnStderr,
      envRaw: s.env != null ? jsYaml.dump(s.env, { lineWidth: 120 }).trim() : undefined,
    };
  }
  if ('powershell' in step) {
    const s = step as import('./types/pipeline').PipelinePowerShellStep;
    return {
      stepKind: 'powershell',
      taskName: s.powershell,
      ...common(s),
      workingDirectory: s.workingDirectory,
      failOnStderr: s.failOnStderr,
      errorActionPreference: s.errorActionPreference,
      ignoreLASTEXITCODE: s.ignoreLASTEXITCODE,
      envRaw: s.env != null ? jsYaml.dump(s.env, { lineWidth: 120 }).trim() : undefined,
    };
  }
  if ('checkout' in step) {
    const s = step as import('./types/pipeline').PipelineCheckoutStep;
    return {
      stepKind: 'checkout',
      taskName: s.checkout,
      clean: s.clean,
      fetchDepth: s.fetchDepth,
      lfs: s.lfs,
      submodules: s.submodules,
      path: s.path,
      persistCredentials: s.persistCredentials,
    };
  }
  if ('publish' in step) {
    const s = step as import('./types/pipeline').PipelinePublishStep;
    return {
      stepKind: 'publish',
      taskName: s.publish,
      artifact: s.artifact,
    };
  }
  if ('download' in step) {
    const s = step as import('./types/pipeline').PipelineDownloadStep;
    return {
      stepKind: 'download',
      taskName: s.download,
      artifact: s.artifact,
      path: s.path,
      patterns: s.patterns,
    };
  }
  return { stepKind: 'task', taskName: '' };
}

/** Serialises a template reference node to its YAML form: { template, parameters? } */
function buildTemplateObject(tn: Node<GraphNodeData>): Record<string, unknown> {
  const d = tn.data.details ?? {};
  const obj: Record<string, unknown> = {
    template: (d['templatePath'] as string | undefined) ?? '',
  };
  const parametersRaw = d['parametersRaw'] as string | undefined;
  if (parametersRaw) {
    try {
      const params = jsYaml.load(parametersRaw);
      if (params !== null && typeof params === 'object' && !Array.isArray(params)) {
        obj['parameters'] = params;
      }
    } catch { /* skip malformed */ }
  }
  return obj;
}

function buildJobObject(
  jn: Node<GraphNodeData>,
  childMap: Map<string, string[]>,
  taskNodes: Node<GraphNodeData>[],
  allNodes: Node<GraphNodeData>[],
  allEdges: Edge[]
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
  // Derive dependsOn from incoming job→job edges so that drawing edges in the
  // graph is the authoritative way to express job ordering.
  const jobDeps = allEdges
    .filter((e) => e.target === jn.id)
    .map((e) => allNodes.find((n) => n.id === e.source))
    .filter((n): n is Node<GraphNodeData> => !!n && n.data.kind === 'job');
  if (jobDeps.length > 0) {
    jobObj['dependsOn'] =
      jobDeps.length === 1 ? jobDeps[0].data.rawId : jobDeps.map((n) => n.data.rawId);
  }
  if (jn.data.condition) {
    jobObj['condition'] = jn.data.condition;
  }
  if (jn.data.continueOnError === true) {
    jobObj['continueOnError'] = true;
  }
  const pool = jn.data.details?.pool as string | undefined;
  if (pool) {
    jobObj['pool'] = { vmImage: pool };
  }
  const timeoutInMinutes = jn.data.details?.['timeoutInMinutes'] as number | undefined;
  if (timeoutInMinutes !== undefined) { jobObj['timeoutInMinutes'] = timeoutInMinutes; }
  const cancelTimeoutInMinutes = jn.data.details?.['cancelTimeoutInMinutes'] as number | undefined;
  if (cancelTimeoutInMinutes !== undefined) { jobObj['cancelTimeoutInMinutes'] = cancelTimeoutInMinutes; }
  const container = jn.data.details?.['container'] as string | undefined;
  if (container) { jobObj['container'] = container; }
  const environment = jn.data.details?.['environment'] as string | undefined;
  if (environment) { jobObj['environment'] = environment; }
  const workspaceClean = jn.data.details?.['workspaceClean'] as string | undefined;
  if (workspaceClean) { jobObj['workspace'] = { clean: workspaceClean }; }
  const strategyParallel = jn.data.details?.['strategyParallel'] as number | undefined;
  if (strategyParallel !== undefined && strategyParallel > 0) { jobObj['strategy'] = { parallel: strategyParallel }; }
  const variablesRaw = jn.data.details?.['variablesRaw'] as string | undefined;
  if (variablesRaw) {
    try { jobObj['variables'] = jsYaml.load(variablesRaw); } catch { /* skip malformed */ }
  }
  const templateContextRaw = jn.data.details?.['templateContextRaw'] as string | undefined;
  if (templateContextRaw) {
    try { jobObj['templateContext'] = jsYaml.load(templateContextRaw); } catch { /* skip malformed */ }
  }
  if (steps.length > 0) {
    jobObj['steps'] = steps;
  }
  return jobObj;
}

function buildStepObject(tn: Node<GraphNodeData>): Record<string, unknown> {
  if (tn.data.kind === 'template') {
    return buildTemplateObject(tn);
  }
  const d = tn.data.details ?? {};
  const taskName = d['taskName'] as string | undefined;
  const stepKind = d['stepKind'] as string | undefined;
  const step: Record<string, unknown> = {};

  // Primary key — use stepKind to distinguish bash/powershell from script
  switch (tn.data.kind) {
    case 'task':
      step['task'] = taskName ?? tn.data.rawId;
      break;
    case 'script':
      if (stepKind === 'bash') {
        step['bash'] = taskName ?? tn.data.label;
      } else if (stepKind === 'powershell') {
        step['powershell'] = taskName ?? tn.data.label;
      } else {
        step['script'] = taskName ?? tn.data.label;
      }
      break;
    case 'checkout': {
      const ref = (taskName ?? '').trim() || tn.data.rawId.replace(/^checkout:\s?/, '').trim() || 'self';
      step['checkout'] = ref;
      break;
    }
    case 'publish':
      step['publish'] = taskName ?? '.';
      step['artifact'] = (d['artifact'] as string | undefined) ?? tn.data.rawId;
      break;
    case 'download': {
      const dlRef = (taskName ?? '').trim() || tn.data.rawId.replace(/^download:\s?/, '').trim() || 'current';
      step['download'] = dlRef;
      break;
    }
    default:
      step['task'] = tn.data.rawId;
  }

  // ── Shared optional metadata ───────────────────────────────────────────────
  if (tn.data.displayName) {
    step['displayName'] = tn.data.displayName;
  }
  if (tn.data.condition) {
    step['condition'] = tn.data.condition;
  }
  if (tn.data.enabled === false) {
    step['enabled'] = false;
  }

  // ── Step-kind-specific fields ─────────────────────────────────────────────

  // name (step ID, used in dependsOn expressions)
  const name = d['name'] as string | undefined;
  if (name) { step['name'] = name; }

  const continueOnError = d['continueOnError'] as boolean | undefined;
  if (continueOnError === true) { step['continueOnError'] = true; }

  const timeoutInMinutes = d['timeoutInMinutes'] as number | undefined;
  if (timeoutInMinutes !== undefined) { step['timeoutInMinutes'] = timeoutInMinutes; }

  // task: specific
  if (tn.data.kind === 'task') {
    const retryCount = d['retryCountOnTaskFailure'] as number | undefined;
    if (retryCount !== undefined) { step['retryCountOnTaskFailure'] = retryCount; }

    const inputsRaw = d['inputsRaw'] as string | undefined;
    if (inputsRaw) {
      try { step['inputs'] = jsYaml.load(inputsRaw); } catch { /* skip malformed */ }
    }
  }

  // script/bash/powershell specific
  if (tn.data.kind === 'script') {
    const workingDirectory = d['workingDirectory'] as string | undefined;
    if (workingDirectory) { step['workingDirectory'] = workingDirectory; }

    const failOnStderr = d['failOnStderr'] as boolean | undefined;
    if (failOnStderr === true) { step['failOnStderr'] = true; }

    if (stepKind === 'powershell') {
      const errorActionPreference = d['errorActionPreference'] as string | undefined;
      if (errorActionPreference) { step['errorActionPreference'] = errorActionPreference; }

      const ignoreLASTEXITCODE = d['ignoreLASTEXITCODE'] as boolean | undefined;
      if (ignoreLASTEXITCODE === true) { step['ignoreLASTEXITCODE'] = true; }
    }
  }

  // env — used by task, script, bash, powershell
  if (tn.data.kind === 'task' || tn.data.kind === 'script') {
    const envRaw = d['envRaw'] as string | undefined;
    if (envRaw) {
      try { step['env'] = jsYaml.load(envRaw); } catch { /* skip malformed */ }
    }
  }

  // checkout specific
  if (tn.data.kind === 'checkout') {
    const clean = d['clean'] as boolean | undefined;
    if (clean === true) { step['clean'] = true; }
    if (clean === false) { step['clean'] = false; }

    const fetchDepth = d['fetchDepth'] as number | undefined;
    if (fetchDepth !== undefined) { step['fetchDepth'] = fetchDepth; }

    const lfs = d['lfs'] as boolean | undefined;
    if (lfs === true) { step['lfs'] = true; }

    const submodules = d['submodules'] as boolean | 'recursive' | undefined;
    if (submodules !== undefined) { step['submodules'] = submodules; }

    const checkoutPath = d['path'] as string | undefined;
    if (checkoutPath) { step['path'] = checkoutPath; }

    const persistCredentials = d['persistCredentials'] as boolean | undefined;
    if (persistCredentials === true) { step['persistCredentials'] = true; }
  }

  // download specific
  if (tn.data.kind === 'download') {
    const artifact = d['artifact'] as string | undefined;
    if (artifact) { step['artifact'] = artifact; }

    const downloadPath = d['path'] as string | undefined;
    if (downloadPath) { step['path'] = downloadPath; }

    const patterns = d['patterns'] as string | undefined;
    if (patterns) { step['patterns'] = patterns; }
  }

  return step;
}

// ── Template expansion ────────────────────────────────────────────────────────

/** Restore info serialised into every expanded node so collapse can recover it. */
export interface ExpandedTemplateRestoreInfo {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: GraphNodeData;
}

/**
 * Expands a template node inline by parsing the template YAML and inserting
 * its sub-graph into the current graph in place of the template node.
 *
 * All inserted nodes carry `fromTemplateId = templateNode.id` so they can be
 * identified as belonging to a template and collapsed back later.
 * The restore info needed for collapse is stored on every inserted node in
 * `details['__expandedFromTemplate']` as a JSON string.
 */
export function expandTemplateNode(
  templateNodeId: string,
  templateYaml: string,
  currentNodes: Node<GraphNodeData>[],
  currentEdges: Edge[]
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const templateNode = currentNodes.find((n) => n.id === templateNodeId);
  if (!templateNode || templateNode.data.kind !== 'template') {
    return { nodes: currentNodes, edges: currentEdges };
  }

  // Parse the template content
  let subNodes: Node<GraphNodeData>[];
  let subEdges: Edge[];
  try {
    ({ nodes: subNodes, edges: subEdges } = pipelineToGraph(templateYaml));
  } catch {
    return { nodes: currentNodes, edges: currentEdges };
  }

  // Drop the trigger node and every edge touching it
  const subTrigger = subNodes.find((n) => n.data.kind === 'trigger');
  const subTriggerEdgeIds = new Set(
    subTrigger
      ? subEdges.filter((e) => e.source === subTrigger.id || e.target === subTrigger.id).map((e) => e.id)
      : []
  );
  const filteredSubNodes = subNodes.filter((n) => n.data.kind !== 'trigger');
  const filteredSubEdges = subEdges.filter((e) => !subTriggerEdgeIds.has(e.id));

  if (filteredSubNodes.length === 0) {
    return { nodes: currentNodes, edges: currentEdges };
  }

  // Find entry nodes (root of sub-graph — no intra-subgraph incoming edges)
  const intraTargets = new Set(filteredSubEdges.map((e) => e.target));
  const rootSubNodeIds = new Set(filteredSubNodes.filter((n) => !intraTargets.has(n.id)).map((n) => n.id));

  // Find exit nodes (leaf of sub-graph — no intra-subgraph outgoing edges)
  const intraSources = new Set(filteredSubEdges.map((e) => e.source));
  const leafSubNodeIds = new Set(filteredSubNodes.filter((n) => !intraSources.has(n.id)).map((n) => n.id));

  // Offset positions so the top-left of the sub-graph lands at the template node's position
  const minSubX = Math.min(...filteredSubNodes.map((n) => n.position.x));
  const minSubY = Math.min(...filteredSubNodes.map((n) => n.position.y));
  const offsetX = templateNode.position.x - minSubX;
  const offsetY = templateNode.position.y - minSubY;

  // New unique IDs to avoid collisions with the existing graph
  const idPrefix = `texp-${Date.now()}`;
  const idMap = new Map<string, string>();
  filteredSubNodes.forEach((n, i) => { idMap.set(n.id, `${idPrefix}-${i}`); });

  // Restore info every expanded node carries
  const restoreInfo: ExpandedTemplateRestoreInfo = {
    id: templateNode.id,
    type: templateNode.type,
    position: templateNode.position,
    data: templateNode.data,
  };
  const restoreRaw = JSON.stringify(restoreInfo);
  const fromTemplatePath =
    (templateNode.data.details?.['templatePath'] as string | undefined) ?? templateNode.data.label;

  const newSubNodes: Node<GraphNodeData>[] = filteredSubNodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    data: {
      ...n.data,
      fromTemplateId: templateNodeId,
      details: {
        ...n.data.details,
        __fromTemplatePath: fromTemplatePath,
        __expandedFromTemplate: restoreRaw,
      },
    },
  }));

  const newSubEdges: Edge[] = filteredSubEdges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      ...e,
      id: `${idPrefix}-e-${e.id}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
    }));

  // Re-wire current edges: predecessors → template → successors
  const incomingEdges = currentEdges.filter((e) => e.target === templateNodeId);
  const outgoingEdges = currentEdges.filter((e) => e.source === templateNodeId);
  const otherEdges = currentEdges.filter(
    (e) => e.target !== templateNodeId && e.source !== templateNodeId
  );

  const rewiredIncoming: Edge[] = [];
  for (const inc of incomingEdges) {
    for (const rootId of rootSubNodeIds) {
      const newRootId = idMap.get(rootId)!;
      rewiredIncoming.push({ ...inc, id: `${inc.id}-to-${newRootId}`, target: newRootId });
    }
  }

  const rewiredOutgoing: Edge[] = [];
  for (const out of outgoingEdges) {
    for (const leafId of leafSubNodeIds) {
      const newLeafId = idMap.get(leafId)!;
      rewiredOutgoing.push({ ...out, id: `${newLeafId}-to-${out.id}`, source: newLeafId });
    }
  }

  return {
    nodes: [...currentNodes.filter((n) => n.id !== templateNodeId), ...newSubNodes],
    edges: [...otherEdges, ...newSubEdges, ...rewiredIncoming, ...rewiredOutgoing],
  };
}

/**
 * Collapses all nodes that were expanded from the given template node back into
 * the original single template node, re-wiring external edges in the process.
 */
export function collapseTemplateNodes(
  fromTemplateId: string,
  currentNodes: Node<GraphNodeData>[],
  currentEdges: Edge[]
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const expandedNodes = currentNodes.filter((n) => n.data.fromTemplateId === fromTemplateId);
  if (expandedNodes.length === 0) { return { nodes: currentNodes, edges: currentEdges }; }

  const restoreRaw = expandedNodes[0].data.details?.['__expandedFromTemplate'] as string | undefined;
  if (!restoreRaw) { return { nodes: currentNodes, edges: currentEdges }; }

  let restoreInfo: ExpandedTemplateRestoreInfo;
  try {
    restoreInfo = JSON.parse(restoreRaw) as ExpandedTemplateRestoreInfo;
  } catch {
    return { nodes: currentNodes, edges: currentEdges };
  }

  const expandedIds = new Set(expandedNodes.map((n) => n.id));

  // Edges that cross the boundary (external ↔ internal)
  const externalIncoming = currentEdges.filter(
    (e) => !expandedIds.has(e.source) && expandedIds.has(e.target)
  );
  const externalOutgoing = currentEdges.filter(
    (e) => expandedIds.has(e.source) && !expandedIds.has(e.target)
  );
  const otherEdges = currentEdges.filter(
    (e) => !expandedIds.has(e.source) && !expandedIds.has(e.target)
  );

  const restoredNode: Node<GraphNodeData> = {
    id: restoreInfo.id,
    type: restoreInfo.type ?? 'template',
    position: restoreInfo.position,
    data: restoreInfo.data,
  };

  // Deduplicate re-wired edges
  const seenIn = new Set<string>();
  const rewiredIncoming: Edge[] = [];
  for (const e of externalIncoming) {
    const key = `${e.source}->${restoredNode.id}`;
    if (!seenIn.has(key)) {
      seenIn.add(key);
      rewiredIncoming.push({ ...e, id: key, target: restoredNode.id });
    }
  }

  const seenOut = new Set<string>();
  const rewiredOutgoing: Edge[] = [];
  for (const e of externalOutgoing) {
    const key = `${restoredNode.id}->${e.target}`;
    if (!seenOut.has(key)) {
      seenOut.add(key);
      rewiredOutgoing.push({ ...e, id: key, source: restoredNode.id });
    }
  }

  return {
    nodes: [...currentNodes.filter((n) => !expandedIds.has(n.id)), restoredNode],
    edges: [...otherEdges, ...rewiredIncoming, ...rewiredOutgoing],
  };
}
