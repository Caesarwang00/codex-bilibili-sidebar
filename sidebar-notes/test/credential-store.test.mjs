import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCredentialStore } from '../credential-store.mjs';

test('Windows DPAPI persists only ciphertext and can restore in a new helper process', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sidebar-notes-test-'));
  const filePath = path.join(directory, 'session.dpapi');
  t.after(async () => { await unlink(filePath).catch(() => {}); await rmdir(directory); });
  const store = createCredentialStore({ filePath });
  assert.equal(await store.load(), null);
  const value = { version: 1, cookies: [['SESSDATA', 'synthetic-secret-for-tests']], expiresAt: null };
  await store.save(value);
  const encrypted = await readFile(filePath);
  assert.equal(encrypted.includes(Buffer.from('synthetic-secret-for-tests')), false);
  assert.equal(encrypted.includes(Buffer.from('SESSDATA')), false);
  assert.deepEqual(await createCredentialStore({ filePath }).load(), value);
  await store.save({ ...value, expiresAt: 12345 });
  assert.equal((await store.load()).expiresAt, 12345);
  await writeFile(filePath, 'invalid encrypted data');
  await assert.rejects(store.load(), /Windows/);
  await store.clear();
  assert.equal(await store.load(), null);
});
