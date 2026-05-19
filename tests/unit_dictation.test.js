/**
 * UNIT TESTS — Voice Dictation (Whisper STT)
 * Tests the logic extracted from n8n Code nodes in isolation.
 * Run: node tests/unit_dictation.test.js
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

// ─── Logic extracted from Router jsCode (dictation routing) ──────────────────

function routerLogic({ message = {}, callback_query = {}, sessionValue = '', user = {} }) {
  const ALLOWED_USERS = [185674280];
  const msg = message;
  const cb = callback_query;
  const userId = msg.from?.id || cb.from?.id;
  if (!ALLOWED_USERS.includes(userId)) return { route: 'blocked' };

  const text = (msg.text || '').trim();
  const cbData = cb.data || '';
  const session = sessionValue || '';
  const voiceFileId = msg.voice?.file_id || '';
  const level = user.level || 'A1';
  const nativeLang = user.native_lang || 'en';
  const targetLang = user.target_lang || 'en';

  let route = 'grammar';

  if (text === '/start') { route = 'start'; }
  else if (text === '/dictation' || cbData === 'menu_dictation' || cbData === 'dictation_next') {
    route = 'dictation_start';
  }
  else if (text === '/quiz' || cbData === 'menu_quiz') { route = 'quiz'; }
  else if (cbData.startsWith('quiz_ans_')) { route = 'quiz_answer'; }
  else if (session === 'dictation' && voiceFileId) { route = 'dictation_response'; }
  else if (session === 'word_input') { route = 'vocabulary'; }
  else if (session === 'grammar_input') { route = 'grammar'; }
  else if (session === 'onboarding') { route = 'onboarding'; }
  else if (session === 'conversation') { route = 'conversation'; }
  else if (!text.includes(' ') && text.length > 0 && !text.startsWith('/')) { route = 'vocabulary'; }

  return { userId, route, voiceFileId, level, nativeLang, targetLang, session };
}

const UID = 185674280;
const msg = (text, extra = {}) => ({ message: { from: { id: UID, first_name: 'Roma' }, text, ...extra } });
const cb  = (data)            => ({ callback_query: { from: { id: UID }, data } });
const voice = (fileId = 'VOICE_FILE_ID') => ({ message: { from: { id: UID }, voice: { file_id: fileId } } });

// ─── SECTION 1: dictation_start routing ──────────────────────────────────────
console.log('\n[Unit] dictation_start routing');
assert(routerLogic({ ...msg('/dictation') }).route === 'dictation_start', '/dictation → dictation_start');
assert(routerLogic({ ...cb('menu_dictation') }).route === 'dictation_start', 'menu_dictation → dictation_start');
assert(routerLogic({ ...cb('dictation_next') }).route === 'dictation_start', 'dictation_next → dictation_start');

// dictation_start takes priority over session
assert(
  routerLogic({ ...msg('/dictation'), sessionValue: 'grammar_input' }).route === 'dictation_start',
  '/dictation overrides grammar_input session'
);

// ─── SECTION 2: dictation_response routing ───────────────────────────────────
console.log('\n[Unit] dictation_response routing');
assert(
  routerLogic({ ...voice('FILE_123'), sessionValue: 'dictation' }).route === 'dictation_response',
  'voice + session=dictation → dictation_response'
);
assert(
  routerLogic({ ...voice('FILE_123'), sessionValue: '' }).route === 'grammar',
  'voice message with no session → grammar fallback (not crash)'
);
assert(
  routerLogic({ ...voice('FILE_123'), sessionValue: 'conversation' }).route === 'conversation',
  'voice in conversation session → conversation (not dictation)'
);
const textInDictSession = routerLogic({ message: { from: { id: UID }, text: 'hello' }, sessionValue: 'dictation' });
assert(
  textInDictSession.route !== 'dictation_response',
  'text message in dictation session (no voice) → not dictation_response'
);
assert(
  routerLogic({ ...voice(''), sessionValue: 'dictation' }).route === 'grammar',
  'empty voiceFileId in dictation session → grammar fallback'
);

// voiceFileId is correctly passed through
const r = routerLogic({ ...voice('VOICE_ABC'), sessionValue: 'dictation' });
assert(r.voiceFileId === 'VOICE_ABC', 'voiceFileId propagated correctly');

// ─── SECTION 3: Normalization function ───────────────────────────────────────
console.log('\n[Unit] Text normalization');

function normalize(s) {
  return s.toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:'"\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

assert(normalize('Hello, World!') === 'hello world', 'punctuation replaced with space, spaces collapsed');
assert(normalize('  The   cat  ') === 'the cat', 'leading/trailing whitespace trimmed, inner collapsed');
assert(normalize('It\'s a test.') === 'it s a test', 'apostrophe stripped, trailing space trimmed');
assert(normalize('café') === 'café', 'unicode NFC preserves accented chars');
assert(normalize('UPPER CASE') === 'upper case', 'lowercased');
assert(normalize('') === '', 'empty string safe');
// normalize already collapses spaces, split+filter gives clean word array
const words = normalize('Hello, World!').split(' ').filter(Boolean);
assert(words.length === 2, 'normalize + split gives 2 clean words from "Hello, World!"');

// ─── SECTION 4: Word-level scoring ───────────────────────────────────────────
console.log('\n[Unit] Word-level accuracy scoring');

function score(target, actual) {
  function norm(s) {
    return s.toLowerCase().normalize('NFC')
      .replace(/[.,!?;:'"\\-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const tw = norm(target).split(' ').filter(Boolean);
  const aw = norm(actual).split(' ').filter(Boolean);
  const as = new Set(aw);
  let matched = 0;
  tw.forEach(w => { if (as.has(w)) matched++; });
  return tw.length > 0 ? Math.round((matched / tw.length) * 100) : 0;
}

assert(score('the cat sat on the mat', 'the cat sat on the mat') === 100, 'perfect match → 100');
assert(score('the cat sat on the mat', 'the cat sat on the mat.') === 100, 'punctuation diff → 100 (normalized)');
assert(score('the cat sat', 'the cat') === 67, 'one word missing → 67%');
assert(score('one two three', '') === 0, 'empty transcript → 0');
assert(score('', 'something') === 0, 'empty target → 0 (no division by zero)');
assert(score('the cat sat on the mat', 'the dog sat on the rug') === 67, '2/6 wrong words → 67%');
assert(score('Hello World', 'hello world') === 100, 'case-insensitive match → 100');

// ─── SECTION 5: Missed/extra words detection ─────────────────────────────────
console.log('\n[Unit] Missed/extra words detection');

function diff(target, actual) {
  function norm(s) {
    return s.toLowerCase().normalize('NFC')
      .replace(/[.,!?;:'"\\-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const tw = norm(target).split(' ').filter(Boolean);
  const aw = norm(actual).split(' ').filter(Boolean);
  const ts = new Set(tw);
  const as = new Set(aw);
  return {
    missed: tw.filter(w => !as.has(w)),
    extra:  aw.filter(w => !ts.has(w))
  };
}

const d1 = diff('the cat sat on the mat', 'the cat sat on the rug');
assert(d1.missed.includes('mat'), 'missed: "mat" detected');
assert(d1.extra.includes('rug'), 'extra: "rug" detected');

const d2 = diff('hello world', 'hello world');
assert(d2.missed.length === 0, 'perfect: no missed words');
assert(d2.extra.length === 0, 'perfect: no extra words');

const d3 = diff('one two three', '');
assert(d3.missed.length === 3, 'all words missed on empty transcript');
assert(d3.extra.length === 0, 'no extra words on empty transcript');

// ─── SECTION 6: Evaluate Dictation Code node logic ───────────────────────────
console.log('\n[Unit] Evaluate Dictation (full node simulation)');

function evaluateDictation({ transcript, sentence, targetLang, level, nativeLang }) {
  function normalize(s) {
    return s.toLowerCase().normalize('NFC')
      .replace(/[.,!?;:'"\\-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const normTarget = normalize(sentence);
  const normActual = normalize(transcript);
  const tw = normTarget.split(' ').filter(Boolean);
  const aw = normActual.split(' ').filter(Boolean);
  const as = new Set(aw);
  const ts = new Set(tw);
  let matched = 0;
  tw.forEach(w => { if (as.has(w)) matched++; });
  const wordScore = tw.length > 0 ? Math.round((matched / tw.length) * 100) : 0;
  const missed = tw.filter(w => !as.has(w));
  const extra  = aw.filter(w => !ts.has(w));
  const LANG = { ru:'Russian', en:'English', es:'Spanish', uk:'Ukrainian' };
  const nativeName = LANG[nativeLang] || nativeLang;
  const targetName = LANG[targetLang] || targetLang;
  // Verify claudeBody is valid JSON with required fields
  const claudeBody = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 400,
    messages: [{ role: 'user', content: 'dummy' }] });
  return { sentence, transcript, wordScore, missed, extra, targetLang, level, nativeLang, claudeBody };
}

const ev1 = evaluateDictation({
  transcript: 'I like coffee in the morning',
  sentence: 'I like coffee in the morning',
  targetLang: 'en', level: 'A1', nativeLang: 'ru'
});
assert(ev1.wordScore === 100, 'perfect dictation → score 100');
assert(ev1.missed.length === 0, 'perfect dictation → no missed words');
assert(JSON.parse(ev1.claudeBody).model === 'claude-haiku-4-5', 'claudeBody uses haiku model');

const ev2 = evaluateDictation({
  transcript: 'i like tea',
  sentence: 'I like coffee in the morning',
  targetLang: 'en', level: 'B1', nativeLang: 'en'
});
assert(ev2.wordScore < 100, 'partial match → score < 100');
assert(ev2.missed.includes('coffee'), 'missed "coffee" detected');
assert(ev2.missed.includes('morning'), 'missed "morning" detected');
assert(ev2.extra.includes('tea'), 'extra "tea" detected');

const ev3 = evaluateDictation({
  transcript: '',
  sentence: 'Hello world',
  targetLang: 'en', level: 'A1', nativeLang: 'ru'
});
assert(ev3.wordScore === 0, 'empty transcript → score 0');

// ─── SECTION 7: Redis key naming conventions ─────────────────────────────────
console.log('\n[Unit] Redis key patterns');

function dictationKey(userId) { return 'dictation:' + userId; }
function sessionKey(userId)   { return 'session:' + userId; }

assert(dictationKey(185674280) === 'dictation:185674280', 'dictation key format');
assert(sessionKey(185674280)   === 'session:185674280',   'session key format');
// Keys must not collide with quiz key pattern
assert(dictationKey(123) !== 'quiz:123',   'dictation key ≠ quiz key');
assert(dictationKey(123) !== 'session:123','dictation key ≠ session key');

// ─── SECTION 8: Dictation state JSON structure ───────────────────────────────
console.log('\n[Unit] Dictation state JSON structure');

function buildDictationState({ sentence, targetLang, level }) {
  return JSON.stringify({ sentence, targetLang, level, createdAt: Date.now() });
}

const state = JSON.parse(buildDictationState({ sentence: 'I love cats', targetLang: 'en', level: 'A1' }));
assert(typeof state.sentence === 'string', 'state has sentence');
assert(typeof state.targetLang === 'string', 'state has targetLang');
assert(typeof state.level === 'string', 'state has level');
assert(typeof state.createdAt === 'number', 'state has createdAt timestamp');
assert(state.sentence === 'I love cats', 'sentence stored correctly');

// ─── SECTION 9: Edge cases & guard conditions ────────────────────────────────
console.log('\n[Unit] Edge cases');

// Stale voice message in wrong session must not crash
assert(
  routerLogic({ ...voice('FILE'), sessionValue: 'quiz' }).route !== 'dictation_response',
  'voice in quiz session → not dictation_response'
);
assert(
  routerLogic({ ...voice('FILE'), sessionValue: 'word_input' }).route === 'vocabulary',
  'voice in word_input session → vocabulary (not dictation)'
);

// Score never goes negative or over 100
const scores = [
  score('a b c', 'a b c d e'),  // extra words
  score('a b c d e', 'a b c'),  // missing words
];
scores.forEach((s, i) => {
  assert(s >= 0 && s <= 100, `score[${i}] in range [0, 100]: ${s}`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Dictation unit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
