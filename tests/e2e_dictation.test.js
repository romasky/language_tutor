/**
 * E2E TESTS — Voice Dictation (Whisper STT)
 * Simulates real Telegram updates via webhook.
 * Tests: /dictation → session set → voice message → result + XP + attempt stored.
 *
 * NOTE: Voice message test uses a pre-recorded real OGG file stored on Telegram's
 * servers. We can only test the routing/session setup without a real voice file.
 * The pipeline after Whisper STT is tested via unit + integration tests.
 *
 * Run: node tests/e2e_dictation.test.js
 */

'use strict';

const https = require('https');
const { execSync, spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function redis(cmd) {
  try {
    return execSync(
      `ssh -i ~/.ssh/id_ed25519_english_teacher root@188.166.28.75 \
       "docker exec english-bot-redis-1 redis-cli -a cHdGCx2v5TGK271yrpJEeaSnliufaSEo ${cmd} 2>/dev/null"`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
  } catch (e) { return ''; }
}

function psql(query) {
  try {
    const r = spawnSync(
      'ssh',
      ['-i', `${process.env.HOME}/.ssh/id_ed25519_english_teacher`, 'root@188.166.28.75',
       'docker exec -i english-bot-postgres-1 psql -U bot_user -d english_bot -t'],
      { input: query, encoding: 'utf8', timeout: 15000 }
    );
    return r.stdout.trim();
  } catch (e) { return ''; }
}

// Get current webhook URL from n8n DB
function getWebhookUrl() {
  const path = psql('SELECT "webhookPath" FROM webhook_entity LIMIT 1').trim();
  const tunnelRow = execSync(
    `ssh -i ~/.ssh/id_ed25519_english_teacher root@188.166.28.75 "cat /opt/english-bot/.env | grep N8N_WEBHOOK_URL"`,
    { encoding: 'utf8' }
  ).trim();
  const tunnelUrl = tunnelRow.split('=')[1].trim().replace(/\/$/, '');
  return `${tunnelUrl}/${path}`;
}

function postWebhook(body, url) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 30000,
    };
    const req = https.request(options, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function makeMsg(text, userId = 185674280) {
  return {
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
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
      message: { message_id: 1, chat: { id: userId, type: 'private' }, date: Math.floor(Date.now() / 1000), text: 'x' },
      data,
    },
  };
}

function makeVoiceMsg(fileId, userId = 185674280) {
  return {
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      from: { id: userId, first_name: 'Roma', username: 'SkyRoma', language_code: 'ru' },
      chat: { id: userId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      voice: { file_id: fileId, duration: 3, mime_type: 'audio/ogg', file_size: 12000 },
    },
  };
}

async function run() {
  let webhookUrl;
  try {
    webhookUrl = getWebhookUrl();
    console.log(`\nWebhook: ${webhookUrl}`);
  } catch (e) {
    console.error('Failed to get webhook URL:', e.message);
    process.exit(1);
  }

  const UID = 185674280;

  // ─── Setup ──────────────────────────────────────────────────────────────────
  console.log('\n[E2E Dictation] Setup: clearing state');
  redis(`DEL session:${UID}`);
  redis(`DEL dictation:${UID}`);
  psql(`DELETE FROM attempts WHERE user_id=${UID} AND type='dictation'`);
  psql(`UPDATE users SET total_xp=50, level='B1', native_lang='ru', target_lang='en' WHERE id=${UID}`);
  await sleep(500);

  const xpBefore = parseInt(psql(`SELECT total_xp FROM users WHERE id=${UID}`).trim(), 10) || 0;

  // ─── TEST 1: /dictation command → session set + sentence stored ─────────────
  console.log('\n[E2E Dictation] Test 1: /dictation command');
  const r1 = await postWebhook(makeMsg('/dictation'), webhookUrl);
  assert(r1.status === 200, '/dictation: webhook returns 200');
  await sleep(5000); // waits for Claude to generate sentence

  const session1 = redis(`GET session:${UID}`);
  assert(session1 === 'dictation', '/dictation: session set to "dictation"');

  const dictStateRaw = redis(`GET dictation:${UID}`);
  let dictState = null;
  try { dictState = JSON.parse(dictStateRaw); } catch (e) {}
  assert(dictState !== null, '/dictation: dictation state stored in Redis');
  assert(typeof dictState?.sentence === 'string' && dictState.sentence.length > 0,
    '/dictation: sentence generated and stored');
  assert(dictState?.targetLang === 'en', '/dictation: targetLang=en in state');
  assert(dictState?.level === 'B1', '/dictation: level=B1 in state');

  const dictTtl = parseInt(redis(`TTL dictation:${UID}`), 10);
  assert(dictTtl > 0 && dictTtl <= 600, `/dictation: dictation key has TTL ${dictTtl}s ≤ 600`);

  const sessionTtl = parseInt(redis(`TTL session:${UID}`), 10);
  assert(sessionTtl > 0 && sessionTtl <= 600, `/dictation: session key has TTL ${sessionTtl}s ≤ 600`);

  // ─── TEST 2: menu_dictation callback → same as /dictation ───────────────────
  console.log('\n[E2E Dictation] Test 2: menu_dictation button');
  redis(`DEL session:${UID}`);
  redis(`DEL dictation:${UID}`);
  await sleep(300);

  const r2 = await postWebhook(makeCallback('menu_dictation'), webhookUrl);
  assert(r2.status === 200, 'menu_dictation: webhook returns 200');
  await sleep(5000);

  const session2 = redis(`GET session:${UID}`);
  assert(session2 === 'dictation', 'menu_dictation: session set to "dictation"');
  const hasState2 = redis(`EXISTS dictation:${UID}`);
  assert(hasState2 === '1', 'menu_dictation: dictation state stored');

  // ─── TEST 3: dictation_next callback → new sentence generated ───────────────
  console.log('\n[E2E Dictation] Test 3: dictation_next button');
  redis(`DEL session:${UID}`);
  redis(`DEL dictation:${UID}`);
  await sleep(300);

  const r3 = await postWebhook(makeCallback('dictation_next'), webhookUrl);
  assert(r3.status === 200, 'dictation_next: webhook returns 200');
  await sleep(5000);

  const session3 = redis(`GET session:${UID}`);
  assert(session3 === 'dictation', 'dictation_next: session set to "dictation"');

  // ─── TEST 4: Voice message without dictation session → not crashed ───────────
  console.log('\n[E2E Dictation] Test 4: Voice message without dictation session');
  redis(`DEL session:${UID}`);
  redis(`DEL dictation:${UID}`);
  await sleep(300);

  // Send a voice message with no session — should fall through to grammar, not crash
  const r4 = await postWebhook(makeVoiceMsg('FAKE_FILE_ID_FOR_STRAY_VOICE'), webhookUrl);
  assert(r4.status === 200, 'stray voice (no session): webhook returns 200');
  await sleep(3000);

  // Should NOT have set dictation session
  const session4 = redis(`GET session:${UID}`);
  assert(session4 !== 'dictation', 'stray voice: session not set to dictation');

  // XP should NOT have increased (grammar fallback may add XP but that's OK)
  // Key check: no dictation attempt stored
  const strayAttempts = psql(`SELECT COUNT(*) FROM attempts WHERE user_id=${UID} AND type='dictation'`);
  assert(strayAttempts.trim() === '0', 'stray voice: no dictation attempt stored');

  // ─── TEST 5: Voice in wrong session → not treated as dictation ──────────────
  console.log('\n[E2E Dictation] Test 5: Voice message in grammar_input session');
  redis(`SET session:${UID} grammar_input EX 300`);
  await sleep(200);

  const r5 = await postWebhook(makeVoiceMsg('FAKE_FILE_ID_GRAMMAR'), webhookUrl);
  assert(r5.status === 200, 'voice in grammar session: webhook returns 200');
  await sleep(3000);

  const session5 = redis(`GET session:${UID}`);
  assert(session5 !== 'dictation', 'voice in grammar session: still not dictation session');

  // ─── TEST 6: /dictation interrupted — text message in dictation session ──────
  console.log('\n[E2E Dictation] Test 6: Text message while in dictation session (not voice)');
  redis(`SET session:${UID} dictation EX 600`);
  redis(`SET dictation:${UID} '{"sentence":"test","targetLang":"en","level":"B1","createdAt":${Date.now()}}' EX 600`);
  await sleep(200);

  // Text message (not voice) in dictation session → should fall through to grammar
  const r6 = await postWebhook(makeMsg('hello there'), webhookUrl);
  assert(r6.status === 200, 'text in dictation session: webhook returns 200');
  await sleep(3000);

  // Dictation state should still be there (grammar handler doesn't clear it)
  const stillHasState = redis(`EXISTS dictation:${UID}`);
  assert(stillHasState === '1', 'text in dictation session: dictation state preserved for next voice msg');

  // ─── TEST 7: XP baseline check (for after voice pipeline) ───────────────────
  console.log('\n[E2E Dictation] Test 7: XP baseline');
  const xpNow = parseInt(psql(`SELECT total_xp FROM users WHERE id=${UID}`).trim(), 10) || 0;
  assert(xpNow >= xpBefore, `XP non-negative: started at ${xpBefore}, now ${xpNow}`);

  // ─── Cleanup ─────────────────────────────────────────────────────────────────
  redis(`DEL session:${UID}`);
  redis(`DEL dictation:${UID}`);
  psql(`DELETE FROM attempts WHERE user_id=${UID} AND type='dictation'`);
  psql(`UPDATE users SET total_xp=${xpBefore}, level='B1' WHERE id=${UID}`);

  // ─── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Dictation E2E: ${passed} passed, ${failed} failed`);

  console.log(`
NOTE: Full voice pipeline (Whisper → Evaluate → Result) requires a real Telegram
voice file_id. Test manually: set session=dictation, send a voice message in Telegram,
verify execution in n8n panel, check attempts table for stored result.`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('E2E fatal:', err);
  process.exit(1);
});
