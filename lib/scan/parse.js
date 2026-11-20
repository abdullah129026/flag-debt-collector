// Detection engine: AST-first flag detection with import-verified SDK call
// shapes. Regex alone cannot tell a flag reference from a same-named string,
// so a call only counts when it traces back to a known SDK import. Anything
// else is an unresolved reference, never a silent "no reference".
// Pure functions: no fs except listJsFiles, no network, no git.

import { parse } from '@babel/parser';
import { parse as parseYaml } from 'yaml';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

export const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
export const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'vendor', '.turbo']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

// Module substring -> provider. The resolver only trusts these imports.
const SDK_MODULES = [
  ['launchdarkly', 'launchdarkly'],
  ['unleash', 'unleash'],
  ['flagsmith', 'flagsmith'],
  ['configcat', 'configcat'],
];

// Methods that read a flag value on a client instance, per provider.
const CLIENT_METHODS = {
  launchdarkly: new Set(['variation', 'variationDetail', 'allFlags', 'allFlagsState']),
  unleash: new Set(['isEnabled', 'getVariant']),
  flagsmith: new Set(['hasFeature', 'getValue', 'getValueAsync']),
  configcat: new Set(['getValue', 'getValueAsync', 'getAllValues', 'getValueDetails']),
};

// Factories that produce a client instance, per provider.
const FACTORIES = {
  launchdarkly: new Set(['initialize']),
  unleash: new Set(['UnleashClient']),
  flagsmith: new Set([]),
  configcat: new Set(['getClient', 'getClientFor']),
};

// Hooks that return a flags object, per provider. The hook name is the
// imported name; the provider comes from the module.
const HOOKS = {
  launchdarkly: new Set(['useFlags', 'useLDClient']),
  unleash: new Set(['useFlags']),
  flagsmith: new Set(['useFlags', 'useFlagsmith']),
  configcat: new Set(['useConfigCatClient']),
};

// Hooks that take a flag key directly.
const KEY_HOOKS = {
  unleash: new Set(['useFlag']),
  configcat: new Set(['useFeatureFlag']),
};

function providerForModule(source) {
  for (const [sub, provider] of SDK_MODULES) {
    if (source.includes(sub)) return provider;
  }
  return null;
}

export function isTestFile(relPath) {
  const p = relPath.replaceAll('\\', '/');
  return (
    p.includes('/__tests__/') || p.includes('/test/') || p.includes('/tests__/') ||
    p.includes('/stories/') || p.includes('/__stories__//') ||
    /\.(test|spec|stories)\.[jt]sx?$/.test(p) || p.includes('/spec/')
  );
}

// --- .flagdebtignore -------------------------------------------------------

export function parseIgnoreFile(text) {
  const flagKeys = new Set();
  const globs = [];
  const rawRules = [];
  for (const line of (text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    rawRules.push(trimmed);
    const flagMatch = /^flag:\s*(\S+)\s*$/.exec(trimmed);
    if (flagMatch) {
      flagKeys.add(flagMatch[1]);
    } else {
      globs.push({ raw: trimmed, regex: globToRegex(trimmed) });
    }
  }
  return { flagKeys, globs, rawRules };
}

// Small gitignore-ish glob: ** crosses directories, * stays in one, ? is one char.
export function globToRegex(glob) {
  let out = '^';
  let i = 0;
  const g = glob.replace(/^\/+/, '');
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        out += '.*';
        i += g[i + 2] === '/' ? 3 : 2;
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  out += '(/.*)?$';
  return new RegExp(out);
}

export function ignoreMatch(relPath, rules) {
  const p = relPath.replaceAll('\\', '/');
  for (const g of rules.globs) {
    if (g.regex.test(p)) return true;
  }
  return false;
}

// --- file walk -------------------------------------------------------------

// Sorted file list, so a budget-driven tick resumes deterministically.
// Returns {files, overCaps}. Config files (.json/.yaml) are included: they
// may carry config-file flags. Lockfiles and minified files are skipped.
export function listJsFiles(rootDir, ignoreRules, maxFiles = 10000) {
  const files = [];
  let overCaps = false;
  const walkDir = (dir) => {
    if (overCaps) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walkDir(full);
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name) || entry.name.endsWith('.min.js')) continue;
        const rel = relative(rootDir, full).split(sep).join('/');
        if (ignoreRules && ignoreMatch(rel, ignoreRules)) continue;
        const ext = extname(entry.name);
        if (JS_EXTS.has(ext) || CONFIG_EXTS.has(ext)) {
          if (files.length >= maxFiles) {
            overCaps = true;
            return;
          }
          files.push(rel);
        }
      }
    }
  };
  walkDir(rootDir);
  return { files, overCaps };
}

