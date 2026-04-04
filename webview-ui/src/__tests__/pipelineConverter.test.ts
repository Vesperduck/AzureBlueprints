/**
 * pipelineConverter.test.ts
 *
 * Full unit test suite for pipelineToGraph and graphToPipeline.
 * Run with:  npm test
 * Coverage:  npm run test:coverage
 */

import type { Edge, Node } from 'reactflow';
import * as jsYaml from 'js-yaml';
import { pipelineToGraph, graphToPipeline, insertTaskNode, insertTriggerNode, parseInputsRaw } from '../pipelineConverter';
import type { GraphNodeData } from '../types/pipeline';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return all node kinds from the result, excluding the trigger. */
const kinds = (nodes: Node<GraphNodeData>[]) =>
  nodes.map((n) => n.data.kind);

/** Edge as a simple "source-kind → target-kind" pair for readable assertions. */
const edgeKinds = (nodes: Node<GraphNodeData>[], edges: Edge[]) =>
  edges.map((e) => {
    const src = nodes.find((n) => n.id === e.source)?.data.kind ?? '?';
    const tgt = nodes.find((n) => n.id === e.target)?.data.kind ?? '?';
    return `${src}→${tgt}`;
  });

/** Edge as raw-id pairs for structural assertions. */
const edgeRawIds = (nodes: Node<GraphNodeData>[], edges: Edge[]) =>
  edges.map((e) => {
    const src = nodes.find((n) => n.id === e.source)?.data.rawId ?? '?';
    const tgt = nodes.find((n) => n.id === e.target)?.data.rawId ?? '?';
    return `${src}→${tgt}`;
  });

// ── YAML fixtures ─────────────────────────────────────────────────────────────

const STAGES_YAML = `
trigger:
  branches:
    include:
      - main

stages:
  - stage: Build
    displayName: Build Stage
    jobs:
      - job: BuildJob
        displayName: Build the project
        pool:
          vmImage: ubuntu-latest
        steps:
          - task: DotNetCoreCLI@2
            displayName: Restore
            inputs:
              command: restore
          - script: echo hello
            displayName: Say Hello
          - bash: echo world
            displayName: Say World

  - stage: Deploy
    displayName: Deploy Stage
    dependsOn: Build
    condition: succeeded()
    jobs:
      - job: DeployJob
        steps:
          - checkout: self
          - publish: \$(Build.ArtifactStagingDirectory)
            artifact: drop
          - download: current
            artifact: drop
`;

const JOBS_ONLY_YAML = `
trigger: none

jobs:
  - job: TestJob
    displayName: Run Tests
    pool:
      vmImage: windows-latest
    steps:
      - script: npm test
        displayName: NPM Test
      - task: PublishTestResults@2
        displayName: Publish Results
`;

const STEPS_ONLY_YAML = `
steps:
  - checkout: self
  - script: npm install
    displayName: Install deps
  - bash: npm run build
    displayName: Build
`;

const DEPLOYMENT_JOB_YAML = `
stages:
  - stage: Prod
    jobs:
      - deployment: DeployProd
        environment: production
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo deploy
`;

// ── pipelineToGraph ───────────────────────────────────────────────────────────

