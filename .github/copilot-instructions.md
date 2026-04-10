# Azure Blueprints – Copilot Instructions

## Test command

```
npm test
```

Run this after every code change. All tests must remain green.

## Adding new tests

- Test files live in `webview-ui/src/__tests__/` and must match `*.test.ts`
- Tests for `pipelineConverter.ts` go in `webview-ui/src/__tests__/pipelineConverter.test.ts`
- New source modules get a sibling `__tests__/<moduleName>.test.ts`

## Coverage target

Run `npm run test:coverage` to check coverage. Every new exported function needs at least one direct test.

## Build command

```
npm run build
```

Run after tests pass to confirm the webpack bundles (extension + webview) still compile correctly.

## Changelog

`CHANGELOG.md` in the repo root follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## Documentation

- The main documentation file is `README.md` in the repo root. After every code change, you must update the documentation to reflect the current state of the project, including new features, changes, or removals.
- All new features, APIs, or user-facing changes must be documented in `README.md` or the appropriate documentation file.
- Never leave documentation outdated after a code change — documentation and code must always be in sync.

**After every code change you must:**

1. Add an entry under the `## [Unreleased]` section describing what was added, changed, fixed, or removed.
2. Include the updated test count if tests were added or removed.
3. Never delete or rewrite existing released version sections — only append to `[Unreleased]`.

When a version is released (i.e. `package.json` version is bumped), move all `[Unreleased]` entries into a new dated `## [x.y.z] – YYYY-MM-DD` section and reset `[Unreleased]` to empty.
