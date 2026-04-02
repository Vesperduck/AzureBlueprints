# Azure Blueprints – Copilot Instructions

## Test command

```
npm test
```

Run this after every code change. All 65 tests must remain green.

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
