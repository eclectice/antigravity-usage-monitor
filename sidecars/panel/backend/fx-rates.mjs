/**
 * @fileoverview Free, no-API-key FX rate fetcher with 24h local disk cache and offline fallback.
 *
 * Provider chain (USD base):
 * 1. Primary: Frankfurter (`https://api.frankfurter.dev/v1/latest?base=USD`) — official central bank reference rates
 * 2. Fallback / Supplement: ExchangeRate-API Open Daily (`https://open.er-api.com/v6/latest/USD`) — 160+ currencies
 * 3. Offline fallback: Built-in static reference rates from `DISPLAY_CURRENCY_META`
 */

import { FX_RATES_CACHE_FILE, isPlainObject, loadJson, saveJson } from './config.mjs';
import {
  DISPLAY_CURRENCY_META,
  SUPPORTED_DISPLAY_CURRENCIES,
} from '../shared/settings-normalization.mjs';

export const FRANKFURTER_USD_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';
export const EXCHANGERATE_API_USD_URL = 'https://open.er-api.com/v6/latest/USD';
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FX_FETCH_TIMEOUT_MS = 6000;

function buildFallbackRatesMap() {
  const out = {};
  for (const code of SUPPORTED_DISPLAY_CURRENCIES) {
    out[code] = DISPLAY_CURRENCY_META[code].fallbackRate;
  }
  return out;
}

function sanitizeRatesObject(rawRates) {
  const out = {};
  if (!isPlainObject(rawRates)) return out;
  for (const code of SUPPORTED_DISPLAY_CURRENCIES) {
    if (code === 'USD') {
      out.USD = 1;
      continue;
    }
    const val = Number(rawRates[code]);
    if (Number.isFinite(val) && val > 0) {
      out[code] = val;
    }
  }
  return out;
}

function formatIsoDateFromUtcString(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

let fxState = {
  hydrated: false,
  base: 'USD',
  provider: 'fallback',
  date: '',
  fetchedAtMs: 0,
  source: 'fallback',
  rates: buildFallbackRatesMap(),
  isSyncing: false,
  lastError: '',
};

let inFlightFxSync = null;

function hydrateFxCacheFromDisk(cacheFile = FX_RATES_CACHE_FILE) {
  if (fxState.hydrated) return;
  fxState.hydrated = true;
  const cached = loadJson(cacheFile, null);
  if (!isPlainObject(cached) || !isPlainObject(cached.rates)) return;
  const cleanRates = sanitizeRatesObject(cached.rates);
  if (Object.keys(cleanRates).length <= 1) return;
  fxState = {
    hydrated: true,
    base: 'USD',
    provider: String(cached.provider || 'frankfurter'),
    date: String(cached.date || ''),
    fetchedAtMs: Number(cached.fetchedAtMs || 0),
    source: 'cache',
    rates: { ...buildFallbackRatesMap(), ...cleanRates },
    isSyncing: false,
    lastError: '',
  };
}

async function fetchJsonWithTimeout(url, fetchFn, timeoutMs = FX_FETCH_TIMEOUT_MS) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res || !res.ok) {
      throw new Error(`HTTP ${res?.status || 'ERR'}`);
    }
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function listMissingCurrencies(ratesMap) {
  return SUPPORTED_DISPLAY_CURRENCIES.filter(
    (code) => code !== 'USD' && !(Number(ratesMap[code]) > 0)
  );
}

/**
 * Returns the current FX rates snapshot synchronously (never blocks telemetry).
 */
export function getFxRatesSnapshot(cacheFile = FX_RATES_CACHE_FILE) {
  hydrateFxCacheFromDisk(cacheFile);
  return {
    base: fxState.base,
    provider: fxState.provider,
    date: fxState.date,
    fetchedAtMs: fxState.fetchedAtMs,
    source: fxState.source,
    rates: { ...fxState.rates },
    isSyncing: fxState.isSyncing,
    lastError: fxState.lastError,
  };
}

/**
 * Reset in-memory FX state (primarily for unit tests).
 */
export function resetFxRatesStateForTest() {
  fxState = {
    hydrated: false,
    base: 'USD',
    provider: 'fallback',
    date: '',
    fetchedAtMs: 0,
    source: 'fallback',
    rates: buildFallbackRatesMap(),
    isSyncing: false,
    lastError: '',
  };
  inFlightFxSync = null;
}

