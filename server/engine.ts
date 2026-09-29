export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type ClueType =
  | 'positionParity' | 'greaterThan' | 'lessThan' | 'sumEquals'
  | 'differenceEquals' | 'sumOfThree' | 'totalSum' | 'exactOddCount'
  | 'distinct' | 'exactDigit';

export interface DifficultyConfig {
  level: DifficultyLevel;
  digits: number;
  seconds: number;
  maxClues: number;
  candidateClues: number;
  allowedTypes: ClueType[];
}

export const DIFFICULTY: Record<DifficultyLevel, DifficultyConfig> = {
  1: { level: 1, digits: 4, seconds: 150, maxClues: 5, candidateClues: 12,
    allowedTypes: ['positionParity', 'greaterThan', 'lessThan', 'sumEquals', 'distinct', 'exactDigit'] },
  2: { level: 2, digits: 4, seconds: 135, maxClues: 5, candidateClues: 14,
    allowedTypes: ['positionParity', 'greaterThan', 'lessThan', 'sumEquals', 'differenceEquals', 'distinct', 'exactDigit'] },
  3: { level: 3, digits: 5, seconds: 120, maxClues: 6, candidateClues: 16,
    allowedTypes: ['positionParity', 'greaterThan', 'lessThan', 'sumEquals', 'differenceEquals', 'sumOfThree', 'totalSum', 'exactOddCount', 'distinct'] },
  4: { level: 4, digits: 5, seconds: 105, maxClues: 6, candidateClues: 18,
    allowedTypes: ['positionParity', 'greaterThan', 'lessThan', 'sumEquals', 'differenceEquals', 'sumOfThree', 'totalSum', 'exactOddCount', 'distinct'] },
  5: { level: 5, digits: 5, seconds: 90, maxClues: 7, candidateClues: 20,
    allowedTypes: ['positionParity', 'greaterThan', 'lessThan', 'sumEquals', 'differenceEquals', 'sumOfThree', 'totalSum', 'exactOddCount', 'distinct'] }
};

const POSITION_NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const fmtPos = (i: number) => POSITION_NAMES[i];
const randomInt = (max: number, rng: () => number) => Math.floor(rng() * max);

interface ClueSpec {
  type: ClueType;
  a?: number; b?: number; c?: number; value?: number; parity?: 0 | 1;
}

export interface Clue {
  id: string;
  type: ClueType;
  text: string;
  readonly spec?: ClueSpec;
  evaluate: (digits: number[]) => boolean;
}

export interface Puzzle {
  level: DifficultyLevel;
  digits: number;
  seconds: number;
  secret: string;
  clues: Clue[];
  solutionCount: number;
  candidateCount: number;
}

interface CodeSpace { codes: number[]; pos: Uint8Array[]; }
const codeSpaceCache = new Map<number, CodeSpace>();

function getCodeSpace(digits: number): CodeSpace {
  const cached = codeSpaceCache.get(digits);
  if (cached) return cached;
  const total = 10 ** digits;
  const codes = Array.from({ length: total }, (_, i) => i);
  const pos = Array.from({ length: digits }, () => new Uint8Array(total));
  for (let code = 0; code < total; code++) {
    let n = code;
    for (let p = digits - 1; p >= 0; p--) { pos[p][code] = n % 10; n = Math.floor(n / 10); }
  }
  const space = { codes, pos };
  codeSpaceCache.set(digits, space);
  return space;
}

function evalSpecFast(s: ClueSpec, code: number, space: CodeSpace): boolean {
  const a = s.a ?? 0, b = s.b ?? 0;
  const da = space.pos[a][code], db = space.pos[b][code];
  switch (s.type) {
    case 'positionParity': return da % 2 === s.parity;
    case 'greaterThan': return da > db;
    case 'lessThan': return da < db;
    case 'sumEquals': return da + db === s.value;
    case 'differenceEquals': return Math.abs(da - db) === s.value;
    case 'sumOfThree': return da + db + space.pos[s.c ?? 0][code] === s.value;
    case 'totalSum': { let sum = 0; for (let p = 0; p < space.pos.length; p++) sum += space.pos[p][code]; return sum === s.value; }
    case 'exactOddCount': { let odd = 0; for (let p = 0; p < space.pos.length; p++) odd += space.pos[p][code] & 1; return odd === s.value; }
    case 'distinct': { let mask = 0; for (let p = 0; p < space.pos.length; p++) { const bit = 1 << space.pos[p][code]; if (mask & bit) return false; mask |= bit; } return true; }
    case 'exactDigit': return da === s.value;
  }
}

