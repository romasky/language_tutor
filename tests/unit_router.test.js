/**
 * UNIT TESTS — Router Code Node
 * Tests the routing logic in isolation (no n8n runtime needed).
 * Run: node tests/unit_router.test.js
 */

'use strict';

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

// ─── Router logic extracted verbatim from n8n Code node ──────────────────────
function routerLogic({ message = {}, callback_query = {}, sessionValue = '', user = {} }) {
  const ALLOWED_USERS = [185674280];
  const msg = message;
  const cb = callback_query;
  const userId = msg.from?.id || cb.from?.id;

  if (!ALLOWED_USERS.includes(userId)) {
    return { userId, route: 'blocked' };
  }

  const text = (msg.text || '').trim();
  const cbData = cb.data || '';
  const session = sessionValue || '';
  const firstName = msg.from?.first_name || cb.from?.first_name || 'друг';
  const level = user.level || 'A1';
  const totalXp = user.total_xp || 0;
  const streak = user.streak || 0;
  const hasProgress = totalXp > 0 || streak > 0 || level !== 'A1';

  let route = 'grammar';
  if (text === '/start') route = hasProgress ? 'start_existing' : 'start';
  else if (cbData === 'reset_yes') route = 'start';
  else if (cbData === 'reset_no') route = 'menu';
  else if (cbData === 'menu_show' || cbData === 'menu_progress' || cbData === 'menu_level' || text === '/menu' || text === '/progress') route = 'menu';
  else if (cbData === 'menu_word') route = 'menu_word_prompt';
  else if (cbData === 'menu_grammar') route = 'menu_grammar_prompt';
  else if (cbData === 'menu_talk' || text.startsWith('/talk')) route = 'conversation';
  else if (text.startsWith('/word ') || (!text.includes(' ') && text.length > 0 && !text.startsWith('/'))) route = 'vocabulary';
  else if (session === 'onboarding') route = 'onboarding';
  else if (session === 'conversation') route = 'conversation';

  return { userId, firstName, level, totalXp, streak, text, cbData, session, route };
}

const ALLOWED_ID = 185674280;
const BLOCKED_ID = 999888777;
const BASE_MSG = (text, id = ALLOWED_ID) => ({
  message: { from: { id, first_name: 'Roma' }, text },
});
const BASE_CB = (data, id = ALLOWED_ID) => ({
  callback_query: { from: { id, first_name: 'Roma' }, data },
});

// ─── SECTION 1: Access control ────────────────────────────────────────────────
console.log('\n[Unit] Access control');
assert(routerLogic({ ...BASE_MSG('/start', BLOCKED_ID) }).route === 'blocked', 'unknown user → blocked');
assert(routerLogic({ ...BASE_MSG('/start', ALLOWED_ID) }).route === 'start', 'allowed user → not blocked');

// ─── SECTION 2: /start routing ────────────────────────────────────────────────
console.log('\n[Unit] /start routing');
assert(routerLogic({ ...BASE_MSG('/start'), user: {} }).route === 'start', '/start, no progress → start');
assert(routerLogic({ ...BASE_MSG('/start'), user: { level: 'B1' } }).route === 'start_existing', '/start, level != A1 → start_existing');
assert(routerLogic({ ...BASE_MSG('/start'), user: { total_xp: 10 } }).route === 'start_existing', '/start, xp > 0 → start_existing');
assert(routerLogic({ ...BASE_MSG('/start'), user: { streak: 3 } }).route === 'start_existing', '/start, streak > 0 → start_existing');
assert(routerLogic({ ...BASE_MSG('/start'), user: { level: 'A1', total_xp: 0, streak: 0 } }).route === 'start', '/start, all zero, A1 → start');

// ─── SECTION 3: Callback query routing ───────────────────────────────────────
console.log('\n[Unit] Callback routing');
assert(routerLogic({ ...BASE_CB('reset_yes') }).route === 'start', 'reset_yes → start');
assert(routerLogic({ ...BASE_CB('reset_no') }).route === 'menu', 'reset_no → menu');
assert(routerLogic({ ...BASE_CB('menu_word') }).route === 'menu_word_prompt', 'menu_word → menu_word_prompt');
assert(routerLogic({ ...BASE_CB('menu_grammar') }).route === 'menu_grammar_prompt', 'menu_grammar → menu_grammar_prompt');
assert(routerLogic({ ...BASE_CB('menu_talk') }).route === 'conversation', 'menu_talk → conversation');
assert(routerLogic({ ...BASE_CB('menu_show') }).route === 'menu', 'menu_show → menu');
assert(routerLogic({ ...BASE_CB('menu_progress') }).route === 'menu', 'menu_progress → menu');
assert(routerLogic({ ...BASE_CB('menu_level') }).route === 'menu', 'menu_level → menu');

