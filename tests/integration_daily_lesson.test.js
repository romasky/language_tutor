/**
 * INTEGRATION TESTS — Daily Lesson SQL Queries & Session Logic
 *
 * Tests SQL queries and n8n Code node logic against a real test DB.
 * Requires: PostgreSQL running, TEST_DB_URL env var set.
 *
 * Run: TEST_DB_URL=postgres://... node tests/integration_daily_lesson.test.js
 *
 * Schema: must have run all migrations (001–006).
 */

'use strict';

const { Client } = require('pg');

const DB_URL = process.env.TEST_DB_URL;
if (!DB_URL) {
  console.error('ERROR: TEST_DB_URL env var required');
  console.error('  Example: TEST_DB_URL=postgres://user:pass@localhost:5432/test_db node tests/integration_daily_lesson.test.js');
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

async function query(sql, params = []) {
  const res = await db.query(sql, params);
  return res.rows;
}

async function cleanup() {
  await db.query('DELETE FROM daily_lesson_sessions WHERE user_id IN (SELECT id FROM users WHERE username = $1)', ['test_daily_user']);
  await db.query('DELETE FROM vocabulary WHERE user_id IN (SELECT id FROM users WHERE username = $1)', ['test_daily_user']);
  await db.query('DELETE FROM users WHERE username = $1', ['test_daily_user']);
}

async function seedUser(overrides = {}) {
  const defaults = {
    id: 999999001,
    username: 'test_daily_user',
    first_name: 'TestUser',
    level: 'B1',
    utc_offset: 0,
    is_opted_in: true,
    lesson_hour: 9,
    total_xp: 0,
    streak: 0
  };
  const u = { ...defaults, ...overrides };
  await db.query(
    `INSERT INTO users (id, username, first_name, level, utc_offset, is_opted_in, lesson_hour, total_xp, streak, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (id) DO UPDATE SET
       utc_offset=EXCLUDED.utc_offset, is_opted_in=EXCLUDED.is_opted_in,
       lesson_hour=EXCLUDED.lesson_hour, last_seen_at=NOW()`,
    [u.id, u.username, u.first_name, u.level, u.utc_offset, u.is_opted_in, u.lesson_hour, u.total_xp, u.streak]
  );
  return u;
}

async function seedWords(userId, count = 5, dueInFuture = false) {
  const words = [];
  for (let i = 0; i < count; i++) {
    const nextReview = dueInFuture ? `NOW() + INTERVAL '${i + 1} days'` : `NOW() - INTERVAL '${i + 1} hours'`;
    const res = await db.query(
      `INSERT INTO vocabulary (user_id, word, translation, context, ease_factor, interval, repetitions, next_review)
       VALUES ($1, $2, $3, $4, 2.5, 1, 0, ${nextReview}) RETURNING id`,
      [userId, `word_${i}`, `перевод_${i}`, `context ${i}`]
    );
    words.push({ id: res.rows[0].id, word: `word_${i}` });
  }
  return words;
}

// ─── SECTION 1: Migration schema check ────────────────────────────────────────
async function testSchemaColumns() {
  console.log('\n[Integration] Schema columns');

  const vocabCols = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='vocabulary' AND column_name='repetitions'`
  );
  assert(vocabCols.length === 1, 'vocabulary.repetitions column exists');

  const userCols = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('utc_offset','is_opted_in','lesson_hour')`
  );
  assert(userCols.length === 3, 'users has utc_offset, is_opted_in, lesson_hour');

  const dlsTable = await query(
    `SELECT table_name FROM information_schema.tables WHERE table_name='daily_lesson_sessions'`
  );
  assert(dlsTable.length === 1, 'daily_lesson_sessions table exists');

  const dlsCols = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='daily_lesson_sessions' AND column_name IN ('status','completed_at','correct','xp_awarded')`
  );
  assert(dlsCols.length === 4, 'daily_lesson_sessions has all required columns');
}

// ─── SECTION 2: Get Due Users This Hour query ─────────────────────────────────
async function testGetDueUsersQuery() {
  console.log('\n[Integration] Get Due Users This Hour');

  await cleanup();
  const currentHour = new Date().getUTCHours();

  // User at correct UTC offset (lesson_hour = currentHour, utc_offset = 0)
  await seedUser({ id: 999999001, utc_offset: 0, lesson_hour: currentHour, is_opted_in: true });
  // User opted out
  await seedUser({ id: 999999002, username: 'test_daily_user', utc_offset: 0, lesson_hour: currentHour, is_opted_in: false });

  const rows = await query(
    `SELECT id FROM users
     WHERE is_opted_in = true
       AND last_seen_at > NOW() - INTERVAL '30 days'
       AND ((EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC')::int + utc_offset + 24) % 24) = lesson_hour
       AND username = 'test_daily_user'`
  );
  // Only the opted-in user at the right hour should appear
  // (Note: opted-out user has same username so cleanup will match both IDs)
  assert(rows.some(r => r.id === 999999001), 'opted-in user at correct lesson hour appears');
  assert(!rows.some(r => r.id === 999999002), 'opted-out user does not appear');
}

// ─── SECTION 3: Get Due Words query ───────────────────────────────────────────
async function testGetDueWordsQuery() {
  console.log('\n[Integration] Get Due Words');

  await cleanup();
  const user = await seedUser();
  // 3 due words + 2 future words
  const dueWords = await seedWords(user.id, 3, false);
  await seedWords(user.id, 2, true);

  const rows = await query(
    `SELECT id, word, translation, context, ease_factor, interval, repetitions
     FROM vocabulary
     WHERE user_id = $1 AND next_review <= NOW()
     ORDER BY next_review ASC LIMIT 5`,
    [user.id]
  );
  assert(rows.length === 3, 'returns only 3 due words (not future ones)');
  assert(rows.every(r => r.repetitions !== undefined), 'repetitions column present in result');
  assert(rows.every(r => r.ease_factor !== undefined), 'ease_factor column present in result');
}

// ─── SECTION 4: Double-send idempotency guard ──────────────────────────────────
async function testDoubleSendGuard() {
  console.log('\n[Integration] Double-send idempotency guard');

  await cleanup();
  const user = await seedUser();

  // Insert a session for today
  await db.query(
    `INSERT INTO daily_lesson_sessions (user_id, card_count, status, started_at) VALUES ($1, 5, 'sent', NOW())`,
    [user.id]
  );

  const rows = await query(
    `SELECT id FROM users
     WHERE id = $1
       AND is_opted_in = true
       AND NOT EXISTS (
         SELECT 1 FROM daily_lesson_sessions dls
         WHERE dls.user_id = $1 AND dls.started_at > NOW() - INTERVAL '20 hours'
       )`,
    [user.id]
  );
  assert(rows.length === 0, 'user with session today is excluded by NOT EXISTS guard');

  // After session older than 20 hours: should appear again
  await db.query(`DELETE FROM daily_lesson_sessions WHERE user_id = $1`, [user.id]);
  await db.query(
    `INSERT INTO daily_lesson_sessions (user_id, card_count, status, started_at) VALUES ($1, 5, 'sent', NOW() - INTERVAL '25 hours')`,
    [user.id]
  );

  const rows2 = await query(
    `SELECT id FROM users
     WHERE id = $1 AND is_opted_in = true
       AND NOT EXISTS (
         SELECT 1 FROM daily_lesson_sessions dls
         WHERE dls.user_id = $1 AND dls.started_at > NOW() - INTERVAL '20 hours'
       )`,
    [user.id]
  );
  assert(rows2.length === 1, 'user with only old session (>20h) appears again');
}

// ─── SECTION 5: SM-2 bulk UPDATE query ────────────────────────────────────────
async function testSm2BulkUpdate() {
  console.log('\n[Integration] SM-2 bulk UPDATE');

  await cleanup();
  const user = await seedUser();
  const words = await seedWords(user.id, 3, false);

  const results = [
    { vocabId: words[0].id, newEaseFactor: 2.6, newInterval: 1, newRepetitions: 1 },
    { vocabId: words[1].id, newEaseFactor: 2.5, newInterval: 6, newRepetitions: 2 },
    { vocabId: words[2].id, newEaseFactor: 2.5, newInterval: 1, newRepetitions: 0 }  // failed
  ];

  const vals = results.map(r =>
    `(${r.vocabId},${r.newEaseFactor.toFixed(4)},${r.newInterval},${r.newRepetitions})`
  ).join(',');

  await db.query(
    `UPDATE vocabulary AS v
     SET ease_factor = c.new_ef::float,
         interval = c.new_int::int,
         repetitions = c.new_rep::int,
         next_review = NOW() + (c.new_int || ' days')::interval
     FROM (VALUES ${vals}) AS c(vid, new_ef, new_int, new_rep)
     WHERE v.id = c.vid::int AND v.user_id = ${user.id}`
  );

  const updated = await query(
    `SELECT id, ease_factor, interval, repetitions FROM vocabulary WHERE user_id = $1 ORDER BY id`,
    [user.id]
  );

  assert(Math.abs(updated[0].ease_factor - 2.6) < 0.001, 'word0 ease_factor updated to 2.6');
  assert(updated[1].interval === 6, 'word1 interval updated to 6');
  assert(updated[2].repetitions === 0, 'word2 repetitions reset to 0 (failed)');

  // Verify next_review is in the future for passed cards
  const reviews = await query(
    `SELECT id, next_review > NOW() as in_future FROM vocabulary WHERE user_id = $1 AND interval > 1`,
    [user.id]
  );
  assert(reviews.every(r => r.in_future), 'passed cards have next_review in future');
}

// ─── SECTION 6: Session record lifecycle ──────────────────────────────────────
async function testSessionRecordLifecycle() {
  console.log('\n[Integration] Session record lifecycle');

  await cleanup();
  const user = await seedUser();

  // Insert session
  const ins = await query(
    `INSERT INTO daily_lesson_sessions (user_id, card_count, status) VALUES ($1, 5, 'sent') RETURNING id`,
    [user.id]
  );
  const sessionId = ins[0].id;
  assert(sessionId > 0, 'session record inserted with id');

  // Complete session
  await db.query(
    `UPDATE daily_lesson_sessions SET completed_at=NOW(), correct=4, xp_awarded=40, status='completed' WHERE id=$1`,
    [sessionId]
  );

  const session = await query(`SELECT * FROM daily_lesson_sessions WHERE id = $1`, [sessionId]);
  assert(session[0].status === 'completed', 'session status = completed');
  assert(session[0].correct === 4, 'correct count saved');
  assert(session[0].xp_awarded === 40, 'XP awarded saved');
  assert(session[0].completed_at !== null, 'completed_at set');

  // Abandon
  await db.query(`UPDATE daily_lesson_sessions SET status='abandoned' WHERE id=$1`, [sessionId]);
  const abandoned = await query(`SELECT status FROM daily_lesson_sessions WHERE id=$1`, [sessionId]);
  assert(abandoned[0].status === 'abandoned', 'session can be marked abandoned');
}

// ─── SECTION 7: XP and streak update ─────────────────────────────────────────
async function testXpAndStreak() {
  console.log('\n[Integration] XP and streak update');

  await cleanup();
  await seedUser({ total_xp: 100, streak: 3 });
  const userId = 999999001;

  // Simulate award: last_seen_at = yesterday → streak increments
  await db.query(`UPDATE users SET last_seen_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [userId]);

  const xpToAward = 45;
  await db.query(
    `UPDATE users
     SET total_xp = total_xp + $1,
         streak = CASE
           WHEN DATE(last_seen_at) = CURRENT_DATE - INTERVAL '1 day'
             OR DATE(last_seen_at) = CURRENT_DATE
           THEN streak + 1
           ELSE 1
         END,
         last_seen_at = NOW()
     WHERE id = $2`,
    [xpToAward, userId]
  );

  const user = await query(`SELECT total_xp, streak FROM users WHERE id = $1`, [userId]);
  assert(user[0].total_xp === 145, 'total_xp updated: 100 + 45 = 145');
  assert(user[0].streak === 4, 'streak incremented: 3 → 4 (was active yesterday)');

  // Simulate award after gap (3+ days) → streak resets to 1
  await db.query(`UPDATE users SET last_seen_at = NOW() - INTERVAL '3 days', streak = 10 WHERE id = $1`, [userId]);
  await db.query(
    `UPDATE users SET streak = CASE WHEN DATE(last_seen_at) = CURRENT_DATE - INTERVAL '1 day' OR DATE(last_seen_at) = CURRENT_DATE THEN streak + 1 ELSE 1 END, last_seen_at = NOW() WHERE id = $1`,
    [userId]
  );

  const user2 = await query(`SELECT streak FROM users WHERE id = $1`, [userId]);
  assert(user2[0].streak === 1, 'streak resets to 1 after gap > 1 day');
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function main() {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
  console.log('Connected to test DB');

  try {
    await testSchemaColumns();
    await testGetDueUsersQuery();
    await testGetDueWordsQuery();
    await testDoubleSendGuard();
    await testSm2BulkUpdate();
    await testSessionRecordLifecycle();
    await testXpAndStreak();
  } finally {
    await cleanup();
    await db.end();
  }

  console.log(`\n[Integration Daily Lesson] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
