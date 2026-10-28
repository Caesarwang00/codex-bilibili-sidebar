import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, DEFAULT_PORT } from './server.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const origin = `http://127.0.0.1:${DEFAULT_PORT}`;
async function health() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok || (await response.json()).app !== APP_ID) throw new Error('Port is occupied by another application.');
    return true;
  } catch (error) {
    if (error.message === 'Port is occupied by another application.') throw error;
    return false;
  }
}

if (process.argv[2] === 'stop') {
  if (await health()) {
    const session = await fetch(`${origin}/api/session`).then(response => response.json());
    const response = await fetch(`${origin}/api/stop`, { method: 'POST', headers: { Origin: origin, 'X-Session-Token': session.token } });
    if (!response.ok) throw new Error('Unable to stop the local service.');
  }
  console.log('Local service stopped.');
} else {
  if (!await health()) {
    const runtime = path.join(root, '.runtime');
    mkdirSync(runtime, { recursive: true });
    const log = openSync(path.join(runtime, 'server.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    closeSync(log);
    child.unref();
    let started = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      if (await health()) { started = true; break; }
    }
    if (!started) throw new Error('Local service did not start. See .runtime/server.log.');
  }
  console.log(`Local: ${origin}`);
}
