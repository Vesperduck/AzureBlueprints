# Azure Blueprints – Pipeline Graph Editor

A Visual Studio Code extension that renders Azure DevOps YAML pipelines as interactive node-based graphs, inspired by Unreal Engine Blueprints. Edit the YAML and see the graph update live, or manipulate nodes and have the YAML regenerated automatically.

## Features

- **Visual graph editor** – Stages, jobs, and tasks rendered as connected nodes using ReactFlow.
- **Bidirectional sync** – YAML ↔ graph conversion kept in sync; edits in either direction are reflected in the other.
- **Context task menu** – Right-click any node to insert a step from the Azure DevOps task catalog.
- **Task catalog** – Fetches available pipeline tasks from your Azure DevOps organisation (OAuth via VS Code built-in Microsoft account).
- **Properties panel** – Select a node to view and edit its properties.
- **Custom editor** – Registered for `azure-pipelines*.yml` and `*.pipeline.yml`; also launchable via the command palette.
- **Trigger creation menu** – Right-clicking an empty canvas when no trigger node exists shows a menu to choose a trigger type (CI, PR, Scheduled, Manual, or None).
- **CI trigger properties** – CI trigger nodes expose Branches (include/exclude), Paths (include/exclude), Tags (include/exclude), and the Batch flag in the Properties panel.
- **Schedule trigger properties** — Scheduled trigger nodes expose the cron expression, schedule name, Branches (include/exclude), Always, and Batch fields in the Properties panel.
- **PR trigger properties** — PR trigger nodes expose Branches (include/exclude), Paths (include/exclude), Auto Cancel, and Drafts in the Properties panel.

## Architecture

| Module | Responsibility |
|--------|---------------|
| [src/extension.ts](src/extension.ts) | VS Code extension entry point; registers the editor and command |
| [src/PipelineEditorProvider.ts](src/PipelineEditorProvider.ts) | Custom text editor provider; owns the webview and document↔webview message bus |
| [src/taskCatalog.ts](src/taskCatalog.ts) | Fetches and caches the Azure DevOps task catalog via OAuth |
| [webview-ui/src/pipelineConverter.ts](webview-ui/src/pipelineConverter.ts) | YAML ↔ ReactFlow graph conversion logic |
| [webview-ui/src/App.tsx](webview-ui/src/App.tsx) | Root React component; wires graph canvas, panels, and menus |
| [webview-ui/src/components/PipelineGraph.tsx](webview-ui/src/components/PipelineGraph.tsx) | ReactFlow canvas with node/edge rendering |
| [webview-ui/src/components/PropertiesPanel.tsx](webview-ui/src/components/PropertiesPanel.tsx) | Sidebar panel for selected node properties |
| [webview-ui/src/components/ContextTaskMenu.tsx](webview-ui/src/components/ContextTaskMenu.tsx) | Right-click menu for inserting pipeline tasks |
| [webview-ui/src/components/ContextTriggerMenu.tsx](webview-ui/src/components/ContextTriggerMenu.tsx) | Right-click menu shown on empty canvas to select a trigger type |

## API / Exports

### `pipelineToGraph(yaml: string): { nodes, edges }`
Parses an Azure DevOps YAML pipeline string and returns ReactFlow `nodes` and `edges` representing the trigger → stage → job → task hierarchy.

### `graphToPipeline(nodes, edges): string`
Serialises a ReactFlow graph back to Azure DevOps YAML.

### `insertTaskNode(input: InsertTaskInput, nodes, edges): { nodes, edges }`
Appends a new task node to the graph, auto-connecting it to the deepest leaf, and returns the updated `nodes` and `edges`.

### `insertTriggerNode(nodes, edges, triggerType: TriggerType): { nodes, edges }`
Adds (or replaces) the trigger node in the graph with the given trigger type, preserving all other nodes and edges.

### `class PipelineEditorProvider`
VS Code `CustomTextEditorProvider` implementation. Use `PipelineEditorProvider.register(context)` to activate.

### `fetchTaskCatalog(): Promise<TaskCatalogItem[]>`
Returns the full Azure DevOps task catalog for the configured organisation. Results are cached for the lifetime of the extension host.

### `clearTaskCatalogCache(): void`
Clears the in-memory task catalog cache, forcing the next `fetchTaskCatalog()` call to re-fetch.

## Getting Started

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Install & Build

```sh
npm install
npm run build
```

Press **F5** in VS Code to launch the extension in a new Extension Development Host window.

### Running Tests

```sh
npm test
```

### Coverage

```sh
npm run test:coverage
```

## Changelog

- 2026-04-02: Initial README generated from codebase.
- 2026-04-02: Fixed double-delete bug in PipelineGraph — node deletions now correctly sync the YAML in one keypress for both isolated nodes and nodes with connected edges.
- 2026-04-02: Fixed node deletion not immediately updating YAML — ReactFlow fires `onEdgesChange` before `onNodesChange` during deletion; edge removals now defer their `onGraphChange` call so `handleNodesChange` can cancel it and write the YAML once with both correct nodes and edges.
- 2026-04-03: Enforced single-input-edge constraint — connecting or re-routing an edge to a node that already has an incoming connection now replaces the old edge instead of creating a duplicate.
- 2026-04-04: Added trigger creation context menu — right-clicking an empty canvas with no trigger node now shows a menu with five trigger types (CI, PR, Scheduled, Manual, None).
- 2026-04-04: Added schedule trigger fields — Scheduled trigger properties panel exposes cron expression, schedule name, branches include/exclude, Always, and Batch; fully round-trips through YAML.
- 2026-04-04: Added CI trigger fields — CI trigger properties panel exposes Branches include/exclude, Paths include/exclude, Tags include/exclude, and Batch; `PipelineTrigger` type expanded accordingly; 16 new tests (125 total).
- 2026-04-03: Added PR trigger fields — PR trigger properties panel exposes Branches include/exclude, Paths include/exclude, Auto Cancel, and Drafts; added `PipelinePrTrigger` type; `getTriggerType` now detects `pr:` blocks; 16 new tests (141 total).
