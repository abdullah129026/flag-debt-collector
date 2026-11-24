import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { downloadTarball, extractTarball, fetchAndExtract, repoFromTarball } from '../lib/scan/tarball.js';

// A small repo tree, tarred with the real GNU tar so the fixtures are
// ground truth (ustar, GNU longname, pax), not the reader's own output.
function buildTree(files) {
  const parent = mkdtempSync(join(tmpdir(), 'fdc-tar-'));
  const root = join(parent, 'acme-shop-deadbeef');
  mkdirSync(join(root, 'src', 'nested'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content);
  }
  return { parent, root };
}

function tarball(parent, name, format) {
  const out = join(parent, 'out.tar.gz');
  const args = ['-czf', out, '-C', parent];
  if (format) args.push('--format=' + format);
  args.push(name);
  execFileSync('tar', args);
  return readFileSync(out);
}

const TREE = {
  'README.md': '# shop\n',
  'src/a.js': 'const a = 1;\n',
  'src/nested/b.js': 'const b = 2;\n',
  'src/a-very-long-file-name-that-keeps-going-past-one-hundred-characters-so-the-archiver-must-use-a-longname-record-for-it.js': 'const c = 3;\n',
};

test('extractTarball restores a GNU tarball with the top level stripped', () => {
  const { parent, root } = buildTree(TREE);
  const dest = mkdtempSync(join(tmpdir(), 'fdc-x-'));
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef');
    const { files, bytes } = extractTarball(buf, dest);
    assert.equal(files, 4);
    assert.equal(bytes, Object.values(TREE).reduce((s, c) => s + c.length, 0));
    assert.equal(readFileSync(join(dest, 'src/a.js'), 'utf8'), 'const a = 1;\n');
    assert.equal(readFileSync(join(dest, 'src/nested/b.js'), 'utf8'), 'const b = 2;\n');
    assert.equal(existsSync(join(dest, 'acme-shop-deadbeef')), false);
    const long = Object.keys(TREE).find((k) => k.includes('very-long'));
    assert.equal(readFileSync(join(dest, long), 'utf8'), 'const c = 3;\n');
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('extractTarball restores a pax tarball', () => {
  const { parent } = buildTree(TREE);
  const dest = mkdtempSync(join(tmpdir(), 'fdc-x-'));
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef', 'pax');
    const { files } = extractTarball(buf, dest);
    assert.equal(files, 4);
    const long = Object.keys(TREE).find((k) => k.includes('very-long'));
    assert.equal(readFileSync(join(dest, long), 'utf8'), 'const c = 3;\n');
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('extractTarball skips symlinks and enforces the caps', () => {
  const { parent, root } = buildTree(TREE);
  symlinkSync(join(root, 'src/a.js'), join(root, 'src/link.js'));
  const dest = mkdtempSync(join(tmpdir(), 'fdc-x-'));
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef');
    const { files } = extractTarball(buf, dest);
    assert.equal(files, 4);
    assert.equal(existsSync(join(dest, 'src/link.js')), false);
    assert.throws(() => extractTarball(buf, dest, { maxBytes: 10 }), (e) => e.code === 'over_caps');
    assert.throws(() => extractTarball(buf, dest, { maxFiles: 2 }), (e) => e.code === 'over_caps');
  } finally {
    rmSync(parent, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

// Hand-built tar buffer: one header + data, no archiver involved.
function handTar(entries) {
  const blocks = [];
  for (const { name, content, type = '0' } of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 'utf8');
    header.write('0000644', 100, 'utf8');
    header.write('0000000', 108, 'utf8');
    header.write('0000000', 116, 'utf8');
    header.write(content.length.toString(8).padStart(11, '0'), 124, 'utf8');
    header.write('00000000000', 136, 'utf8');
    header.write('        ', 148, 'utf8');
    header.write(type, 156, 'utf8');
    header.write('ustar', 257, 'utf8');
    const sum = header.reduce((s, b) => s + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'utf8');
    blocks.push(header);
    const data = Buffer.from(content);
    blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

test('extractTarball rejects traversal entries and bad gzip', () => {
  const dest = mkdtempSync(join(tmpdir(), 'fdc-x-'));
  try {
    const evil = handTar([{ name: 'root/../evil.txt', content: 'x\n' }]);
    assert.throws(() => extractTarball(evil, dest), (e) => e.code === 'download_failed');
    assert.equal(existsSync(join(dest, 'evil.txt')), false);
    assert.throws(() => extractTarball(Buffer.from('not gzip'), dest), (e) => e.code === 'download_failed');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

test('extractTarball honors a pax path override', () => {
  const dest = mkdtempSync(join(tmpdir(), 'fdc-x-'));
  try {
    const pax = '35 path=root/long-name-from-pax.js\n';
    const buf = handTar([
      { name: './PaxHeaders.0/x', content: pax, type: 'x' },
      { name: 'root/short.js', content: 'const p = 1;\n' },
    ]);
    const { files } = extractTarball(buf, dest);
    assert.equal(files, 1);
    assert.equal(readFileSync(join(dest, 'long-name-from-pax.js'), 'utf8'), 'const p = 1;\n');
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});

function routeFetch(routes) {
  return async (url, opts) => {
    for (const [match, res] of routes) {
      if (url.includes(match)) return res;
    }
    throw new Error('unexpected fetch: ' + url);
  };
}

const okJson = (body) => ({ status: 200, ok: true, json: async () => body });
const okTar = (buf) => ({
  status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => buf,
});

test('downloadTarball hits codeload with the default branch', async () => {
  const { parent } = buildTree(TREE);
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef');
    const seen = [];
    const fetch = routeFetch([
      ['api.github.com/repos/acme/shop', okJson({ default_branch: 'main', size: 100 })],
      ['codeload.github.com/acme/shop/tar.gz/main', okTar(buf)],
    ]);
    const wrapped = async (url, opts) => { seen.push(url); return fetch(url, opts); };
    const out = await downloadTarball({ host: 'github.com', owner: 'acme', repo: 'shop', fetchImpl: wrapped });
    assert.equal(Buffer.compare(out, buf), 0);
    assert.ok(seen.some((u) => u === 'https://codeload.github.com/acme/shop/tar.gz/main'));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('downloadTarball names the failure: missing repo, host error, timeout', async () => {
  const missing = routeFetch([['api.github.com', { status: 404, ok: false, json: async () => ({}) }]]);
  await assert.rejects(
    downloadTarball({ host: 'github.com', owner: 'acme', repo: 'nope', fetchImpl: missing }),
    (e) => e.code === 'not_found',
  );
  const down = routeFetch([['codeload.github.com', { status: 500, ok: false, json: async () => ({}) }]]);
  await assert.rejects(
    downloadTarball({ host: 'github.com', owner: 'acme', repo: 'shop', ref: 'main', fetchImpl: down }),
    (e) => e.code === 'download_failed',
  );
  const hanging = async (_url, opts) => new Promise((_res, rej) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      rej(e);
    });
  });
  await assert.rejects(
    downloadTarball({ host: 'github.com', owner: 'acme', repo: 'shop', ref: 'main', fetchImpl: hanging, timeoutMs: 50 }),
    (e) => e.code === 'download_timeout',
  );
  const huge = routeFetch([['codeload.github.com', {
    status: 200, ok: true, headers: { get: (n) => (n === 'content-length' ? '200000000' : null) }, arrayBuffer: async () => Buffer.alloc(0),
  }]]);
  await assert.rejects(
    downloadTarball({ host: 'github.com', owner: 'acme', repo: 'shop', ref: 'main', fetchImpl: huge }),
    (e) => e.code === 'over_caps',
  );
});

test('downloadTarball uses the GitLab archive endpoint', async () => {
  const { parent } = buildTree(TREE);
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef');
    const seen = [];
    const fetch = routeFetch([
      ['repository/archive.tar.gz?sha=main', okTar(buf)],
      ['gitlab.com/api/v4/projects/acme%2Fshop', okJson({ default_branch: 'main' })],
    ]);
    const wrapped = async (url, opts) => { seen.push(url); return fetch(url, opts); };
    const out = await downloadTarball({ host: 'gitlab.com', owner: 'acme', repo: 'shop', fetchImpl: wrapped });
    assert.equal(Buffer.compare(out, buf), 0);
    assert.ok(seen.some((u) => u.includes('/repository/archive.tar.gz?sha=main')));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('fetchAndExtract and repoFromTarball round-trip a stored tarball', async () => {
  const { parent } = buildTree(TREE);
  try {
    const buf = tarball(parent, 'acme-shop-deadbeef');
    const fetched = await fetchAndExtract({
      host: 'github.com', owner: 'acme', repo: 'shop',
      downloadImpl: async () => buf,
    });
    assert.equal(fetched.files, 4);
    assert.equal(readFileSync(join(fetched.repoDir, 'src/a.js'), 'utf8'), 'const a = 1;\n');
    assert.ok(fetched.sizeMb > 0);
    const stored = fetched.tarballBuffer;
    fetched.cleanup();
    assert.equal(existsSync(fetched.workDir), false);
    const workDir = mkdtempSync(join(tmpdir(), 'fdc-rb-'));
    try {
      const repoDir = repoFromTarball(stored, workDir);
      assert.equal(readFileSync(join(repoDir, 'src/nested/b.js'), 'utf8'), 'const b = 2;\n');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
