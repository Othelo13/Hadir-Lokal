import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildServer } from './build-server.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let child,
  timer,
  closing = false,
  restarting = false,
  ignoreGeneratedUntil = 0;
function compile() {
  ignoreGeneratedUntil = Date.now() + 750;
  buildServer();
}
function start() {
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, HADIR_DEV: '1' },
  });
  child.once('error', (error) => {
    console.error(error.message);
    close();
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    if (!closing && !restarting) {
      console.log('Server berhenti. Perbaiki kode server untuk memulai ulang, atau tekan Ctrl+C.');
    }
  });
}
async function restart() {
  if (closing) return;
  if (restarting) {
    schedule();
    return;
  }
  try {
    compile();
  } catch (error) {
    console.error(error.message);
    return;
  }
  restarting = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
  }
  if (!closing) {
    console.log('Memulai ulang server setelah perubahan kode…');
    start();
  }
  restarting = false;
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(restart, 200);
}
compile();
const watcher = watch(new URL('../server/', import.meta.url), (_event, filename) => {
  if (!filename || !/[.](mjs|ts|sql)$/.test(filename)) return;
  if (filename === 'api.mjs' && Date.now() < ignoreGeneratedUntil) return;
  schedule();
});
function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  watcher.close();
  if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, close);
start();
