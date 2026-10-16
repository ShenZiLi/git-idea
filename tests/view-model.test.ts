import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRows } from '../src/diff';
import { graphRows } from '../src/graph';
import type { Commit } from '../shared/types';
test('diff aligns replacements, insertions, deletions and CRLF without losing line numbers', () => {
  const rows = diffRows('a\r\nb\r\nc\r\n', 'a\nB\nextra\nc\n');
  assert.equal(rows[0].kind, 'same'); assert.equal(rows[1].kind, 'change'); assert.equal(rows[1].oldNumber, 2); assert.equal(rows[1].newNumber, 2);
  assert.equal(rows[2].kind, 'add'); assert.equal(rows[3].oldNumber, 3); assert.equal(rows[3].newNumber, 4);
  assert.equal(diffRows('a\n', '')[0].kind, 'delete'); assert.equal(diffRows('', 'a\n')[0].kind, 'add');
  assert.equal(diffRows('  a\n', 'a\n', true)[0].kind, 'same');
});
test('graph preserves parallel lanes and connects both parents of a merge', () => {
  const commits = [{ hash: 'm', parents: ['a', 'b'] }, { hash: 'a', parents: ['root'] }, { hash: 'b', parents: ['root'] }, { hash: 'root', parents: [] }] as Commit[];
  const rows = graphRows(commits);
  assert.equal(rows[0].lines.filter(l => l.start).length, 2);
  assert.equal(rows[0].width, 2); assert.equal(rows[2].lane, 1);
  assert.equal(rows[3].lines.filter(l => l.start).length, 0);
  for (const row of rows) for (const line of row.lines) assert.ok(line.to >= 0);
});
