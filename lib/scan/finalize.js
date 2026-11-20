// Finalize a scan: signals, confidence, status, deletable LOC, and the
// deletion diff per flag, then carry user state forward from repo_flags.
// Needs the repo checked out on disk (for diffs) and the parse/age/provider
// states. Writes flag, reference, unresolved, and event rows, marks the scan
// done, and deletes the scan's Storage objects.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { evaluateFlag } from './signals.js';
import { applyDeletions } from './loc.js';
import { makeDiff } from './diff.js';

// LOC for a flag when the winning value is unknown: the max lines any one
// shape would remove under either assumption, never a sum across branches.
// Computed from the text splice, not from a stored diff.
function upToLoc(readFile, sites) {
  let max = 0;
  const byFile = new Map();
  for (const site of sites) {
    if (!byFile.has(site.file)) byFile.set(site.file, []);
    byFile.get(site.file).push(site);
  }
  for (const [file, fileSites] of byFile) {
    const content = readFile(file);
    if (!content) continue;
    for (const winning of [true, false]) {
      const { newContent } = applyDeletions(content, fileSites, winning);
      const removed = content.split('\n').length - newContent.split('\n').length;
      if (removed > max) max = removed;
    }
  }
  return max;
}

export async function finalizeScan(store, scan, repo, repoDir, parseState, ageState, providerState, opts = {}) {
  const now = opts.now || new Date();
  const settings = (await store.getSettings(scan.owner_id)) || {};
  const stalenessDays = settings.staleness_days || 90;
  const prevScan = await store.getLatestDoneScan(scan.repo_id, scan.id);
  const prevFlags = prevScan ? await store.getScanFlags(prevScan.id) : [];
  const prevKeys = new Set(prevFlags.map((f) => `${f.provider}:${f.key}`));
  const userStates = await store.getUserStates(scan.repo_id);
  const userByKey = new Map(userStates.map((u) => [`${u.provider}:${u.key}`, u]));

  // Group parsed references and sites by flag.
  const found = new Map();
  for (const ref of parseState.references || []) {
    const id = `${ref.provider}:${ref.key}`;
    if (!found.has(id)) {
      found.set(id, { key: ref.key, provider: ref.provider, kind: ref.kind, references: [], sites: [] });
    }
    found.get(id).references.push(ref);
  }
  for (const site of parseState.sites || []) {
    const id = `${site.provider}:${site.key}`;
    if (found.has(id)) found.get(id).sites.push({ ...site, file: site.file });
  }
  const unresolvedByKey = new Map();
  for (const u of parseState.unresolved || []) {
    unresolvedByKey.set(u.file, true);
  }
  const contentByFile = {};
  const readContent = (file) => {
    if (contentByFile[file] === undefined) {
      try {
        contentByFile[file] = readFileSync(join(repoDir, file), 'utf8');
      } catch {
        contentByFile[file] = null;
      }
    }
    return contentByFile[file];
  };

  const flagRows = [];
  const refRows = [];
  const flagIdByKey = new Map();
  const newKeys = new Set();

  for (const flag of found.values()) {
    const id = `${flag.provider}:${flag.key}`;
    newKeys.add(id);
    const age = (ageState && ageState[flag.key]) || { createdAt: null, lastChangedAt: null };
    const rollout = (providerState && providerState.byKey && providerState.byKey[flag.key]) || null;
    const userState = userByKey.get(id) || null;
    // A dynamic reference cannot be tied to a flag key, so the conservative
    // rule is same-file: a dynamic ref in a file caps the flags recorded in
    // that file at possible confidence.
    const unresolvedTouch = flag.references.some((r) => unresolvedByKey.has(r.file));
    const winningValue = rollout ? rollout.winningValue ?? null : null;
    const evaluated = evaluateFlag({
      key: flag.key, kind: flag.kind, references: flag.references,
      unresolvedTouch, age, rollout, winningValue, stalenessDays, userState, now,
    });

    // User state overrides the scanner status for display.
    let status = evaluated.status;
    if (userState && userState.user_status === 'ignored') status = 'ignored';

    // Deletable LOC and diff. Known winning value: one diff per flag across
    // its files, LOC from the diff. Unknown: "up to N", no diff.
    let deletableLoc = 0;
    let locUpTo = false;
    let locFormula = null;
    let diffText = null;
    if (flag.sites.length > 0) {
      if (winningValue === null) {
        deletableLoc = upToLoc(readContent, flag.sites);
        locUpTo = true;
        locFormula = 'Deletable LOC = lines in the losing branch + the guard lines, from AST node spans. Known winning value: unknown, so this is up to N.';
      } else {
        const byFile = new Map();
        for (const site of flag.sites) {
          if (!byFile.has(site.file)) byFile.set(site.file, []);
          byFile.get(site.file).push(site);
        }
        const diffs = [];
        for (const [file, fileSites] of byFile) {
          const content = readContent(file);
          if (content === null) continue;
          const { newContent } = applyDeletions(content, fileSites, winningValue);
          if (newContent === content) continue;
          try {
            const made = await makeDiff(repoDir, file, newContent, content);
            if (made) {
              diffs.push(made.diff);
              deletableLoc += made.removed;
            }
          } catch {
            // A diff that does not apply is not stored; the flag keeps its
            // call sites and caps at possible confidence.
            locUpTo = true;
          }
        }
        if (diffs.length > 0) {
          diffText = diffs.join('\n');
          locFormula = 'Deletable LOC = lines in the losing branch + the guard lines + the flag definition line, from AST node spans. Known winning value: ' + String(winningValue) + '. ' + deletableLoc + ' lines.';
        }
      }
    }

    const row = {
      scan_id: scan.id,
      repo_id: scan.repo_id,
      key: flag.key,
      provider: flag.provider,
      kind: flag.kind,
      status,
      confidence: evaluated.confidence,
      signals: evaluated.signals,
      created_at_git: age.createdAt,
      last_changed_at: age.lastChangedAt,
      age_source: age.approx ? 'github-api' : 'git',
      rollout_pct: rollout ? rollout.pct ?? null : null,
      rollout_source: rollout ? flag.provider : null,
      // The provider's temporary marker, kept so an un-ignore can re-apply
      // the kill-switch cap without another API call.
      rollout_by_env: rollout && rollout.temporary !== undefined ? { temporary: rollout.temporary } : null,
      winning_value: winningValue,
      references_count: flag.references.length,
      deletable_loc: deletableLoc,
      loc_up_to: locUpTo,
      loc_formula: locFormula,
      diff: diffText,
    };
    flagRows.push(row);
  }

  const inserted = await store.insertFlags(flagRows);
  for (const row of inserted) flagIdByKey.set(`${row.provider}:${row.key}`, row.id);
  for (const flag of found.values()) {
    const flagId = flagIdByKey.get(`${flag.provider}:${flag.key}`);
    if (!flagId) continue;
    for (const ref of flag.references) {
      refRows.push({
        flag_id: flagId,
        file_path: ref.file,
        line: ref.line,
        column: ref.column,
        kind: ref.refKind,
      });
    }
  }
  await store.insertReferences(refRows);
  await store.insertUnresolved(
    (parseState.unresolved || []).map((u) => ({ scan_id: scan.id, file_path: u.file, line: u.line, reason: u.reason })),
  );

  // Carry user state forward: ignored survives, marked-removed is confirmed
  // by absence or returns to Active with a reappeared event. A confirmed
  // removal keeps a struck-through row in this scan (status removed, no
  // references), so the dashboard still shows what was deleted.
  const prevByKey = new Map(prevFlags.map((f) => [`${f.provider}:${f.key}`, f]));
  for (const user of userStates) {
    const id = `${user.provider}:${user.key}`;
    if (user.user_status === 'marked_removed') {
      if (!newKeys.has(id)) {
        const prev = prevByKey.get(id);
        const removedRows = await store.insertFlags([{
          scan_id: scan.id,
          repo_id: scan.repo_id,
          key: user.key,
          provider: user.provider,
          kind: (prev && prev.kind) || 'sdk',
          status: 'removed',
          confidence: (prev && prev.confidence) || 'definite',
          signals: {},
          created_at_git: null,
          last_changed_at: null,
          age_source: 'git',
          rollout_pct: null,
          rollout_source: null,
          rollout_by_env: null,
          winning_value: null,
          references_count: 0,
          deletable_loc: 0,
          loc_up_to: false,
          loc_formula: null,
          diff: null,
        }]);
        await store.insertFlagEvent({
          repo_flag_id: user.id, flag_id: (removedRows[0] && removedRows[0].id) || null, actor_id: scan.owner_id,
          action: 'confirmed_removed', reason: user.reason,
        });
        await store.clearRepoFlagUserStatus(user.id);
      } else {
        await store.insertFlagEvent({
          repo_flag_id: user.id, flag_id: flagIdByKey.get(id) || null, actor_id: scan.owner_id,
          action: 'reappeared', reason: 'Flag found again by a rescan.',
        });
        await store.clearRepoFlagUserStatus(user.id);
      }
    }
  }

  await store.updateScan(scan.id, {
    status: 'done',
    finished_at: now.toISOString(),
    updated_at: now.toISOString(),
    progress: {
      step: 'done',
      files_scanned: parseState.filesScanned || 0,
      flags: flagRows.length,
      files_total: parseState.filesTotal || 0,
      applied_ignore: parseState.appliedIgnore || [],
      ignored_paths: parseState.skippedPaths || 0,
      ignored_flags: (parseState.ignoredFlagKeys || []).length,
    },
  });
  return { flags: flagRows.length, deletable: flagRows.filter((f) => f.status === 'deletable').length };
}
