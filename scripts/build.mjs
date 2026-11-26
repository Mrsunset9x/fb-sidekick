// Builds the extension into dist/. `--watch` rebuilds on change and reloads the extension.
import * as esbuild from 'esbuild';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, watch as watchFs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BuildGate } from './build-gate.mjs';

const watch = process.argv.includes('--watch');
const src = new URL('../src/', import.meta.url);
// `--out <dir>` builds elsewhere (pack uses it so the dev build Chrome has loaded is left alone).
const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? process.argv[outArg + 1].replace(/\/?$/, '/') : 'dist/';
const dist = new URL(`../${outDir}`, import.meta.url);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const STATIC_DIRS = ['_locales', 'rules', 'icons'];
const STATIC_FILES = { 'popup/popup.html': 'popup.html', 'popup/popup.css': 'popup.css' };
const run = promisify(execFile);
async function typecheck() {
  try {
    await run(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    });
  } catch (error) {
    throw new Error(`TypeScript check failed; keeping the previous build.\n${error.stdout || error.message}`);
  }
}

/**
 * Writes a file only when its content changed, through a temporary file and a
 * rename, so dist/ never has a missing or half-written file. Chrome may reload
 * the extension at any moment during `npm run dev`, and a missing icon or
 * manifest makes it refuse to load the extension at all.
 */
async function put(to, data) {
  const current = await readFile(to).catch(() => null);
  if (current && Buffer.compare(current, Buffer.from(data)) === 0) return;
  await mkdir(new URL('.', to), { recursive: true });
  const tmp = new URL(`${to.href}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, to);
}

async function putDir(from, to) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const name = entry.name + (entry.isDirectory() ? '/' : '');
    if (entry.isDirectory()) await putDir(new URL(name, from), new URL(name, to));
    else await put(new URL(name, to), await readFile(new URL(name, from)));
  }
}

async function copyStaticNow() {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', src), 'utf8'));
  manifest.version = pkg.version;
  if (watch) {
    // The background bundle's dev code uses an alarm to wake the reload check.
    manifest.permissions = [...manifest.permissions, 'alarms'];
  }
  for (const dir of STATIC_DIRS) {
    if (!existsSync(new URL(dir, src))) throw new Error(`Missing src/${dir}${dir === 'icons' ? ' (run npm run icons)' : ''}`);
    await putDir(new URL(`${dir}/`, src), new URL(`${dir}/`, dist));
  }
  for (const [from, to] of Object.entries(STATIC_FILES)) await put(new URL(to, dist), await readFile(new URL(from, src)));
  // Publish the manifest last: all entry points must already exist when Chrome sees it.
  await put(new URL('manifest.json', dist), JSON.stringify(manifest, null, 2));
}

// Every write to the output folder goes through one queue, so nothing is ever written twice at once.
let queue = Promise.resolve();
const serial = (task) => {
  const next = queue.then(task);
  queue = watch ? next.catch((e) => console.error(`[build] ${e.message}`)) : next;
  return queue;
};

/** esbuild does not write: its output goes through put(), atomically, like every other file. */
const writeOutputs = (result) =>
  serial(async () => {
    for (const file of result.outputFiles ?? []) await put(pathToFileURL(file.path), file.contents);
  });

const shared = {
  bundle: true,
  write: false,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome121',
  loader: { '.css': 'text' },
  define: { __DEV__: String(watch) },
  legalComments: 'none',
  logLevel: 'info',
};

const builds = [
  {
    entryPoints: { content: 'src/content/main.ts', hub: 'src/hub/main.ts', frame: 'src/frame/main.ts', quiet: 'src/frame/quiet.ts' },
    format: 'iife',
  },
  { entryPoints: { popup: 'src/popup/popup.ts', background: 'src/background/main.ts' }, format: 'esm' },
].map((b) => ({ ...shared, ...b, outdir: outDir }));

// A loaded unpacked extension may live here. Never remove its files during a build.
await mkdir(dist, { recursive: true });

if (watch) {
  // The dev worker reloads the extension when build-id.txt changes. It is stamped only when no
  // build is running and every file has been written, so Chrome never loads a half-built folder.
  const gate = new BuildGate(builds.length);
  let stopping = false;
  let stampTimer;
  const stamp = () => {
    if (stopping) return;
    clearTimeout(stampTimer);
    stampTimer = setTimeout(() => {
      void serial(async () => {
        const snapshot = gate.snapshot();
        if (stopping || !snapshot) return;
        // esbuild strips types without checking cross-file contracts. Without
        // tsc an intermediate edit can publish missing callbacks/props.
        await typecheck();
        if (stopping || !gate.isCurrent(snapshot)) return;
        for (const file of snapshot.files) await put(pathToFileURL(file.path), file.contents);
        await copyStaticNow();
        // A source edit during publishing must wait for its own successful build.
        if (!stopping && gate.isCurrent(snapshot)) await put(new URL('build-id.txt', dist), String(Date.now()));
      });
    }, 250);
  };
  const output = (index) => ({
    name: 'atomic-output',
    setup(build) {
      build.onStart(() => {
        gate.start(index);
      });
      build.onEnd(async (result) => {
        gate.finish(index, result);
        stamp();
      });
    },
  });
  // Restart this process when its build configuration changes. Never keep a v1.0
  // entry-point list alive while reading a v1.1 manifest from disk.
  const contexts = [];
  for (const [index, b] of builds.entries()) {
    const context = await esbuild.context({ ...b, plugins: [output(index)] });
    contexts.push(context);
    await context.watch();
  }
  // Locales, rules, the manifest and the popup's HTML/CSS do not pass through esbuild.
  watchFs(src, { recursive: true }, (_, file) => file && !file.endsWith('.ts') && stamp());
  const configFiles = ['../package.json', '../package-lock.json', './build.mjs', './build-gate.mjs'];
  for (const path of configFiles) watchFs(new URL(path, import.meta.url), () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(stampTimer);
    // Refuse further publication, including any onEnd callback already in flight.
    gate.start(0);
    console.error('[build] Build configuration changed. Restart npm run dev before publishing again.');
    void Promise.all(contexts.map((context) => context.dispose())).then(() => process.exit(1));
  });
  console.log('Watching src/ ...');
} else {
  await typecheck();
  for (const result of await Promise.all(builds.map((b) => esbuild.build(b)))) await writeOutputs(result);
  await serial(copyStaticNow);
  await queue;
  // Only remove known obsolete development artifacts, never the loaded folder.
  for (const name of ['dev-reload.js', 'build-id.txt']) await rm(new URL(name, dist), { force: true });
  console.log(`Built ${outDir}`);
}
