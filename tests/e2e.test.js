/**
 * E2E TESTS — Full webhook flow (simulates Telegram updates)
 * Sends real HTTP POST to the n8n webhook and verifies outcomes.
 * Run: node tests/e2e.test.js
 */

'use strict';

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
  results.push({ label, ok: condition, detail });
}

function redis(cmd) {
  try {
    return execSync(
      `ssh -i ~/.ssh/id_ed25519_english_teacher root@188.166.28.75 \
       "docker exec english-bot-redis-1 redis-cli -a cHdGCx2v5TGK271yrpJEeaSnliufaSEo ${cmd} 2>/dev/null"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
  } catch (e) { return ''; }
}

function psql(q) {
  try {
    return execSync(
      `ssh -i ~/.ssh/id_ed25519_english_teacher root@188.166.28.75 \
       "docker exec english-bot-postgres-1 psql -U bot_user -d english_bot -t -c \\"${q.replace(/"/g, '\\"')}\\"" `,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
  } catch (e) { return ''; }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function postWebhook(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'convertible-laden-rear-listed.trycloudflare.com',
      path: '/webhook/55b4046a-7ae5-45d1-a77d-7521e9211e5c/webhook',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function makeMessage(text, userId = 185674280, msgId = Date.now()) {
  return {
    update_id: msgId,
    message: {
      message_id: msgId,
      from: { id: userId, first_name: 'Roma', username: 'SkyRoma', language_code: 'ru' },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

function makeCallback(data, userId = 185674280) {
  return {
    update_id: Date.now(),
    callback_query: {
      id: String(Date.now()),
      from: { id: userId, first_name: 'Roma', username: 'SkyRoma' },
      message: {
        message_id: 1,
        chat: { id: userId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'previous message',
      },
      data,
    },
  };
}

function getExecCount() {
  const r = psql('SELECT COUNT(*) FROM execution_entity');
  return parseInt(r.trim(), 10) || 0;
}

async function runE2E() {
  // ─── Setup ─────────────────────────────────────────────────────────────────
  console.log('\n[E2E] Setup: clearing state');
  redis('DEL session:185674280');
  redis('DEL onboarding:185674280');
  psql('UPDATE users SET level=\'A1\', total_xp=0, streak=0 WHERE id=185674280');
  await sleep(500);

  // ─── TEST 1: Blocked user ──────────────────────────────────────────────────
  console.log('\n[E2E] Test 1: Blocked user');
  const beforeBlocked = getExecCount();
  const blockedResp = await postWebhook(makeMessage('/start', 99999999));
  await sleep(2000);
  const afterBlocked = getExecCount();
  assert(blockedResp.status === 200, 'blocked user: webhook returns 200');
  assert(afterBlocked > beforeBlocked, 'blocked user: execution recorded');

  // ─── TEST 2: /start fresh user ────────────────────────────────────────────
  console.log('\n[E2E] Test 2: /start fresh user');
  const before2 = getExecCount();
  const startResp = await postWebhook(makeMessage('/start'));
  await sleep(3000);
  const after2 = getExecCount();
  assert(startResp.status === 200, '/start: webhook returns 200');
  assert(after2 > before2, '/start: execution created');

  // Session should be set to onboarding
  await sleep(1000);
  const sessionAfterStart = redis('GET session:185674280');
  assert(sessionAfterStart === 'onboarding', '/start: session set to onboarding');

  // ─── TEST 3: Onboarding Q1 answer ─────────────────────────────────────────
  console.log('\n[E2E] Test 3: Onboarding answer Q1');
  const before3 = getExecCount();
  const q1Resp = await postWebhook(makeMessage('My name is Roma and I am from Russia'));
  await sleep(8000); // Claude API call takes time
  const after3 = getExecCount();
  assert(q1Resp.status === 200, 'Q1 answer: webhook returns 200');
  assert(after3 > before3, 'Q1 answer: execution created');

  // History should be saved in Redis
  const historyAfterQ1 = redis('GET onboarding:185674280');
  let histParsed = [];
  try { histParsed = JSON.parse(historyAfterQ1); } catch(e) {}
  assert(histParsed.length >= 2, `Q1: history has user+assistant entries (got ${histParsed.length})`);
  assert(histParsed[0]?.role === 'user', 'Q1: first history entry is user');
  assert(histParsed[1]?.role === 'assistant', 'Q1: second history entry is assistant');

  // Session still onboarding
  const sessionAfterQ1 = redis('GET session:185674280');
  assert(sessionAfterQ1 === 'onboarding', 'Q1: session still onboarding after answer');

  // ─── TEST 4: /menu command ────────────────────────────────────────────────
  console.log('\n[E2E] Test 4: /menu command (interrupts onboarding)');
  // BUG #8: /menu during onboarding should work but Router checks session AFTER
  // vocab/command checks — /menu text IS checked before session, so it works
  const before4 = getExecCount();
  const menuResp = await postWebhook(makeMessage('/menu'));
  await sleep(2000);
  const after4 = getExecCount();
  assert(menuResp.status === 200, '/menu: webhook returns 200');
  assert(after4 > before4, '/menu: execution created');

  // ─── TEST 5: Blocked user callback ────────────────────────────────────────
  console.log('\n[E2E] Test 5: Blocked user callback query');
  const before5 = getExecCount();
  const cbBlocked = await postWebhook(makeCallback('menu_word', 88888888));
  await sleep(2000);
  const after5 = getExecCount();
  assert(cbBlocked.status === 200, 'blocked callback: webhook returns 200');
  assert(after5 > before5, 'blocked callback: execution recorded');

  // ─── TEST 6: Callback query routing ───────────────────────────────────────
  console.log('\n[E2E] Test 6: Callback query — menu_word');
  redis('DEL session:185674280');
  await sleep(500);
  const before6 = getExecCount();
  const cbWordResp = await postWebhook(makeCallback('menu_word'));
  await sleep(2000);
  const after6 = getExecCount();
  assert(cbWordResp.status === 200, 'menu_word callback: webhook returns 200');
  assert(after6 > before6, 'menu_word callback: execution created');

  // ─── TEST 7: /word command ────────────────────────────────────────────────
  console.log('\n[E2E] Test 7: /word elephant');
  const before7 = getExecCount();
  const wordResp = await postWebhook(makeMessage('/word elephant'));
  await sleep(8000);
  const after7 = getExecCount();
  assert(wordResp.status === 200, '/word elephant: webhook returns 200');
  assert(after7 > before7, '/word elephant: execution created');

  // ─── TEST 8: start_existing flow ──────────────────────────────────────────
  console.log('\n[E2E] Test 8: /start with existing progress');
  psql('UPDATE users SET level=\'B1\', total_xp=100 WHERE id=185674280');
  redis('DEL session:185674280');
  await sleep(500);
  const before8 = getExecCount();
  const startExResp = await postWebhook(makeMessage('/start'));
  await sleep(2000);
  const after8 = getExecCount();
  assert(startExResp.status === 200, '/start existing: webhook returns 200');
  assert(after8 > before8, '/start existing: execution created');

  // ─── TEST 9: reset_yes callback ────────────────────────────────────────────
  console.log('\n[E2E] Test 9: reset_yes callback');
  const before9 = getExecCount();
  const resetResp = await postWebhook(makeCallback('reset_yes'));
  await sleep(3000);
  const after9 = getExecCount();
  assert(resetResp.status === 200, 'reset_yes: webhook returns 200');
  assert(after9 > before9, 'reset_yes: execution created');
  const sessionAfterReset = redis('GET session:185674280');
  assert(sessionAfterReset === 'onboarding', 'reset_yes: session set to onboarding');

  // ─── TEST 10: Edge — empty message ────────────────────────────────────────
  console.log('\n[E2E] Test 10: Empty / malformed updates');
  const emptyResp = await postWebhook({});
  assert(emptyResp.status === 200, 'empty update body: webhook returns 200 (n8n accepts)');

  const noTextResp = await postWebhook({ update_id: 1, message: { from: { id: 185674280 }, chat: { id: 185674280 } } });
  await sleep(2000);
  assert(noTextResp.status === 200, 'message without text: webhook returns 200');

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  redis('DEL session:185674280');
  redis('DEL onboarding:185674280');
  psql('UPDATE users SET level=\'A1\', total_xp=0, streak=0 WHERE id=185674280');

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`E2E: ${passed} passed, ${failed} failed`);

  const bugs = results.filter(r => r.label.startsWith('[BUG'));
  if (bugs.length) {
    console.log('\nConfirmed bugs:');
    bugs.forEach(b => console.log(`  - ${b.label}`));
  }

  if (failed > 0) process.exit(1);
}

runE2E().catch(err => {
  console.error('E2E fatal error:', err);
  process.exit(1);
});
