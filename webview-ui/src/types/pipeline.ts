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
  inputs?: Record<string, string | boolean | number>;
}

export interface PipelineScriptStep {
  script: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
}

export interface PipelineBashStep {
  bash: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
}

export interface PipelinePowerShellStep {
  powershell: string;
  displayName?: string;
  name?: string;
  enabled?: boolean;
  condition?: string;
  continueOnError?: boolean;
}

export interface PipelineCheckoutStep {
  checkout: string;
  clean?: boolean;
  fetchDepth?: number;
  lfs?: boolean;
  submodules?: boolean | 'recursive';
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
  pool?: PipelinePool | string;
  steps?: PipelineStep[];
  timeoutInMinutes?: number;
}

export interface PipelineDeploymentJob {
  deployment: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  pool?: PipelinePool | string;
  environment?: string;
  timeoutInMinutes?: number;
}

export interface PipelineStage {
  stage: string;
  displayName?: string;
  dependsOn?: string | string[];
  condition?: string;
  jobs?: (PipelineJob | PipelineDeploymentJob)[];
  pool?: PipelinePool | string;
}

export interface PipelineTrigger {
  branches?: { include?: string[]; exclude?: string[] };
}

export interface Pipeline {
  name?: string;
  trigger?: PipelineTrigger | 'none' | string[];
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
  | 'download';

export interface GraphNodeData {
  kind: GraphNodeKind;
  label: string;
  rawId: string;
  displayName?: string;
  enabled?: boolean;
  condition?: string;
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
}
