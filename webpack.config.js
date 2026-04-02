// @ts-check
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration[]} */
module.exports = [
  // ─── Extension Host Bundle (Node.js) ──────────────────────────────────────
  {
    name: 'extension',
    target: 'node',
    mode: 'none',
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'out'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [
            {
              loader: 'ts-loader',
              options: { configFile: 'tsconfig.json' },
            },
          ],
          exclude: /node_modules/,
        },
      ],
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: { level: 'log' },
  },

  // ─── Webview Bundle (Browser) ─────────────────────────────────────────────
  {
    name: 'webview',
    target: 'web',
    mode: 'none',
    entry: './webview-ui/src/main.tsx',
    output: {
      path: path.resolve(__dirname, 'out', 'webview'),
      filename: 'main.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.(ts|tsx)$/,
          use: [
            {
              loader: 'ts-loader',
              options: { configFile: 'tsconfig.webview.json' },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    devtool: 'nosources-source-map',
    performance: {
      hints: false,
    },
  },
];
