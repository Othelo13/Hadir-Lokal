import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from '../server/runtime-config.mjs';

const validToken = '897b1c4d3e9a6f125a3d4c8b76e10f2a9c5b7d3e6f8a1b2c4d5e7f901234abcd';

test('localhost ignores stale public origin without requiring setup token', () => {
  const config = resolveRuntimeConfig({
    HOST: '127.0.0.1', PORT: '5197',
    HADIR_PUBLIC_ORIGIN: 'https://old.trycloudflare.com',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.publicOrigin, null);
  assert.equal(config.ignoredPublicOrigin, true);
});

test('default local configuration works without hosting variables', () => {
  const config = resolveRuntimeConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5197);
  assert.equal(config.publicOrigin, null);
});

test('public mode requires an explicit HTTPS origin and strong setup token', () => {
  assert.throws(() => resolveRuntimeConfig({ HOST: '0.0.0.0' }), /HADIR_PUBLIC_ORIGIN/);
  assert.throws(() => resolveRuntimeConfig({
    HOST: '0.0.0.0', HADIR_PUBLIC_ORIGIN: 'http://hadir.example.org',
    HADIR_SETUP_TOKEN: validToken,
  }), /HTTPS/);
  assert.throws(() => resolveRuntimeConfig({
    HOST: '0.0.0.0', HADIR_PUBLIC_ORIGIN: 'https://hadir.example.org',
    HADIR_SETUP_TOKEN: 'a'.repeat(64),
  }), /HADIR_SETUP_TOKEN/);
  const config = resolveRuntimeConfig({
    HOST: '0.0.0.0',
    HADIR_PUBLIC_ORIGIN: 'https://hadir.example.org',
    HADIR_SETUP_TOKEN: validToken,
  });
  assert.equal(config.publicOrigin.origin, 'https://hadir.example.org');
});

test('reject unsupported bind hosts and invalid ports', () => {
  assert.throws(() => resolveRuntimeConfig({ HOST: '192.168.1.7' }), /HOST/);
  assert.throws(() => resolveRuntimeConfig({ PORT: '99999' }), /PORT/);
});
