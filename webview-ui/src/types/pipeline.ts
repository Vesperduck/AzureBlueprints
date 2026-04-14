/**
 * Webview-local copies of the shared pipeline types.
 * These are duplicated here so the webview webpack bundle does not depend on
 * the extension src/ tree.
 */

export interface PipelinePool {
  vmImage?: string;
  name?: string;
  demands?: string | string[];
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
  failOnStderr?: boolean;
  errorActionPreference?: string;
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
  name?: string;
  enabled?: boolean;
  condition?: string;
}

export interface PipelineDownloadStep {
  download: string;
  artifact?: string;
  path?: string;
  patterns?: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
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
  variables?: unknown;
  steps?: PipelineStep[];
  timeoutInMinutes?: number;
  cancelTimeoutInMinutes?: number;
  container?: string;
  workspace?: { clean?: 'outputs' | 'resources' | 'all' };
  strategy?: { parallel?: number; maxParallel?: number };
  templateContext?: unknown;
}

export interface PipelineDeploymentJob {
  deployment: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  pool?: PipelinePool | string;
  environment?: string;
  timeoutInMinutes?: number;
  cancelTimeoutInMinutes?: number;
  variables?: unknown;
}

export interface PipelineStage {
  stage: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  jobs?: (PipelineJob | PipelineDeploymentJob)[];
  pool?: PipelinePool | string;
  variables?: unknown;
  lockBehavior?: 'sequential' | 'runLatest';
  trigger?: 'manual' | 'automatic';
  isSkippable?: boolean;
  templateContext?: unknown;
}

export interface PipelineTrigger {
  batch?: boolean;
  branches?: { include?: string[]; exclude?: string[] };
  paths?: { include?: string[]; exclude?: string[] };
  tags?: { include?: string[]; exclude?: string[] };
}

export interface PipelinePrTrigger {
  autoCancel?: boolean;
  drafts?: boolean;
  branches?: { include?: string[]; exclude?: string[] };
  paths?: { include?: string[]; exclude?: string[] };
}

export interface PipelineSchedule {
  cron: string;
  displayName?: string;
  branches?: { include?: string[]; exclude?: string[] };
  always?: boolean;
  batch?: boolean;
}

export interface Pipeline {
  name?: string;
  trigger?: PipelineTrigger | 'none' | string[];
  pr?: PipelinePrTrigger;
  schedules?: PipelineSchedule[];
  stages?: PipelineStage[];
  jobs?: (PipelineJob | PipelineDeploymentJob)[];
  steps?: PipelineStep[];
  variables?: unknown;
  parameters?: unknown[];
}

export type GraphNodeKind =
  | 'trigger'
  | 'stage'
  | 'job'
  | 'task'
  | 'script'
  | 'checkout'
  | 'publish'
  | 'download'
  | 'template';

export interface GraphNodeData {
  kind: GraphNodeKind;
  label: string;
  rawId: string;
  displayName?: string;
  enabled?: boolean;
  condition?: string;
  /** Set when this node was expanded inline from a template node.
   *  Value is the ID of the original template node so it can be collapsed. */
  fromTemplateId?: string;
  continueOnError?: boolean;
  dependsOn?: string[];
  details?: Record<string, unknown>;
  /** ID of the job (or trigger for steps-only) node this task was parsed under.
   *  Used as a fallback in graphToPipeline when the connecting edge has been removed. */
  parentId?: string;
}

/** A single entry in the Azure DevOps task catalog. */
export interface CatalogTask {
  name: string;
  friendlyName: string;
  category: string;
  /** When set, inserting this entry creates a node of this kind instead of 'task'.
   *  Used for built-in entries such as checkout steps. */
  nodeKind?: GraphNodeKind;
}

/**
 * Schema definition for a single input on an Azure DevOps pipeline task.
 * Sourced from the /_apis/distributedtask/tasks ADO REST API.
 */
export interface TaskInputDefinition {
  name: string;
  /** ADO input types: 'string' | 'boolean' | 'pickList' | 'multiLine' | 'filePath' | 'secureFile' | 'radio' | 'url' */
  type: string;
  label: string;
  defaultValue: string;
  required: boolean;
  helpMarkDown?: string;
  groupName?: string;
  /** Only for pickList/radio: maps option value → display label. */
  options?: Record<string, string>;
  visibleRule?: string;
}

/**
 * A single parameter defined in the `parameters:` block of an ADO YAML template file.
 * Sourced by reading and parsing the local template file from the workspace.
 */
export interface TemplateParamDefinition {
  name: string;
  /** ADO parameter types: 'string'|'number'|'boolean'|'object'|'step'|'stepList'|'job'|'jobList'|'deployment'|'deploymentList'|'stage'|'stageList' */
  type: string;
  /** Optional display hint; falls back to `name` when absent. */
  displayName?: string;
  default?: unknown;
  /** Allowed values — makes the field render as a select dropdown. */
  values?: string[];
}
