import test from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTY, assignClues, countSolutions, generatePuzzle, publicPuzzlePayload } from './engine.ts';

test('difficulty requirements are enforced', () => {
  assert.equal(DIFFICULTY[1].digits, 4);
  assert.equal(DIFFICULTY[1].seconds, 150);
  assert.equal(DIFFICULTY[1].maxClues, 5);
  for (const level of [1, 2, 3, 4, 5] as const) assert.ok(DIFFICULTY[level].seconds >= 90);
  assert.equal(DIFFICULTY[5].digits, 5);
});

test('generated level 1 puzzle has exactly one solution', () => {
  let seed = 123456789;
  const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
  const puzzle = generatePuzzle(1, rng);
  assert.equal(puzzle.solutionCount, 1);
  assert.equal(countSolutions(puzzle.clues, puzzle.digits), 1);
  assert.equal(puzzle.secret.length, 4);
});

test('two-player assignment gives clues to keypad and non-keypad player', () => {
  const puzzle = generatePuzzle(1);
  const assigned = assignClues(puzzle, ['a', 'b'], 'a');
  assert.ok(assigned.a.length > 0);
  assert.ok(assigned.b.length > 0);
  assert.equal(assigned.a.length + assigned.b.length, puzzle.clues.length);
});

test('keypad receives fewer clues when possible', () => {
  const puzzle = generatePuzzle(1);
  const assigned = assignClues(puzzle, ['a', 'b', 'c'], 'a');
  assert.ok(assigned.a.length <= assigned.b.length);
  assert.ok(assigned.a.length <= assigned.c.length);
});

test('public payload never contains the secret', () => {
  const puzzle = generatePuzzle(1);
  const assigned = assignClues(puzzle, ['a', 'b'], 'a');
  const payload = publicPuzzlePayload(puzzle, assigned.a, true) as Record<string, unknown>;
  assert.equal('secret' in payload, false);
  assert.equal(JSON.stringify(payload).includes(puzzle.secret), false);
});

test('generated level 1 puzzles stay within five clues', () => {
  for (let i = 0; i < 20; i++) {
    const puzzle = generatePuzzle(1);
    assert.ok(puzzle.clues.length <= 5);
    assert.equal(puzzle.solutionCount, 1);
  }
});
