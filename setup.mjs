import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(root, 'sidebar-notes');
const installOnly = process.argv.includes('--install-only');
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function run(script, args, cwd = app) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', () => reject(new Error('Unable to start the dependency installer.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Command failed (${code}). Check the output above and try again.`)));
  });
}
async function findManager() {
  const binaryDir = path.dirname(process.execPath);
  const bases = [...new Set([binaryDir, path.resolve(binaryDir, '..'), path.resolve(binaryDir, '../lib')])];
  for (const base of bases) {
    const script = path.join(base, 'node_modules/pnpm/bin/pnpm.cjs');
    if (await exists(script)) return { script, args: ['install', '--frozen-lockfile'] };
  }
  for (const base of bases) {
    const script = path.join(base, 'node_modules/npm/bin/npm-cli.js');
    if (await exists(script)) return { script, args: ['exec', '--yes', '--package=pnpm@10.20.0', '--', 'pnpm', 'install', '--frozen-lockfile'] };
  }
  throw new Error('No bundled pnpm or npm was found. Run "pnpm install --frozen-lockfile" in sidebar-notes, then run "node setup.mjs" again. See INSTALL.md.');
}
async function dependenciesReady(dependencies) {
  try {
    for (const [name, version] of Object.entries(dependencies)) {
      const installed = JSON.parse(await readFile(path.join(app, 'node_modules', name, 'package.json'), 'utf8'));
      if (installed.version !== version) return false;
    }
    const require = createRequire(path.join(app, 'package.json'));
    require('qrcode');
    await access(path.join(app, 'node_modules/dashjs/dist/modern/umd/dash.mediaplayer.min.js'));
    return true;
  } catch { return false; }
}
try {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required. Use the Codex bundled Node runtime or install a current Node.js LTS release.');
  const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
  const digest = createHash('sha256').update(await readFile(path.join(app, 'pnpm-lock.yaml'))).digest('hex');
  const stamp = path.join(app, '.runtime/dependencies.sha256');
  let previous = '';
  try { previous = await readFile(stamp, 'utf8'); } catch {}
  const ready = await dependenciesReady(manifest.dependencies);
  if (!ready || (previous && previous !== digest)) {
    console.log('Installing the locked dependencies for Sidebar Notes...');
    const manager = await findManager();
    await run(manager.script, manager.args);
    if (!await dependenciesReady(manifest.dependencies)) throw new Error('Dependency validation failed. Run the installer again.');
  } else console.log('Dependencies are ready.');
  await mkdir(path.dirname(stamp), { recursive: true });
  await writeFile(stamp, digest);
  if (!installOnly) await run(path.join(app, 'launch.mjs'), []);
  console.log(installOnly ? 'Installation complete.' : 'Ready. Open http://127.0.0.1:17329/ in the Codex browser.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
