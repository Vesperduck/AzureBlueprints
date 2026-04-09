import * as vscode from 'vscode';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { fetchTaskCatalog, findTaskInputs } from './taskCatalog';
import type { TemplateParamDefinition } from './types/pipeline';

/**
 * Provides the Pipeline Graph Editor as a VS Code custom text editor.
 * The underlying YAML document is managed by VS Code; this provider only
 * renders a webview on top of it and keeps the two in sync.
 */
export class PipelineEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'azureBlueprints.pipelineGraphEditor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new PipelineEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      PipelineEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  private constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // ── Helpers ──────────────────────────────────────────────────────────────

    const postYaml = () => {
      webviewPanel.webview.postMessage({
        type: 'update',
        yaml: document.getText(),
        fileName: path.basename(document.uri.fsPath),
        documentPath: document.uri.fsPath,
      });
    };

    // ── Document → webview ────────────────────────────────────────────────
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        postYaml();
      }
    });

    // ── Webview → document ────────────────────────────────────────────────
    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        switch (message.type) {
          case 'ready':
            postYaml();
            break;

          case 'edit': {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              document.uri,
              new vscode.Range(0, 0, document.lineCount, 0),
              message.yaml
            );
            await vscode.workspace.applyEdit(edit);
            break;
          }

          case 'showError':
            vscode.window.showErrorMessage(`Pipeline Graph: ${message.text}`);
            break;

          case 'showInfo':
            vscode.window.showInformationMessage(`Pipeline Graph: ${message.text}`);
            break;

          case 'requestTaskCatalog': {
            // Fetch the catalog (cached after first call) and send it back to
            // the webview, which renders its own in-canvas search menu.
            try {
              const tasks = await fetchTaskCatalog();
              webviewPanel.webview.postMessage({
                type: 'taskCatalogReady',
                tasks: tasks.map((t) => ({
                  name: t.name,
                  friendlyName: t.friendlyName,
                  category: t.category,
                })),
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(
                `Pipeline Graph: Failed to load task catalog – ${msg}`
              );
            }
            break;
          }

          case 'requestTaskInputs': {
            // Fetch the catalog (cached after first call), find inputs for the
            // requested task reference (e.g. "DotNetCoreCLI@2"), and send back.
            try {
              await fetchTaskCatalog(); // ensures catalog is cached
              const inputs = findTaskInputs(message.taskRef);
              webviewPanel.webview.postMessage({
                type: 'taskInputsReady',
                taskRef: message.taskRef,
                inputs,
              });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              // Send back empty inputs on failure rather than blocking the UI
              webviewPanel.webview.postMessage({
                type: 'taskInputsReady',
                taskRef: message.taskRef,
                inputs: [],
              });
              vscode.window.showWarningMessage(
                `Pipeline Graph: Could not fetch inputs for ${message.taskRef} – ${msg}`
              );
            }
            break;
          }

          case 'requestTemplateParams': {
            // Resolve the template path relative to the open document, read
            // the file, parse its top-level `parameters:` block, and send the
            // structured definitions back to the webview.
            try {
              const docDir = path.dirname(message.documentPath);
              const templateAbs = path.resolve(docDir, message.templatePath);
              const fileUri = vscode.Uri.file(templateAbs);
              const bytes = await vscode.workspace.fs.readFile(fileUri);
              const content = Buffer.from(bytes).toString('utf8');
              const parsed = jsYaml.load(content) as Record<string, unknown> | null | undefined;
              const rawParams = parsed && typeof parsed === 'object' && Array.isArray(parsed['parameters'])
                ? (parsed['parameters'] as unknown[])
                : [];
              const params: TemplateParamDefinition[] = rawParams
                .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
                .map((p) => ({
                  name: String(p['name'] ?? ''),
                  type: String(p['type'] ?? 'string'),
                  displayName: p['displayName'] !== undefined ? String(p['displayName']) : undefined,
                  default: p['default'],
                  values: Array.isArray(p['values']) ? (p['values'] as unknown[]).map(String) : undefined,
                }))
                .filter((p) => p.name !== '');
              webviewPanel.webview.postMessage({
                type: 'templateParamsReady',
                templatePath: message.templatePath,
                params,
              });
            } catch (err: unknown) {
              // File not found or unreadable: send empty params (not an error the user needs to see)
              webviewPanel.webview.postMessage({
                type: 'templateParamsReady',
                templatePath: message.templatePath,
                params: [],
              });
            }
            break;
          }
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      messageSubscription.dispose();
    });
  }

  // ── HTML ────────────────────────────────────────────────────────────────────

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js')
    );

    // Content-Security-Policy: allow styles and scripts only from our bundle
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 img-src ${webview.cspSource} data:;
                 font-src ${webview.cspSource};" />
  <title>Pipeline Graph Editor</title>
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100vh;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ── Types for messages coming from the webview ────────────────────────────────

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'edit'; yaml: string }
  | { type: 'showError'; text: string }
  | { type: 'showInfo'; text: string }
  | { type: 'requestTaskCatalog' }
  | { type: 'requestTaskInputs'; taskRef: string }
  | { type: 'requestTemplateParams'; templatePath: string; documentPath: string };

// ── Utility ───────────────────────────────────────────────────────────────────

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
