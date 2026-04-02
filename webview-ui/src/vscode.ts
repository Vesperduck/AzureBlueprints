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
  | { type: 'edit'; yaml: string }
  | { type: 'showError'; text: string }
  | { type: 'showInfo'; text: string };

// ── Message shapes (extension → webview) ─────────────────────────────────────

export interface UpdateMessage {
  type: 'update';
  yaml: string;
  fileName: string;
}

export type ExtensionToWebviewMessage = UpdateMessage;

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
