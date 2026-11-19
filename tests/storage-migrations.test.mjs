import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const storageUrl = new URL('../server/storage.mjs', import.meta.url).href;
const baseline = readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hadir-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function startStorage(dir) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { sqlite } = await import(${JSON.stringify(storageUrl)}); sqlite.close();`], {
    env: { ...process.env, HOST:'127.0.0.1', HADIR_DATA_DIR:dir },
    encoding:'utf8', timeout:15000,
  });
}
function open(dir) {
  const db = new DatabaseSync(path.join(dir,'hadir.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}
function versions(db) {
  return db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id);
}
const expected = ['001-absence-domain','002-member-schedule-history'];
function successful(result) {
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
}

test('fresh storage startup applies both migrations and is restart-safe',t=>{
  const dir = fixture(t);
  successful(startStorage(dir));
  let db = open(dir);
  const markers = db.prepare('SELECT * FROM schema_migrations ORDER BY id').all();
  assert.deepEqual(versions(db),expected);
  assert.equal(db.prepare('SELECT count(*) n FROM member_history').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM schedule_history').get().n,0);
  db.close();
  successful(startStorage(dir));
  db = open(dir);
  try {
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY id').all(),markers);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  } finally { db.close(); }
});

test('legacy on-disk storage upgrade preserves accounts, attendance, cancellations and photos',t=>{
  const dir = fixture(t);
  let db = open(dir);
  db.exec(baseline);
  db.exec(`INSERT INTO members VALUES('a@example.invalid','a','Member A','employee',1,'dummy');
    INSERT INTO config VALUES(1,'[1,2,3,4,5,6]','09:00','17:00','Asia/Makassar',1);
    INSERT INTO records VALUES('r','a','a@example.invalid','Member A','2026-11-19','in','2026-11-19T00:00:00Z','ontime','selfies/a/r.jpg','qr','pending');
    INSERT INTO attendance_cancellations (id,user_id,email,name,date,kind,time,reason,cancelled_by,cancelled_at)
    VALUES('c','a','a@example.invalid','Member A','2026-11-18','in','2026-11-18T00:00:00Z','Example','admin','2026-11-18T01:00:00Z');`);
  const tables=['members','config','records','attendance_cancellations'];
  const snapshot=Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT * FROM '+name).all()]));
  db.close();
  const photo=path.join(dir,'selfies','a','r.jpg');
  mkdirSync(path.dirname(photo),{recursive:true});
  writeFileSync(photo,'dummy legacy photo');
  successful(startStorage(dir));
  successful(startStorage(dir));
  db = open(dir);
  try {
    for(const name of tables) assert.deepEqual(db.prepare('SELECT * FROM '+name).all(),snapshot[name]);
    assert.equal(readFileSync(photo,'utf8'),'dummy legacy photo');
    assert.deepEqual(versions(db),expected);
    assert.equal(db.prepare('SELECT count(*) n FROM member_history').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM schedule_history').get().n,1);
    db.exec("UPDATE members SET name='Updated' WHERE user_id='a'");
    assert.equal(db.prepare('SELECT count(*) n FROM member_history').get().n,2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { db.close(); }
});

test('storage startup fails closed on an incompatible migration and resumes after repair',t=>{
  const dir = fixture(t);
  let db = open(dir);
  db.exec(baseline);
  db.exec('CREATE TABLE member_history(incompatible_column TEXT)');
  db.close();
  const failed = startStorage(dir);
  assert.ifError(failed.error);
  assert.notEqual(failed.status,0);
  db = open(dir);
  try {
    assert.deepEqual(versions(db),['001-absence-domain']);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='schedule_history'").get().n,0);
    // Deliberately malformed test-only table; not a production recovery procedure.
    db.exec('DROP TABLE member_history');
  } finally { db.close(); }
  successful(startStorage(dir));
  db = open(dir);
  try {
    assert.deepEqual(versions(db),expected);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  } finally { db.close(); }
});
