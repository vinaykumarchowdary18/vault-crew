import test from 'node:test';
import assert from 'node:assert/strict';
import { assignClues, countSolutions, generatePuzzle, DIFFICULTY, type DifficultyLevel } from './engine.ts';

const LEVELS: DifficultyLevel[] = [1, 2, 3, 4, 5];
const COUNT = Number(process.env.STRESS_COUNT ?? 200);
const ASSIGN_COUNT = Number(process.env.ASSIGN_COUNT ?? 500);

test(`correctness: ${COUNT} puzzles per level`, () => {
  for (const level of LEVELS) for (let i = 0; i < COUNT; i++) {
    const puzzle = generatePuzzle(level);
    const digits = puzzle.secret.split('').map(Number);
    assert.equal(puzzle.solutionCount, 1);
    assert.equal(countSolutions(puzzle.clues, puzzle.digits), 1);
    assert.ok(puzzle.clues.every(c => c.evaluate(digits)), `false clue at level ${level}`);
  }
});

test(`generation timing: ${COUNT} puzzles per level under 200ms`, () => {
  for (const level of LEVELS) {
    let max = 0;
    for (let i = 0; i < COUNT; i++) {
      const t = performance.now();
      generatePuzzle(level);
      max = Math.max(max, performance.now() - t);
    }
    assert.ok(max < 200, `level ${level} max generation time ${max.toFixed(2)}ms`);
  }
});

test(`assignment: ${ASSIGN_COUNT} puzzles per level for 2–8 players`, () => {
  for (const level of LEVELS) for (let i = 0; i < ASSIGN_COUNT; i++) {
    const puzzle = generatePuzzle(level);
    for (let count = 2; count <= 8; count++) {
      const ids = Array.from({length: count}, (_, j) => `p${j}`);
      const assigned = assignClues(puzzle, ids, ids[0]);
      for (const id of ids) assert.ok(assigned[id].length >= 1, `${level}/${count}: ${id} has no clue`);
      assert.ok(assigned[ids[0]].length <= Math.max(...ids.slice(1).map(id => assigned[id].length)));
      assert.equal(Object.values(assigned).reduce((n, cs) => n + cs.length, 0), Math.max(puzzle.clues.length, count + 1));
    }
  }
});

test('base puzzle clue caps', () => {
  for (const level of LEVELS) for (let i = 0; i < Math.min(COUNT, 200); i++) {
    const p = generatePuzzle(level);
    const counts = new Map<string, number>();
    for (const c of p.clues) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    for (const [type, count] of counts) assert.ok(count <= 2, `${level}: ${type} count ${count}`);
    const exact = counts.get('exactDigit') ?? 0;
    if (level <= 2) assert.ok(exact <= 1);
    else assert.equal(exact, 0);
    for (const c of p.clues) assert.ok(!/fourth and second|third and first|fifth and third/.test(c.text));
  }
});