function specKey(s: ClueSpec) { return JSON.stringify(s); }

function makeSpec(type: ClueType, digits: number[], rng: () => number): ClueSpec | null {
  const n = digits.length;
  if (type === 'positionParity') {
    const a = randomInt(n, rng); return { type, a, parity: (digits[a] % 2) as 0 | 1 };
  }
  if (type === 'greaterThan' || type === 'lessThan') {
    let a = randomInt(n, rng), b = randomInt(n - 1, rng); if (b >= a) b++;
    if (a > b) [a, b] = [b, a];
    if (type === 'greaterThan' && digits[a] <= digits[b]) return null;
    if (type === 'lessThan' && digits[a] >= digits[b]) return null;
    return { type, a, b };
  }
  if (type === 'sumEquals' || type === 'differenceEquals') {
    let a = randomInt(n, rng), b = randomInt(n - 1, rng); if (b >= a) b++;
    if (a > b) [a, b] = [b, a];
    return { type, a, b, value: type === 'sumEquals' ? digits[a] + digits[b] : Math.abs(digits[a] - digits[b]) };
  }
  if (type === 'sumOfThree') {
    const ps = Array.from({ length: n }, (_, i) => i);
    for (let i = ps.length - 1; i > 0; i--) { const j = randomInt(i + 1, rng); [ps[i], ps[j]] = [ps[j], ps[i]]; }
    ps.splice(3);
    ps.sort((x, y) => x - y);
    return { type, a: ps[0], b: ps[1], c: ps[2], value: ps.reduce((sum, p) => sum + digits[p], 0) };
  }
  if (type === 'totalSum') return { type, value: digits.reduce((a, b) => a + b, 0) };
  if (type === 'exactOddCount') return { type, value: digits.filter(d => d % 2).length };
  if (type === 'distinct') return new Set(digits).size === n ? { type } : null;
  if (type === 'exactDigit') { const a = randomInt(n, rng); return { type, a, value: digits[a] }; }
  return null;
}

function specToClue(s: ClueSpec, digits: number, id: string): Clue {
  let text: string;
  switch (s.type) {
    case 'positionParity': text = `The ${fmtPos(s.a!)} digit is ${s.parity === 0 ? 'even' : 'odd'}.`; break;
    case 'greaterThan': text = `The ${fmtPos(s.a!)} digit is greater than the ${fmtPos(s.b!)} digit.`; break;
    case 'lessThan': text = `The ${fmtPos(s.a!)} digit is less than the ${fmtPos(s.b!)} digit.`; break;
    case 'sumEquals': text = `The ${fmtPos(s.a!)} and ${fmtPos(s.b!)} digits add up to ${s.value}.`; break;
    case 'differenceEquals': text = `The difference between the ${fmtPos(s.a!)} and ${fmtPos(s.b!)} digits is ${s.value}.`; break;
    case 'sumOfThree': text = `The ${fmtPos(s.a!)}, ${fmtPos(s.b!)} and ${fmtPos(s.c!)} digits add up to ${s.value}.`; break;
    case 'totalSum': text = `All digits add up to ${s.value}.`; break;
    case 'exactOddCount': text = `Exactly ${s.value} digit${s.value === 1 ? '' : 's'} in the code ${s.value === 1 ? 'is' : 'are'} odd.`; break;
    case 'distinct': text = 'No digit is repeated.'; break;
    case 'exactDigit': text = `The ${fmtPos(s.a!)} digit is ${s.value}.`; break;
  }
  return { id, type: s.type, text, spec: s, evaluate: ds => evalSpecOnDigits(s, ds) };
}

