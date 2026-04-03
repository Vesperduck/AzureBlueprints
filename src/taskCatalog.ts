import * as vscode from 'vscode';
import type { TaskInputDefinition } from './types/pipeline';

// ── Public types ──────────────────────────────────────────────────────────────

export type { TaskInputDefinition };

export interface TaskCatalogItem {
  /** YAML reference used in pipeline files, e.g. "DotNetCoreCLI@2" */
  name: string;
  friendlyName: string;
  description: string;
  category: string;
  inputs: TaskInputDefinition[];
}

// ── Simple per-session in-memory cache ────────────────────────────────────────

let _cache: TaskCatalogItem[] | undefined;

export function clearTaskCatalogCache(): void {
  _cache = undefined;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

/**
 * Returns the full Azure DevOps task catalog for the configured organisation.
 * Results are cached for the lifetime of the extension host process.
 * Authenticates via the VS Code built-in Microsoft account provider (OAuth).
 */
export async function fetchTaskCatalog(): Promise<TaskCatalogItem[]> {
  if (_cache) {
    return _cache;
  }

  const config = vscode.workspace.getConfiguration('azureBlueprints');
  const orgUrl = config
    .get<string>('organizationUrl', 'https://dev.azure.com/bdna')
    .replace(/\/$/, '');

  // Azure DevOps resource ID for MSAL / VS Code Microsoft auth provider
  const session = await vscode.authentication.getSession(
    'microsoft',
    ['499b84ac-1321-427f-aa17-267ca6975798/.default'],
    { createIfNone: true }
  );

  const apiUrl = `${orgUrl}/_apis/distributedtask/tasks?api-version=7.0`;
  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Azure DevOps task catalog: HTTP ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as AzureDoTasksResponse;

  // The API returns every version of every task. Keep only the highest major
  // version per task name so the QuickPick list stays manageable.
  const byName = new Map<string, AzureDoTask>();
  for (const task of body.value) {
    const existing = byName.get(task.name);
    if (!existing || task.version.major > existing.version.major) {
      byName.set(task.name, task);
    }
  }

  _cache = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: `${t.name}@${t.version.major}`,
      friendlyName: t.friendlyName ?? t.name,
      description: t.description ?? '',
      category: t.category ?? '',
      inputs: (t.inputs ?? []).map((i) => ({
        name: i.name,
        type: i.type,
        label: i.label,
        defaultValue: i.defaultValue ?? '',
        required: i.required ?? false,
        helpMarkDown: i.helpMarkDown,
        groupName: i.groupName,
        options: i.options,
        visibleRule: i.visibleRule,
      })),
    }));

  return _cache;
}

/**
 * Returns the input schema for a specific task reference (e.g. "DotNetCoreCLI@2").
 * The catalog must already be cached (call fetchTaskCatalog first).
 * Returns an empty array if the task is not found in the cache.
 */
export function findTaskInputs(taskRef: string): TaskInputDefinition[] {
  if (!_cache) { return []; }
  return _cache.find((t) => t.name === taskRef)?.inputs ?? [];
}

// ── ADO REST API shapes ───────────────────────────────────────────────────────

interface AzureDoTaskInput {
  name: string;
  type: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  helpMarkDown?: string;
  groupName?: string;
  options?: Record<string, string>;
  visibleRule?: string;
}

interface AzureDoTask {
  id: string;
  name: string;
  version: { major: number; minor: number; patch: number };
  friendlyName: string;
  description: string;
  category: string;
  inputs?: AzureDoTaskInput[];
}

interface AzureDoTasksResponse {
  count: number;
  value: AzureDoTask[];
}
