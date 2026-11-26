import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_DISPLAY_CURRENCY,
  normalizeDisplayCurrency,
} from '../shared/settings-normalization.mjs';
import {
  EXCHANGERATE_API_USD_URL,
  FRANKFURTER_USD_URL,
  getFxRatesSnapshot,
  resetFxRatesStateForTest,
  syncFxRates,
} from '../backend/fx-rates.mjs';
import { formatSecondaryCurrency } from '../src/core/formatters.js';

function makeJsonResponse(body, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: async () => body,
  });
}

test('normalizeDisplayCurrency defaults to CNY and accepts supported codes', () => {
  assert.equal(normalizeDisplayCurrency(undefined), DEFAULT_DISPLAY_CURRENCY);
  assert.equal(normalizeDisplayCurrency('myr'), 'MYR');
  assert.equal(normalizeDisplayCurrency(' USD '), 'USD');
  assert.equal(normalizeDisplayCurrency('INVALID'), 'CNY');
});

test('syncFxRates uses Frankfurter primary and supplements missing currencies from ExchangeRate-API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'um-fx-'));
  const cacheFile = join(dir, 'fx_rates_cache.json');
  resetFxRatesStateForTest();
  try {
    const calls = [];
    const mockFetch = async (url) => {
      calls.push(url);
      if (url === FRANKFURTER_USD_URL) {
        return makeJsonResponse({
          base: 'USD',
          date: '2026-11-26',
          rates: {
            CNY: 7.25,
            MYR: 4.42,
            EUR: 0.91,
            GBP: 0.78,
            JPY: 151.2,
            SGD: 1.33,
            AUD: 1.53,
            CAD: 1.38,
            HKD: 7.77,
            KRW: 1390,
            INR: 84.3,
            THB: 34.1,
            IDR: 15750,
            CHF: 0.87,
          },
        });
      }
      if (url === EXCHANGERATE_API_USD_URL) {
        return makeJsonResponse({
          result: 'success',
          time_last_update_utc: 'Thu, 26 Nov 2026 00:00:01 +0000',
          rates: { MYR: 4.99, TWD: 32.4 },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const snap = await syncFxRates({ force: true, fetchFn: mockFetch, cacheFile, nowMs: 1_000_000 });
    assert.equal(snap.source, 'live');
    assert.equal(snap.provider, 'frankfurter+er-api');
    assert.equal(snap.date, '2026-11-26');
    // Frankfurter rate wins for MYR, ER-API fills missing TWD
    assert.equal(snap.rates.MYR, 4.42);
    assert.equal(snap.rates.TWD, 32.4);
    assert.equal(calls.length, 2);

    // Subsequent non-forced call within 24h TTL reuses cache without network calls
    const cachedSnap = await syncFxRates({ force: false, fetchFn: mockFetch, cacheFile, nowMs: 1_000_500 });
    assert.equal(calls.length, 2);
    assert.equal(cachedSnap.rates.MYR, 4.42);

    // Hydrating fresh in-memory state reads disk cache
    resetFxRatesStateForTest();
    const diskSnap = getFxRatesSnapshot(cacheFile);
    assert.equal(diskSnap.source, 'cache');
    assert.equal(diskSnap.rates.MYR, 4.42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    resetFxRatesStateForTest();
  }
});

test('syncFxRates falls back to ExchangeRate-API when Frankfurter fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'um-fx-fb-'));
  const cacheFile = join(dir, 'fx_rates_cache.json');
  resetFxRatesStateForTest();
  try {
    const mockFetch = async (url) => {
      if (url === FRANKFURTER_USD_URL) {
        return makeJsonResponse({}, false, 503);
      }
      if (url === EXCHANGERATE_API_USD_URL) {
        return makeJsonResponse({
          result: 'success',
          time_last_update_utc: 'Thu, 26 Nov 2026 00:00:01 +0000',
          rates: { MYR: 4.45, CNY: 7.28 },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    };

    const snap = await syncFxRates({ force: true, fetchFn: mockFetch, cacheFile, nowMs: 2_000_000 });
    assert.equal(snap.source, 'live');
    assert.equal(snap.provider, 'er-api');
    assert.equal(snap.date, '2026-11-26');
    assert.equal(snap.rates.MYR, 4.45);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    resetFxRatesStateForTest();
  }
});

test('formatSecondaryCurrency formats MYR, CNY, JPY, and hides USD', () => {
  const fx = { rates: { MYR: 4.42, CNY: 7.2, JPY: 152 } };
  assert.equal(formatSecondaryCurrency(10, 'USD', fx), '');
  assert.equal(formatSecondaryCurrency(1, 'MYR', fx), '≈ RM4.42');
  assert.equal(formatSecondaryCurrency(10, 'MYR', fx), '≈ RM44.2');
  assert.equal(formatSecondaryCurrency(10, 'CNY', fx), '≈ ¥72');
  assert.equal(formatSecondaryCurrency(10, 'JPY', fx), '≈ ¥1,520');
});