function evalSpecOnDigits(s: ClueSpec, ds: number[]): boolean {
  const a = s.a ?? 0, b = s.b ?? 0;
  switch (s.type) {
    case 'positionParity': return ds[a] % 2 === s.parity;
    case 'greaterThan': return ds[a] > ds[b];
    case 'lessThan': return ds[a] < ds[b];
    case 'sumEquals': return ds[a] + ds[b] === s.value;
    case 'differenceEquals': return Math.abs(ds[a] - ds[b]) === s.value;
    case 'sumOfThree': return ds[a] + ds[b] + ds[s.c ?? 0] === s.value;
    case 'totalSum': return ds.reduce((x, y) => x + y, 0) === s.value;
    case 'exactOddCount': return ds.filter(d => d % 2).length === s.value;
    case 'distinct': return new Set(ds).size === ds.length;
    case 'exactDigit': return ds[a] === s.value;
  }
}

function canAdd(specs: ClueSpec[], candidate: ClueSpec, level: DifficultyLevel): boolean {
  const count = specs.filter(s => s.type === candidate.type).length;
  if (candidate.type === 'exactDigit') return level <= 2 && count < 1;
  return count < 2;
}

function filterOne(candidates: number[], spec: ClueSpec, space: CodeSpace): number[] {
  const out: number[] = [];
  for (const code of candidates) if (evalSpecFast(spec, code, space)) out.push(code);
  return out;
}

export function countSolutions(clues: Clue[], digits: number): number {
  const space = getCodeSpace(digits);
  let current = space.codes;
  for (const clue of clues) {
    const spec = clue.spec;
    const next: number[] = [];
    for (const code of current) {
      if (spec ? evalSpecFast(spec, code, space) : clue.evaluate(code.toString().padStart(digits, '0').split('').map(Number))) next.push(code);
    }
    current = next;
    if (current.length <= 1) break;
  }
  return current.length;
}

function randomDistinctDigits(n: number, rng: () => number): number[] {
  const pool = Array.from({ length: 10 }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1, rng); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}

function secretValue(ds: number[]) { return Number(ds.join('')); }

export function generatePuzzle(level: DifficultyLevel, rng: () => number = Math.random, maxAttempts = 500): Puzzle {
  const config = DIFFICULTY[level];
  const space = getCodeSpace(config.digits);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const secretDigits = level >= 3 ? randomDistinctDigits(config.digits, rng) : Array.from({ length: config.digits }, () => randomInt(10, rng));
    const secret = secretValue(secretDigits);
    const candidates: ClueSpec[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < config.candidateClues * 20 && candidates.length < config.candidateClues; i++) {
      const type = config.allowedTypes[randomInt(config.allowedTypes.length, rng)];
      const spec = makeSpec(type, secretDigits, rng);
      if (!spec) continue;
      const key = specKey(spec);
      if (seen.has(key) || !canAdd(candidates, spec, level)) continue;
      if (!evalSpecOnDigits(spec, secretDigits)) continue;
      seen.add(key); candidates.push(spec);
    }
    if (candidates.length < config.maxClues) continue;

    let remaining = space.codes;
    const selected: ClueSpec[] = [];
    const pool = [...candidates];
    while (selected.length < config.maxClues && pool.length && remaining.length > 1) {
      let best = -1, bestFiltered: number[] | null = null;
      for (let i = 0; i < pool.length; i++) {
        const filtered = filterOne(remaining, pool[i], space);
        if (!filtered.includes(secret)) continue;
        if (!bestFiltered || filtered.length < bestFiltered.length) { best = i; bestFiltered = filtered; }
      }
      if (best < 0 || !bestFiltered) break;
      selected.push(pool.splice(best, 1)[0]);
      remaining = bestFiltered;
    }

    if (remaining.length !== 1 || remaining[0] !== secret) continue;
    if (!selected.every(s => evalSpecOnDigits(s, secretDigits))) continue;
    const clues = selected.map((s, i) => specToClue(s, config.digits, `c${i}`));
    if (countSolutions(clues, config.digits) !== 1) continue;
    return { level, digits: config.digits, seconds: config.seconds, secret: secretDigits.join(''), clues, solutionCount: 1, candidateCount: space.codes.length };
  }
  throw new Error(`Could not generate a unique level ${level} puzzle after ${maxAttempts} attempts`);
}

