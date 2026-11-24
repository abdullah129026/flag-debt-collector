// Deletion diff without git: a unified diff built from the two contents
// with Myers' O(ND) algorithm, so the diff shown on a flag is the real
// diff of the deletion. A diff from this generator applies by
// construction; the test proves it by applying the generated diff back
// to the original content. No file on disk is touched: the old version
// wrote the new content, ran `git diff`, and restored with `git checkout`.

import { countRemovedLines } from './loc.js';

function splitLines(content) {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Myers diff on two line arrays. Returns ops in order, each {type, line,
// ai, bi}: ' ' is a shared line, '-' is in a only (ai set), '+' is in b
// only (bi set). The trace stores one V array per edit distance so the
// backtrack can replay the path.
function myersOps(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  const offset = max + 1;
  const width = 2 * max + 3;
  const v = new Array(width).fill(0);
  const trace = [];
  v[offset + 1] = 0;
  let foundD = -1;
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) { foundD = d; break; }
    }
    trace.push(v.slice());
    if (foundD !== -1) break;
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const prev = trace[d - 1];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: ' ', line: a[x - 1], ai: x - 1, bi: y - 1 });
      x -= 1; y -= 1;
    }
    if (x === prevX) {
      ops.push({ type: '+', line: b[y - 1], ai: -1, bi: y - 1 });
      y -= 1;
    } else {
      ops.push({ type: '-', line: a[x - 1], ai: x - 1, bi: -1 });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: ' ', line: a[x - 1], ai: x - 1, bi: y - 1 });
    x -= 1; y -= 1;
  }
  ops.reverse();
  return ops;
}

// Format ops as a unified diff with 3 lines of context. Changes separated
// by 6 or fewer context lines merge into one hunk, as git does.
function formatDiff(relPath, ops, aLen, bLen, aEndsNewline, bEndsNewline) {
  const out = [`diff --git a/${relPath} b/${relPath}`, `--- a/${relPath}`, `+++ b/${relPath}`];
  const n = ops.length;
  const hunks = [];
  let i = 0;
  while (i < n) {
    if (ops[i].type === ' ') { i += 1; continue; }
    const start = Math.max(0, i - 3);
    let end = i + 1;
    for (;;) {
      let next = -1;
      for (let j = end; j < Math.min(n, end + 6); j++) {
        if (ops[j].type !== ' ') { next = j; break; }
      }
      if (next === -1) break;
      end = next + 1;
    }
    end = Math.min(n, end + 3);
    hunks.push([start, end]);
    i = end;
  }
  let aPos = 0;
  let bPos = 0;
  let consumed = 0;
  for (const [start, end] of hunks) {
    for (let k = consumed; k < start; k++) {
      if (ops[k].type !== '+') aPos += 1;
      if (ops[k].type !== '-') bPos += 1;
    }
    let aCount = 0;
    let bCount = 0;
    for (let k = start; k < end; k++) {
      if (ops[k].type !== '+') aCount += 1;
      if (ops[k].type !== '-') bCount += 1;
    }
    const aStart = aCount === 0 ? aPos : aPos + 1;
    const bStart = bCount === 0 ? bPos : bPos + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (let k = start; k < end; k++) {
      const op = ops[k];
      out.push(`${op.type}${op.line}`);
      if (op.type !== '+') aPos += 1;
      if (op.type !== '-') bPos += 1;
      const noNewlineA = op.type !== '+' && op.ai === aLen - 1 && !aEndsNewline;
      const noNewlineB = op.type !== '-' && op.bi === bLen - 1 && !bEndsNewline;
      if (noNewlineA || noNewlineB) out.push('\\ No newline at end of file');
    }
    consumed = end;
  }
  return `${out.join('\n')}\n`;
}

// Returns {diff, removed} or null when the content is unchanged.
export function makeDiff(relPath, newContent, originalContent) {
  if (newContent === originalContent) return null;
  const a = splitLines(originalContent);
  const b = splitLines(newContent);
  const ops = myersOps(a, b);
  const diff = formatDiff(relPath, ops, a.length, b.length, originalContent.endsWith('\n'), newContent.endsWith('\n'));
  return { diff, removed: countRemovedLines(diff) };
}
