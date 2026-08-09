export const POLICY_PROFILES = Object.freeze({
  'strict-global': Object.freeze({
    id: 'strict-global',
    label: 'Strict global consent',
    interaction: 'opt_in',
    defaults: 'deny_optional',
    honor_gpc: true,
    gpc_locks_advertising: true,
    description: 'Deny optional purposes until a visitor makes a choice. Safe fallback when region is unknown.',
  }),
  'eu-uk-consent': Object.freeze({
    id: 'eu-uk-consent',
    label: 'EU/UK consent',
    interaction: 'opt_in',
    defaults: 'deny_optional',
    honor_gpc: true,
    gpc_locks_advertising: true,
    description: 'Prior, granular opt-in with an equally available reject action.',
  }),
  'us-opt-out': Object.freeze({
    id: 'us-opt-out',
    label: 'US opt-out',
    interaction: 'opt_out',
    defaults: 'organization_defined',
    honor_gpc: true,
    gpc_locks_advertising: true,
    description: 'Separates sale/share and targeted-advertising opt-out from Google consent signals.',
  }),
});

export function policyProfile(id = 'strict-global') {
  const profile = POLICY_PROFILES[id];
  if (!profile) throw new TypeError(`Unknown policy profile: ${id}`);
  return profile;
}

export function policyManifest(id = 'strict-global', overrides = {}) {
  const profile = policyProfile(id);
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    ...profile,
    ...overrides,
    legal_review_required: true,
  };
}
