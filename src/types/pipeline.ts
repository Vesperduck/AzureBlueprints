// Azure DevOps Pipeline YAML type definitions

/**
 * Schema definition for a single input on an Azure DevOps pipeline task.
 * Sourced from the /_apis/distributedtask/tasks ADO REST API.
 */
export interface TaskInputDefinition {
  name: string;
  type: string;
  label: string;
  defaultValue: string;
  required: boolean;
  helpMarkDown?: string;
  groupName?: string;
  options?: Record<string, string>;
  visibleRule?: string;
}

export interface PipelineTrigger {
  branches?: {
    include?: string[];
    exclude?: string[];
  };
  paths?: {
    include?: string[];
    exclude?: string[];
  };
  tags?: {
    include?: string[];
    exclude?: string[];
  };
}

export interface PipelinePool {
  vmImage?: string;
  name?: string;
  demands?: string | string[];
}

export interface PipelineVariable {
  name: string;
  value?: string;
  group?: string;
  readonly?: boolean;
}

export interface PipelineTaskStep {
  task: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
  timeoutInMinutes?: number;
  retryCountOnTaskFailure?: number;
  inputs?: Record<string, string | boolean | number>;
  env?: Record<string, string>;
}

export interface PipelineScriptStep {
  script: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
  timeoutInMinutes?: number;
  workingDirectory?: string;
  env?: Record<string, string>;
  failOnStderr?: boolean;
}

export interface PipelineBashStep {
  bash: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
  timeoutInMinutes?: number;
  workingDirectory?: string;
  env?: Record<string, string>;
  failOnStderr?: boolean;
}

export interface PipelinePowerShellStep {
  powershell: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
  timeoutInMinutes?: number;
  workingDirectory?: string;
  env?: Record<string, string>;
  errorActionPreference?: string;
  failOnStderr?: boolean;
  ignoreLASTEXITCODE?: boolean;
}

export interface PipelineCheckoutStep {
  checkout: string;
  clean?: boolean;
  fetchDepth?: number;
  lfs?: boolean;
  submodules?: boolean | 'recursive';
  path?: string;
  persistCredentials?: boolean;
}

export interface PipelinePublishStep {
  publish: string;
  artifact: string;
  displayName?: string;
}

export interface PipelineDownloadStep {
  download: string;
  artifact?: string;
  path?: string;
  patterns?: string;
  displayName?: string;
}

export type PipelineStep =
  | PipelineTaskStep
  | PipelineScriptStep
  | PipelineBashStep
  | PipelinePowerShellStep
  | PipelineCheckoutStep
  | PipelinePublishStep
  | PipelineDownloadStep;

export interface PipelineJob {
  job: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  continueOnError?: boolean;
  pool?: PipelinePool | string;
  variables?: PipelineVariable[] | Record<string, string>;
  steps?: PipelineStep[];
  timeoutInMinutes?: number;
  cancelTimeoutInMinutes?: number;
  strategy?: PipelineStrategy;
  container?: string | PipelineContainer;
  services?: Record<string, string | PipelineContainer>;
  workspace?: { clean?: 'outputs' | 'resources' | 'all' };
}

export interface PipelineDeploymentJob {
  deployment: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  pool?: PipelinePool | string;
  environment?: string | PipelineEnvironment;
  strategy?: PipelineDeploymentStrategy;
  variables?: PipelineVariable[] | Record<string, string>;
  timeoutInMinutes?: number;
}

export interface PipelineEnvironment {
  name: string;
  resourceName?: string;
  resourceType?: 'VirtualMachine' | 'Kubernetes';
  tags?: string;
}

export interface PipelineContainer {
  image: string;
  endpoint?: string;
  env?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  options?: string;
}

export interface PipelineStrategy {
  matrix?: Record<string, Record<string, string>>;
  maxParallel?: number;
  parallel?: number;
}

export interface PipelineDeploymentStrategy {
  runOnce?: {
    deploy?: { steps?: PipelineStep[] };
    preDeploy?: { steps?: PipelineStep[] };
    routeTraffic?: { steps?: PipelineStep[] };
    postRouteTraffic?: { steps?: PipelineStep[] };
    on?: {
      failure?: { steps?: PipelineStep[] };
      success?: { steps?: PipelineStep[] };
    };
  };
  rolling?: {
    maxParallel?: number | string;
    preDeploy?: { steps?: PipelineStep[] };
    deploy?: { steps?: PipelineStep[] };
    routeTraffic?: { steps?: PipelineStep[] };
    postRouteTraffic?: { steps?: PipelineStep[] };
    on?: {
      failure?: { steps?: PipelineStep[] };
      success?: { steps?: PipelineStep[] };
    };
  };
  canary?: {
    increments?: number[];
    preDeploy?: { steps?: PipelineStep[] };
    deploy?: { steps?: PipelineStep[] };
    routeTraffic?: { steps?: PipelineStep[] };
    postRouteTraffic?: { steps?: PipelineStep[] };
    on?: {
      failure?: { steps?: PipelineStep[] };
      success?: { steps?: PipelineStep[] };
    };
  };
}

export interface PipelineStage {
  stage: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  variables?: PipelineVariable[] | Record<string, string>;
  jobs?: (PipelineJob | PipelineDeploymentJob)[];
  pool?: PipelinePool | string;
  lockBehavior?: 'runLatest' | 'sequential';
}

export interface Pipeline {
  name?: string;
  trigger?: PipelineTrigger | 'none' | string[];
  pr?: PipelineTrigger | 'none' | string[];
  schedules?: PipelineSchedule[];
  resources?: PipelineResources;
  variables?: PipelineVariable[] | Record<string, string>;
  parameters?: PipelineParameter[];
  pool?: PipelinePool | string;
  stages?: PipelineStage[];
  jobs?: (PipelineJob | PipelineDeploymentJob)[];
  steps?: PipelineStep[];
}

export interface PipelineSchedule {
  cron: string;
  displayName?: string;
  branches?: { include?: string[]; exclude?: string[] };
  always?: boolean;
  batch?: boolean;
}

export interface PipelineResources {
  pipelines?: PipelineResourcePipeline[];
  repositories?: PipelineResourceRepository[];
  containers?: PipelineResourceContainer[];
}

export interface PipelineResourcePipeline {
  pipeline: string;
  project?: string;
  source?: string;
  version?: string;
  branch?: string;
  trigger?: PipelineTrigger | boolean;
}

export interface PipelineResourceRepository {
  repository: string;
  type: 'git' | 'github' | 'bitbucket';
  name: string;
  ref?: string;
  endpoint?: string;
  trigger?: PipelineTrigger | 'none';
}

export interface PipelineResourceContainer {
  container: string;
  image: string;
  endpoint?: string;
  env?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  options?: string;
}

export interface PipelineParameter {
  name: string;
  displayName?: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'step' | 'stepList' | 'job' | 'jobList' | 'deployment' | 'deploymentList' | 'stage' | 'stageList';
  default?: unknown;
  values?: string[];
}

// ─── Graph node/edge data shapes used by the webview ────────────────────────

export type GraphNodeKind = 'trigger' | 'stage' | 'job' | 'task' | 'script' | 'checkout' | 'publish' | 'download';

export interface GraphNodeData {
  kind: GraphNodeKind;
  label: string;
  rawId: string;          // id used in YAML (e.g. stage name, job name)
  displayName?: string;
  enabled?: boolean;
  condition?: string;
  dependsOn?: string[];
  details?: Record<string, unknown>;
}
