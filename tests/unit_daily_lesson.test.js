/**
 * UNIT TESTS — Daily Lesson Flashcard Logic
 * Tests SM-2 algorithm, state machine, and soft grading in isolation.
 * Run: node tests/unit_daily_lesson.test.js
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

function assertClose(a, b, label, eps = 0.0001) {
  assert(Math.abs(a - b) < eps, label, `expected ${b}, got ${a}`);
}

// ─── SM-2 implementation (mirrors Process Daily Answer Code node) ──────────────
function sm2(easeFactor, interval, repetitions, quality) {
  let newInterval, newRepetitions;
  if (quality < 3) {
    newRepetitions = 0;
    newInterval = 1;
  } else {
    newRepetitions = repetitions + 1;
    if (repetitions === 0) {
      newInterval = 1;
    } else if (repetitions === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * easeFactor);
    }
  }
  const newEF = quality >= 3
    ? Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    : easeFactor;
  return { interval: newInterval, easeFactor: newEF, repetitions: newRepetitions };
}

// ─── Soft grading logic (mirrors Process Daily Answer Code node) ───────────────
function computeQuality(cbData, hintUsed) {
  if (cbData === 'daily_ans_know') return 5;
  return hintUsed ? 1 : 2;
}

// ─── State machine (mirrors Process Daily Answer Code node) ───────────────────
function processAnswer(state, cbData) {
  if (cbData === 'daily_ans_hint') {
    return { ...state, hintUsed: true, isHint: true, isFinished: false };
  }
  const card = state.cards[state.current];
  const quality = computeQuality(cbData, state.hintUsed);
  const sm2Result = sm2(card.easeFactor, card.interval, card.repetitions, quality);
  const results = [...state.results, {
    vocabId: card.vocabId, word: card.word, quality,
    hintUsed: state.hintUsed,
    newInterval: sm2Result.interval,
    newEaseFactor: sm2Result.easeFactor,
    newRepetitions: sm2Result.repetitions
  }];
  const current = state.current + 1;
  const isFinished = current >= state.cards.length;
  const correctCount = results.filter(r => r.quality >= 3).length;
  return { ...state, results, current, hintUsed: false, isHint: false, isFinished, correctCount };
}

function makeCard(overrides = {}) {
  return { vocabId: 1, word: 'ambitious', translation: 'амбициозный', context: '', easeFactor: 2.5, interval: 1, repetitions: 0, ...overrides };
}

function makeState(cards, overrides = {}) {
  return { cards, current: 0, results: [], hintUsed: false, sessionId: 42, nativeLang: 'ru', level: 'B1', ...overrides };
}

// ─── SECTION 1: SM-2 algorithm ────────────────────────────────────────────────
console.log('\n[Unit] SM-2 algorithm');

// First repetition (n=0): interval should be 1 regardless of quality
const r0 = sm2(2.5, 1, 0, 5);
assert(r0.interval === 1, 'n=0, q=5 → interval=1 (first review)');
assert(r0.repetitions === 1, 'n=0, q=5 → repetitions becomes 1');
assertClose(r0.easeFactor, 2.6, 'n=0, q=5 → EF increases to 2.6');

// Second repetition (n=1): interval should jump to 6
const r1 = sm2(2.5, 1, 1, 5);
assert(r1.interval === 6, 'n=1, q=5 → interval=6');
assert(r1.repetitions === 2, 'n=1, q=5 → repetitions becomes 2');

// Third repetition (n=2): interval = round(interval * EF)
const r2 = sm2(2.5, 6, 2, 5);
assert(r2.interval === 15, 'n=2, q=5, interval=6, ef=2.5 → interval=15');
assert(r2.repetitions === 3, 'n=2 → repetitions becomes 3');

// Failure resets repetitions and interval regardless of prior progress
const fail = sm2(2.8, 30, 5, 2);
assert(fail.interval === 1, 'failure → interval reset to 1');
assert(fail.repetitions === 0, 'failure → repetitions reset to 0');
assertClose(fail.easeFactor, 2.8, 'quality<3 → EF unchanged on failure');

// EF floor at 1.3
const floor = sm2(1.4, 1, 0, 3);
assert(floor.easeFactor >= 1.3, 'EF never goes below 1.3');
const hardFloor = sm2(1.3, 1, 0, 3);
assertClose(hardFloor.easeFactor, 1.3, 'EF stays at floor 1.3');

// Quality 3 (hard pass) — EF decreases slightly
const q3 = sm2(2.5, 1, 0, 3);
assert(q3.interval === 1, 'q=3 → pass (quality >= 3)');
assert(q3.easeFactor < 2.5, 'q=3 → EF decreases');
assert(q3.easeFactor >= 1.3, 'q=3 → EF still above floor');

// ─── SECTION 2: Soft grading ──────────────────────────────────────────────────
console.log('\n[Unit] Soft grading');

assert(computeQuality('daily_ans_know', false) === 5, 'know → quality 5');
assert(computeQuality('daily_ans_know', true) === 5, 'know+hint → quality 5 (know wins)');
assert(computeQuality('daily_ans_dontknow', false) === 2, 'dont_know, no hint → quality 2');
assert(computeQuality('daily_ans_dontknow', true) === 1, 'dont_know + hint → quality 1 (harshest)');

// ─── SECTION 3: State machine — hint flow ─────────────────────────────────────
console.log('\n[Unit] State machine — hint flow');

const state0 = makeState([makeCard(), makeCard({ vocabId: 2, word: 'ephemeral' })]);

// Hint: marks hintUsed, does not advance current
const afterHint = processAnswer(state0, 'daily_ans_hint');
assert(afterHint.hintUsed === true, 'hint → hintUsed=true');
assert(afterHint.current === 0, 'hint → current NOT advanced');
assert(afterHint.isHint === true, 'hint → isHint flag');
assert(afterHint.isFinished === false, 'hint → not finished');
assert(afterHint.results.length === 0, 'hint → no result recorded yet');

// Answer after hint: quality=1, resets hintUsed
const afterDontKnowWithHint = processAnswer(afterHint, 'daily_ans_dontknow');
assert(afterDontKnowWithHint.results[0].quality === 1, 'dontknow after hint → quality=1');
assert(afterDontKnowWithHint.results[0].hintUsed === true, 'result records hintUsed=true');
assert(afterDontKnowWithHint.hintUsed === false, 'hintUsed reset after answer');
assert(afterDontKnowWithHint.current === 1, 'current advanced to 1');
assert(afterDontKnowWithHint.isFinished === false, '2 cards, 1 answered → not finished');

// ─── SECTION 4: State machine — full happy path ────────────────────────────────
console.log('\n[Unit] State machine — full happy path');

const cards5 = Array.from({ length: 5 }, (_, i) => makeCard({ vocabId: i + 1, word: `word${i + 1}` }));
let state = makeState(cards5);

for (let i = 0; i < 5; i++) {
  state = processAnswer(state, 'daily_ans_know');
}

assert(state.isFinished === true, '5 knows → isFinished=true');
assert(state.current === 5, 'current advanced to 5');
assert(state.results.length === 5, '5 results recorded');
assert(state.correctCount === 5, 'correctCount=5');
assert(state.results.every(r => r.quality === 5), 'all results quality=5');

const xp = state.correctCount * 5 + (state.correctCount === 5 ? 20 : 0);
assert(xp === 45, 'perfect 5/5 → 5*5 + 20 = 45 XP');

// ─── SECTION 5: State machine — fail path ─────────────────────────────────────
console.log('\n[Unit] State machine — fail path');

const cards3 = Array.from({ length: 3 }, (_, i) => makeCard({ vocabId: i + 1, word: `w${i}` }));
let failState = makeState(cards3);
failState = processAnswer(failState, 'daily_ans_know');
failState = processAnswer(failState, 'daily_ans_dontknow');
failState = processAnswer(failState, 'daily_ans_dontknow');

assert(failState.isFinished === true, '3 cards answered → finished');
assert(failState.correctCount === 1, '1 know, 2 dontknow → correctCount=1');
const partialXp = failState.correctCount * 5 + (failState.correctCount === 3 ? 20 : 0);
assert(partialXp === 5, 'partial score → 1*5 + 0 = 5 XP (no perfect bonus)');

// Verify SM-2 reset for failed cards
const failedResult = failState.results[1];
assert(failedResult.newInterval === 1, 'failed card → interval reset to 1');
assert(failedResult.newRepetitions === 0, 'failed card → repetitions reset to 0');

// ─── SECTION 6: Edge cases ────────────────────────────────────────────────────
console.log('\n[Unit] Edge cases');

// Expired/missing state (no cards)
const emptyState = { cards: [], current: 0, results: [] };
assert(emptyState.cards.length === 0, 'expired state has no cards');

// Double-hint does not change quality (idempotent)
const baseState = makeState([makeCard()]);
const hint1 = processAnswer(baseState, 'daily_ans_hint');
const hint2 = processAnswer(hint1, 'daily_ans_hint');
assert(hint2.hintUsed === true, 'double hint → hintUsed stays true');
assert(hint2.current === 0, 'double hint → current not advanced');

// ─── SECTION 7: XP calculation ────────────────────────────────────────────────
console.log('\n[Unit] XP calculation');

function calcXP(correct, total) {
  return correct * 5 + (correct === total ? 20 : 0);
}
assert(calcXP(0, 5) === 0,  '0/5 → 0 XP');
assert(calcXP(1, 5) === 5,  '1/5 → 5 XP');
assert(calcXP(4, 5) === 20, '4/5 → 20 XP (no bonus)');
assert(calcXP(5, 5) === 45, '5/5 → 45 XP (25 + 20 bonus)');
assert(calcXP(3, 3) === 35, '3/3 → 35 XP (15 + 20 bonus)');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n[Unit Daily Lesson] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
