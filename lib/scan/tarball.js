// Repo fetch without git: download the host's tarball and extract it.
// The Vercel Node runtime has no git binary, so `git clone` fails there
// with spawn ENOENT. The tarball is the repo's default branch at HEAD;
// history is gone, so age comes from the host API (see age-fallback.js)
// and flags cap at possible confidence. Nothing here assumes any binary
// exists in the runtime: download is fetch, extraction is node:zlib plus
// a small tar reader written against the format (ponytail: stdlib before
// a new dependency; a `tar` package would only save ~100 lines and the
// reader below is covered by tests against real GNU tar output).

import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { MAX_MB, MAX_FILES } from './url.js';

export const DOWNLOAD_TIMEOUT_MS = 90000;
const MAX_DOWNLOAD_BYTES = MAX_MB * 1024 * 1024;

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function tarballUrl(host, owner, repo, ref) {
  if (host === 'github.com') return `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  return `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}/repository/archive.tar.gz?sha=${encodeURIComponent(ref)}`;
}

// Repo metadata: default branch, plus the existence check. Throws
// not_found / private_repo / download_failed with the fixed causes.
async function repoMeta(host, owner, repo, fetchImpl, token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = host === 'github.com'
    ? `https://api.github.com/repos/${owner}/${repo}`
    : `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${owner}/${repo}`)}`;
  let res;
  try {
    // Capped at 3s: a hung metadata call must fail fast, not eat the
    // tick's 10s function budget.
    res = await fetchImpl(url, { headers: host === 'github.com' ? headers : {}, signal: AbortSignal.timeout(3000) });
  } catch {
    throw fail('download_failed', 'Could not reach the repo host. Check the connection and try again.');
  }
  if (res.status === 404) throw fail('not_found', 'No repo at that URL. Check the owner and name.');
  if (res.status === 403 || res.status === 401) throw fail('private_repo', 'This repo is private. Public repos only in v1.');
  if (!res.ok) throw fail('download_failed', 'The repo host answered with an error. Try again in a few minutes.');
  const data = await res.json();
  return { defaultBranch: data.default_branch || 'main' };
}

// Download the repo tarball. Returns a Buffer. The ref (default branch)
// usually comes from the pre-download size check; when it is missing the
// metadata is fetched here. Throws not_found, private_repo, over_caps,
// download_timeout, or download_failed.
export async function downloadTarball({ host, owner, repo, ref, fetchImpl = fetch, token, timeoutMs = DOWNLOAD_TIMEOUT_MS }) {
  const branch = ref || (await repoMeta(host, owner, repo, fetchImpl, token)).defaultBranch;
  const url = tarballUrl(host, owner, repo, branch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { signal: controller.signal });
    if (res.status === 404) throw fail('not_found', 'No repo at that URL. Check the owner and name.');
    if (res.status === 403 || res.status === 401) throw fail('private_repo', 'This repo is private. Public repos only in v1.');
    if (!res.ok) throw fail('download_failed', 'The repo host answered with an error. Try again in a few minutes.');
    const length = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
    if (Number.isFinite(length) && length > MAX_DOWNLOAD_BYTES) {
      throw fail('over_caps', 'This repo is over the scan caps (100 MB, 10,000 files).');
    }
    // Stream the body so an oversized download aborts early instead of
    // buffering the whole thing first.
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_DOWNLOAD_BYTES) throw fail('over_caps', 'This repo is over the scan caps (100 MB, 10,000 files).');
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) throw fail('over_caps', 'This repo is over the scan caps (100 MB, 10,000 files).');
    return buf;
  } catch (e) {
    if (e && e.name === 'AbortError') throw fail('download_timeout', 'The download timed out. The repo may be too large or the host slow.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Minimal tar reader: ustar headers, pax extended headers (type 'x') for
// long paths, GNU longname (type 'L'). Only regular files are written;
// directories, symlinks, and anything else are skipped. Paths are
// stripped of the single top-level directory (the tarball root) and
// rejected when they escape the destination.
function parsePax(buf) {
  // Records: "<len> <key>=<value>\n", len counts itself.
  const out = {};
  const text = buf.toString('utf8');
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp === -1) break;
    const len = parseInt(text.slice(i, sp), 10);
    if (!len || Number.isNaN(len) || i + len > text.length) break;
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq !== -1) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

function stripTopLevel(path) {
  const parts = path.split('/');
  if (parts.length < 2) return null;
  const rest = parts.slice(1);
  if (rest.some((p) => p === '' || p === '..')) {
    throw fail('download_failed', 'The downloaded archive contains an unsafe path.');
  }
  return rest.join('/');
}

// Extract a .tar.gz buffer into destDir. Returns {files, bytes} and
// enforces the scan caps while writing. Throws over_caps or
// download_failed on a bad archive.
export function extractTarball(buffer, destDir, { maxBytes = MAX_MB * 1024 * 1024, maxFiles = MAX_FILES } = {}) {
  let data;
  try {
    data = gunzipSync(buffer);
  } catch {
    throw fail('download_failed', 'The downloaded archive is not a valid tarball.');
  }
  const root = resolve(destDir);
  const field = (block, start, end) => block.toString('utf8', start, end).split('\0')[0];
  let offset = 0;
  let files = 0;
  let bytes = 0;
  let paxPath = null;
  let longName = null;
  for (;;) {
    if (offset + 512 > data.length) throw fail('download_failed', 'The downloaded archive is truncated.');
    const block = data.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;
    const name = field(block, 0, 100);
    const prefix = field(block, 345, 500);
    const sizeRaw = field(block, 124, 136).trim();
    const size = sizeRaw === '' ? 0 : parseInt(sizeRaw, 8);
    if (Number.isNaN(size) || size < 0) throw fail('download_failed', 'The downloaded archive is not a valid tarball.');
    const type = String.fromCharCode(block[156]);
    const dataStart = offset + 512;
    const next = dataStart + Math.ceil(size / 512) * 512;
    if (next > data.length) throw fail('download_failed', 'The downloaded archive is truncated.');
    if (type === 'x') {
      const pax = parsePax(data.subarray(dataStart, dataStart + size));
      if (pax.path) paxPath = pax.path;
    } else if (type === 'L') {
      longName = data.subarray(dataStart, dataStart + size).toString('utf8').split('\0')[0];
    } else if (type === '0' || type === '\0') {
      const rawPath = longName || paxPath || (prefix ? `${prefix}/${name}` : name);
      paxPath = null;
      longName = null;
      const rel = stripTopLevel(rawPath);
      if (rel) {
        const dest = resolve(root, rel);
        if (dest !== root && !dest.startsWith(root + sep)) {
          throw fail('download_failed', 'The downloaded archive contains a path outside the repo.');
        }
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, data.subarray(dataStart, dataStart + size));
        files += 1;
        bytes += size;
        if (files > maxFiles || bytes > maxBytes) {
          throw fail('over_caps', 'This repo is over the scan caps (100 MB, 10,000 files).');
        }
      }
    } else {
      paxPath = null;
      longName = null;
    }
    offset = next;
  }
  return { files, bytes };
}

// Download + extract one repo. Returns {workDir, repoDir, tarballBuffer,
// files, sizeMb, cleanup}. Throws not_found, private_repo, over_caps,
// download_timeout, or download_failed.
export async function fetchAndExtract({ host, owner, repo, ref, fetchImpl = fetch, token, downloadImpl, onHeartbeat, timeoutMs } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'fdc-fetch-'));
  const repoDir = join(workDir, 'repo');
  const cleanup = () => rmSync(workDir, { recursive: true, force: true });
  try {
    const download = downloadImpl || downloadTarball;
    // timeoutMs caps the download (the tick passes 6s so a stalled
    // download aborts before the 10s function cap instead of dying
    // silently). The default 90s is for callers without a function cap.
    const tarballBuffer = await download({ host, owner, repo, ref, fetchImpl, token, timeoutMs });
    if (onHeartbeat) await onHeartbeat();
    mkdirSync(repoDir, { recursive: true });
    const { files, bytes } = extractTarball(tarballBuffer, repoDir, {});
    const sizeMb = bytes / (1024 * 1024);
    return { workDir, repoDir, tarballBuffer, files, sizeMb, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

// Rebuild a working repo from a stored tarball: extract into
// workDir/repo. Returns the repo dir. The caller owns cleanup of workDir.
export function repoFromTarball(tarballBuffer, workDir) {
  const repoDir = join(workDir, 'repo');
  mkdirSync(repoDir, { recursive: true });
  extractTarball(tarballBuffer, repoDir, {});
  return repoDir;
}
