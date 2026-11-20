// Deletable LOC from AST spans. The deletion is a text splice of the file;
// the line count comes from the real diff (lines removed), never from an
// estimate, so the number on the page matches the diff shown. Combined
// conditions produce no deletion here: only lines guarded solely by the flag
// count, and a combined guard is "up to N", handled by finalize.

function offsetOf(content, line, column) {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const next = content.indexOf('\n', offset);
    if (next === -1) return content.length;
    offset = next + 1;
    current += 1;
  }
  return Math.min(offset + column, content.length);
}

function sliceSpan(content, span) {
  return content.slice(offsetOf(content, span.start.line, span.start.column), offsetOf(content, span.end.line, span.end.column));
}

// Inner text of a branch: for a block, the lines between the braces; for a
// single statement, the statement itself.
function innerText(content, span) {
  const text = sliceSpan(content, span);
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open !== -1 && close > open) return text.slice(open + 1, close);
  return text;
}

function spansOverlap(a, b) {
  const aStart = a.start.line * 100000 + a.start.column;
  const aEnd = a.end.line * 100000 + a.end.column;
  const bStart = b.start.line * 100000 + b.start.column;
  const bEnd = b.end.line * 100000 + b.end.column;
  return aStart < bEnd && bStart < aEnd;
}

// Apply one flag's deletion sites in one file. Sites are applied bottom-up
// so earlier line numbers stay valid. Overlapping sites (nested guards on
// the same flag) are skipped, not double-applied.
export function applyDeletions(content, sites, winningValue) {
  const ordered = [...sites].sort((a, b) => {
    if (a.stmt.start.line !== b.stmt.start.line) return b.stmt.start.line - a.stmt.start.line;
    return b.stmt.start.column - a.stmt.start.column;
  });
  let next = content;
  const appliedSpans = [];
  let applied = 0;
  let skipped = 0;
  for (const site of ordered) {
    if (site.shape === 'combined') {
      skipped += 1;
      continue;
    }
    if (appliedSpans.some((s) => spansOverlap(s, site.stmt))) {
      skipped += 1;
      continue;
    }
    let replacement = null;
    if (site.shape === 'if-else' || site.shape === 'if') {
      const branch = winningValue ? site.win : site.lose;
      replacement = branch ? innerText(next, branch) : '';
    } else if (site.shape === 'early-return') {
      if (winningValue !== true) {
        skipped += 1;
        continue;
      }
      replacement = '';
    } else if (site.shape === 'ternary') {
      const arm = winningValue ? site.win : site.lose;
      replacement = arm ? sliceSpan(next, arm) : '';
    } else if (site.shape === 'logical') {
      replacement = winningValue ? sliceSpan(next, site.win) : '';
    } else {
      skipped += 1;
      continue;
    }
    const start = offsetOf(next, site.stmt.start.line, site.stmt.start.column);
    const end = offsetOf(next, site.stmt.end.line, site.stmt.end.column);
    next = next.slice(0, start) + replacement + next.slice(end);
    appliedSpans.push(site.stmt);
    applied += 1;
  }
  return { newContent: next, changed: applied > 0, applied, skipped };
}

// Lines removed by a unified diff, excluding the --- header.
export function countRemovedLines(diffText) {
  let removed = 0;
  for (const line of (diffText || '').split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return removed;
}
