/**
 * pipelineConverter.test.ts
 *
 * Full unit test suite for pipelineToGraph and graphToPipeline.
 * Run with:  npm test
 * Coverage:  npm run test:coverage
 */

import type { Edge, Node } from 'reactflow';
import * as jsYaml from 'js-yaml';
import { pipelineToGraph, graphToPipeline } from '../pipelineConverter';
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
    deployNode.data.dependsOn = ['Build', 'Test'];
    const yaml = graphToPipeline(nodes, edges);
    const parsed = jsYaml.load(yaml) as { stages: Array<Record<string, unknown>> };
    const deploy = parsed.stages.find((s) => s['stage'] === 'Deploy')!;
    expect(Array.isArray(deploy['dependsOn'])).toBe(true);
    expect(deploy['dependsOn']).toEqual(['Build', 'Test']);
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