// --- key resolution --------------------------------------------------------

// A key is resolvable when it is a string literal, a template literal with
// no expressions, or a concatenation of resolvable parts. Anything else
// (variable, interpolation, call) is dynamic: unresolved, never guessed.
export function resolveKey(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = resolveKey(node.left);
    const right = resolveKey(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

// --- config-file flags -----------------------------------------------------

const CONFIG_FILENAMES = new Set(['flags.json', 'feature-flags.json']);
const CONFIG_TOP_KEYS = new Set(['flags', 'featureFlags']);

// A config file carries flags when its name says so, or when it has a
// top-level flags/featureFlags object whose values are booleans or rollout
// objects. Any other JSON key is not a flag.
export function detectConfigFlags(relPath, content) {
  const base = relPath.split('/').pop();
  const named = CONFIG_FILENAMES.has(base) || /\.flags\.json$/.test(base) || /\.flags\.ya?ml$/.test(base);
  let data;
  try {
    data = relPath.endsWith('.json') ? JSON.parse(content) : parseYaml(content);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object') return [];
  let flagObj = null;
  if (named && typeof data === 'object') {
    flagObj = data.flags || data.featureFlags || data;
  } else {
    for (const key of CONFIG_TOP_KEYS) {
      if (data[key] && typeof data[key] === 'object') flagObj = data[key];
    }
  }
  if (!flagObj || typeof flagObj !== 'object' || Array.isArray(flagObj)) return [];
  const lines = content.split('\n');
  const flags = [];
  for (const [key, value] of Object.entries(flagObj)) {
    if (typeof value !== 'boolean' && (typeof value !== 'object' || value === null)) continue;
    let line = 1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`"${key}"`) || lines[i].includes(`'${key}'`) || new RegExp(`^\\s*${key}:`).test(lines[i])) {
        line = i + 1;
        break;
      }
    }
    flags.push({ key, provider: 'config', kind: 'config', line });
  }
  return flags;
}

// --- AST walk --------------------------------------------------------------

// span helper: babel loc is {start: {line, column}, end: {line, column}}.
function spanOf(node) {
  return node.loc
    ? { start: { line: node.loc.start.line, column: node.loc.start.column }, end: { line: node.loc.end.line, column: node.loc.end.column } }
    : null;
}

