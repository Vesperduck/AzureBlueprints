import * as vscode from 'vscode';
import { PipelineEditorProvider } from './PipelineEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  // Register the custom text editor provider
  context.subscriptions.push(PipelineEditorProvider.register(context));

  // Command: open any YAML file in the graph editor
  context.subscriptions.push(
    vscode.commands.registerCommand('azureBlueprints.openGraphEditor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor. Open a YAML pipeline file first.');
        return;
      }
      if (editor.document.languageId !== 'yaml') {
        vscode.window.showWarningMessage('Azure Blueprints: the active file is not a YAML file.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        editor.document.uri,
        PipelineEditorProvider.viewType,
        { viewColumn: vscode.ViewColumn.Beside }
      );
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up – subscriptions are disposed automatically
}
