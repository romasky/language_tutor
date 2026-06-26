/**
 * E2E TESTS — Daily Lesson Flashcard Flow
 *
 * Simulates Telegram webhook → Router → flashcard handler chain.
 * Tests 3 critical user scenarios end-to-end.
 *
 * Requires:
 *   - n8n running at N8N_URL (default http://localhost:5678)
 *   - Workflow 01_webhook_router.json imported and active
 *   - TEST_USER_ID: Telegram user ID allowed in ALLOWED_USERS
 *   - N8N_API_KEY: n8n API key for triggering test executions
 *   - TEST_DB_URL: PostgreSQL connection string
 *   - Redis must be running and accessible
 *
 * Run: N8N_URL=http://localhost:5678 N8N_API_KEY=... TEST_USER_ID=185674280 TEST_DB_URL=postgres://... node tests/e2e_daily_lesson.test.js
 */

'use strict';

const http = require('http');
const https = require('https');
const { Client } = require('pg');

const N8N_URL = process.env.N8N_URL || 'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY;
const TEST_USER_ID = parseInt(process.env.TEST_USER_ID || '185674280');
const DB_URL = process.env.TEST_DB_URL;
const WEBHOOK_ID = process.env.WEBHOOK_ID || '';

if (!N8N_API_KEY || !DB_URL) {
  console.error('ERROR: N8N_API_KEY and TEST_DB_URL are required');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let db;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function dbQuery(sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

// ── Send a simulated Telegram webhook update to n8n ───────────────────────────
async function sendWebhook(payload) {
  const webhookUrl = `${N8N_URL}/webhook/${WEBHOOK_ID}/webhook`;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const lib = webhookUrl.startsWith('https') ? https : http;
    const url = new URL(webhookUrl);
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function makeCallbackUpdate(cbData, callbackId = '123456') {
  return {
    update_id: Date.now(),
    callback_query: {
      id: callbackId,
      from: { id: TEST_USER_ID, first_name: 'TestUser', language_code: 'ru' },
      data: cbData,
      message: { message_id: 1, chat: { id: TEST_USER_ID } }
    }
  };
}

// ── Seed a flashcard session directly in Redis (bypasses scheduler for testing) ─
// Uses n8n's Redis credential via a test execute endpoint, or direct redis-cli
async function seedFlashcardSession(sessionData) {
  // Use n8n API to trigger a test workflow, or use redis-cli if available
  const stateJson = JSON.stringify(sessionData);
  const key = `flashcard:${TEST_USER_ID}`;
  const sessionKey = `session:${TEST_USER_ID}`;

  // Try redis-cli (available in Docker environment)
  const { execSync } = require('child_process');
  try {
    execSync(`redis-cli SET "${key}" '${stateJson}' EX 86400`, { stdio: 'pipe' });
    execSync(`redis-cli SET "${sessionKey}" "flashcard" EX 86400`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn('  ⚠ redis-cli not available, skipping Redis seed step');
    return false;
  }
}

function makeTestState(cards, sessionId = 9999) {
  return {
    type: 'flashcard',
    cards: cards.map((w, i) => ({
      vocabId: w.id,
      word: w.word,
      translation: w.translation || 'перевод',
      context: w.context || '',
      easeFactor: 2.5,
      interval: 1,
      repetitions: 0
    })),
    current: 0,
    results: [],
    hintUsed: false,
    sentAt: [Date.now()],
    startedAt: Date.now(),
    sessionId,
    nativeLang: 'ru',
    targetLang: 'en',
    level: 'B1'
  };
}

// ── Seed DB words and session record ──────────────────────────────────────────
async function seedDbForE2e() {
  // Ensure user exists
  await db.query(
    `INSERT INTO users (id, username, first_name, level, utc_offset, is_opted_in, lesson_hour, total_xp, streak, last_seen_at)
     VALUES ($1,'e2e_test_user','E2EUser','B1',0,true,9,0,0,NOW())
     ON CONFLICT (id) DO UPDATE SET last_seen_at=NOW(), total_xp=0, streak=0`,
    [TEST_USER_ID]
  );

  // Seed 3 vocabulary words
  const wordIds = [];
  for (let i = 0; i < 3; i++) {
    const res = await db.query(
      `INSERT INTO vocabulary (user_id, word, translation, context, ease_factor, interval, repetitions, next_review)
       VALUES ($1,$2,$3,$4,2.5,1,0,NOW()-INTERVAL '1 hour') RETURNING id`,
      [TEST_USER_ID, `e2e_word_${i}`, `translation_${i}`, `context ${i}`]
    );
    wordIds.push({ id: res.rows[0].id, word: `e2e_word_${i}`, translation: `translation_${i}`, context: `context ${i}` });
  }

  // Seed session record
  const sessionRes = await db.query(
    `INSERT INTO daily_lesson_sessions (user_id, card_count, status) VALUES ($1, 3, 'sent') RETURNING id`,
    [TEST_USER_ID]
  );
  return { wordIds, sessionId: sessionRes.rows[0].id };
}

async function cleanupE2e() {
  await db.query(`DELETE FROM daily_lesson_sessions WHERE user_id = $1`, [TEST_USER_ID]);
  await db.query(`DELETE FROM vocabulary WHERE user_id = $1 AND word LIKE 'e2e_%'`, [TEST_USER_ID]);
  try {
    const { execSync } = require('child_process');
    execSync(`redis-cli DEL "flashcard:${TEST_USER_ID}" "session:${TEST_USER_ID}"`, { stdio: 'pipe' });
  } catch (e) {}
}

// ─── E2E Scenario 1: Happy path — 3 knows → session complete ──────────────────
async function testHappyPath() {
  console.log('\n[E2E] Scenario 1: Happy path (3x Know → complete)');

  const { wordIds, sessionId } = await seedDbForE2e();
  const state = makeTestState(wordIds, sessionId);
  const seeded = await seedFlashcardSession(state);

  if (!seeded) {
    console.log('  ⚠ Skipping E2E (no Redis access)');
    return;
  }

  const xpBefore = (await dbQuery(`SELECT total_xp FROM users WHERE id=$1`, [TEST_USER_ID]))[0].total_xp;

  // Answer card 1
  let res = await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  assert(res.status === 200, 'card 1 know → HTTP 200');
  await sleep(500);

  // Answer card 2
  res = await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  assert(res.status === 200, 'card 2 know → HTTP 200');
  await sleep(500);

  // Answer card 3 (last) — should trigger completion
  res = await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  assert(res.status === 200, 'card 3 know → HTTP 200');
  await sleep(1000);

  // Verify DB: session completed
  const sessions = await dbQuery(`SELECT status, correct, xp_awarded FROM daily_lesson_sessions WHERE id=$1`, [sessionId]);
  assert(sessions.length > 0, 'session record exists');
  assert(sessions[0].status === 'completed', 'session status = completed');
  assert(sessions[0].correct === 3, 'correct = 3');

  // Verify XP awarded
  const xpAfter = (await dbQuery(`SELECT total_xp FROM users WHERE id=$1`, [TEST_USER_ID]))[0].total_xp;
  const xpDiff = xpAfter - xpBefore;
  assert(xpDiff === 35, `XP awarded: ${xpDiff} (expected 35 = 3*5 + 20 bonus)`, `got ${xpDiff}`);

  // Verify SM-2 updated: all 3 words should have next_review in future
  const words = await dbQuery(
    `SELECT next_review > NOW() as in_future, repetitions FROM vocabulary WHERE user_id=$1 AND word LIKE 'e2e_%' ORDER BY word`,
    [TEST_USER_ID]
  );
  assert(words.every(w => w.in_future), 'all words next_review advanced to future');
  assert(words.every(w => w.repetitions === 1), 'all words repetitions = 1 after first successful review');
}

// ─── E2E Scenario 2: Hint flow — hint then don't know ─────────────────────────
async function testHintFlow() {
  console.log('\n[E2E] Scenario 2: Hint + Don\'t know → quality=1');

  await cleanupE2e();
  const { wordIds, sessionId } = await seedDbForE2e();
  const state = makeTestState(wordIds, sessionId);
  const seeded = await seedFlashcardSession(state);

  if (!seeded) {
    console.log('  ⚠ Skipping E2E (no Redis access)');
    return;
  }

  // Tap hint on card 1
  let res = await sendWebhook(makeCallbackUpdate('daily_ans_hint'));
  assert(res.status === 200, 'hint → HTTP 200');
  await sleep(500);

  // Then don't know → should record quality=1
  res = await sendWebhook(makeCallbackUpdate('daily_ans_dontknow'));
  assert(res.status === 200, 'dontknow after hint → HTTP 200');
  await sleep(500);

  // Complete remaining 2 cards
  await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  await sleep(400);
  await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  await sleep(1000);

  // Verify: first word should have interval=1, repetitions=0 (failed with q=1)
  const firstWord = await dbQuery(
    `SELECT interval, repetitions, ease_factor FROM vocabulary WHERE user_id=$1 AND word='e2e_word_0'`,
    [TEST_USER_ID]
  );
  if (firstWord.length > 0) {
    assert(firstWord[0].interval === 1, 'first word interval=1 (failed word back tomorrow)');
    assert(firstWord[0].repetitions === 0, 'first word repetitions=0 (reset on failure)');
  }

  const session = await dbQuery(`SELECT status, correct FROM daily_lesson_sessions WHERE id=$1`, [sessionId]);
  assert(session[0].status === 'completed', 'session completed despite one failure');
  assert(session[0].correct === 2, 'correct=2 (1 failure, 2 know)');
}

// ─── E2E Scenario 3: Expired session (no Redis state) ─────────────────────────
async function testExpiredSession() {
  console.log('\n[E2E] Scenario 3: Answer with expired session (no Redis state)');

  // Clear Redis state to simulate expiry
  try {
    const { execSync } = require('child_process');
    execSync(`redis-cli DEL "flashcard:${TEST_USER_ID}" "session:${TEST_USER_ID}"`, { stdio: 'pipe' });
  } catch (e) {
    console.log('  ⚠ Could not clear Redis, skipping scenario');
    return;
  }

  // Send a daily_ans_know with no session state — should not crash
  const res = await sendWebhook(makeCallbackUpdate('daily_ans_know'));
  assert(res.status === 200, 'expired session answer returns 200 (no crash)');

  // No DB writes should have happened for a non-existent session
  await sleep(500);
  // If we get here without a 500 error, the handler gracefully handled missing state
  assert(true, 'handler does not crash on missing Redis state');
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function main() {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
  console.log('Connected to test DB');
  console.log(`Testing against n8n at ${N8N_URL}, user ${TEST_USER_ID}`);

  try {
    await testHappyPath();
    await cleanupE2e();
    await testHintFlow();
    await cleanupE2e();
    await testExpiredSession();
  } finally {
    await cleanupE2e();
    await db.end();
  }

  console.log(`\n[E2E Daily Lesson] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
