import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// The fixed command contains no credentials. Input and output use private pipes.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $entropyBytes = [Text.Encoding]::UTF8.GetBytes('SidebarNotes.Bilibili.Session.v1')
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($env:SIDEBAR_NOTES_CRYPTO_MODE -eq 'protect') {
    $outputBytes = [Security.Cryptography.ProtectedData]::Protect($inputBytes, $entropyBytes, $scope)
  } elseif ($env:SIDEBAR_NOTES_CRYPTO_MODE -eq 'unprotect') {
    $outputBytes = [Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $entropyBytes, $scope)
  } else { throw 'Invalid operation' }
  [Console]::Out.Write([Convert]::ToBase64String($outputBytes))
} catch { [Console]::Error.Write('Windows credential protection failed.'); exit 1 }
`;
const storeError = () => new Error('无法访问 Windows 加密的登录存储。');
export function protectWithWindows(input, mode) {
  if (process.platform !== 'win32' || !['protect', 'unprotect'].includes(mode)) return Promise.reject(storeError());
  return new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SIDEBAR_NOTES_CRYPTO_MODE: mode }
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(storeError()); }, 10_000);
    child.stdout.on('data', data => {
      output += data;
      if (output.length > 96_000) { child.kill(); reject(storeError()); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(storeError()); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) { reject(storeError()); return; }
      resolve(Buffer.from(output, 'base64'));
    });
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

export function createCredentialStore({ filePath, crypt = protectWithWindows } = {}) {
  const file = filePath || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '.', 'AppData/Local'), 'SidebarNotes', 'bilibili-session.dpapi');
  return {
    async load() {
      let encrypted;
      try { encrypted = await readFile(file); }
      catch (error) { if (error.code === 'ENOENT') return null; throw storeError(); }
      if (encrypted.length > 64_000) throw storeError();
      let plain;
      try { plain = await crypt(encrypted, 'unprotect'); return JSON.parse(plain.toString('utf8')); }
      catch { throw storeError(); }
      finally { plain?.fill(0); }
    },
    async save(value) {
      const plain = Buffer.from(JSON.stringify(value), 'utf8');
      let encrypted;
      try { encrypted = await crypt(plain, 'protect'); }
      catch { throw storeError(); }
      finally { plain.fill(0); }
      const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(temp, encrypted, { flag: 'wx', mode: 0o600 });
        await rename(temp, file);
      } catch { throw storeError(); }
      finally { await unlink(temp).catch(() => {}); }
    },
    async clear() {
      try { await unlink(file); }
      catch (error) { if (error.code !== 'ENOENT') throw storeError(); }
    }
  };
}
