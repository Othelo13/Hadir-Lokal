import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertPrivateDataDirectory, isSafeStaticFile } from '../server/storage-paths.mjs';
import { resolveRuntimeConfig } from '../server/runtime-config.mjs';

test('private storage cannot be placed in the public dist directory', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hadir-storage-'));
  try {
    const dist = path.join(root, 'dist');
    const privateData = path.join(root, 'private-data');
    const exposedData = path.join(dist, 'data');
    mkdirSync(dist);
    mkdirSync(privateData);
    mkdirSync(exposedData);
    assert.doesNotThrow(() => assertPrivateDataDirectory(privateData, dist));
    assert.throws(() => assertPrivateDataDirectory(exposedData, dist), /dist/);
    const linked = path.join(dist, 'linked-data');
    try {
      symlinkSync(privateData, linked, 'junction');
      assert.doesNotThrow(() => assertPrivateDataDirectory(linked, dist));
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('static file serving refuses symlinks outside public build', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hadir-static-'));
  try {
    const dist = path.join(root, 'dist');
    mkdirSync(dist);
    const publicFile = path.join(dist, 'index.html');
    const privateFile = path.join(root, 'private.txt');
    writeFileSync(publicFile, 'public');
    writeFileSync(privateFile, 'secret');
    assert.equal(isSafeStaticFile(dist, publicFile), true);
    const linked = path.join(dist, 'linked.txt');
    try {
      symlinkSync(privateFile, linked, 'file');
      assert.equal(isSafeStaticFile(dist, linked), false);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('development server cannot bind publicly', () => {
  assert.throws(() => resolveRuntimeConfig({ HOST: '0.0.0.0', HADIR_DEV: '1' }), /pengembangan/);
});