export function assignClues(puzzle: Puzzle, playerIds: string[], keypadPlayerId: string, rng: () => number = Math.random): Record<string, Clue[]> {
  if (playerIds.length < 2 || playerIds.length > 8) throw new Error('Vault Crew requires 2–8 players');
  if (!playerIds.includes(keypadPlayerId)) throw new Error('Keypad player must be in the room');

  const result: Record<string, Clue[]> = Object.fromEntries(playerIds.map(id => [id, []]));
  const clues = [...puzzle.clues];
  const required = playerIds.length + 1;
  const used = new Set(clues.map(c => c.text));
  const secretDigits = puzzle.secret.split('').map(Number);

  // Extras are generated only when the crew is large enough to need them.
  // Per-type caps may be relaxed for these extras, but exactDigit never is.
  for (let i = 0; clues.length < required; i++) {
    let added: Clue | null = null;
    for (let tries = 0; tries < 100; tries++) {
      const type = DIFFICULTY[puzzle.level].allowedTypes[randomInt(DIFFICULTY[puzzle.level].allowedTypes.length, rng)];
      if (type === 'exactDigit') continue;
      const spec = makeSpec(type, secretDigits, rng);
      if (!spec || !evalSpecOnDigits(spec, secretDigits)) continue;
      const clue = specToClue(spec, puzzle.digits, `extra${i}-${tries}`);
      if (used.has(clue.text)) continue;
      used.add(clue.text); added = clue; break;
    }
    if (!added) {
      // Deterministic fallback: enumerate allowed true clue specs until one is found.
      outer: for (const type of DIFFICULTY[puzzle.level].allowedTypes) {
        if (type === 'exactDigit') continue;
        for (let a = 0; a < puzzle.digits; a++) for (let b = a + 1; b < puzzle.digits; b++) {
          const specs: ClueSpec[] = type === 'greaterThan' ? [{type,a,b}] : type === 'lessThan' ? [{type,a,b}] :
            type === 'sumEquals' ? [{type,a,b,value:secretDigits[a]+secretDigits[b]}] :
            type === 'differenceEquals' ? [{type,a,b,value:Math.abs(secretDigits[a]-secretDigits[b])}] : [];
          for (const s of specs) { const c = specToClue(s,puzzle.digits,`extra${i}`); if(!used.has(c.text)){used.add(c.text);added=c;break outer;} }
        }
        if (type === 'positionParity' || type === 'totalSum' || type === 'exactOddCount' || type === 'distinct') {
          const s = type === 'positionParity' ? {type,a:0,parity:(secretDigits[0]%2) as 0|1} :
            type === 'totalSum' ? {type,value:secretDigits.reduce((x,y)=>x+y,0)} :
            type === 'exactOddCount' ? {type,value:secretDigits.filter(d=>d%2).length} : {type};
          const c=specToClue(s,puzzle.digits,`extra${i}`); if(!used.has(c.text)){used.add(c.text);added=c;break;}
        }
        if (type === 'sumOfThree' && puzzle.digits >= 3) {
          const s={type,a:0,b:1,c:2,value:secretDigits[0]+secretDigits[1]+secretDigits[2]} as ClueSpec;
          const c=specToClue(s,puzzle.digits,`extra${i}`); if(!used.has(c.text)){used.add(c.text);added=c;break;}
        }
      }
    }
    if (!added) throw new Error(`Could not create enough clues for ${playerIds.length} players`);
    clues.push(added);
  }

  // Give every player one clue. Then give the one spare clue to a non-keypad player.
  // Remaining clues are distributed among non-keypad players, keeping keypad lighter.
  const others = playerIds.filter(id => id !== keypadPlayerId);
  let index = 0;
  for (const id of others) result[id].push(clues[index++]);
  result[keypadPlayerId].push(clues[index++]);
  let oi = 0;
  while (index < clues.length) result[others[oi++ % others.length]].push(clues[index++]);
  return result;
}

export function publicPuzzlePayload(puzzle: Puzzle, assignedClues: Clue[], isKeypad: boolean) {
  return { level: puzzle.level, digits: puzzle.digits, seconds: puzzle.seconds, role: isKeypad ? 'keypad' : 'clue', clues: assignedClues.map(({id,type,text}) => ({id,type,text})) };
}