/**
 * Fetches latest USD-based FX rates using Frankfurter (primary) -> ExchangeRate-API (fallback/supplement).
 * Results are persisted to `fx_rates_cache.json` with a 24h TTL.
 *
 * @param {{ force?: boolean, fetchFn?: typeof fetch, cacheFile?: string, nowMs?: number }} [opts]
 */
export async function syncFxRates({
  force = false,
  fetchFn = globalThis.fetch,
  cacheFile = FX_RATES_CACHE_FILE,
  nowMs = Date.now(),
} = {}) {
  hydrateFxCacheFromDisk(cacheFile);

  if (
    !force &&
    fxState.source !== 'fallback' &&
    fxState.fetchedAtMs > 0 &&
    nowMs - fxState.fetchedAtMs < FX_CACHE_TTL_MS
  ) {
    return getFxRatesSnapshot(cacheFile);
  }

  if (inFlightFxSync && fetchFn === globalThis.fetch && cacheFile === FX_RATES_CACHE_FILE) {
    return inFlightFxSync;
  }

  const run = (async () => {
    if (typeof fetchFn !== 'function') {
      fxState.lastError = 'fetch unavailable';
      return getFxRatesSnapshot(cacheFile);
    }

    fxState.isSyncing = true;
    const errors = [];
    let mergedRates = { USD: 1 };
    let provider = '';
    let rateDate = '';

    // 1. Primary: Frankfurter (official central banks)
    try {
      const data = await fetchJsonWithTimeout(FRANKFURTER_USD_URL, fetchFn);
      const parsed = sanitizeRatesObject(data?.rates);
      if (Object.keys(parsed).length > 1) {
        mergedRates = { ...mergedRates, ...parsed };
        provider = 'frankfurter';
        rateDate = String(data?.date || '');
      } else {
        errors.push('Frankfurter: empty rates');
      }
    } catch (err) {
      errors.push(`Frankfurter: ${err?.message || 'request failed'}`);
    }

    // 2. Fallback / Supplement: ExchangeRate-API Open Daily (fills missing currencies like TWD, or full fallback)
    const missing = listMissingCurrencies(mergedRates);
    if (!provider || missing.length > 0) {
      try {
        const data = await fetchJsonWithTimeout(EXCHANGERATE_API_USD_URL, fetchFn);
        const parsed = sanitizeRatesObject(data?.rates);
        if (Object.keys(parsed).length > 1) {
          if (!provider) {
            mergedRates = { ...mergedRates, ...parsed };
            provider = 'er-api';
            rateDate = formatIsoDateFromUtcString(data?.time_last_update_utc);
          } else {
            let filledAny = false;
            for (const code of missing) {
              if (Number(parsed[code]) > 0) {
                mergedRates[code] = parsed[code];
                filledAny = true;
              }
            }
            if (filledAny) {
              provider = 'frankfurter+er-api';
            }
          }
        } else if (!provider) {
          errors.push('ExchangeRate-API: empty rates');
        }
      } catch (err) {
        if (!provider) {
          errors.push(`ExchangeRate-API: ${err?.message || 'request failed'}`);
        }
      }
    }

    fxState.isSyncing = false;

    if (provider) {
      const completeRates = { ...buildFallbackRatesMap(), ...mergedRates };
      fxState = {
        hydrated: true,
        base: 'USD',
        provider,
        date: rateDate,
        fetchedAtMs: nowMs,
        source: 'live',
        rates: completeRates,
        isSyncing: false,
        lastError: '',
      };
      saveJson(cacheFile, {
        base: 'USD',
        provider,
        date: rateDate,
        fetchedAtMs: nowMs,
        rates: completeRates,
      });
    } else {
      fxState.lastError = errors.join('; ') || 'FX sync failed';
    }

    return getFxRatesSnapshot(cacheFile);
  })();

  if (fetchFn === globalThis.fetch && cacheFile === FX_RATES_CACHE_FILE) {
    inFlightFxSync = run.finally(() => {
      inFlightFxSync = null;
    });
    return inFlightFxSync;
  }

  return run;
}
