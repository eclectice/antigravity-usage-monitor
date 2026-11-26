export const WINDOW_BRIDGE_KEY = '__AGUsageMonitorBridge';
export const WINDOW_BRIDGE_ROUTE_KEY = 'hostRouteCascadeId';
export const WINDOW_BRIDGE_ENDPOINT_KEY = 'endpointId';
export const WINDOW_BRIDGE_ENDPOINT_HEADER = 'X-Usage-Monitor-Endpoint';
export const LOCAL_ENDPOINT_ID = 'local';
export const WINDOW_OVERLAY_KEY = '__AGUsageMonitorOverlay';
export const CONTEXT_WINDOWS_GLOBAL_KEY = '__AGUsageMonitorContextWindows';

export const WINDOW_OVERLAY_METHODS = Object.freeze({
  ensureAlive: 'ensureAlive',
  getDockKind: 'getDockKind',
  getMountMode: 'getMountMode',
  updateBridge: 'updateBridge',
  applyMountMode: 'applyMountMode',
  syncHostRoute: 'syncHostRoute',
  deliverRpc: 'deliverRpc',
  dispose: 'dispose',
});

export const BRIDGE_API_ROUTE_DEFS = Object.freeze([
  Object.freeze({ path: '/api/telemetry', method: 'GET', action: 'telemetry' }),
  Object.freeze({ path: '/api/settings', method: 'POST', action: 'settings' }),
  Object.freeze({ path: '/api/accounts', method: 'GET', action: 'accounts_get' }),
  Object.freeze({ path: '/api/accounts/update', method: 'POST', action: 'accounts_update' }),
  Object.freeze({ path: '/api/context-window', method: 'POST', action: 'context_window' }),
  Object.freeze({ path: '/api/settings/reset', method: 'POST', action: 'settings_reset' }),
  Object.freeze({ path: '/api/cache/rebuild', method: 'POST', action: 'cache_rebuild' }),
  Object.freeze({ path: '/api/cloud-sync', method: 'POST', action: 'cloud_sync' }),
  Object.freeze({ path: '/api/fx-sync', method: 'POST', action: 'fx_sync' }),
  Object.freeze({ path: '/api/plugin-update', method: 'POST', action: 'plugin_update' }),
  Object.freeze({ path: '/api/bridge/relaunch', method: 'POST', action: 'bridge_relaunch' }),
  Object.freeze({
    path: '/api/session-migration/catalog',
    method: 'GET',
    action: 'session_migration_catalog',
  }),
  Object.freeze({
    path: '/api/session-migration/migrate',
    method: 'POST',
    action: 'session_migration_migrate',
  }),
  Object.freeze({ path: '/api/export-file', method: 'POST', action: 'export_file' }),
  Object.freeze({ path: '/api/reveal-file', method: 'POST', action: 'reveal_file' }),
  Object.freeze({
    path: '/api/quota-reservation/log',
    method: 'GET',
    action: 'quota_reservation_log',
  }),
  Object.freeze({ path: '/api/host-i18n', method: 'GET', action: 'host_i18n_get' }),
  Object.freeze({ path: '/api/host-i18n', method: 'POST', action: 'host_i18n_action' }),
  Object.freeze({ path: '/api/sessions/list', method: 'GET', action: 'sessions_list' }),
  Object.freeze({
    path: '/api/sessions/cleanup-preview',
    method: 'POST',
    action: 'sessions_cleanup_preview',
  }),
  Object.freeze({ path: '/api/sessions/delete', method: 'POST', action: 'sessions_delete' }),
  Object.freeze({
    path: '/api/sessions/redact-ledger',
    method: 'POST',
    action: 'sessions_redact_ledger',
  }),
  Object.freeze({ path: '/api/sessions/reveal', method: 'POST', action: 'sessions_reveal' }),
]);

export const BRIDGE_API_PATHS = Object.freeze(BRIDGE_API_ROUTE_DEFS.map((r) => r.path));

export function readInjectedWindowBridge() {
  return typeof window === 'undefined' ? undefined : window[WINDOW_BRIDGE_KEY];
}
