import type { CatalogTask, TaskInputDefinition, TemplateParamDefinition } from './types/pipeline';

// VS Code webview API wrapper – acquires the VS Code API once and re-exports
// typed helpers so consuming components don't need to call acquireVsCodeApi()
// directly (which can only be called once per webview lifetime).

export interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): WebviewState | undefined;
  setState(state: WebviewState): void;
}

// ── Message shapes (webview → extension) ─────────────────────────────────────

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'edit'; yaml: string; filePath?: string }
  | { type: 'showError'; text: string }
  | { type: 'showInfo'; text: string }
  | { type: 'requestTaskCatalog' }
  | { type: 'requestTaskInputs'; taskRef: string }
  | { type: 'requestTemplateParams'; templatePath: string; documentPath: string }
  | { type: 'loadTemplate'; templatePath: string; documentPath: string }
  | { type: 'requestTemplateExpansion'; templatePath: string; documentPath: string; templateNodeId: string };

// ── Message shapes (extension → webview) ─────────────────────────────────────

export interface UpdateMessage {
  type: 'update';
  yaml: string;
  fileName: string;
  documentPath: string;
}

export interface AddTaskMessage {
  type: 'addTask';
  task: { name: string; friendlyName: string };
}

export interface TaskCatalogReadyMessage {
  type: 'taskCatalogReady';
  tasks: CatalogTask[];
}

export interface TaskInputsReadyMessage {
  type: 'taskInputsReady';
  taskRef: string;
  inputs: TaskInputDefinition[];
}

export interface TemplateParamsReadyMessage {
  type: 'templateParamsReady';
  templatePath: string;
  params: TemplateParamDefinition[];
}

export interface TemplateLoadedMessage {
  type: 'templateLoaded';
  yaml: string;
  fileName: string;
  absolutePath: string;
}

export interface TemplateExpansionReadyMessage {
  type: 'templateExpansionReady';
  templateNodeId: string;
  yaml: string;
}

export type ExtensionToWebviewMessage = UpdateMessage | TaskCatalogReadyMessage | TaskInputsReadyMessage | TemplateParamsReadyMessage | TemplateLoadedMessage | TemplateExpansionReadyMessage;

// ── State ─────────────────────────────────────────────────────────────────────

export interface WebviewState {
  yaml?: string;
  fileName?: string;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare function acquireVsCodeApi(): VsCodeApi;

let _api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!_api) {
    _api = acquireVsCodeApi();
  }
  return _api;
}
