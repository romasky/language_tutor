/**
 * INTEGRATION TESTS — Voice Dictation (Whisper STT)
 * Tests: DB schema for attempts table, Redis dictation keys, workflow node wiring.
 * Requires: docker containers running on 188.166.28.75
 * Run: node tests/integration_dictation.test.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
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

// ─── SECTION 1: attempts table schema ────────────────────────────────────────
console.log('\n[Integration] attempts table schema');

const tables = psql('\\dt');
assert(tables.includes('attempts'), 'attempts table exists');

const attemptsSchema = psql(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='attempts' ORDER BY ordinal_position"
);
assert(attemptsSchema.includes('id'),         'attempts.id exists');
assert(attemptsSchema.includes('user_id'),    'attempts.user_id exists');
assert(attemptsSchema.includes('type'),       'attempts.type exists');
assert(attemptsSchema.includes('prompt'),     'attempts.prompt exists');
assert(attemptsSchema.includes('response'),   'attempts.response exists');
assert(attemptsSchema.includes('score'),      'attempts.score exists');
assert(attemptsSchema.includes('details'),    'attempts.details exists');
assert(attemptsSchema.includes('created_at'), 'attempts.created_at exists');

// Check indexes
const indexes = psql(
  "SELECT indexname FROM pg_indexes WHERE tablename='attempts'"
);
assert(indexes.includes('idx_attempts_user'),      'idx_attempts_user index exists');
assert(indexes.includes('idx_attempts_type_date'), 'idx_attempts_type_date index exists');

// Check score constraint
const scoreConstraint = psql(
  "SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='attempts' AND constraint_type='CHECK'"
);
assert(scoreConstraint.length > 0 && !scoreConstraint.includes('ERROR'), 'score CHECK constraint exists');

// ─── SECTION 2: attempts CRUD ────────────────────────────────────────────────
console.log('\n[Integration] attempts CRUD');

const TEST_ID = 999999003;
psql(`DELETE FROM users WHERE id=${TEST_ID}`);
psql(`INSERT INTO users (id, username, first_name) VALUES (${TEST_ID}, 'dicttest', 'Test')`);

// Insert a dictation attempt
const insertAttempt = psql(`
  INSERT INTO attempts (user_id, type, prompt, response, score, details)
  VALUES (
    ${TEST_ID},
    'dictation',
    $sentence$I like coffee in the morning$sentence$,
    $transcript$i like coffee in the morning$transcript$,
    100,
    '{"targetLang":"en","level":"A1"}'::jsonb
  ) RETURNING id, score;
`);
assert(insertAttempt.includes('100'), 'attempt insert returns score=100');
assert(!insertAttempt.includes('ERROR'), 'attempt insert no error');

// Retrieve attempt
const fetchAttempt = psql(`SELECT type, score FROM attempts WHERE user_id=${TEST_ID} LIMIT 1`);
assert(fetchAttempt.includes('dictation'), 'attempt type=dictation retrieved');
assert(fetchAttempt.includes('100'), 'attempt score=100 retrieved');

// Score constraint: score > 100 must fail
const badScore = psql(`
  INSERT INTO attempts (user_id, type, score)
  VALUES (${TEST_ID}, 'dictation', 150)
`);
assert(badScore.includes('ERROR') || badScore.includes('violates'), 'score > 100 rejected by CHECK constraint');

// Score constraint: score < 0 must fail
const negScore = psql(`
  INSERT INTO attempts (user_id, type, score)
  VALUES (${TEST_ID}, 'dictation', -1)
`);
assert(negScore.includes('ERROR') || negScore.includes('violates'), 'score < 0 rejected by CHECK constraint');

// Dollar-quoting works for apostrophes (important for real speech transcripts)
const apostropheAttempt = psql(`
  INSERT INTO attempts (user_id, type, prompt, response, score)
  VALUES (
    ${TEST_ID},
    'dictation',
    $s$It's a test sentence$s$,
    $s$it's a test sentence$s$,
    95
  ) RETURNING id;
`);
assert(!apostropheAttempt.includes('ERROR'), "dollar-quoting handles apostrophes safely");

// CASCADE delete: deleting user removes attempts
psql(`DELETE FROM users WHERE id=${TEST_ID}`);
const afterDelete = psql(`SELECT COUNT(*) FROM attempts WHERE user_id=${TEST_ID}`);
assert(afterDelete.trim() === '0', 'cascade delete removes attempts when user deleted');

// ─── SECTION 3: Redis dictation keys ─────────────────────────────────────────
console.log('\n[Integration] Redis dictation keys');

const TEST_UID = 999999004;
const DICT_KEY = `dictation:${TEST_UID}`;
const SESSION_KEY = `session:${TEST_UID}`;

redis(`DEL ${DICT_KEY}`);
redis(`DEL ${SESSION_KEY}`);

// Store dictation state
const dictState = JSON.stringify({ sentence: 'Hello world', targetLang: 'en', level: 'A1', createdAt: Date.now() });
redis(`SET ${DICT_KEY} '${dictState}' EX 600`);

const fetchedState = redis(`GET ${DICT_KEY}`);
try {
  const parsed = JSON.parse(fetchedState);
  assert(parsed.sentence === 'Hello world', 'dictation sentence stored and retrieved');
  assert(parsed.targetLang === 'en', 'targetLang stored in dictation state');
  assert(parsed.level === 'A1', 'level stored in dictation state');
  assert(typeof parsed.createdAt === 'number', 'createdAt is a number');
} catch (e) {
  assert(false, 'dictation state JSON parseable', e.message);
}

// TTL check
const ttl = parseInt(redis(`TTL ${DICT_KEY}`), 10);
assert(ttl > 0 && ttl <= 600, `dictation key TTL set (${ttl}s)`);

// Session key
redis(`SET ${SESSION_KEY} dictation EX 600`);
assert(redis(`GET ${SESSION_KEY}`) === 'dictation', 'session set to dictation');

// Cleanup
redis(`DEL ${DICT_KEY}`);
redis(`DEL ${SESSION_KEY}`);
const afterCleanup = redis(`EXISTS ${DICT_KEY}`);
assert(afterCleanup === '0', 'dictation key cleaned up');
const sessionAfterCleanup = redis(`EXISTS ${SESSION_KEY}`);
assert(sessionAfterCleanup === '0', 'session key cleaned up');

// Key isolation: dictation key ≠ quiz key
const QUIZ_KEY = `quiz:${TEST_UID}`;
redis(`SET ${QUIZ_KEY} test EX 10`);
assert(redis(`GET ${DICT_KEY}`) !== 'test', 'dictation key does not collide with quiz key');
redis(`DEL ${QUIZ_KEY}`);

// ─── SECTION 4: Workflow JSON structure ──────────────────────────────────────
console.log('\n[Integration] Workflow JSON node wiring');

const wf = JSON.parse(fs.readFileSync('n8n/workflows/01_webhook_router.json', 'utf8'));
const nodes = wf.nodes || [];
const conns = wf.connections || {};

const nodeNames = new Set(nodes.map(n => n.name));

// All required dictation nodes present
const requiredNodes = [
  'Is Dictation Start?',
  'Generate Dictation Sentence',
  'Send Dictation Prompt',
  'Store Dictation Sentence',
  'Set Dictation Session',
  'Is Dictation?',
  'Send Dictation Thinking',
  'Get File Path',
  'Download Voice File',
  'Whisper STT',
  'Get Dictation State',
  'Evaluate Dictation',
  'Claude Grade Dictation',
  'Send Dictation Result',
  'XP Dictation',
  'Save Dictation Attempt',
  'Clear Dictation Session',
  'Clear Dictation Sentence',
];
requiredNodes.forEach(name => {
  assert(nodeNames.has(name), `node "${name}" exists in workflow`);
});

// Router routes /dictation to dictation_start
const routerNode = nodes.find(n => n.name === 'Router');
assert(routerNode !== undefined, 'Router node exists');
const routerCode = routerNode?.parameters?.jsCode || '';
assert(routerCode.includes("text === '/dictation'"), "Router handles /dictation command");
assert(routerCode.includes("cbData === 'menu_dictation'"), "Router handles menu_dictation button");
assert(routerCode.includes("cbData === 'dictation_next'"), "Router handles dictation_next button");
assert(routerCode.includes("'dictation_start'"), "Router sets route: dictation_start");
assert(routerCode.includes("session === 'dictation'"), "Router checks dictation session");
assert(routerCode.includes("'dictation_response'"), "Router sets route: dictation_response");
assert(routerCode.includes("msg.voice?.file_id"), "Router checks voice file_id for dictation guard");

// Menu has dictation button
const menuNode = nodes.find(n => n.name === 'Send Menu');
const menuBody = menuNode?.parameters?.body || '';
assert(menuBody.includes('menu_dictation'), 'Send Menu has dictation button callback');
assert(menuBody.includes('🎤'), 'Send Menu has dictation emoji');

// IF chain: Is Onboarding? FALSE → Is Dictation Start?
const onboardingFalse = conns['Is Onboarding?']?.main?.[1]?.[0]?.node;
assert(onboardingFalse === 'Is Dictation Start?', 'Is Onboarding? FALSE → Is Dictation Start?');

// Is Dictation Start? TRUE → Generate Dictation Sentence
const dictStartTrue = conns['Is Dictation Start?']?.main?.[0]?.[0]?.node;
assert(dictStartTrue === 'Generate Dictation Sentence', 'Is Dictation Start? TRUE → Generate Dictation Sentence');

// Is Dictation Start? FALSE → Is Dictation?
const dictStartFalse = conns['Is Dictation Start?']?.main?.[1]?.[0]?.node;
assert(dictStartFalse === 'Is Dictation?', 'Is Dictation Start? FALSE → Is Dictation?');

// Is Dictation? FALSE → Get Grammar History (grammar fallback preserved)
const dictFalse = conns['Is Dictation?']?.main?.[1]?.[0]?.node;
assert(dictFalse === 'Get Grammar History', 'Is Dictation? FALSE → Get Grammar History (grammar fallback intact)');

// Voice pipeline chain
const chainChecks = [
  ['Send Dictation Thinking', 'Get File Path'],
  ['Get File Path',           'Download Voice File'],
  ['Download Voice File',     'Whisper STT'],
  ['Whisper STT',             'Get Dictation State'],
  ['Get Dictation State',     'Evaluate Dictation'],
  ['Evaluate Dictation',      'Claude Grade Dictation'],
  ['Claude Grade Dictation',  'Send Dictation Result'],
  ['Send Dictation Result',   'XP Dictation'],
  ['XP Dictation',            'Save Dictation Attempt'],
  ['Save Dictation Attempt',  'Clear Dictation Session'],
  ['Clear Dictation Session', 'Clear Dictation Sentence'],
];
chainChecks.forEach(([from, to]) => {
  const next = conns[from]?.main?.[0]?.[0]?.node;
  assert(next === to, `${from} → ${to}`);
});

// A flow chain
const aChainChecks = [
  ['Generate Dictation Sentence', 'Send Dictation Prompt'],
  ['Send Dictation Prompt',       'Store Dictation Sentence'],
  ['Store Dictation Sentence',    'Set Dictation Session'],
];
aChainChecks.forEach(([from, to]) => {
  const next = conns[from]?.main?.[0]?.[0]?.node;
  assert(next === to, `Flow A: ${from} → ${to}`);
});

// Whisper STT uses targetLang
const whisperNode = nodes.find(n => n.name === 'Whisper STT');
const whisperLang = JSON.stringify(whisperNode?.parameters?.bodyParameters || {});
assert(whisperLang.includes('targetLang'), 'Whisper STT uses targetLang (not hardcoded "en")');

// Whisper STT model = whisper-1
assert(whisperLang.includes('whisper-1'), 'Whisper STT uses whisper-1 model');

// Claude Grade uses haiku (not expensive sonnet)
const gradeNode = nodes.find(n => n.name === 'Evaluate Dictation');
const gradeCode = gradeNode?.parameters?.jsCode || '';
assert(gradeCode.includes('claude-haiku-4-5'), 'Grade Dictation uses claude-haiku-4-5');

// Redis TTL checks
const storeSentenceNode = nodes.find(n => n.name === 'Store Dictation Sentence');
assert(storeSentenceNode?.parameters?.ttl === 600, 'Store Dictation Sentence TTL = 600s');

const setSessionNode = nodes.find(n => n.name === 'Set Dictation Session');
assert(setSessionNode?.parameters?.ttl === 600, 'Set Dictation Session TTL = 600s');

// XP amount
const xpNode = nodes.find(n => n.name === 'XP Dictation');
const xpQuery = xpNode?.parameters?.query || '';
assert(xpQuery.includes('+ 15'), 'XP Dictation awards 15 XP');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Dictation integration: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