// ─── SECTION 4: Text command routing ─────────────────────────────────────────
console.log('\n[Unit] Text command routing');
assert(routerLogic({ ...BASE_MSG('/menu') }).route === 'menu', '/menu → menu');
assert(routerLogic({ ...BASE_MSG('/progress') }).route === 'menu', '/progress → menu');
assert(routerLogic({ ...BASE_MSG('/talk') }).route === 'conversation', '/talk → conversation');
assert(routerLogic({ ...BASE_MSG('/talk let us chat') }).route === 'conversation', '/talk with args → conversation');
assert(routerLogic({ ...BASE_MSG('/word elephant') }).route === 'vocabulary', '/word word → vocabulary');

// ─── SECTION 5: Vocabulary routing ───────────────────────────────────────────
console.log('\n[Unit] Vocabulary routing (single-word messages)');
assert(routerLogic({ ...BASE_MSG('elephant') }).route === 'vocabulary', 'single word → vocabulary');
assert(routerLogic({ ...BASE_MSG('Hello') }).route === 'vocabulary', 'single capitalized word → vocabulary');
// BUG: multi-word text outside session falls through to grammar — document expected
const multiWord = routerLogic({ ...BASE_MSG('hello world'), sessionValue: '' });
assert(multiWord.route === 'grammar', 'multi-word with no session → grammar (fallback)');

// ─── SECTION 6: Session-based routing ────────────────────────────────────────
console.log('\n[Unit] Session-based routing');
assert(routerLogic({ ...BASE_MSG('hello world'), sessionValue: 'onboarding' }).route === 'onboarding', 'session=onboarding → onboarding');
assert(routerLogic({ ...BASE_MSG('hello world'), sessionValue: 'conversation' }).route === 'conversation', 'session=conversation → conversation');

// BUG #1: single-word during onboarding session goes to vocabulary, not onboarding
// The word check fires BEFORE the session check
const singleWordDuringOnboarding = routerLogic({ ...BASE_MSG('elephant'), sessionValue: 'onboarding' });
const bug1 = singleWordDuringOnboarding.route === 'vocabulary'; // this is the BUG
assert(bug1, '[BUG #1 confirmed] single word during onboarding → vocabulary (should be onboarding)');

// ─── SECTION 7: Edge cases ────────────────────────────────────────────────────
console.log('\n[Unit] Edge cases');
assert(routerLogic({ ...BASE_MSG('') }).route === 'grammar', 'empty text → grammar');
assert(routerLogic({ ...BASE_MSG('   ') }).route === 'grammar', 'whitespace-only → grammar (after trim)');
assert(routerLogic({ ...BASE_MSG('/unknown') }).route === 'grammar', 'unknown command → grammar');
assert(routerLogic({ ...BASE_MSG('/word') }).route === 'grammar', '/word without space → grammar (not vocabulary)');
// BUG #2: /word without word arg routes to grammar instead of showing prompt
const bug2 = routerLogic({ ...BASE_MSG('/word') }).route === 'grammar';
assert(bug2, '[BUG #2 confirmed] /word alone → grammar (should be menu_word_prompt)');

// Callback + text simultaneously (callback takes priority in real TG, text is empty)
const cbWithText = routerLogic({ message: { from: { id: ALLOWED_ID }, text: '/start' }, callback_query: { from: { id: ALLOWED_ID }, data: 'reset_yes' } });
// cbData checked first in the else-if chain after /start check — text wins first
assert(cbWithText.route === 'start', 'when both text=/start and cbData, text wins');

// Missing from.id (malformed update)
const noId = routerLogic({ message: { text: 'hi' } });
assert(noId.route === 'blocked', 'missing from.id → blocked (not in ALLOWED_USERS)');

// ─── SECTION 8: Output fields ────────────────────────────────────────────────
console.log('\n[Unit] Output fields');
const out = routerLogic({ ...BASE_MSG('hello world'), user: { level: 'B2', total_xp: 50, streak: 7 } });
assert(out.firstName === 'Roma', 'firstName extracted');
assert(out.level === 'B2', 'level from user');
assert(out.totalXp === 50, 'totalXp from user');
assert(out.streak === 7, 'streak from user');
assert(out.text === 'hello world', 'text normalized');
assert(out.userId === ALLOWED_ID, 'userId correct');

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Router unit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
