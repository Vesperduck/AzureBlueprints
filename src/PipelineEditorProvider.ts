import * as vscode from 'vscode';
import * as path from 'path';

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
  | { type: 'showInfo'; text: string };

// ── Utility ───────────────────────────────────────────────────────────────────

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
