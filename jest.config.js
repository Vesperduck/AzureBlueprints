// @ts-check
'use strict';

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'azure-blueprints',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/webview-ui/src/__tests__/**/*.test.ts',
    '<rootDir>/src/__tests__/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  // reactflow is imported as type-only in the converter – no runtime module
  // resolution needed. Any other CSS/asset imports from node_modules are mocked.
  moduleNameMapper: {
    '\\.css$': '<rootDir>/__mocks__/fileMock.js',
  },
  collectCoverageFrom: [
    'webview-ui/src/pipelineConverter.ts',
    'src/**/*.ts',
    '!src/extension.ts',       // VS Code API – tested via integration tests
    '!src/**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
};
