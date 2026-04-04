# Contributing to Azure Blueprints

Thank you for contributing! This document describes the development workflow, including how versions are bumped and releases are published.

## Workflow overview

```
feature branch  →  (PR with label)  →  main  →  GitHub Release
                        ↑
               version-bump-pr.yml bumps
               package.json before merge
```

1. Open a PR targeting `main`.
2. Add a **release label** (see below) to control the version bump.
3. The `Bump version on PR` workflow automatically commits the bumped `package.json`/`package-lock.json` to your PR branch.
4. Once merged, the `Release on PR Merge` workflow reads the version, builds the VSIX, pushes a tag (`v<version>`), and creates a GitHub Release.

## Release labels

Add **exactly one** of the following labels to your PR before (or just after) opening it:

| Label | Meaning | Example: 0.1.0 → |
|---|---|---|
| `release:patch` | Bug fixes, small improvements | 0.1.1 |
| `release:minor` | New backward-compatible features | 0.2.0 |
| `release:major` | Breaking changes | 1.0.0 |

> **Default:** If no `release:*` label is present, the workflow defaults to a **patch** bump.

## Local development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Install & build

```sh
npm install
npm run build
```

Press **F5** in VS Code to launch the extension in a new Extension Development Host window.

### Running tests

```sh
npm test
```

### Coverage

```sh
npm run test:coverage
```

## Branching model

- `main` is protected; all changes must go through a PR.
- Branch names are free-form; a common pattern is `feat/<description>` or `fix/<description>`.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` – new feature
- `fix:` – bug fix
- `chore:` – maintenance (version bumps, dependency updates, etc.)
- `docs:` – documentation only

The version bump commit added by the bot looks like:

```
chore: bump version to v0.1.1 [skip ci]
```

The `[skip ci]` trailer prevents the CI workflow from running again on that push.
