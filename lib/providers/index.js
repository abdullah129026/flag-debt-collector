// Provider rollout adapters. One function per provider, same return shape:
// {key: {pct, launched, stale, temporary, winningValue}}.
// A provider fetch never fails the scan: on any error the flags keep
// rollout "unknown" and the code-derived signals still work.
//
// LaunchDarkly (verified against the API docs 2026-11-20): the flag-statuses
// endpoint lists one status per flag for an environment: new, active,
// launched, inactive. "launched" means one variation served, toggled on,
// no config change in 7 days, which is exactly the settled-rollout signal.
// The endpoint does not return a percentage, so pct is 100 only for
// launched flags, null otherwise. The flag key is read from the item's
// parent link (/api/v2/flags/{project}/{key}). The `temporary` field comes
// from the flag detail call and drives the kill-switch carve-out.
// ConfigCat: the public config.json needs only the SDK key, no auth. A flag
// with no percentage split serves its value to 100%; with a split, pct is
// the share served the true value (boolean flags only).

const LD_BASE = 'https://app.launchdarkly.com/api/v2';
const CC_CDN = 'https://cdn.configcat.com/configuration-files';

export async function fetchLaunchDarkly({ token, projectKey, envKey = 'production', flagKeys, fetchImpl = fetch }) {
  const out = {};
  if (!token || !projectKey || !flagKeys || flagKeys.length === 0) return out;
  let statuses;
  try {
    const res = await fetchImpl(`${LD_BASE}/flag-statuses/${encodeURIComponent(projectKey)}/${encodeURIComponent(envKey)}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        const e = new Error('LaunchDarkly token invalid');
        e.code = 'token_invalid';
        throw e;
      }
      return out;
    }
    statuses = await res.json();
  } catch (e) {
    if (e.code === 'token_invalid') throw e;
    return out;
  }
  const wanted = new Set(flagKeys);
  for (const item of statuses.items || []) {
    const parent = (item._links && item._links.parent && item._links.parent.href) || '';
    const key = parent.split('/').filter(Boolean).pop();
    if (!key || !wanted.has(key)) continue;
    const status = item.name;
    out[key] = {
      pct: status === 'launched' ? 100 : null,
      launched: status === 'launched',
      stale: status === 'inactive',
      temporary: undefined,
      winningValue: status === 'launched' ? true : null,
    };
  }
  // temporary comes from the flag detail, one call per flag in the scan.
  for (const key of Object.keys(out)) {
    try {
      const res = await fetchImpl(`${LD_BASE}/flags/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`, {
        headers: { Authorization: token },
      });
      if (!res.ok) continue;
      const flag = await res.json();
      out[key].temporary = flag.temporary;
    } catch {
      // Keep the status data; temporary stays unknown.
    }
  }
  return out;
}

export async function fetchConfigCat({ sdkKey, flagKeys, fetchImpl = fetch }) {
  const out = {};
  if (!sdkKey || !flagKeys || flagKeys.length === 0) return out;
  let config;
  try {
    const res = await fetchImpl(`${CC_CDN}/${encodeURIComponent(sdkKey)}/config_v6.json`);
    if (!res.ok) return out;
    config = await res.json();
  } catch {
    return out;
  }
  const flags = (config && config.flags) || {};
  for (const key of flagKeys) {
    const entry = flags[key];
    if (!entry) continue;
    const value = entry.v;
    const splits = entry.p || [];
    if (typeof value !== 'boolean') {
      out[key] = { pct: null, launched: false, stale: false, temporary: undefined, winningValue: null };
      continue;
    }
    if (splits.length === 0) {
      out[key] = {
        pct: value ? 100 : 0,
        launched: false,
        stale: false,
        temporary: undefined,
        winningValue: value,
      };
      continue;
    }
    let trueShare = 0;
    for (const split of splits) {
      if (split.v === true) trueShare += split.p || 0;
    }
    out[key] = {
      pct: trueShare,
      launched: false,
      stale: false,
      temporary: undefined,
      winningValue: trueShare === 100 ? true : trueShare === 0 ? false : null,
    };
  }
  return out;
}

// Rollout for a whole scan, by provider. tokenGetter(provider) returns the
// stored token or null; sdkKeys are ConfigCat keys found in the repo code.
// Returns {byKey: {key: rollout}, tokenInvalid: bool}.
export async function fetchRollout({ flags, settings = {}, tokenGetter, repoConfigCatKeys, fetchImpl = fetch }) {
  const byKey = {};
  let tokenInvalid = false;
  const ldKeys = flags.filter((f) => f.provider === 'launchdarkly').map((f) => f.key);
  const ccKeys = flags.filter((f) => f.provider === 'configcat').map((f) => f.key);
  if (ldKeys.length > 0) {
    const token = await tokenGetter('launchdarkly');
    if (token) {
      try {
        const ld = await fetchLaunchDarkly({
          token,
          projectKey: settings.ld_project_key,
          envKey: settings.ld_env_key || 'production',
          flagKeys: ldKeys,
          fetchImpl,
        });
        Object.assign(byKey, ld);
      } catch (e) {
        if (e.code === 'token_invalid') tokenInvalid = true;
      }
    }
  }
  if (ccKeys.length > 0) {
    const storedKey = await tokenGetter('configcat');
    const sdkKey = storedKey || (repoConfigCatKeys && repoConfigCatKeys[0]);
    if (sdkKey) {
      const cc = await fetchConfigCat({ sdkKey, flagKeys: ccKeys, fetchImpl });
      Object.assign(byKey, cc);
    }
  }
  return { byKey, tokenInvalid };
}
