import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(root, '.test-'));
const suites = ['contacts', 'delete', 'background', 'runtime', 'build', 'layout', 'pause'];
const outputs = suites.map((suite) => join(temporary, `${suite}.test.mjs`));
try {
  await build({
    absWorkingDir: root,
    entryPoints: suites.map((suite) => `tests/${suite}.test.ts`),
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    define: { __DEV__: 'false' },
  });
  const test = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  await Promise.all(outputs.map((output) => rm(output, { force: true })));
  await rmdir(temporary);
}
