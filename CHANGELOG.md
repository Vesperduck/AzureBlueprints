# Changelog

All notable changes to Azure Blueprints are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions match the `version` field in `package.json`.

---

## [Unreleased]

### Added
- **Template node inline expansion** – right-clicking a template node now shows a context menu with an "Expand template inline" action. The extension host reads the referenced template file and inserts its internal nodes and edges directly into the current graph in place of the template node. Expanded nodes are visually distinguished with a dashed purple border and a `⇒ <template path>` badge at the bottom of each node.
- **Template collapse** – right-clicking any node that was expanded inline (identified by its `fromTemplateId`) shows a "Collapse back to template" action that removes the expanded sub-graph and restores the original template placeholder node, including all external edge connections.
- **`expandTemplateNode` / `collapseTemplateNodes`** – two new exported functions in `pipelineConverter.ts` for expand/collapse graph mutations. `expandTemplateNode` parses the template YAML, filters the trigger, re-IDs sub-nodes to avoid collisions, offsets their positions relative to the template node, and re-wires all external boundary edges. `collapseTemplateNodes` reads the restore info stored on each expanded node and reverses the operation.
- **`ContextTemplateMenu` component** – new floating context menu (`ContextTemplateMenu.tsx` / `ContextTemplateMenu.css`) that renders either an expand or collapse action depending on the right-clicked node type.
- **`node--from-template` CSS class** – expanded nodes receive a dashed purple border (`rgba(138, 99, 210, 0.6)`) and a `node__from-template-badge` footer strip indicating their template origin. Applied in `nodes.css` and consumed by `StageNode`, `JobNode`, `TaskNode`, and `TemplateNode`.
- **`fromTemplateId` field** – new optional field on `GraphNodeData` tracking which original template node each expanded node came from.
- **`requestTemplateExpansion` message** – new webview→extension message that asks the extension host to read a template file. The host responds with `templateExpansionReady` carrying the raw YAML, which the webview uses to drive `expandTemplateNode`.

### Tests
- 10 new tests across `expandTemplateNode` (6) and `collapseTemplateNodes` (4) covering: template replacement, `fromTemplateId` marking, trigger exclusion, identity on missing/wrong node, intra-subgraph edge creation, expanded node removal, template restore, and node count invariant.
- Total test count: **286** (up from 276).

---

## [0.1.5] – 2026-04-10

### Added
- **Transitive reduction for stage edges** – when stage C declares `dependsOn: [A, B]` and B already depends on A, the graph now renders a clean linear chain `A → B → C` instead of showing the redundant `A → C` edge. Parallel fan-in (independent stages both feeding a downstream stage) is preserved correctly.
- **Transitive reduction for job edges** – the same reduction is applied to job `dependsOn` inside a stage and in jobs-only pipelines. Both pipeline shapes (stages pipeline and jobs-only pipeline) are covered.
- **`computeTransitiveDeps` helper** – new exported utility that computes the full transitive closure of a dependency map, used internally for both stage and job reduction.
- **`azure-pipelines` language ID support** – the *Open as Pipeline Graph Editor* command now accepts files whose VS Code language ID is `azure-pipelines` (set by the Azure Pipelines extension) in addition to `yaml`, fixing an error where the command refused to open valid pipeline files.
- **GitHub Pages Jekyll theme** – added `_config.yml` and `assets/css/style.scss` to apply the Cayman theme with Azure Blueprints brand colours (orange → Azure-blue header gradient) to the project's GitHub Pages site.

### Tests
- 11 new tests for `computeTransitiveDeps` (unit) and transitive reduction behaviour at both the stage and job levels, covering linear chains, parallel fans, and YAML serialisation after reduction.
- Total test count: **276** (up from 265).

---

## [0.1.4] – 2026-04-07

### Added
- Task input schema — selecting a `task:` node fetches structured input definitions from the Azure DevOps task catalog and renders them as typed form fields (text, checkbox, select, textarea) grouped by category in the Properties panel.
- Template node support — stage, job, and step template references (`- template: path.yml`) are parsed, displayed as distinct purple nodes, and round-trip through the YAML converter with full `parameters:` block support.
- Live template parameter resolution — when a template node's path resolves to a local file the extension reads and parses its `parameters:` block; the Properties panel renders each parameter as a typed field (text, number, boolean checkbox, or values-based select); unresolvable templates fall back silently to the raw YAML textarea.

---

## [0.1.3] – 2026-04-07

### Added
- Live template parameter resolution (initial implementation).

---

## [0.1.2] – 2026-04-07

### Added
- Template node support for stage, job, and step references.

---

## [0.1.1] – 2026-04-05

### Added
- Script node insertion (`script:` steps) from the edge-drop and context menus.

### Fixed
- Tag-based release workflow and PR version-bump workflow reliability.

---

## [0.1.0] – 2026-04-02

### Added
- Initial release: visual graph editor for Azure DevOps YAML pipelines.
- Trigger, stage, job, and task nodes with live YAML synchronisation.
- Property editing side panel for task, trigger, and schedule settings.
- Task insertion from the Azure DevOps task catalog, including `checkout: self` and `checkout: none` nodes.
- Edge-drop context menu for adding dependent stages, jobs inside a stage, or tasks.
- 1:1 job→task and task→task multiplicity enforcement.
- Custom editor workflow via Explorer context menu and command palette.

[Unreleased]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.5...HEAD
[0.1.5]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.4...0.1.5
[0.1.4]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/Vesperduck/AzureBlueprints/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Vesperduck/AzureBlueprints/releases/tag/0.1.0
