#!/usr/bin/env node
/** Abre Pulso con la cartera de demostración, sin tocar los datos reales. */

const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PULSO_DEMO: '1' }
});

child.on('exit', (code) => process.exit(code ?? 0));
