#!/usr/bin/env node
/** Regenera las capturas de docs/screenshots usando datos ficticios. */

const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PULSO_DEMO: '1', PULSO_SCREENSHOT: '1', PULSO_FAKE_AI: '1' }
});

child.on('exit', (code) => process.exit(code ?? 0));
