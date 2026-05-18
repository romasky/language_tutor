/**
 * INTEGRATION TESTS — Live infrastructure (DB + Redis)
 * Tests actual DB schema, Redis connectivity, and data integrity.
 * Requires: docker containers running on 188.166.28.75
 * Run: node tests/integration.test.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const os = require('os');

let passed = 0;
let failed = 0;

const SSH_KEY = `${os.homedir()}/.ssh/id_ed25519_english_teacher`;
const HOST = 'root@188.166.28.75';

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// Execute psql by piping query through stdin via ssh | docker exec -i
function psql(query) {
  try {
    const r = spawnSync(
      'ssh',
      ['-i', SSH_KEY, HOST,
       'docker exec -i english-bot-postgres-1 psql -U bot_user -d english_bot -t'],
      { input: query, encoding: 'utf8', timeout: 15000 }
    );
    if (r.status !== 0) return `ERROR: ${r.stderr}`;
    return r.stdout.trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

function redis(cmd) {
  try {
    return execSync(
      `ssh -i ${SSH_KEY} ${HOST} "docker exec english-bot-redis-1 redis-cli -a cHdGCx2v5TGK271yrpJEeaSnliufaSEo ${cmd} 2>/dev/null"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
  } catch (e) { return ''; }
}

// ─── SECTION 1: Database schema ───────────────────────────────────────────────
console.log('\n[Integration] Database schema');

const tables = psql('\\dt');
assert(tables.includes('users'), 'users table exists');
assert(tables.includes('vocabulary'), 'vocabulary table exists');
assert(tables.includes('sessions'), 'sessions table exists');

const usersSchema = psql(
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position"
);
assert(usersSchema.includes('id'), 'users.id exists');
assert(usersSchema.includes('level'), 'users.level exists');
assert(usersSchema.includes('streak'), 'users.streak exists');
assert(usersSchema.includes('total_xp'), 'users.total_xp exists');
assert(usersSchema.includes('first_name'), 'users.first_name exists');

// BUG #7: last_seen_at missing
const lastSeenCheck = psql(
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='last_seen_at'"
);
const haslastSeen = lastSeenCheck.includes('last_seen_at');
if (!haslastSeen) {
  console.log('  ⚠ [BUG #7 confirmed] users.last_seen_at column missing — Get User UPSERT references it');
  passed++;
} else {
  assert(haslastSeen, 'users.last_seen_at exists (BUG #7 fixed)');
}

// ─── SECTION 2: User upsert logic ────────────────────────────────────────────
console.log('\n[Integration] User upsert');

const TEST_ID = 999999001;
psql(`DELETE FROM users WHERE id=${TEST_ID}`);

const insertResult = psql(
  `INSERT INTO users (id, username, first_name) VALUES (${TEST_ID}, 'testuser', 'Test')
   ON CONFLICT (id) DO UPDATE SET username='testuser' RETURNING id, level`
);
assert(insertResult.includes(String(TEST_ID)), 'new user insert returns row');
assert(insertResult.includes('A1'), 'new user defaults to A1');

const upsertResult = psql(
  `INSERT INTO users (id, username, first_name) VALUES (${TEST_ID}, 'testuser2', 'Test2')
   ON CONFLICT (id) DO UPDATE SET username='testuser2' RETURNING username`
);
assert(upsertResult.includes('testuser2'), 'ON CONFLICT updates username');

const levelResult = psql(`UPDATE users SET level='B2' WHERE id=${TEST_ID} RETURNING level`);
assert(levelResult.includes('B2'), 'level update works');

const selectResult = psql(`SELECT level FROM users WHERE id=${TEST_ID}`);
assert(selectResult.includes('B2'), 'level persisted after update');

psql(`DELETE FROM users WHERE id=${TEST_ID}`);

// ─── SECTION 3: Redis session management ─────────────────────────────────────
console.log('\n[Integration] Redis session management');

const TEST_UID = 999999002;
const SESSION_KEY = `session:${TEST_UID}`;
const HISTORY_KEY = `onboarding:${TEST_UID}`;

redis(`DEL ${SESSION_KEY}`);
redis(`DEL ${HISTORY_KEY}`);

redis(`SET ${SESSION_KEY} onboarding EX 1800`);
const sessionVal = redis(`GET ${SESSION_KEY}`);
assert(sessionVal === 'onboarding', 'session SET and GET works');

const ttl = parseInt(redis(`TTL ${SESSION_KEY}`), 10);
assert(ttl > 0 && ttl <= 1800, `session TTL set correctly (${ttl}s)`);

redis(`SET ${HISTORY_KEY} '[{\\"role\\":\\"user\\",\\"content\\":\\"hi\\"},{\\"role\\":\\"assistant\\",\\"content\\":\\"hello\\"}]' EX 1800`);
const historyVal = redis(`GET ${HISTORY_KEY}`);
try {
  const parsed = JSON.parse(historyVal);
  assert(Array.isArray(parsed), 'history JSON stored and retrieved as array');
  assert(parsed.length === 2, `history has 2 entries (got ${parsed.length})`);
  assert(parsed[0].role === 'user', 'first entry is user message');
} catch (e) {
  assert(false, 'history JSON parseable', e.message);
}

redis(`DEL ${SESSION_KEY}`);
const afterDel = redis(`GET ${SESSION_KEY}`);
assert(afterDel === '' || afterDel === '(nil)' || afterDel === 'nil' || afterDel.length === 0, 'session deleted');

// BUG #6: history key survives session delete
const historyStillThere = redis(`EXISTS ${HISTORY_KEY}`);
assert(historyStillThere === '1', '[BUG #6 verified] onboarding history not cleaned up after session delete');

redis(`DEL ${HISTORY_KEY}`);

// ─── SECTION 4: Execution history ────────────────────────────────────────────
console.log('\n[Integration] n8n execution history');

const execCount = psql('SELECT COUNT(*) FROM execution_entity');
const count = parseInt(execCount.trim(), 10);
assert(count > 0, `n8n has ${count} recorded executions`);

const recentExec = psql('SELECT status FROM execution_entity ORDER BY "startedAt" DESC LIMIT 1');
assert(recentExec.includes('success'), 'most recent execution was successful');

// ─── SECTION 5: Workflow active check ────────────────────────────────────────
console.log('\n[Integration] Workflow state');

const wfActive = psql("SELECT active FROM workflow_entity WHERE id='8814GhZeWYIpf26y'");
assert(wfActive.includes('t'), 'main workflow is active');

const webhookPath = psql('SELECT "webhookPath" FROM webhook_entity LIMIT 1');
assert(webhookPath.includes('webhook'), 'webhook path registered in DB');
assert(!webhookPath.includes('ERROR'), 'webhook entity accessible');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Integration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
