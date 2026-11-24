// Repo URL validation + pre-clone size check. Every rejection names the
// fixed failure cause from PLAN 0.1 so the UI can show the fixed copy.

export const ALLOWED_HOSTS = ['github.com', 'gitlab.com'];
export const MAX_MB = 100;
export const MAX_FILES = 10000;

export const FAILURE_MESSAGES = {
  private_repo: 'This repo is private. Public repos only in v1.',
  not_found: 'No repo at that URL. Check the owner and name.',
  non_allowlisted_host: 'Only github.com and gitlab.com repos are supported.',
  no_js_ts_files: 'No JavaScript or TypeScript files found in this repo.',
  over_caps: 'This repo is over the scan caps (100 MB, 10,000 files).',
  download_timeout: 'The download timed out. The repo may be too large or the host slow.',
  download_failed: 'The repo download failed. The host may be slow or unavailable. Try again in a few minutes.',
  quota_used: 'You have used 3 anonymous scans today. Quota resets at midnight UTC.',
  queue_full: 'Scan queue full. 10 scans are queued. Try again in a few minutes.',
};

// Parse and normalize a pasted repo URL. Returns {ok, host, owner, repo,
// fullName, url} or {ok: false, cause, message}.
export function parseRepoUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, cause: 'not_found', message: 'Paste a repo URL first.' };
  }
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, cause: 'not_found', message: 'That does not look like a repo URL. Use https://github.com/owner/repo.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, cause: 'non_allowlisted_host', message: FAILURE_MESSAGES.non_allowlisted_host };
  }
  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, cause: 'non_allowlisted_host', message: FAILURE_MESSAGES.non_allowlisted_host };
  }
  const host = parsed.hostname.replace(/^www\./, '');
  if (!ALLOWED_HOSTS.includes(host)) {
    return { ok: false, cause: 'non_allowlisted_host', message: FAILURE_MESSAGES.non_allowlisted_host };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes('[')) {
    return { ok: false, cause: 'non_allowlisted_host', message: FAILURE_MESSAGES.non_allowlisted_host };
  }
  const parts = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length !== 2) {
    return { ok: false, cause: 'not_found', message: 'That does not look like a repo URL. Use https://github.com/owner/repo.' };
  }
  const [owner, repo] = parts;
  return { ok: true, host, owner, repo, fullName: `${owner}/${repo}`, url: `https://${host}/${owner}/${repo}` };
}

// Pre-download size check via the host API. Returns {ok: true, sizeMb,
// defaultBranch} or {ok: false, cause} or {ok: true, unknown: true} when
// the API cannot be reached (the post-extraction cap check is then the
// enforcement, and the download resolves the branch itself).
// fetchImpl is injectable for tests; token is optional (GITHUB_TOKEN).
export async function checkRepoSize(parsed, fetchImpl = fetch, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    if (parsed.host === 'github.com') {
      const res = await fetchImpl(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
      if (res.status === 404) return { ok: false, cause: 'not_found' };
      if (res.status === 403 || res.status === 401) return { ok: false, cause: 'private_repo' };
      if (!res.ok) return { ok: true, unknown: true };
      const data = await res.json();
      const sizeMb = (data.size || 0) / 1024;
      if (sizeMb > MAX_MB) return { ok: false, cause: 'over_caps' };
      return { ok: true, sizeMb, defaultBranch: data.default_branch || null };
    }
    const res = await fetchImpl(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(parsed.fullName)}`,
      { headers: {} },
    );
    if (res.status === 404) return { ok: false, cause: 'not_found' };
    if (res.status === 403 || res.status === 401) return { ok: false, cause: 'private_repo' };
    if (!res.ok) return { ok: true, unknown: true };
    const data = await res.json();
    const sizeMb = ((data.statistics && data.statistics.repository_size) || 0) / (1024 * 1024);
    if (sizeMb > MAX_MB) return { ok: false, cause: 'over_caps' };
    return { ok: true, sizeMb, defaultBranch: data.default_branch || null };
  } catch {
    return { ok: true, unknown: true };
  }
}
