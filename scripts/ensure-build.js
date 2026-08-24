/**
 * Pretest guard: make sure the Strapi server bundle exists before Jest runs.
 *
 * The integration tests boot the app from ./dist (compiled output). If the
 * bundle is missing or the sources are newer than the build, rebuild it so
 * `npm test` always works as a single command.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const marker = path.join(root, 'dist', 'src', 'index.js');

function newest(dir, acc = 0) {
  let mtime = acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) mtime = newest(full, mtime);
    else mtime = Math.max(mtime, fs.statSync(full).mtimeMs);
  }
  return mtime;
}

const needsBuild =
  !fs.existsSync(marker) || newest(path.join(root, 'src')) > fs.statSync(marker).mtimeMs;

if (needsBuild) {
  console.log('[ensure-build] dist missing or stale — running `strapi build`…');
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['strapi', 'build', '--no-optimization'],
    { cwd: root, stdio: 'inherit' }
  );
  if (res.status !== 0) {
    console.error('[ensure-build] strapi build failed with exit code', res.status);
    process.exit(res.status ?? 1);
  }
} else {
  console.log('[ensure-build] dist is up to date.');
}
