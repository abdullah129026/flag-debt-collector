// No-git age fallback (PLAN risk 4). When the git binary is absent from the
// runtime, age comes from the GitHub API: the oldest commit touching each
// distinct file with a reference, one commits-list call per file, capped at
// 100 files. Ages from this path are labeled "approx", rename detection is
// unavailable, and flags are capped at possible confidence. GitLab has no
// equivalent cheap call, so the fallback only covers github.com.

export const MAX_FALLBACK_FILES = 100;

// Returns {createdAt, lastChangedAt, approx: true} per file, or null per
// file when the API cannot answer.
export async function approxAgeForFiles(owner, repo, files, fetchImpl = fetch, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const out = {};
  for (const file of files.slice(0, MAX_FALLBACK_FILES)) {
    try {
      const res = await fetchImpl(
        `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(file)}&per_page=100`,
        { headers },
      );
      if (!res.ok) {
        out[file] = null;
        continue;
      }
      const commits = await res.json();
      if (!Array.isArray(commits) || commits.length === 0) {
        out[file] = null;
        continue;
      }
      const newest = commits[0].commit.committer.date;
      const oldest = commits[commits.length - 1].commit.committer.date;
      out[file] = { createdAt: oldest, lastChangedAt: newest, approx: true };
    } catch {
      out[file] = null;
    }
  }
  return out;
}