export function parseFileContent(code, relPath, ignoreRules) {
  const result = {
    references: [],
    sites: [],
    unresolved: [],
    configcatKeys: [],
    unparseable: false,
  };
  const testFile = isTestFile(relPath);

  if (CONFIG_EXTS.has(extname(relPath))) {
    for (const flag of detectConfigFlags(relPath, code)) {
      if (ignoreRules && ignoreRules.flagKeys.has(flag.key)) continue;
      result.references.push({
        key: flag.key, provider: 'config', kind: 'config',
        file: relPath, line: flag.line, column: 0,
        refKind: 'config',
      });
    }
    return result;
  }

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch {
    result.unparseable = true;
    result.unresolved.push({ file: relPath, line: 1, reason: 'unparseable' });
    return result;
  }

  // Bindings, per file.
  const namespaces = new Map(); // local name -> provider (default import)
  const factories = new Map(); // local name -> provider
  const hooks = new Map(); // local name -> {provider, kind: 'flags'|'key'|'array'}
  const clients = new Map(); // local name -> provider
  const flagsObjs = new Map(); // local name -> provider
  const flagNames = new Map(); // local name -> {provider, key}

  const addRef = (key, provider, kind, node, refKind) => {
    if (!node.loc || (ignoreRules && ignoreRules.flagKeys.has(key))) return;
    const line = node.loc.start.line;
    const column = node.loc.start.column;
    if (result.references.some((r) => r.key === key && r.line === line && r.column === column)) return;
    result.references.push({
      key, provider, kind,
      file: relPath, line, column,
      refKind: refKind || (testFile ? 'test' : 'call'),
    });
  };
  const addUnresolved = (node, reason) => {
    result.unresolved.push({ file: relPath, line: node.loc.start.line, reason });
  };
  const addSite = (key, provider, shape, stmtNode, winNode, loseNode) => {
    if (ignoreRules && ignoreRules.flagKeys.has(key)) return;
    const stmt = spanOf(stmtNode);
    if (!stmt) return;
    const site = { key, provider, shape, stmt, win: winNode ? spanOf(winNode) : null, lose: loseNode ? spanOf(loseNode) : null };
    if (!result.sites.some((s) => s.key === key && s.shape === shape && s.stmt.start.line === stmt.start.line)) {
      result.sites.push(site);
    }
  };

  // Find the flag reference inside a guard test, if any. Returns
  // {key, provider, kind, node, negated} or null. Covers a destructured flag
  // name, a flags-object member, process.env, and a client method call
  // (if (client.variation('key'))).
  const findTestRef = (testNode) => {
    let found = null;
    const scan = (node) => {
      if (!node || found || typeof node !== 'object') return;
      if (node.type === 'Identifier' && flagNames.has(node.name)) {
        const b = flagNames.get(node.name);
        found = { key: b.key, provider: b.provider, kind: 'sdk', node, negated: false };
        return;
      }
      if (node.type === 'MemberExpression') {
        const ref = refFromNode(node);
        if (ref) {
          found = { ...ref, node, negated: false };
          return;
        }
      }
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' && clients.has(node.callee.object.name)
      ) {
        const provider = clients.get(node.callee.object.name);
        const method = !node.callee.computed && node.callee.property.type === 'Identifier' ? node.callee.property.name : null;
        if (method && CLIENT_METHODS[provider].has(method)) {
          const key = resolveKey(node.arguments && node.arguments[0]);
          if (key !== null) {
            found = { key, provider, kind: 'sdk', node: node.arguments[0], negated: false };
            return;
          }
        }
      }
      if (node.type === 'UnaryExpression' && node.operator === '!' && node.argument) {
        const before = found;
        scan(node.argument);
        if (found && found !== before) found.negated = true;
        return;
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(scan);
        else if (value && typeof value === 'object' && value.type) scan(value);
      }
    };
    scan(testNode);
    return found;
  };

  const refFromNode = (node) => {
    // Returns {key, provider, kind} for a reference node, or null.
    if (node.type === 'Identifier' && flagNames.has(node.name)) {
      const b = flagNames.get(node.name);
      return { key: b.key, provider: b.provider, kind: 'sdk' };
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && flagsObjs.has(node.object.name)) {
      const provider = flagsObjs.get(node.object.name);
      const key = !node.computed && node.property.type === 'Identifier'
        ? node.property.name
        : node.computed && node.property.type === 'StringLiteral'
          ? node.property.value
          : null;
      if (key) return { key, provider, kind: 'sdk' };
    }
    if (
      node.type === 'MemberExpression' &&
      node.object.type === 'MemberExpression' &&
      node.object.object.type === 'Identifier' && node.object.object.name === 'process' &&
      node.object.property.type === 'Identifier' && node.object.property.name === 'env'
    ) {
      const key = !node.computed && node.property.type === 'Identifier'
        ? node.property.name
        : node.computed && node.property.type === 'StringLiteral'
          ? node.property.value
          : null;
      if (key) return { key, provider: 'env', kind: 'env' };
    }
    return null;
  };

  const walk = (node, parent, parentKey, ctx) => {
    if (!node || typeof node !== 'object' || !node.type) return;
    ctx = ctx || {};

    // Import bindings.
    if (node.type === 'ImportDeclaration') {
      const provider = providerForModule(node.source.value || '');
      if (provider) {
        for (const spec of node.specifiers || []) {
          if (spec.type === 'ImportDefaultSpecifier') namespaces.set(spec.local.name, provider);
          if (spec.type === 'ImportSpecifier') {
            const imported = spec.imported.name;
            // Flagsmith's useFlags takes an array of keys, not a flags object.
            if (provider === 'flagsmith' && imported === 'useFlags') hooks.set(spec.local.name, { provider, kind: 'array' });
            else if (imported === 'useLDClient') hooks.set(spec.local.name, { provider, kind: 'client' });
            else if (FACTORIES[provider].has(imported)) factories.set(spec.local.name, provider);
            else if (HOOKS[provider].has(imported)) hooks.set(spec.local.name, { provider, kind: 'flags' });
            else if (KEY_HOOKS[provider] && KEY_HOOKS[provider].has(imported)) hooks.set(spec.local.name, { provider, kind: 'key' });
          }
        }
      }
      return;
    }

    // Variable declarators: client factories, hook results, destructuring.
    if (node.type === 'VariableDeclarator') {
      const init = node.init;
      if (init && init.type === 'CallExpression') {
        const callee = init.callee;
        const calleeName = callee.type === 'Identifier' ? callee.name : null;
        const nsFactory = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && namespaces.has(callee.object.name)
          ? { provider: namespaces.get(callee.object.name), method: callee.property.name }
          : null;
        if (calleeName && factories.has(calleeName) && node.id.type === 'Identifier') {
          clients.set(node.id.name, factories.get(calleeName));
        } else if (nsFactory && FACTORIES[nsFactory.provider].has(nsFactory.method) && node.id.type === 'Identifier') {
          clients.set(node.id.name, nsFactory.provider);
        } else if (calleeName && hooks.has(calleeName)) {
          const hook = hooks.get(calleeName);
          if (hook.kind === 'client' && node.id.type === 'Identifier') {
            clients.set(node.id.name, hook.provider);
          } else if (hook.kind === 'flags' && node.id.type === 'Identifier') {
            flagsObjs.set(node.id.name, hook.provider);
          } else if (hook.kind === 'flags' && node.id.type === 'ObjectPattern') {
            for (const prop of node.id.properties) {
              if (prop.type !== 'ObjectProperty') continue;
              const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
              const local = prop.value.type === 'Identifier' ? prop.value.name : null;
              addRef(keyName, hook.provider, 'sdk', prop.key, 'call');
              if (local) flagNames.set(local, { provider: hook.provider, key: keyName });
            }
          }
        }
        // ConfigCat SDK key literal in a getClient call.
        if (calleeName === 'getClient' || (nsFactory && nsFactory.method === 'getClient')) {
          const first = init.arguments && init.arguments[0];
          const key = resolveKey(first);
          if (key && (key.startsWith('configcat-sdk-1/') || key.startsWith('configcat-proxy/'))) {
            result.configcatKeys.push(key);
          }
        }
      }
      if (init && init.type === 'NewExpression' && init.callee.type === 'Identifier' && factories.has(init.callee.name) && node.id.type === 'Identifier') {
        clients.set(node.id.name, factories.get(init.callee.name));
      }
      if (init) walk(init, node, 'init', ctx);
      if (node.id && node.id.type === 'ObjectPattern') {
        // Already handled above for hooks; still walk the pattern values.
        for (const prop of node.id.properties) walk(prop, node.id, 'properties', ctx);
      } else if (node.id) {
        walk(node.id, node, 'id', ctx);
      }
      return;
    }

    // Guard statements: the test is walked with the statement as context,
    // so a LogicalExpression inside a test becomes a combined guard, never
    // a standalone logical site.
    if (node.type === 'IfStatement') {
      const testRef = findTestRef(node.test);
      if (testRef) {
        const ref = testRef;
        addRef(ref.key, ref.provider, ref.kind, ref.node, 'call');
        const test = node.test;
        const isEarlyReturn =
          testRef.negated &&
          ((node.consequent.type === 'ReturnStatement') ||
            (node.consequent.type === 'BlockStatement' && node.consequent.body.length === 1 && node.consequent.body[0].type === 'ReturnStatement'));
        const isCombined = test.type === 'LogicalExpression';
        const isComparison =
          test.type === 'BinaryExpression' &&
          (test.left === testRef.node || test.right === testRef.node);
        if (isEarlyReturn) {
          addSite(ref.key, ref.provider, 'early-return', node, null, null);
        } else if (isCombined && !isComparison) {
          const lose = testRef.negated ? node.consequent : node.alternate || node.consequent;
          addSite(ref.key, ref.provider, 'combined', node, null, lose);
        } else if (node.alternate) {
          const win = testRef.negated ? node.alternate : node.consequent;
          const lose = testRef.negated ? node.consequent : node.alternate;
          addSite(ref.key, ref.provider, 'if-else', node, win, lose);
        } else {
          addSite(ref.key, ref.provider, 'if', node, testRef.negated ? null : node.consequent, testRef.negated ? null : node.consequent);
        }
      }
      const testCtx = { ...ctx, inTest: true };
      walk(node.test, node, 'test', testCtx);
      walk(node.consequent, node, 'consequent', ctx);
      if (node.alternate) walk(node.alternate, node, 'alternate', ctx);
      return;
    }

    if (node.type === 'ConditionalExpression') {
      const testRef = findTestRef(node.test);
      if (testRef) {
        const ref = testRef;
        addRef(ref.key, ref.provider, ref.kind, ref.node, 'call');
        const win = testRef.negated ? node.alternate : node.consequent;
        const lose = testRef.negated ? node.consequent : node.alternate;
        addSite(ref.key, ref.provider, 'ternary', node, win, lose);
      }
      const testCtx = { ...ctx, inTest: true };
      walk(node.test, node, 'test', testCtx);
      walk(node.consequent, node, 'consequent', ctx);
      walk(node.alternate, node, 'alternate', ctx);
      return;
    }

    if (node.type === 'LogicalExpression' && node.operator === '&&' && !ctx.inTest) {
      const testRef = findTestRef(node.left);
      if (testRef) {
        const ref = testRef;
        addRef(ref.key, ref.provider, ref.kind, ref.node, 'call');
        addSite(ref.key, ref.provider, 'logical', node, node.right, null);
      }
      walk(node.left, node, 'left', ctx);
      walk(node.right, node, 'right', ctx);
      return;
    }

    // SDK method calls on a tracked client.
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && clients.has(callee.object.name)) {
        const provider = clients.get(callee.object.name);
        const method = !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
        if (method && CLIENT_METHODS[provider].has(method)) {
          const key = resolveKey(node.arguments && node.arguments[0]);
          if (key !== null) {
            addRef(key, provider, 'sdk', node.arguments[0], 'call');
          } else if (node.arguments && node.arguments[0]) {
            addUnresolved(node.arguments[0], 'dynamic_key');
          }
          for (const arg of node.arguments || []) walk(arg, node, 'arguments', ctx);
          return;
        }
      }
      if (callee.type === 'MemberExpression' && callee.object.type === 'CallExpression') {
        // useFlags().myFlag chained straight off the hook call.
        const inner = callee.object;
        if (inner.callee.type === 'Identifier' && hooks.has(inner.callee.name)) {
          const provider = hooks.get(inner.callee.name).provider;
          const key = !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
          if (key) {
            addRef(key, provider, 'sdk', callee.property, 'call');
            for (const arg of node.arguments || []) walk(arg, node, 'arguments', ctx);
            return;
          }
        }
      }
      if (callee.type === 'Identifier' && hooks.has(callee.name)) {
        const hook = hooks.get(callee.name);
        if (hook.kind === 'key') {
          const key = resolveKey(node.arguments && node.arguments[0]);
          if (key !== null) addRef(key, hook.provider, 'sdk', node.arguments[0], 'call');
          else if (node.arguments && node.arguments[0]) addUnresolved(node.arguments[0], 'dynamic_key');
        } else if (hook.kind === 'array') {
          const arr = node.arguments && node.arguments[0];
          if (arr && arr.type === 'ArrayExpression') {
            for (const el of arr.elements || []) {
              if (!el) continue;
              const key = resolveKey(el);
              if (key !== null) addRef(key, hook.provider, 'sdk', el, 'call');
              else addUnresolved(el, 'dynamic_key');
            }
          }
        }
        for (const arg of node.arguments || []) walk(arg, node, 'arguments', ctx);
        return;
      }
      walk(callee, node, 'callee', ctx);
      for (const arg of node.arguments || []) walk(arg, node, 'arguments', ctx);
      return;
    }

    // Member access: flags object, or process.env. The whole member node
    // is the reference location, so a guard test that already recorded it
    // dedupes instead of double-counting.
    if (node.type === 'MemberExpression') {
      const ref = refFromNode(node);
      if (ref) {
        // Skip the object half: it is the flags binding or process, not a ref.
        if (node.object.type === 'Identifier' && flagsObjs.has(node.object.name)) {
          addRef(ref.key, ref.provider, ref.kind, node, 'call');
        } else if (node.object.type === 'MemberExpression') {
          addRef(ref.key, ref.provider, ref.kind, node, 'call');
        }
        return;
      }
      walk(node.object, node, 'object', ctx);
      if (node.computed) walk(node.property, node, 'property', ctx);
      return;
    }

    // Bare identifier use of a destructured flag name.
    if (node.type === 'Identifier') {
      const isBindingPosition =
        (parent && parent.type === 'VariableDeclarator' && parentKey === 'id') ||
        (parent && parent.type === 'FunctionDeclaration' && parentKey === 'id') ||
        (parent && parent.type === 'ImportSpecifier') ||
        (parent && parent.type === 'ObjectProperty' && parentKey === 'key') ||
        (parent && parent.type === 'ObjectProperty' && parentKey === 'value') ||
        (parent && parent.type === 'MemberExpression' && parentKey === 'property' && !parent.computed) ||
        (parent && parent.type === 'ObjectPattern');
      if (!isBindingPosition && flagNames.has(node.name)) {
        const b = flagNames.get(node.name);
        addRef(b.key, b.provider, 'sdk', node, 'call');
      }
      return;
    }

    // Generic descent.
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'range' || key === 'leadingComments' || key === 'trailingComments') continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && child.type) walk(child, node, key, ctx);
        }
      } else if (value && typeof value === 'object' && value.type) {
        walk(value, node, key, ctx);
      }
    }
  };

  walk(ast.program, null, null, {});
  return result;
}