describe('pipelineToGraph', () => {

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty graph for empty string', () => {
      const { nodes, edges } = pipelineToGraph('');
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('returns empty graph for non-object YAML (plain string)', () => {
      const { nodes, edges } = pipelineToGraph('just a string');
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('returns empty graph for null YAML', () => {
      const { nodes, edges } = pipelineToGraph('null');
      expect(nodes).toHaveLength(0);
      expect(edges).toHaveLength(0);
    });

    it('returns only a trigger node for a valid but empty pipeline', () => {
      const { nodes, edges } = pipelineToGraph('name: EmptyPipeline\n');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].data.kind).toBe('trigger');
      expect(edges).toHaveLength(0);
    });
  });

  // ── Trigger node ───────────────────────────────────────────────────────────

  describe('trigger node', () => {
    it('labels trigger as "CI trigger" when branches object present', () => {
      const { nodes } = pipelineToGraph(STAGES_YAML);
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      expect(trigger).toBeDefined();
      expect(trigger.data.label).toContain('branches:');
    });

    it('labels trigger as "none" when trigger is none', () => {
      const { nodes } = pipelineToGraph(JOBS_ONLY_YAML);
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      expect(trigger.data.label).toBe('none');
    });

    it('labels trigger as "no trigger" when trigger is absent', () => {
      const { nodes } = pipelineToGraph(STEPS_ONLY_YAML);
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      expect(trigger.data.label).toBe('no trigger');
    });

    it('places the trigger to the left of the stage column', () => {
      const { nodes } = pipelineToGraph(STAGES_YAML);
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      const build = nodes.find((n) => n.data.rawId === 'Build')!;
      expect(trigger.position.x).toBeLessThan(build.position.x);
    });
  });

  // ── Stages pipeline ────────────────────────────────────────────────────────

  describe('stages pipeline', () => {
    let nodes: Node<GraphNodeData>[];
    let edges: Edge[];

    beforeEach(() => {
      ({ nodes, edges } = pipelineToGraph(STAGES_YAML));
    });

    it('creates a trigger node', () => {
      expect(nodes.filter((n) => n.data.kind === 'trigger')).toHaveLength(1);
    });

    it('creates two stage nodes', () => {
      expect(nodes.filter((n) => n.data.kind === 'stage')).toHaveLength(2);
    });

    it('assigns correct rawId to each stage', () => {
      const stageIds = nodes
        .filter((n) => n.data.kind === 'stage')
        .map((n) => n.data.rawId);
      expect(stageIds).toContain('Build');
      expect(stageIds).toContain('Deploy');
    });

    it('assigns displayName to stages', () => {
      const buildStage = nodes.find((n) => n.data.rawId === 'Build')!;
      expect(buildStage.data.displayName).toBe('Build Stage');
    });

    it('stores condition on the Deploy stage', () => {
      const deployStage = nodes.find((n) => n.data.rawId === 'Deploy')!;
      expect(deployStage.data.condition).toBe('succeeded()');
    });

    it('stores dependsOn on the Deploy stage', () => {
      const deployStage = nodes.find((n) => n.data.rawId === 'Deploy')!;
      expect(deployStage.data.dependsOn).toEqual(['Build']);
    });

    it('creates job nodes for each job', () => {
      const jobNodes = nodes.filter((n) => n.data.kind === 'job');
      expect(jobNodes).toHaveLength(2);
      expect(jobNodes.map((j) => j.data.rawId)).toContain('BuildJob');
      expect(jobNodes.map((j) => j.data.rawId)).toContain('DeployJob');
    });

    it('stores displayName on jobs', () => {
      const buildJob = nodes.find((n) => n.data.rawId === 'BuildJob')!;
      expect(buildJob.data.displayName).toBe('Build the project');
    });

    it('stores vmImage pool in job details', () => {
      const buildJob = nodes.find((n) => n.data.rawId === 'BuildJob')!;
      expect(buildJob.data.details?.['pool']).toBe('ubuntu-latest');
    });

    // ── Task nodes ──────────────────────────────────────────────────────────

    it('creates task node for task: step', () => {
      const taskNodes = nodes.filter((n) => n.data.kind === 'task');
      expect(taskNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('creates script node for script: step', () => {
      expect(nodes.some((n) => n.data.kind === 'script')).toBe(true);
    });

    it('creates script node for bash: step', () => {
      const scripts = nodes.filter((n) => n.data.kind === 'script');
      // Both script: and bash: map to 'script' kind
      expect(scripts.length).toBeGreaterThanOrEqual(2);
    });

    it('creates checkout node for checkout: step', () => {
      expect(nodes.some((n) => n.data.kind === 'checkout')).toBe(true);
    });

    it('creates publish node for publish: step', () => {
      expect(nodes.some((n) => n.data.kind === 'publish')).toBe(true);
    });

    it('creates download node for download: step', () => {
      expect(nodes.some((n) => n.data.kind === 'download')).toBe(true);
    });

    it('stores task name in details for task: steps', () => {
      const taskNode = nodes.find(
        (n) => n.data.kind === 'task' && String(n.data.details?.['taskName']).startsWith('DotNetCoreCLI')
      );
      expect(taskNode).toBeDefined();
    });

    // ── Edge topology ───────────────────────────────────────────────────────

    it('connects trigger → Build stage (Build has no dependsOn)', () => {
      const buildStage = nodes.find((n) => n.data.rawId === 'Build')!;
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      const edge = edges.find(
        (e) => e.source === trigger.id && e.target === buildStage.id
      );
      expect(edge).toBeDefined();
    });

    it('connects Build stage → Deploy stage (via dependsOn)', () => {
      const buildStage = nodes.find((n) => n.data.rawId === 'Build')!;
      const deployStage = nodes.find((n) => n.data.rawId === 'Deploy')!;
      const edge = edges.find(
        (e) => e.source === buildStage.id && e.target === deployStage.id
      );
      expect(edge).toBeDefined();
    });

    it('does NOT connect trigger → Deploy stage directly', () => {
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      const deployStage = nodes.find((n) => n.data.rawId === 'Deploy')!;
      const edge = edges.find(
        (e) => e.source === trigger.id && e.target === deployStage.id
      );
      expect(edge).toBeUndefined();
    });

    it('connects each stage → its job', () => {
      const buildStage = nodes.find((n) => n.data.rawId === 'Build')!;
      const buildJob = nodes.find((n) => n.data.rawId === 'BuildJob')!;
      expect(edges.find((e) => e.source === buildStage.id && e.target === buildJob.id)).toBeDefined();
    });

    it('job with dependsOn creates job→job edge instead of stage→job', () => {
      const yaml = `
stages:
  - stage: MyStage
    jobs:
      - job: JobA
        steps:
          - script: echo a
      - job: JobB
        dependsOn: JobA
        steps:
          - script: echo b
`.trim();
      const { nodes: ns, edges: es } = pipelineToGraph(yaml);
      const jobA = ns.find((n) => n.data.rawId === 'JobA')!;
      const jobB = ns.find((n) => n.data.rawId === 'JobB')!;
      const stage = ns.find((n) => n.data.kind === 'stage')!;
      // JobB should be connected from JobA, not from the stage
      expect(es.find((e) => e.source === jobA.id && e.target === jobB.id)).toBeDefined();
      expect(es.find((e) => e.source === stage.id && e.target === jobB.id)).toBeUndefined();
    });

    // ── REGRESSION: tasks must chain sequentially, not fan out from job ──────

    it('[regression] tasks in BuildJob chain sequentially (job→task1→task2→task3), not hub-and-spoke', () => {
      const buildJob = nodes.find((n) => n.data.rawId === 'BuildJob')!;

      // Find build job's task chain
      const taskEdgesFromJob = edges.filter((e) => e.source === buildJob.id);
      // Only the FIRST task should be directly connected to the job
      expect(taskEdgesFromJob).toHaveLength(1);

      // Follow the chain: job → t1
      const t1 = nodes.find((n) => n.id === taskEdgesFromJob[0].target)!;
      expect(t1.data.kind).toBe('task');

      // t1 → t2
      const edgesFromT1 = edges.filter((e) => e.source === t1.id);
      expect(edgesFromT1).toHaveLength(1);
      const t2 = nodes.find((n) => n.id === edgesFromT1[0].target)!;
      expect(t2.data.kind).toBe('script');

      // t2 → t3
      const edgesFromT2 = edges.filter((e) => e.source === t2.id);
      expect(edgesFromT2).toHaveLength(1);
      const t3 = nodes.find((n) => n.id === edgesFromT2[0].target)!;
      expect(t3.data.kind).toBe('script');

      // t3 → nothing (end of chain)
      const edgesFromT3 = edges.filter((e) => e.source === t3.id);
      expect(edgesFromT3).toHaveLength(0);
    });
  });

  // ── Jobs-only pipeline ─────────────────────────────────────────────────────

  describe('jobs-only pipeline', () => {
    let nodes: Node<GraphNodeData>[];
    let edges: Edge[];

    beforeEach(() => {
      ({ nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML));
    });

    it('creates trigger + job nodes (no stage nodes)', () => {
      expect(nodes.find((n) => n.data.kind === 'trigger')).toBeDefined();
      expect(nodes.find((n) => n.data.kind === 'job')).toBeDefined();
      expect(nodes.find((n) => n.data.kind === 'stage')).toBeUndefined();
    });

    it('connects trigger → job', () => {
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
      const job = nodes.find((n) => n.data.kind === 'job')!;
      expect(edges.find((e) => e.source === trigger.id && e.target === job.id)).toBeDefined();
    });

    it('stores windows pool value', () => {
      const job = nodes.find((n) => n.data.kind === 'job')!;
      expect(job.data.details?.['pool']).toBe('windows-latest');
    });

    it('[regression] tasks within job chain sequentially', () => {
      const job = nodes.find((n) => n.data.kind === 'job')!;

      // Only one direct edge from job (to first task)
      const directTaskEdges = edges.filter((e) => e.source === job.id);
      expect(directTaskEdges).toHaveLength(1);

      const t1 = nodes.find((n) => n.id === directTaskEdges[0].target)!;
      const t1Outbound = edges.filter((e) => e.source === t1.id);
      expect(t1Outbound).toHaveLength(1);

      const t2 = nodes.find((n) => n.id === t1Outbound[0].target)!;
      expect(t2.data.kind).toBe('task');
      // t2 is the last step – nothing after it
      expect(edges.filter((e) => e.source === t2.id)).toHaveLength(0);
    });

    it('job with dependsOn creates job→job edge instead of trigger→job', () => {
      const yaml = `
jobs:
  - job: JobA
    steps:
      - script: echo a
  - job: JobB
    dependsOn: JobA
    steps:
      - script: echo b
`.trim();
      const { nodes: ns, edges: es } = pipelineToGraph(yaml);
      const jobA = ns.find((n) => n.data.rawId === 'JobA')!;
      const jobB = ns.find((n) => n.data.rawId === 'JobB')!;
      const trigger = ns.find((n) => n.data.kind === 'trigger')!;
      // JobB should be connected from JobA, not from the trigger
      expect(es.find((e) => e.source === jobA.id && e.target === jobB.id)).toBeDefined();
      expect(es.find((e) => e.source === trigger.id && e.target === jobB.id)).toBeUndefined();
    });
  });

  // ── Steps-only pipeline ────────────────────────────────────────────────────

  describe('steps-only pipeline', () => {
    let nodes: Node<GraphNodeData>[];
    let edges: Edge[];

    beforeEach(() => {
      ({ nodes, edges } = pipelineToGraph(STEPS_ONLY_YAML));
    });

    it('creates trigger + step nodes only (no stage or job nodes)', () => {
      expect(nodes.find((n) => n.data.kind === 'trigger')).toBeDefined();
      expect(nodes.find((n) => n.data.kind === 'stage')).toBeUndefined();
      expect(nodes.find((n) => n.data.kind === 'job')).toBeUndefined();
    });

    it('[regression] steps chain sequentially from trigger', () => {
      const trigger = nodes.find((n) => n.data.kind === 'trigger')!;

      // trigger → checkout
      const fromTrigger = edges.filter((e) => e.source === trigger.id);
      expect(fromTrigger).toHaveLength(1);
      const checkout = nodes.find((n) => n.id === fromTrigger[0].target)!;
      expect(checkout.data.kind).toBe('checkout');

      // checkout → script (npm install)
      const fromCheckout = edges.filter((e) => e.source === checkout.id);
      expect(fromCheckout).toHaveLength(1);
      const install = nodes.find((n) => n.id === fromCheckout[0].target)!;
      expect(install.data.kind).toBe('script');

      // script → bash (npm run build)
      const fromInstall = edges.filter((e) => e.source === install.id);
      expect(fromInstall).toHaveLength(1);
      const build = nodes.find((n) => n.id === fromInstall[0].target)!;
      expect(build.data.kind).toBe('script');

      // bash is the last – no outbound edges
      expect(edges.filter((e) => e.source === build.id)).toHaveLength(0);
    });
  });

  // ── Deployment job ─────────────────────────────────────────────────────────

  describe('deployment job', () => {
    it('marks deployment jobs with isDeployment flag', () => {
      const { nodes } = pipelineToGraph(DEPLOYMENT_JOB_YAML);
      const deployJob = nodes.find((n) => n.data.kind === 'job')!;
      expect(deployJob.data.details?.['isDeployment']).toBe(true);
      expect(deployJob.data.rawId).toBe('DeployProd');
    });
  });

  // ── Node positions ─────────────────────────────────────────────────────────

  describe('node positions', () => {
    it('places stages to the left of jobs', () => {
      const { nodes } = pipelineToGraph(STAGES_YAML);
      const stage = nodes.find((n) => n.data.kind === 'stage')!;
      const job = nodes.find((n) => n.data.kind === 'job')!;
      expect(stage.position.x).toBeLessThan(job.position.x);
    });

    it('places jobs to the left of tasks', () => {
      const { nodes } = pipelineToGraph(STAGES_YAML);
      const job = nodes.find((n) => n.data.kind === 'job')!;
      const task = nodes.find((n) => n.data.kind === 'task')!;
      expect(job.position.x).toBeLessThan(task.position.x);
    });

    it('stacks tasks vertically at increasing Y', () => {
      const { nodes } = pipelineToGraph(STAGES_YAML);
      const taskNodes = nodes.filter(
        (n) => n.data.kind === 'task' || n.data.kind === 'script'
      );
      // Verify each task is positioned lower than the previous
      for (let i = 1; i < taskNodes.length; i++) {
        expect(taskNodes[i].position.y).toBeGreaterThanOrEqual(taskNodes[i - 1].position.y);
      }
    });
  });
});

// ── graphToPipeline ───────────────────────────────────────────────────────────

describe('graphToPipeline', () => {

  it('returns empty YAML object for no nodes', () => {
    const yaml = graphToPipeline([], []);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toEqual({});
  });

  // ── Stages round-trip ──────────────────────────────────────────────────────

  describe('stages pipeline serialisation', () => {
    let roundTripped: ReturnType<typeof pipelineToGraph>;

    beforeEach(() => {
      const { nodes, edges } = pipelineToGraph(STAGES_YAML);
      const yaml = graphToPipeline(nodes, edges);
      roundTripped = pipelineToGraph(yaml);
    });

    it('preserves stages count', () => {
      const stages = roundTripped.nodes.filter((n) => n.data.kind === 'stage');
      expect(stages).toHaveLength(2);
    });

    it('preserves stage rawIds', () => {
      const ids = roundTripped.nodes
        .filter((n) => n.data.kind === 'stage')
        .map((n) => n.data.rawId);
      expect(ids).toContain('Build');
      expect(ids).toContain('Deploy');
    });

    it('preserves dependsOn on Deploy stage', () => {
      const deploy = roundTripped.nodes.find((n) => n.data.rawId === 'Deploy')!;
      expect(deploy.data.dependsOn).toEqual(['Build']);
    });

    it('preserves condition on Deploy stage', () => {
      const deploy = roundTripped.nodes.find((n) => n.data.rawId === 'Deploy')!;
      expect(deploy.data.condition).toBe('succeeded()');
    });

    it('preserves job nodes', () => {
      const jobs = roundTripped.nodes.filter((n) => n.data.kind === 'job');
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Jobs-only round-trip ───────────────────────────────────────────────────

  describe('jobs-only pipeline serialisation', () => {
    it('emits jobs: key (not stages:)', () => {
      const { nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML);
      const yaml = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(yaml) as Record<string, unknown>;
      expect(parsed).toHaveProperty('jobs');
      expect(parsed).not.toHaveProperty('stages');
    });

    it('preserves job id round-trip', () => {
      const { nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML);
      const yaml = graphToPipeline(nodes, edges);
      const { nodes: rt } = pipelineToGraph(yaml);
      const job = rt.find((n) => n.data.kind === 'job')!;
      expect(job.data.rawId).toBe('TestJob');
    });
  });

  // ── Steps-only round-trip ──────────────────────────────────────────────────

  describe('steps-only pipeline serialisation', () => {
    it('emits steps: key (not jobs: or stages:)', () => {
      const { nodes, edges } = pipelineToGraph(STEPS_ONLY_YAML);
      const yaml = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(yaml) as Record<string, unknown>;
      expect(parsed).toHaveProperty('steps');
      expect(parsed).not.toHaveProperty('jobs');
      expect(parsed).not.toHaveProperty('stages');
    });
  });

  // ── Pool serialisation ─────────────────────────────────────────────────────

  it('serialises pool as vmImage object when present', () => {
    const { nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { jobs: Array<Record<string, unknown>> };
    const job = parsed.jobs[0] as Record<string, unknown>;
    expect(job['pool']).toEqual({ vmImage: 'windows-latest' });
  });

  // ── Extended job fields round-trips ────────────────────────────────────────

  describe('extended job fields', () => {
    function makeJobYaml(extra: string): string {
      return `jobs:\n  - job: J\n    pool:\n      vmImage: ubuntu-latest\n${extra}\n    steps:\n      - script: echo hi`.trim();
    }

    it('round-trips timeoutInMinutes', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    timeoutInMinutes: 90'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['timeoutInMinutes']).toBe(90);
    });

    it('round-trips cancelTimeoutInMinutes', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    cancelTimeoutInMinutes: 3'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['cancelTimeoutInMinutes']).toBe(3);
    });

    it('round-trips continueOnError: true', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    continueOnError: true'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['continueOnError']).toBe(true);
    });

    it('does not emit continueOnError when false/unset', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml(''));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['continueOnError']).toBeUndefined();
    });

    it('round-trips container', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    container: mcr.microsoft.com/dotnet/sdk:8.0'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['container']).toBe('mcr.microsoft.com/dotnet/sdk:8.0');
    });

    it('round-trips workspace.clean', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    workspace:\n      clean: all'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect((parsed.jobs[0]['workspace'] as Record<string, unknown>)['clean']).toBe('all');
    });

    it('round-trips strategy.parallel', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    strategy:\n      parallel: 4'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect((parsed.jobs[0]['strategy'] as Record<string, unknown>)['parallel']).toBe(4);
    });

    it('round-trips variables (YAML map)', () => {
      const { nodes, edges } = pipelineToGraph(makeJobYaml('    variables:\n      myVar: hello\n      count: 5'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect((parsed.jobs[0]['variables'] as Record<string, unknown>)['myVar']).toBe('hello');
    });

    it('round-trips deployment job environment', () => {
      const yaml = `jobs:\n  - deployment: D\n    environment: production\n    pool:\n      vmImage: ubuntu-latest`.trim();
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
      expect(parsed.jobs[0]['environment']).toBe('production');
    });
  });

  // ── Sequential task chain serialisation ───────────────────────────────────

  it('[regression] all tasks in a sequential chain are preserved when serialising', () => {
    const yaml = `
jobs:
  - job: MyJob
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: TaskA@1
        displayName: Step A
      - task: TaskB@1
        displayName: Step B
      - task: TaskC@1
        displayName: Step C
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
    const steps = parsed.jobs[0]['steps'] as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]['task']).toBe('TaskA@1');
    expect(steps[1]['task']).toBe('TaskB@1');
    expect(steps[2]['task']).toBe('TaskC@1');
  });

  it('[regression] editing a field on task 1 does not drop task 2', () => {
    const yaml = `
jobs:
  - job: MyJob
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: TaskA@1
        displayName: Step A
      - task: TaskB@1
        displayName: Step B
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    // Simulate editing displayName on the first task node (as PropertiesPanel would)
    const task1 = nodes.find((n) => n.data.kind === 'task' && n.data.displayName === 'Step A')!;
    const updatedNodes = nodes.map((n) =>
      n.id === task1.id ? { ...n, data: { ...n.data, displayName: 'Step A edited' } } : n
    );
    const out = graphToPipeline(updatedNodes, edges);
    const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
    const steps = parsed.jobs[0]['steps'] as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(2);
    expect(steps[0]['displayName']).toBe('Step A edited');
    expect(steps[1]['task']).toBe('TaskB@1');
  });

  // ── Display name omitted when same as rawId ────────────────────────────────

  it('omits displayName in YAML when it matches rawId', () => {
    const { nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML);
    // Force displayName to equal rawId
    const jobNode = nodes.find((n) => n.data.kind === 'job')!;
    jobNode.data.displayName = jobNode.data.rawId;
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { jobs: Array<Record<string, unknown>> };
    expect(parsed.jobs[0]).not.toHaveProperty('displayName');
  });

  it('includes displayName in YAML when it differs from rawId', () => {
    const { nodes, edges } = pipelineToGraph(JOBS_ONLY_YAML);
    const jobNode = nodes.find((n) => n.data.kind === 'job')!;
    jobNode.data.displayName = 'My Custom Display Name';
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { jobs: Array<Record<string, unknown>> };
    expect(parsed.jobs[0]).toHaveProperty('displayName', 'My Custom Display Name');
  });

  // ── dependsOn singles vs arrays ────────────────────────────────────────────

  it('serialises single dependsOn as a string (not array)', () => {
    const { nodes, edges } = pipelineToGraph(STAGES_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { stages: Array<Record<string, unknown>> };
    const deploy = parsed.stages.find((s) => s['stage'] === 'Deploy')!;
    expect(typeof deploy['dependsOn']).toBe('string');
    expect(deploy['dependsOn']).toBe('Build');
  });

  it('serialises multiple dependsOn as an array', () => {
    const { nodes, edges } = pipelineToGraph(STAGES_YAML);
    const deployNode = nodes.find((n) => n.data.rawId === 'Deploy')!;
    // Add a second upstream stage and a corresponding edge to express multi-dependsOn
    const testStageNode: Node<GraphNodeData> = {
      id: 'stage-test-extra',
      type: 'stage',
      position: { x: 0, y: 500 },
      data: { kind: 'stage', label: 'Test', rawId: 'Test' },
    };
    const testToDeployEdge: Edge = {
      id: 'stage-test-extra->deploy',
      source: testStageNode.id,
      target: deployNode.id,
      animated: true,
      style: {},
    };
    const updatedNodes = [...nodes, testStageNode];
    const updatedEdges = [...edges, testToDeployEdge];
    const yaml = graphToPipeline(updatedNodes, updatedEdges);
    const parsed = jsYaml.load(yaml) as { stages: Array<Record<string, unknown>> };
    const deploy = parsed.stages.find((s) => s['stage'] === 'Deploy')!;
    expect(Array.isArray(deploy['dependsOn'])).toBe(true);
    expect((deploy['dependsOn'] as string[])).toContain('Build');
    expect((deploy['dependsOn'] as string[])).toContain('Test');
  });

  // ── Stage dependency via edges ─────────────────────────────────────────────

  it('stage with no incoming stage edges emits no dependsOn', () => {
    const yaml = `stages:\n  - stage: OnlyStage\n    jobs:\n      - job: J\n        steps:\n          - script: echo hi`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    expect(parsed.stages[0]['dependsOn']).toBeUndefined();
  });

  it('round-trips single stage dependsOn string via edges', () => {
    const { nodes, edges } = pipelineToGraph(STAGES_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const deploy = parsed.stages.find((s) => s['stage'] === 'Deploy')!;
    expect(deploy['dependsOn']).toBe('Build');
  });

  it('drawing a new stage→stage edge adds dependsOn to YAML', () => {
    // Build a graph with two independent stages (both connected to trigger)
    const yaml = `
stages:
  - stage: StageA
    jobs:
      - job: J1
        steps:
          - script: echo a
  - stage: StageB
    jobs:
      - job: J2
        steps:
          - script: echo b
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const stageA = nodes.find((n) => n.data.rawId === 'StageA')!;
    const stageB = nodes.find((n) => n.data.rawId === 'StageB')!;
    // Remove trigger→B and add A→B to express "StageB depends on StageA"
    const newEdge: Edge = { id: 'a->b', source: stageA.id, target: stageB.id, animated: true, style: {} };
    const updatedEdges = [...edges.filter((e) => e.target !== stageB.id), newEdge];
    const out = graphToPipeline(nodes, updatedEdges);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const stageBOut = parsed.stages.find((s) => s['stage'] === 'StageB')!;
    expect(stageBOut['dependsOn']).toBe('StageA');
  });

  it('removing a stage→stage edge removes dependsOn from YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGES_YAML);
    const deployNode = nodes.find((n) => n.data.rawId === 'Deploy')!;
    // Remove all edges going to Deploy (simulate user deleting the dependency edge)
    const withoutDep = edges.filter((e) => e.target !== deployNode.id);
    const out = graphToPipeline(nodes, withoutDep);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const deploy = parsed.stages.find((s) => s['stage'] === 'Deploy')!;
    expect(deploy['dependsOn']).toBeUndefined();
  });

  it('stage→job edge (drag-spawn) adds job into stage YAML', () => {
    // Simulate dragging from a stage to empty space to spawn a new job node.
    const stageId = 'stage-1';
    const jobId = 'job-new';
    const stageNode: Node<GraphNodeData> = {
      id: stageId,
      type: 'stage',
      position: { x: 0, y: 0 },
      data: { kind: 'stage', label: 'MyStage', rawId: 'MyStage' },
    };
    const jobNode: Node<GraphNodeData> = {
      id: jobId,
      type: 'job',
      position: { x: 200, y: 0 },
      data: { kind: 'job', label: 'New Job', rawId: 'NewJob' },
    };
    const edge: Edge = {
      id: `e-${stageId}-${jobId}`,
      source: stageId,
      target: jobId,
      animated: true,
      style: {},
    };
    const out = graphToPipeline([stageNode, jobNode], [edge]);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    expect(parsed.stages).toHaveLength(1);
    const stageOut = parsed.stages[0] as Record<string, unknown>;
    const jobs = stageOut['jobs'] as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]['job']).toBe('NewJob');
  });

  // ── Job dependency via edges ───────────────────────────────────────────────

  it('job with no incoming job edges emits no dependsOn', () => {
    const yaml = `
stages:
  - stage: S
    jobs:
      - job: OnlyJob
        steps:
          - script: echo hi
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const jobs = parsed.stages[0]['jobs'] as Array<Record<string, unknown>>;
    expect(jobs[0]['dependsOn']).toBeUndefined();
  });

  it('round-trips job dependsOn string via edges', () => {
    const yaml = `
stages:
  - stage: S
    jobs:
      - job: JobA
        steps:
          - script: echo a
      - job: JobB
        dependsOn: JobA
        steps:
          - script: echo b
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const jobs = parsed.stages[0]['jobs'] as Array<Record<string, unknown>>;
    const jobB = jobs.find((j) => j['job'] === 'JobB')!;
    expect(jobB['dependsOn']).toBe('JobA');
  });

  it('drawing a job→job edge adds dependsOn to YAML', () => {
    const stageId = 'stage-1';
    const jobAId = 'job-a';
    const jobBId = 'job-b';
    const stageNode: Node<GraphNodeData> = {
      id: stageId, type: 'stage', position: { x: 0, y: 0 },
      data: { kind: 'stage', label: 'S', rawId: 'S' },
    };
    const jobA: Node<GraphNodeData> = {
      id: jobAId, type: 'job', position: { x: 200, y: 0 },
      data: { kind: 'job', label: 'JobA', rawId: 'JobA' },
    };
    const jobB: Node<GraphNodeData> = {
      id: jobBId, type: 'job', position: { x: 200, y: 100 },
      data: { kind: 'job', label: 'JobB', rawId: 'JobB' },
    };
    const edgeStageA: Edge = { id: `${stageId}->${jobAId}`, source: stageId, target: jobAId, animated: true, style: {} };
    const edgeAB: Edge    = { id: `${jobAId}->${jobBId}`,  source: jobAId,  target: jobBId, animated: true, style: {} };
    const out = graphToPipeline([stageNode, jobA, jobB], [edgeStageA, edgeAB]);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const jobs = parsed.stages[0]['jobs'] as Array<Record<string, unknown>>;
    const jobBOut = jobs.find((j) => j['job'] === 'JobB')!;
    expect(jobBOut['dependsOn']).toBe('JobA');
  });

  it('removing a job→job edge removes dependsOn from YAML', () => {
    const yaml = `
stages:
  - stage: S
    jobs:
      - job: JobA
        steps:
          - script: echo a
      - job: JobB
        dependsOn: JobA
        steps:
          - script: echo b
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const jobB = nodes.find((n) => n.data.rawId === 'JobB')!;
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    // Remove the job→job edge to JobB and add back the stage→job edge
    const withoutDep = [
      ...edges.filter((e) => e.target !== jobB.id),
      { id: `${stage.id}->${jobB.id}`, source: stage.id, target: jobB.id, animated: true, style: {} } as Edge,
    ];
    const out = graphToPipeline(nodes, withoutDep);
    const parsed = jsYaml.load(out) as { stages: Array<Record<string, unknown>> };
    const jobs = parsed.stages[0]['jobs'] as Array<Record<string, unknown>>;
    const jobBOut = jobs.find((j) => j['job'] === 'JobB')!;
    expect(jobBOut['dependsOn']).toBeUndefined();
  });

  // ── Edge removal regression ────────────────────────────────────────────────

  it('[regression] removing the job→task edge preserves all tasks in YAML', () => {
    const yaml = `
jobs:
  - job: MyJob
    pool:
      vmImage: ubuntu-latest
    steps:
      - task: A@1
      - task: B@1
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const jobNode = nodes.find((n) => n.data.kind === 'job')!;
    const taskNodes = nodes.filter((n) => n.data.kind === 'task');
    // Remove the edge from job → first task (breaks the chain walk)
    const edgeToRemove = edges.find((e) => e.source === jobNode.id && taskNodes.some((t) => t.id === e.target))!;
    const updatedEdges = edges.filter((e) => e.id !== edgeToRemove.id);
    const out = graphToPipeline(nodes, updatedEdges);
    const parsed = jsYaml.load(out) as { jobs: Array<Record<string, unknown>> };
    const steps = parsed.jobs[0]['steps'] as Array<Record<string, unknown>>;
    expect(steps.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Step type detection ────────────────────────────────────────────────────────

describe('step type detection', () => {
  const makeYaml = (stepYaml: string) => `steps:\n  ${stepYaml}`;

  it('task: step → kind task', () => {
    const { nodes } = pipelineToGraph(makeYaml('- task: DotNetCoreCLI@2'));
    expect(nodes.find((n) => n.data.kind === 'task')).toBeDefined();
  });

  it('script: step → kind script', () => {
    const { nodes } = pipelineToGraph(makeYaml('- script: echo hi'));
    expect(nodes.find((n) => n.data.kind === 'script')).toBeDefined();
  });

  it('bash: step → kind script', () => {
    const { nodes } = pipelineToGraph(makeYaml('- bash: echo hi'));
    expect(nodes.find((n) => n.data.kind === 'script')).toBeDefined();
  });

  it('powershell: step → kind script', () => {
    const { nodes } = pipelineToGraph(makeYaml('- powershell: Write-Host hi'));
    expect(nodes.find((n) => n.data.kind === 'script')).toBeDefined();
  });

  it('checkout: step → kind checkout', () => {
    const { nodes } = pipelineToGraph(makeYaml('- checkout: self'));
    expect(nodes.find((n) => n.data.kind === 'checkout')).toBeDefined();
  });

  it('publish: step → kind publish', () => {
    const { nodes } = pipelineToGraph(
      makeYaml('- publish: $(Build.ArtifactStagingDirectory)\n    artifact: drop')
    );
    expect(nodes.find((n) => n.data.kind === 'publish')).toBeDefined();
  });

  it('download: step → kind download', () => {
    const { nodes } = pipelineToGraph(makeYaml('- download: current'));
    expect(nodes.find((n) => n.data.kind === 'download')).toBeDefined();
  });

  it('stores task name in details for task: steps', () => {
    const { nodes } = pipelineToGraph(makeYaml('- task: NuGetCommand@2'));
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.details?.['taskName']).toBe('NuGetCommand@2');
  });

  it('uses displayName as label when provided', () => {
    const { nodes } = pipelineToGraph(
      makeYaml('- task: DotNetCoreCLI@2\n    displayName: Restore packages')
    );
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.label).toBe('Restore packages');
  });

  it('uses task name as label when no displayName', () => {
    const { nodes } = pipelineToGraph(makeYaml('- task: DotNetCoreCLI@2'));
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.label).toBe('DotNetCoreCLI@2');
  });

  it('marks enabled: false steps', () => {
    const { nodes } = pipelineToGraph(
      makeYaml('- task: DotNetCoreCLI@2\n    enabled: false')
    );
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.enabled).toBe(false);
  });

  it('marks step with condition', () => {
    const { nodes } = pipelineToGraph(
      makeYaml("- script: echo hi\n    condition: eq(variables['Build.Reason'], 'PullRequest')")
    );
    const step = nodes.find((n) => n.data.kind === 'script')!;
    expect(step.data.condition).toBeDefined();
  });
});

// ── displayName round-trip (regression) ───────────────────────────────────────

describe('displayName round-trip', () => {
  const makeYaml = (stepYaml: string) => `steps:\n  ${stepYaml}`;

  it('[regression] task node stores displayName from YAML in data.displayName', () => {
    const { nodes } = pipelineToGraph(
      makeYaml('- task: DotNetCoreCLI@2\n    displayName: Restore packages')
    );
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.displayName).toBe('Restore packages');
  });

  it('[regression] task without YAML displayName has undefined data.displayName', () => {
    const { nodes } = pipelineToGraph(makeYaml('- task: DotNetCoreCLI@2'));
    const task = nodes.find((n) => n.data.kind === 'task')!;
    expect(task.data.displayName).toBeUndefined();
  });

  it('[regression] graphToPipeline writes displayName to YAML for task nodes', () => {
    const { nodes, edges } = pipelineToGraph(
      makeYaml('- task: DotNetCoreCLI@2\n    displayName: Restore packages')
    );
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { steps: Array<Record<string, unknown>> };
    expect(parsed.steps[0]['displayName']).toBe('Restore packages');
  });

  it('[regression] task displayName survives a full YAML round-trip', () => {
    const input = makeYaml('- task: DotNetCoreCLI@2\n    displayName: Restore packages');
    const { nodes, edges } = pipelineToGraph(input);
    const yaml = graphToPipeline(nodes, edges);
    const { nodes: nodes2 } = pipelineToGraph(yaml);
    const task2 = nodes2.find((n) => n.data.kind === 'task')!;
    expect(task2.data.displayName).toBe('Restore packages');
    expect(task2.data.label).toBe('Restore packages');
  });

  it('[regression] script step stores displayName from YAML', () => {
    const { nodes } = pipelineToGraph(
      makeYaml('- script: echo hi\n    displayName: Say hello')
    );
    const step = nodes.find((n) => n.data.kind === 'script')!;
    expect(step.data.displayName).toBe('Say hello');
  });

  it('[regression] graphToPipeline writes displayName for script steps', () => {
    const { nodes, edges } = pipelineToGraph(
      makeYaml('- script: echo hi\n    displayName: Say hello')
    );
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { steps: Array<Record<string, unknown>> };
    expect(parsed.steps[0]['displayName']).toBe('Say hello');
  });
});

// ── Schedule trigger ──────────────────────────────────────────────────────────

const SCHEDULE_YAML = `
schedules:
  - cron: '0 3 * * 1'
    displayName: Weekly Monday
    branches:
      include:
        - main
        - develop
      exclude:
        - feature/*
    always: true
    batch: false
`.trim();

describe('schedule trigger', () => {
  it('detects triggerType as "scheduled"', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['triggerType']).toBe('scheduled');
  });

  it('stores cron expression on trigger node details', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['cron']).toBe('0 3 * * 1');
  });

  it('stores scheduleDisplayName on trigger node details', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['scheduleDisplayName']).toBe('Weekly Monday');
  });

  it('stores branchesInclude as comma-separated string', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesInclude']).toBe('main, develop');
  });

  it('stores branchesExclude as comma-separated string', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesExclude']).toBe('feature/*');
  });

  it('stores always flag', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['always']).toBe(true);
  });

  it('stores batch flag', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['batch']).toBe(false);
  });

  it('sets trigger label to the cron string', () => {
    const { nodes } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.label).toBe('schedule: 0 3 * * 1');
  });

  it('round-trips schedules: key into YAML', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('schedules');
  });

  it('round-trips cron value', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    expect(parsed.schedules[0]['cron']).toBe('0 3 * * 1');
  });

  it('round-trips displayName', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    expect(parsed.schedules[0]['displayName']).toBe('Weekly Monday');
  });

  it('round-trips branch include list', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    const branches = parsed.schedules[0]['branches'] as Record<string, unknown>;
    expect(branches['include']).toEqual(['main', 'develop']);
  });

  it('round-trips branch exclude list', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    const branches = parsed.schedules[0]['branches'] as Record<string, unknown>;
    expect(branches['exclude']).toEqual(['feature/*']);
  });

  it('round-trips always: true', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    expect(parsed.schedules[0]['always']).toBe(true);
  });

  it('omits branch keys when both include and exclude are empty', () => {
    const { nodes, edges } = pipelineToGraph('schedules:\n  - cron: "0 0 * * *"');
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    expect(parsed.schedules[0]).not.toHaveProperty('branches');
  });

  it('editing cron in details round-trips the updated value', () => {
    const { nodes, edges } = pipelineToGraph(SCHEDULE_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    const updatedNodes = nodes.map((n) =>
      n.id === trigger.id
        ? { ...n, data: { ...n.data, details: { ...n.data.details, cron: '0 6 * * *' } } }
        : n
    );
    const yaml = graphToPipeline(updatedNodes, edges);
    const parsed = jsYaml.load(yaml) as { schedules: Array<Record<string, unknown>> };
    expect(parsed.schedules[0]['cron']).toBe('0 6 * * *');
  });
});

// ── insertTaskNode ────────────────────────────────────────────────────────────

describe('insertTaskNode', () => {
  it('adds exactly one new task node', () => {
    const { nodes, edges } = pipelineToGraph('trigger: none');
    const result = insertTaskNode(nodes, edges, { taskName: 'DotNetCoreCLI@2' });
    const tasksBefore = nodes.filter((n) => n.data.kind === 'task');
    const tasksAfter = result.nodes.filter((n) => n.data.kind === 'task');
    expect(tasksAfter).toHaveLength(tasksBefore.length + 1);
  });

  it('sets rawId and label to taskName', () => {
    const { nodes, edges } = pipelineToGraph('trigger: none');
    const result = insertTaskNode(nodes, edges, { taskName: 'DotNetCoreCLI@2' });
    const newTask = result.nodes[result.nodes.length - 1];
    expect(newTask.data.rawId).toBe('DotNetCoreCLI@2');
    expect(newTask.data.label).toBe('DotNetCoreCLI@2');
    expect(newTask.data.details?.['taskName']).toBe('DotNetCoreCLI@2');
  });

  it('connects new node to the trigger when graph has no tasks', () => {
    const { nodes, edges } = pipelineToGraph('trigger: none');
    const result = insertTaskNode(nodes, edges, { taskName: 'MyTask@1' });
    const trigger = result.nodes.find((n) => n.data.kind === 'trigger')!;
    const newTask = result.nodes[result.nodes.length - 1];
    const newEdge = result.edges.find((e) => e.target === newTask.id);
    expect(newEdge).toBeDefined();
    expect(newEdge!.source).toBe(trigger.id);
  });

  it('connects new node to the last leaf task in a chain', () => {
    const yaml = `steps:\n  - task: A@1\n  - task: B@1`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const result = insertTaskNode(nodes, edges, { taskName: 'C@1' });
    const taskB = result.nodes.find((n) => n.data.rawId === 'B@1')!;
    const newTask = result.nodes[result.nodes.length - 1];
    const newEdge = result.edges.find((e) => e.target === newTask.id);
    expect(newEdge!.source).toBe(taskB.id);
  });

  it('places new node below the last existing task (higher Y)', () => {
    const yaml = `steps:\n  - task: A@1\n  - task: B@1`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const result = insertTaskNode(nodes, edges, { taskName: 'C@1' });
    const taskNodes = result.nodes.filter((n) => n.data.kind === 'task');
    const ys = taskNodes.map((n) => n.position.y);
    const newTask = result.nodes[result.nodes.length - 1];
    // New task Y must be greater than all previous task Ys
    expect(newTask.position.y).toBeGreaterThan(Math.max(...ys.slice(0, -1)));
  });

  it('serialises new node correctly after insertion', () => {
    const yaml = `steps:\n  - task: A@1`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const result = insertTaskNode(nodes, edges, { taskName: 'B@2' });
    const out = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[1]['task']).toBe('B@2');
  });

  it('works on an empty graph (no nodes at all)', () => {
    const result = insertTaskNode([], [], { taskName: 'Standalone@1' });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it('wires new task to explicit anchorNodeId when provided (job anchor)', () => {
    // Simulate drag-from-job: a graph with a stage + job, no tasks yet.
    const yaml = `
stages:
  - stage: S
    jobs:
      - job: JobA
        steps: []
      - job: JobB
        steps: []
`.trim();
    const { nodes, edges } = pipelineToGraph(yaml);
    const jobA = nodes.find((n) => n.data.rawId === 'JobA')!;
    const result = insertTaskNode(nodes, edges, { taskName: 'MyTask@1', anchorNodeId: jobA.id });
    const newTask = result.nodes[result.nodes.length - 1];
    const newEdge = result.edges.find((e) => e.target === newTask.id);
    expect(newEdge).toBeDefined();
    expect(newEdge!.source).toBe(jobA.id);
  });

  describe('1:1 job→task enforcement', () => {
    it('appends to the leaf task (not the job) when job already has one task', () => {
      const yaml = `jobs:\n  - job: J\n    steps:\n      - task: A@1`;
      const { nodes, edges } = pipelineToGraph(yaml);
      const job = nodes.find((n) => n.data.kind === 'job')!;
      const taskA = nodes.find((n) => n.data.rawId === 'A@1')!;
      const result = insertTaskNode(nodes, edges, { taskName: 'B@1', anchorNodeId: job.id });
      const newTask = result.nodes[result.nodes.length - 1];
      const newEdge = result.edges.find((e) => e.target === newTask.id);
      expect(newEdge!.source).toBe(taskA.id);  // chains from A, not from the job
    });

    it('appends to the last leaf when job has a multi-task chain', () => {
      const yaml = `jobs:\n  - job: J\n    steps:\n      - task: A@1\n      - task: B@1\n      - task: C@1`;
      const { nodes, edges } = pipelineToGraph(yaml);
      const job = nodes.find((n) => n.data.kind === 'job')!;
      const taskC = nodes.find((n) => n.data.rawId === 'C@1')!;
      const result = insertTaskNode(nodes, edges, { taskName: 'D@1', anchorNodeId: job.id });
      const newTask = result.nodes[result.nodes.length - 1];
      const newEdge = result.edges.find((e) => e.target === newTask.id);
      expect(newEdge!.source).toBe(taskC.id);  // chains from C (the leaf), not the job
    });

    it('connects directly to the job when it has no tasks yet', () => {
      const yaml = `jobs:\n  - job: J\n    steps: []`;
      const { nodes, edges } = pipelineToGraph(yaml);
      const job = nodes.find((n) => n.data.kind === 'job')!;
      const result = insertTaskNode(nodes, edges, { taskName: 'A@1', anchorNodeId: job.id });
      const newTask = result.nodes[result.nodes.length - 1];
      const newEdge = result.edges.find((e) => e.target === newTask.id);
      expect(newEdge!.source).toBe(job.id);
    });

    it('does not create a second direct job→task edge', () => {
      const yaml = `jobs:\n  - job: J\n    steps:\n      - task: A@1`;
      const { nodes, edges } = pipelineToGraph(yaml);
      const job = nodes.find((n) => n.data.kind === 'job')!;
      const result = insertTaskNode(nodes, edges, { taskName: 'B@1', anchorNodeId: job.id });
      const directJobToTaskEdges = result.edges.filter(
        (e) => e.source === job.id && result.nodes.find((n) => n.id === e.target && n.data.kind === 'task')
      );
      expect(directJobToTaskEdges).toHaveLength(1);  // still exactly one job→task edge
    });
  });

  it('wires new task to explicit anchorNodeId when provided (task anchor — sequential drag)', () => {
    // Simulate dragging an edge off an existing task to chain a new one after it.
    const yaml = `steps:\n  - task: A@1\n  - task: B@1`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const taskA = nodes.find((n) => n.data.rawId === 'A@1')!;
    // Drag from A@1 (not the leaf) — anchor forces connection from A@1
    const result = insertTaskNode(nodes, edges, { taskName: 'C@1', anchorNodeId: taskA.id });
    const newTask = result.nodes[result.nodes.length - 1];
    const newEdge = result.edges.find((e) => e.target === newTask.id);
    expect(newEdge).toBeDefined();
    expect(newEdge!.source).toBe(taskA.id);
  });

  describe('checkout node insertion', () => {
    it('creates a checkout node with kind checkout', () => {
      const result = insertTaskNode([], [], { taskName: 'checkout: self', nodeKind: 'checkout' });
      const node = result.nodes[0];
      expect(node.data.kind).toBe('checkout');
      expect(node.type).toBe('checkout');
    });

    it('sets rawId to "checkout: self" for self checkout', () => {
      const result = insertTaskNode([], [], { taskName: 'checkout: self', nodeKind: 'checkout' });
      expect(result.nodes[0].data.rawId).toBe('checkout: self');
    });

    it('sets rawId to "checkout: none" for none checkout', () => {
      const result = insertTaskNode([], [], { taskName: 'checkout: none', nodeKind: 'checkout' });
      expect(result.nodes[0].data.rawId).toBe('checkout: none');
    });

    it('stores the ref in details.taskName (strips "checkout: " prefix)', () => {
      const result = insertTaskNode([], [], { taskName: 'checkout: self', nodeKind: 'checkout' });
      expect(result.nodes[0].data.details?.['taskName']).toBe('self');
    });

    it('sets details.stepKind to "checkout"', () => {
      const result = insertTaskNode([], [], { taskName: 'checkout: self', nodeKind: 'checkout' });
      expect(result.nodes[0].data.details?.['stepKind']).toBe('checkout');
    });

    it('serialises checkout: self node to correct YAML', () => {
      const { nodes: n, edges: e } = insertTaskNode([], [], { taskName: 'checkout: self', nodeKind: 'checkout' });
      const yaml = graphToPipeline(n, e);
      const parsed = jsYaml.load(yaml) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['checkout']).toBe('self');
    });

    it('serialises checkout: none node to correct YAML', () => {
      const { nodes: n, edges: e } = insertTaskNode([], [], { taskName: 'checkout: none', nodeKind: 'checkout' });
      const yaml = graphToPipeline(n, e);
      const parsed = jsYaml.load(yaml) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['checkout']).toBe('none');
    });
  });
});

// ── insertTriggerNode ──────────────────────────────────────────────────────────────

describe('insertTriggerNode', () => {
  it('adds a trigger node to an empty graph', () => {
    const result = insertTriggerNode([], [], 'ci');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].data.kind).toBe('trigger');
  });

  it('stores the triggerType in node details', () => {
    const result = insertTriggerNode([], [], 'pr');
    expect(result.nodes[0].data.details?.['triggerType']).toBe('pr');
  });

  it('sets the label to the human-readable option label', () => {
    const result = insertTriggerNode([], [], 'scheduled');
    expect(result.nodes[0].data.label).toBe('Scheduled');
  });

  it('does not add edges when inserting into an empty graph', () => {
    const result = insertTriggerNode([], [], 'ci');
    expect(result.edges).toHaveLength(0);
  });

  it('replaces an existing trigger node (same id, updated details)', () => {
    const { nodes, edges } = pipelineToGraph('trigger: none');
    const originalId = nodes.find((n) => n.data.kind === 'trigger')!.id;
    const result = insertTriggerNode(nodes, edges, 'ci');
    const triggerNodes = result.nodes.filter((n) => n.data.kind === 'trigger');
    expect(triggerNodes).toHaveLength(1);
    expect(triggerNodes[0].id).toBe(originalId);
    expect(triggerNodes[0].data.details?.['triggerType']).toBe('ci');
  });

  it('preserves existing non-trigger nodes when replacing', () => {
    const yaml = `trigger: none\njobs:\n  - job: MyJob\n    steps:\n      - script: echo hi`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const result = insertTriggerNode(nodes, edges, 'pr');
    expect(result.nodes.filter((n) => n.data.kind === 'job')).toHaveLength(1);
  });

  it('preserves all edges when replacing the trigger', () => {
    const yaml = `trigger: none\njobs:\n  - job: MyJob`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const result = insertTriggerNode(nodes, edges, 'ci');
    expect(result.edges).toHaveLength(edges.length);
  });

  it('serialises ci trigger as trigger.branches in YAML', () => {
    const result = insertTriggerNode([], [], 'ci');
    const yaml = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('trigger');
  });

  it('serialises manual trigger as trigger: none in YAML', () => {
    const result = insertTriggerNode([], [], 'manual');
    const yaml = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed['trigger']).toBe('none');
  });

  it('serialises none type with no trigger key in YAML', () => {
    const result = insertTriggerNode([], [], 'none');
    const yaml = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('trigger');
  });

  it('serialises pr trigger with pr key in YAML', () => {
    const result = insertTriggerNode([], [], 'pr');
    const yaml = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('pr');
  });

  it('serialises scheduled trigger with schedules key in YAML', () => {
    const result = insertTriggerNode([], [], 'scheduled');
    const yaml = graphToPipeline(result.nodes, result.edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('schedules');
  });
});

// ── CI trigger fields ─────────────────────────────────────────────────────────

describe('ci trigger', () => {
  const CI_YAML = `
trigger:
  batch: true
  branches:
    include:
      - main
      - develop
    exclude:
      - feature/*
  paths:
    include:
      - src/*
    exclude:
      - README.md
  tags:
    include:
      - v1.*
    exclude:
      - experimental-*
`;

  it('parses triggerType as ci', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['triggerType']).toBe('ci');
  });

  it('parses batch flag', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['ciBatch']).toBe(true);
  });

  it('parses branches include', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesInclude']).toBe('main, develop');
  });

  it('parses branches exclude', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesExclude']).toBe('feature/*');
  });

  it('parses paths include', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['pathsInclude']).toBe('src/*');
  });

  it('parses paths exclude', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['pathsExclude']).toBe('README.md');
  });

  it('parses tags include', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['tagsInclude']).toBe('v1.*');
  });

  it('parses tags exclude', () => {
    const { nodes } = pipelineToGraph(CI_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['tagsExclude']).toBe('experimental-*');
  });

  it('round-trips batch flag', () => {
    const { nodes, edges } = pipelineToGraph(CI_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect((parsed['trigger'] as Record<string, unknown>)['batch']).toBe(true);
  });

  it('round-trips branches include and exclude', () => {
    const { nodes, edges } = pipelineToGraph(CI_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const branches = (parsed['trigger'] as Record<string, unknown>)['branches'] as Record<string, unknown>;
    expect(branches['include']).toEqual(['main', 'develop']);
    expect(branches['exclude']).toEqual(['feature/*']);
  });

  it('round-trips paths include and exclude', () => {
    const { nodes, edges } = pipelineToGraph(CI_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const paths = (parsed['trigger'] as Record<string, unknown>)['paths'] as Record<string, unknown>;
    expect(paths['include']).toEqual(['src/*']);
    expect(paths['exclude']).toEqual(['README.md']);
  });

  it('round-trips tags include and exclude', () => {
    const { nodes, edges } = pipelineToGraph(CI_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const tags = (parsed['trigger'] as Record<string, unknown>)['tags'] as Record<string, unknown>;
    expect(tags['include']).toEqual(['v1.*']);
    expect(tags['exclude']).toEqual(['experimental-*']);
  });

  it('omits batch from YAML when false', () => {
    const yaml = `trigger:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['trigger'] as Record<string, unknown>)['batch']).toBeUndefined();
  });

  it('omits paths from YAML when not specified', () => {
    const yaml = `trigger:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['trigger'] as Record<string, unknown>)['paths']).toBeUndefined();
  });

  it('omits tags from YAML when not specified', () => {
    const yaml = `trigger:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['trigger'] as Record<string, unknown>)['tags']).toBeUndefined();
  });

  it('produces empty trigger object when inserted fresh with no details', () => {
    const { nodes, edges } = insertTriggerNode([], [], 'ci');
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('trigger');
  });
});

// ── PR trigger fields ─────────────────────────────────────────────────────────

describe('pr trigger', () => {
  const PR_YAML = `
trigger: none
pr:
  autoCancel: false
  drafts: false
  branches:
    include:
      - main
      - develop
    exclude:
      - feature/*
  paths:
    include:
      - src/*
    exclude:
      - README.md
`;

  it('parses triggerType as pr', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['triggerType']).toBe('pr');
  });

  it('parses pr trigger without explicit trigger: none', () => {
    const yaml = `pr:\n  branches:\n    include:\n      - main`;
    const { nodes } = pipelineToGraph(yaml);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['triggerType']).toBe('pr');
  });

  it('parses autoCancel flag', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['prAutoCancel']).toBe(false);
  });

  it('parses drafts flag', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['prDrafts']).toBe(false);
  });

  it('parses branches include', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesInclude']).toBe('main, develop');
  });

  it('parses branches exclude', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['branchesExclude']).toBe('feature/*');
  });

  it('parses paths include', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['pathsInclude']).toBe('src/*');
  });

  it('parses paths exclude', () => {
    const { nodes } = pipelineToGraph(PR_YAML);
    const trigger = nodes.find((n) => n.data.kind === 'trigger')!;
    expect(trigger.data.details?.['pathsExclude']).toBe('README.md');
  });

  it('round-trips autoCancel: false to YAML', () => {
    const { nodes, edges } = pipelineToGraph(PR_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect((parsed['pr'] as Record<string, unknown>)['autoCancel']).toBe(false);
  });

  it('round-trips drafts: false to YAML', () => {
    const { nodes, edges } = pipelineToGraph(PR_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect((parsed['pr'] as Record<string, unknown>)['drafts']).toBe(false);
  });

  it('round-trips branches include and exclude', () => {
    const { nodes, edges } = pipelineToGraph(PR_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const branches = (parsed['pr'] as Record<string, unknown>)['branches'] as Record<string, unknown>;
    expect(branches['include']).toEqual(['main', 'develop']);
    expect(branches['exclude']).toEqual(['feature/*']);
  });

  it('round-trips paths include and exclude', () => {
    const { nodes, edges } = pipelineToGraph(PR_YAML);
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    const paths = (parsed['pr'] as Record<string, unknown>)['paths'] as Record<string, unknown>;
    expect(paths['include']).toEqual(['src/*']);
    expect(paths['exclude']).toEqual(['README.md']);
  });

  it('omits autoCancel from YAML when default (true)', () => {
    const yaml = `pr:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['pr'] as Record<string, unknown>)['autoCancel']).toBeUndefined();
  });

  it('omits drafts from YAML when default (true)', () => {
    const yaml = `pr:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['pr'] as Record<string, unknown>)['drafts']).toBeUndefined();
  });

  it('omits paths from YAML when not specified', () => {
    const yaml = `pr:\n  branches:\n    include:\n      - main`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    expect((parsed['pr'] as Record<string, unknown>)['paths']).toBeUndefined();
  });

  it('produces pr key in YAML when inserted fresh', () => {
    const { nodes, edges } = insertTriggerNode([], [], 'pr');
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as Record<string, unknown>;
    expect(parsed).toHaveProperty('pr');
  });
});

// ── Stage extended fields ─────────────────────────────────────────────────────

describe('stage extended fields', () => {
  const STAGE_EXTENDED_YAML = `
trigger:
  branches:
    include:
      - main
stages:
  - stage: Build
    displayName: Build Stage
    pool:
      vmImage: ubuntu-latest
    lockBehavior: sequential
    trigger: manual
    isSkippable: false
    variables:
      myVar: hello
      count: 42
    templateContext:
      key: value
    jobs:
      - job: BuildJob
        steps:
          - script: echo hi
`;

  it('parses stage pool into details.stagePool', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    expect(stage.data.details?.['stagePool']).toBe('ubuntu-latest');
  });

  it('parses lockBehavior into details', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    expect(stage.data.details?.['lockBehavior']).toBe('sequential');
  });

  it('parses stage trigger into details.stageTrigger', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    expect(stage.data.details?.['stageTrigger']).toBe('manual');
  });

  it('parses isSkippable: false into details', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    expect(stage.data.details?.['isSkippable']).toBe(false);
  });

  it('parses variables into details.variablesRaw as YAML string', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    const raw = stage.data.details?.['variablesRaw'] as string;
    const parsed = jsYaml.load(raw) as Record<string, unknown>;
    expect(parsed['myVar']).toBe('hello');
    expect(parsed['count']).toBe(42);
  });

  it('parses templateContext into details.templateContextRaw as YAML string', () => {
    const { nodes } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    const raw = stage.data.details?.['templateContextRaw'] as string;
    const parsed = jsYaml.load(raw) as Record<string, unknown>;
    expect(parsed['key']).toBe('value');
  });

  it('does not set details.isSkippable when value is default (true)', () => {
    const yaml = `stages:\n  - stage: A\n    jobs:\n      - job: J\n        steps:\n          - script: echo hi`;
    const { nodes } = pipelineToGraph(yaml);
    const stage = nodes.find((n) => n.data.kind === 'stage')!;
    expect(stage.data.details?.['isSkippable']).toBeUndefined();
  });

  it('round-trips pool to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    expect((stage['pool'] as Record<string, unknown>)['vmImage']).toBe('ubuntu-latest');
  });

  it('round-trips lockBehavior to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    expect(stage['lockBehavior']).toBe('sequential');
  });

  it('round-trips stage trigger to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    expect(stage['trigger']).toBe('manual');
  });

  it('round-trips isSkippable: false to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    expect(stage['isSkippable']).toBe(false);
  });

  it('round-trips variables to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    const vars = stage['variables'] as Record<string, unknown>;
    expect(vars['myVar']).toBe('hello');
    expect(vars['count']).toBe(42);
  });

  it('round-trips templateContext to YAML', () => {
    const { nodes, edges } = pipelineToGraph(STAGE_EXTENDED_YAML);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    const tc = stage['templateContext'] as Record<string, unknown>;
    expect(tc['key']).toBe('value');
  });

  it('omits pool from YAML when not set', () => {
    const yaml = `stages:\n  - stage: A\n    jobs:\n      - job: J\n        steps:\n          - script: echo hi`;
    const { nodes, edges } = pipelineToGraph(yaml);
    const out = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(out) as Record<string, unknown>;
    const stage = (parsed['stages'] as Record<string, unknown>[])[0];
    expect(stage['pool']).toBeUndefined();
  });
});

// ── Step field round-trips ────────────────────────────────────────────────────

describe('step field round-trips', () => {
  /** Build a steps-only YAML with a single step block. */
  const wrap = (stepYaml: string) =>
    `steps:\n${stepYaml.split('\n').map((l) => `  ${l}`).join('\n')}`;

  // ── task: step ─────────────────────────────────────────────────────────────

  describe('task: step', () => {
    it('stores stepKind as "task" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- task: DotNetCoreCLI@2'));
      const n = nodes.find((n) => n.data.kind === 'task')!;
      expect(n.data.details?.['stepKind']).toBe('task');
    });

    it('stores taskName (task reference) in details', () => {
      const { nodes } = pipelineToGraph(wrap('- task: NuGetCommand@2'));
      const n = nodes.find((n) => n.data.kind === 'task')!;
      expect(n.data.details?.['taskName']).toBe('NuGetCommand@2');
    });

    it('round-trips inputs map', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  inputs:\n    command: restore\n    projects: "**/*.csproj"');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect((parsed.steps[0]['inputs'] as Record<string, unknown>)['command']).toBe('restore');
    });

    it('round-trips env map', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  env:\n    MY_VAR: hello');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect((parsed.steps[0]['env'] as Record<string, unknown>)['MY_VAR']).toBe('hello');
    });

    it('round-trips continueOnError: true', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  continueOnError: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['continueOnError']).toBe(true);
    });

    it('does not emit continueOnError when false/absent', () => {
      const { nodes, edges } = pipelineToGraph(wrap('- task: DotNetCoreCLI@2'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['continueOnError']).toBeUndefined();
    });

    it('round-trips timeoutInMinutes', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  timeoutInMinutes: 15');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['timeoutInMinutes']).toBe(15);
    });

    it('round-trips retryCountOnTaskFailure', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  retryCountOnTaskFailure: 3');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['retryCountOnTaskFailure']).toBe(3);
    });

    it('round-trips step name (id)', () => {
      const yaml = wrap('- task: DotNetCoreCLI@2\n  name: restoreStep');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['name']).toBe('restoreStep');
    });
  });

  // ── script: step ───────────────────────────────────────────────────────────

  describe('script: step', () => {
    it('stores stepKind as "script" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- script: echo hi'));
      const n = nodes.find((n) => n.data.kind === 'script')!;
      expect(n.data.details?.['stepKind']).toBe('script');
    });

    it('round-trips script content', () => {
      const yaml = wrap('- script: echo hello world');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['script']).toBe('echo hello world');
    });

    it('round-trips workingDirectory', () => {
      const yaml = wrap('- script: echo hi\n  workingDirectory: $(Build.SourcesDirectory)');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['workingDirectory']).toBe('$(Build.SourcesDirectory)');
    });

    it('round-trips failOnStderr: true', () => {
      const yaml = wrap('- script: echo hi\n  failOnStderr: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['failOnStderr']).toBe(true);
    });

    it('does not emit failOnStderr when absent', () => {
      const { nodes, edges } = pipelineToGraph(wrap('- script: echo hi'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['failOnStderr']).toBeUndefined();
    });

    it('round-trips env map', () => {
      const yaml = wrap('- script: echo hi\n  env:\n    FOO: bar');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect((parsed.steps[0]['env'] as Record<string, unknown>)['FOO']).toBe('bar');
    });
  });

  // ── bash: step ─────────────────────────────────────────────────────────────

  describe('bash: step', () => {
    it('stores stepKind as "bash" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- bash: echo hi'));
      const n = nodes.find((n) => n.data.kind === 'script')!;
      expect(n.data.details?.['stepKind']).toBe('bash');
    });

    it('round-trips bash step as bash: key (not script:)', () => {
      const yaml = wrap('- bash: echo world');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['bash']).toBe('echo world');
      expect(parsed.steps[0]['script']).toBeUndefined();
    });

    it('round-trips failOnStderr for bash step', () => {
      const yaml = wrap('- bash: echo hi\n  failOnStderr: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['failOnStderr']).toBe(true);
    });
  });

  // ── powershell: step ───────────────────────────────────────────────────────

  describe('powershell: step', () => {
    it('stores stepKind as "powershell" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- powershell: Write-Host hi'));
      const n = nodes.find((n) => n.data.kind === 'script')!;
      expect(n.data.details?.['stepKind']).toBe('powershell');
    });

    it('round-trips powershell step as powershell: key', () => {
      const yaml = wrap('- powershell: Write-Host hello');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['powershell']).toBe('Write-Host hello');
      expect(parsed.steps[0]['script']).toBeUndefined();
    });

    it('round-trips errorActionPreference', () => {
      const yaml = wrap('- powershell: Write-Host hi\n  errorActionPreference: continue');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['errorActionPreference']).toBe('continue');
    });

    it('round-trips ignoreLASTEXITCODE: true', () => {
      const yaml = wrap('- powershell: Write-Host hi\n  ignoreLASTEXITCODE: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['ignoreLASTEXITCODE']).toBe(true);
    });
  });

  // ── checkout: step ─────────────────────────────────────────────────────────

  describe('checkout: step', () => {
    it('stores stepKind as "checkout" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- checkout: self'));
      const n = nodes.find((n) => n.data.kind === 'checkout')!;
      expect(n.data.details?.['stepKind']).toBe('checkout');
    });

    it('round-trips checkout ref', () => {
      const { nodes, edges } = pipelineToGraph(wrap('- checkout: self'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['checkout']).toBe('self');
    });

    it('round-trips fetchDepth', () => {
      const yaml = wrap('- checkout: self\n  fetchDepth: 1');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['fetchDepth']).toBe(1);
    });

    it('round-trips lfs: true', () => {
      const yaml = wrap('- checkout: self\n  lfs: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['lfs']).toBe(true);
    });

    it('round-trips submodules: recursive', () => {
      const yaml = wrap('- checkout: self\n  submodules: recursive');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['submodules']).toBe('recursive');
    });

    it('round-trips path', () => {
      const yaml = wrap('- checkout: self\n  path: s/myrepo');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['path']).toBe('s/myrepo');
    });

    it('round-trips persistCredentials: true', () => {
      const yaml = wrap('- checkout: self\n  persistCredentials: true');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['persistCredentials']).toBe(true);
    });

    it('round-trips clean: false', () => {
      const yaml = wrap('- checkout: self\n  clean: false');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['clean']).toBe(false);
    });
  });

  // ── publish: step ──────────────────────────────────────────────────────────

  describe('publish: step', () => {
    it('stores stepKind as "publish" in details', () => {
      const yaml = wrap('- publish: $(Build.ArtifactStagingDirectory)\n  artifact: drop');
      const { nodes } = pipelineToGraph(yaml);
      const n = nodes.find((n) => n.data.kind === 'publish')!;
      expect(n.data.details?.['stepKind']).toBe('publish');
    });

    it('stores publish path in details.taskName', () => {
      const yaml = wrap('- publish: $(Build.ArtifactStagingDirectory)\n  artifact: drop');
      const { nodes } = pipelineToGraph(yaml);
      const n = nodes.find((n) => n.data.kind === 'publish')!;
      expect(n.data.details?.['taskName']).toBe('$(Build.ArtifactStagingDirectory)');
    });

    it('stores artifact name in details', () => {
      const yaml = wrap('- publish: $(Build.ArtifactStagingDirectory)\n  artifact: drop');
      const { nodes } = pipelineToGraph(yaml);
      const n = nodes.find((n) => n.data.kind === 'publish')!;
      expect(n.data.details?.['artifact']).toBe('drop');
    });

    it('round-trips publish + artifact', () => {
      const yaml = wrap('- publish: $(Build.ArtifactStagingDirectory)\n  artifact: drop');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['publish']).toBe('$(Build.ArtifactStagingDirectory)');
      expect(parsed.steps[0]['artifact']).toBe('drop');
    });
  });

  // ── download: step ─────────────────────────────────────────────────────────

  describe('download: step', () => {
    it('stores stepKind as "download" in details', () => {
      const { nodes } = pipelineToGraph(wrap('- download: current\n  artifact: drop'));
      const n = nodes.find((n) => n.data.kind === 'download')!;
      expect(n.data.details?.['stepKind']).toBe('download');
    });

    it('round-trips download ref', () => {
      const { nodes, edges } = pipelineToGraph(wrap('- download: current'));
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['download']).toBe('current');
    });

    it('round-trips artifact name', () => {
      const yaml = wrap('- download: current\n  artifact: drop');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['artifact']).toBe('drop');
    });

    it('round-trips path', () => {
      const yaml = wrap('- download: current\n  artifact: drop\n  path: $(Pipeline.Workspace)/drop');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['path']).toBe('$(Pipeline.Workspace)/drop');
    });

    it('round-trips patterns', () => {
      const yaml = wrap('- download: current\n  artifact: drop\n  patterns: "**/*.zip"');
      const { nodes, edges } = pipelineToGraph(yaml);
      const out = graphToPipeline(nodes, edges);
      const parsed = jsYaml.load(out) as { steps: Array<Record<string, unknown>> };
      expect(parsed.steps[0]['patterns']).toBe('**/*.zip');
    });
  });
});

describe('parseInputsRaw', () => {
  it('returns empty object for undefined', () => {
    expect(parseInputsRaw(undefined)).toEqual({});
  });

  it('parses a YAML map into string-keyed pairs', () => {
    const raw = 'command: restore\nprojects: "**/*.csproj"';
    expect(parseInputsRaw(raw)).toEqual({ command: 'restore', projects: '**/*.csproj' });
  });

  it('coerces non-string values to strings', () => {
    const raw = 'count: 42\nflag: true';
    const result = parseInputsRaw(raw);
    expect(result['count']).toBe('42');
    expect(result['flag']).toBe('true');
  });

  it('returns empty object for malformed YAML', () => {
    expect(parseInputsRaw(': invalid: {{{}')).toEqual({});
  });

  it('returns empty object for a YAML array (not a map)', () => {
    expect(parseInputsRaw('- item1\n- item2')).toEqual({});
  });
});
