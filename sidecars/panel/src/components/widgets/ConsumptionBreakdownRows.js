/**
 * @fileoverview Reusable model, client-source, workspace, and top-conversation breakdown
 * row builders (`ConsumptionBreakdownRows.js`) extracted from `ConsumptionView.js`.
 * Consolidates shared long-tail model partitioning, hover-popover event binding, and top-model pill rendering.
 */

import {
  h,
  patchAttr,
  patchClasses,
  patchKeyedList,
  patchStyleVar,
  patchText,
} from '../../core/domPatch.js';
import {
  formatCnyApprox,
  formatSecondaryCurrency,
  formatMetric,
  formatPctNumber,
  formatSpeedMetric,
  formatTokensPrecise,
  formatUsd,
  getCanonicalModelColorSeed,
  resolveDeterministicModelColor,
} from '../../core/formatters.js';
import { t } from '../../i18n/index.js';
import { createFourSegmentBar } from '../ui/FourSegmentBar.js';

function createSourceModelSegment() {
  const segEl = h('div', { className: 'progress-seg cons-model-seg' });
  return { el: segEl, refs: { segEl } };
}

function createSourceTopModelItem() {
  const dotEl = h('span', { className: 'dot-swatch cons-model-dot cons-source-top-dot' });
  const nameEl = h('span', { className: 'cons-source-top-name' });
  const pctEl = h('strong', { className: 'cons-source-top-pct text-mono' });
  const itemEl = h('span', { className: 'cons-source-top-item' }, [dotEl, nameEl, pctEl]);
  return { el: itemEl, refs: { itemEl, dotEl, nameEl, pctEl } };
}

function formatCompactSourceSharePct(pct) {
  const num = Number(pct || 0);
  if (!Number.isFinite(num) || num <= 0) return '0%';
  if (num >= 10) return `${Math.round(num)}%`;
  return `${num.toFixed(1)}%`;
}

function renderSegmentedModelBarAndTopPills(
  trackEl,
  topModelsEl,
  partitioned,
  scaleRatio,
  fallbackKey
) {
  const barItems =
    partitioned.length > 0
      ? partitioned.map((seg) => ({
          key: seg.key,
          segPct: scaleRatio > 0 ? seg.pct * scaleRatio : 0,
          color: seg.color,
        }))
      : scaleRatio > 0
        ? [
            {
              key: fallbackKey,
              segPct: scaleRatio * 100,
              color: 'var(--accent-primary)',
            },
          ]
        : [];

  patchKeyedList(trackEl, barItems, {
    keyFn: (seg) => seg.key,
    sigFn: (seg) => `${seg.key}:${seg.segPct.toFixed(2)}:${seg.color}`,
    createRow: createSourceModelSegment,
    updateRow: (segRefs, seg) => {
      patchStyleVar(segRefs.segEl, '--seg-w', `${seg.segPct.toFixed(2)}%`);
      patchStyleVar(segRefs.segEl, '--seg-color', seg.color);
    },
  });

  const topModels = partitioned
    .filter((seg) => !seg.isOther)
    .slice(0, 3)
    .map((seg) => ({
      key: seg.key,
      label: seg.label,
      pctText: formatCompactSourceSharePct(seg.pct),
      color: seg.color,
    }));
  patchAttr(topModelsEl, 'hidden', topModels.length === 0);
  patchKeyedList(topModelsEl, topModels, {
    keyFn: (m) => m.key,
    sigFn: (m) => `${m.key}:${m.label}:${m.pctText}:${m.color}`,
    createRow: createSourceTopModelItem,
    updateRow: (mRefs, m) => {
      patchStyleVar(mRefs.dotEl, '--dot-color', m.color);
      patchText(mRefs.nameEl, m.label);
      patchText(mRefs.pctEl, m.pctText);
      patchAttr(mRefs.itemEl, 'title', `${m.label} (${m.pctText})`);
    },
  });

  return topModels;
}

/**
 * Collapses long-tail model entries into primary segments + an aggregated "Other (N)" tail.
 */
export function partitionModelSegments(
  mergedModels,
  modelColorMap,
  { maxMain = 5, minSharePct = 1.5 } = {}
) {
  if (!Array.isArray(mergedModels) || mergedModels.length === 0) return [];
  const sumTok = mergedModels.reduce((sum, m) => sum + Number(m.totalTokens || 0), 0);
  const mainModels = [];
  const tailModels = [];

  for (let i = 0; i < mergedModels.length; i += 1) {
    const m = mergedModels[i];
    const mTok = Number(m.totalTokens || 0);
    const sharePct = sumTok > 0 ? (mTok / sumTok) * 100 : 0;
    if (i === 0 || (mainModels.length < maxMain && sharePct >= minSharePct)) {
      mainModels.push(m);
    } else {
      tailModels.push(m);
    }
  }

  if (tailModels.length === 1) {
    mainModels.push(tailModels.pop());
  }

  const out = mainModels.map((m) => {
    const seed = getCanonicalModelColorSeed(m);
    const color =
      modelColorMap?.get(seed) || resolveDeterministicModelColor(seed || m.displayText);
    const tok = Number(m.totalTokens || 0);
    const pct = sumTok > 0 ? (tok / sumTok) * 100 : 0;
    const label = m.displayText || m.label || m.shortName || '—';
    const inputTokens = Math.max(0, Number(m.inputTokens || 0));
    const cacheReadTokens = Math.max(0, Number(m.cacheReadTokens || 0));
    const thinkingTokens = Math.max(0, Number(m.thinkingTokens || 0));
    const responseTokens =
      m.responseTokens != null
        ? Math.max(0, Number(m.responseTokens))
        : Math.max(0, Number(m.outputTokens || 0) - thinkingTokens);
    return {
      key: label,
      label,
      tok,
      pct,
      inputTokens,
      cacheReadTokens,
      thinkingTokens,
      responseTokens,
      outputTokens: responseTokens + thinkingTokens,
      tokText: formatTokensPrecise(tok),
      pctText: formatPctNumber(pct, { withSymbol: true }),
      color,
      isOther: false,
    };
  });

  if (tailModels.length >= 2) {
    let otherTok = 0;
    let otherIn = 0;
    let otherCache = 0;
    let otherThink = 0;
    let otherResp = 0;
    for (const m of tailModels) {
      const mt = Math.max(0, Number(m.thinkingTokens || 0));
      const mr =
        m.responseTokens != null
          ? Math.max(0, Number(m.responseTokens))
          : Math.max(0, Number(m.outputTokens || 0) - mt);
      otherTok += Number(m.totalTokens || 0);
      otherIn += Math.max(0, Number(m.inputTokens || 0));
      otherCache += Math.max(0, Number(m.cacheReadTokens || 0));
      otherThink += mt;
      otherResp += mr;
    }
    const otherPct = sumTok > 0 ? (otherTok / sumTok) * 100 : 0;
    const otherLabel = t('cons.otherModelsCount', { count: tailModels.length });
    out.push({
      key: '__other__',
      label: otherLabel,
      tok: otherTok,
      pct: otherPct,
      inputTokens: otherIn,
      cacheReadTokens: otherCache,
      thinkingTokens: otherThink,
      responseTokens: otherResp,
      outputTokens: otherResp + otherThink,
      tokText: formatTokensPrecise(otherTok),
      pctText: formatPctNumber(otherPct, { withSymbol: true }),
      color: 'var(--cons-other-seg)',
      isOther: true,
    });
  }

  return out;
}

/**
 * Creates a model ranking row (`tokens` | `cost` | `speed` | `calls` sort modes).
 */
export function createBreakdownItemRow() {
  const nameTextEl = h('span', { className: 'cons-row-title-text' });
  const nameEl = h('strong', { className: 'cons-row-title' }, [nameTextEl]);
  const pctBadge = h('span', { className: 'cons-share-pill text-mono', text: '0%' });
  const totalTokEl = h('span', { className: 'cons-row-tok text-mono' });
  const costEl = h('strong', { className: 'cons-row-cost text-mono' });
  const segBar = createFourSegmentBar();

  const inLbl = h('span', { text: t('cons.footInput') });
  const cacheLbl = h('span', { text: t('cons.footCache') });
  const outLbl = h('span', { text: t('cons.footOutput') });
  const thinkLbl = h('span', { text: t('cons.footThinking') });
  const callsLbl = h('span', { text: t('cons.footCalls') });

  const inVal = h('strong', { className: 'text-mono' });
  const cacheVal = h('strong', { className: 'text-mono' });
  const outVal = h('strong', { className: 'text-mono' });
  const thinkVal = h('strong', { className: 'text-mono' });
  const callsVal = h('strong', { className: 'text-mono' });
  const metricBarFillEl = h('div', { className: 'progress-seg cons-metric-fill' });
  const metricBarEl = h(
    'div',
    { className: 'progress-track cons-seg-bar cons-metric-bar', hidden: true },
    [metricBarFillEl]
  );
  const tokenFootEl = h('div', { className: 'cons-item-foot' }, [
    h('span', { className: 'legend-left' }, [
      h('span', { className: 'dot-swatch seg-input' }),
      inLbl,
      inVal,
    ]),
    h('span', { className: 'legend-left' }, [
      h('span', { className: 'dot-swatch seg-cached' }),
      cacheLbl,
      cacheVal,
    ]),
    h('span', { className: 'legend-left' }, [
      h('span', { className: 'dot-swatch seg-thinking' }),
      thinkLbl,
      thinkVal,
    ]),
    h('span', { className: 'legend-left' }, [
      h('span', { className: 'dot-swatch seg-output' }),
      outLbl,
      outVal,
    ]),
    h('span', { className: 'legend-left' }, [callsLbl, callsVal]),
  ]);
  const perfMainEl = h('span', { className: 'cons-model-perf-main text-mono' });
  const perfUnitCostEl = h('span', { className: 'cons-model-unit-cost text-mono', hidden: true });
  const perfFootEl = h('div', { className: 'cons-model-perf-foot', hidden: true }, [
    perfMainEl,
    perfUnitCostEl,
  ]);
  const focusLeftEl = h('span', { className: 'cons-model-focus-left text-mono' });
  const focusRightEl = h('span', { className: 'cons-model-focus-right text-mono' });
  const focusFootEl = h(
    'div',
    { className: 'cons-item-foot cons-model-focus-foot', hidden: true },
    [focusLeftEl, focusRightEl]
  );

  const rowEl = h('div', { className: 'cons-item-row' }, [
    h('div', { className: 'panel-header' }, [
      nameEl,
      h('span', { className: 'cons-row-metrics' }, [pctBadge, totalTokEl, costEl]),
    ]),
    segBar.el,
    metricBarEl,
    tokenFootEl,
    perfFootEl,
    focusFootEl,
  ]);

  return {
    el: rowEl,
    refs: {
      nameEl,
      nameTextEl,
      pctBadge,
      totalTokEl,
      costEl,
      segBar,
      metricBarEl,
      metricBarFillEl,
      tokenFootEl,
      inLbl,
      cacheLbl,
      outLbl,
      thinkLbl,
      callsLbl,
      inVal,
      cacheVal,
      outVal,
      thinkVal,
      callsVal,
      perfFootEl,
      perfMainEl,
      perfUnitCostEl,
      focusFootEl,
      focusLeftEl,
      focusRightEl,
    },
  };
}

/**
 * Incrementally patches a model ranking row.
 */
export function updateBreakdownItemRow(refs, item, totalsCtx, sortMode = 'tokens') {
  const displayLabel = item.label || item.name || item.shortName || '—';
  patchText(refs.nameTextEl, displayLabel);
  patchAttr(refs.nameEl, 'title', item.title || displayLabel);

  const total = Number(item.totalTokens || 0);
  const costVal = Number(item.costUsd || 0);
  const callsCount = Number(item.calls || 0);
  const isAllUnpriced =
    callsCount > 0 && Number(item.unpricedCalls || 0) >= callsCount && !(costVal > 0);
  const costText = formatUsd(isAllUnpriced ? null : costVal, {
    precise: costVal > 0 && costVal < 0.1,
  });

  const avgTps =
    item.avgTokPerSec != null &&
    Number.isFinite(Number(item.avgTokPerSec)) &&
    Number(item.avgTokPerSec) > 0
      ? Number(item.avgTokPerSec)
      : null;
  const avgTtft =
    item.avgTtftSec != null &&
    Number.isFinite(Number(item.avgTtftSec)) &&
    Number(item.avgTtftSec) >= 0
      ? Number(item.avgTtftSec)
      : null;
  const hasExplicitCachePct =
    item.cacheHitPct != null && Number.isFinite(Number(item.cacheHitPct));
  const promptTok = Number(item.inputTokens || 0) + Number(item.cacheReadTokens || 0);
  const cachePctVal = hasExplicitCachePct
    ? Number(item.cacheHitPct)
    : promptTok > 0 && Number(item.cacheReadTokens || 0) > 0
      ? +((Number(item.cacheReadTokens || 0) / promptTok) * 100).toFixed(1)
      : 0;
  const cachePctStr = formatPctNumber(cachePctVal);
  const effCostPer1M =
    !isAllUnpriced && costVal > 0 && total >= 1000 ? costVal / (total / 1_000_000) : null;
  const outTok = Number(
    item.outputTokens ?? Number(item.responseTokens || 0) + Number(item.thinkingTokens || 0)
  );

  if (sortMode === 'cost') {
    const costBase = Number(totalsCtx?.totalCost || 0);
    const costShare = costBase > 0 ? +((costVal / costBase) * 100).toFixed(1) : 0;
    const barPct =
      costBase > 0 && costVal > 0 ? Math.min(100, Math.max(1, (costVal / costBase) * 100)) : 0;
    patchAttr(refs.pctBadge, 'hidden', false);
    patchAttr(refs.pctBadge, 'title', null);
    patchText(refs.pctBadge, formatPctNumber(costShare, { withSymbol: true }));
    patchText(
      refs.totalTokEl,
      isAllUnpriced
        ? ''
        : formatSecondaryCurrency(costVal, totalsCtx?.displayCurrency, totalsCtx?.fxRates)
    );
    patchText(refs.costEl, costText);

    patchAttr(refs.segBar.el, 'hidden', true);
    patchAttr(refs.metricBarEl, 'hidden', false);
    patchStyleVar(refs.metricBarFillEl, '--seg-w', `${barPct.toFixed(2)}%`);
    patchClasses(refs.metricBarFillEl, {
      'tone-cost': true,
      'tone-speed': false,
      'tone-calls': false,
    });

    patchAttr(refs.tokenFootEl, 'hidden', true);
    patchAttr(refs.perfFootEl, 'hidden', true);
    patchAttr(refs.focusFootEl, 'hidden', false);
    const unitPart =
      effCostPer1M !== null
        ? t('cons.modelUnitCost', {
            cost: formatUsd(effCostPer1M, { precise: effCostPer1M < 0.1 }),
          })
        : '';
    const cachePart = t('cons.topConvCacheMeta', { pct: cachePctStr });
    patchText(refs.focusLeftEl, unitPart ? `${unitPart} · ${cachePart}` : cachePart);
    patchText(
      refs.focusRightEl,
      `${formatTokensPrecise(total)} · ${t('cons.callsCount', { calls: callsCount })}`
    );
    return;
  }

  if (sortMode === 'speed') {
    const maxTps = Number(totalsCtx?.maxAvgTps || 0);
    const speedPct =
      maxTps > 0 && avgTps !== null ? Math.min(100, Math.max(2, (avgTps / maxTps) * 100)) : 0;
    patchAttr(refs.pctBadge, 'hidden', avgTps === null);
    patchAttr(refs.pctBadge, 'title', avgTps !== null ? t('cons.speedRelTip') : null);
    patchText(refs.pctBadge, avgTps !== null ? `${Math.round(speedPct)}%` : '');
    patchText(
      refs.totalTokEl,
      avgTtft !== null ? t('cons.focusTtft', { ttft: formatMetric(avgTtft, 's') }) : ''
    );
    patchText(refs.costEl, formatSpeedMetric(avgTps, ' tok/s'));

    patchAttr(refs.segBar.el, 'hidden', true);
    patchAttr(refs.metricBarEl, 'hidden', false);
    patchStyleVar(refs.metricBarFillEl, '--seg-w', `${speedPct.toFixed(2)}%`);
    patchClasses(refs.metricBarFillEl, {
      'tone-cost': false,
      'tone-speed': true,
      'tone-calls': false,
    });

    patchAttr(refs.tokenFootEl, 'hidden', true);
    patchAttr(refs.perfFootEl, 'hidden', true);
    patchAttr(refs.focusFootEl, 'hidden', false);
    patchText(
      refs.focusLeftEl,
      t('cons.focusSpeedMeta', {
        ttft: formatMetric(avgTtft, 's'),
        cache: cachePctStr,
        out: formatTokensPrecise(outTok),
      })
    );
    patchText(refs.focusRightEl, t('cons.callsCount', { calls: callsCount }));
    return;
  }

  if (sortMode === 'calls') {
    const callsBase = Number(totalsCtx?.totalCalls || 0);
    const callsShare = callsBase > 0 ? +((callsCount / callsBase) * 100).toFixed(1) : 0;
    const barPct =
      callsBase > 0 && callsCount > 0
        ? Math.min(100, Math.max(1, (callsCount / callsBase) * 100))
        : 0;
    patchAttr(refs.pctBadge, 'hidden', false);
    patchAttr(refs.pctBadge, 'title', null);
    patchText(refs.pctBadge, formatPctNumber(callsShare, { withSymbol: true }));
    patchText(refs.totalTokEl, formatTokensPrecise(total));
    patchText(refs.costEl, t('cons.callsCount', { calls: callsCount }));

    patchAttr(refs.segBar.el, 'hidden', true);
    patchAttr(refs.metricBarEl, 'hidden', false);
    patchStyleVar(refs.metricBarFillEl, '--seg-w', `${barPct.toFixed(2)}%`);
    patchClasses(refs.metricBarFillEl, {
      'tone-cost': false,
      'tone-speed': false,
      'tone-calls': true,
    });

    patchAttr(refs.tokenFootEl, 'hidden', true);
    patchAttr(refs.perfFootEl, 'hidden', true);
    patchAttr(refs.focusFootEl, 'hidden', false);
    const avgPerCall = callsCount > 0 ? total / callsCount : 0;
    patchText(
      refs.focusLeftEl,
      t('cons.focusCallsMeta', {
        avgTok: formatTokensPrecise(avgPerCall),
        cost: costText,
      })
    );
    patchText(refs.focusRightEl, t('cons.topConvCacheMeta', { pct: cachePctStr }));
    return;
  }

  patchText(refs.inLbl, t('cons.footInput'));
  patchText(refs.cacheLbl, t('cons.footCache'));
  patchText(refs.outLbl, t('cons.footOutput'));
  patchText(refs.thinkLbl, t('cons.footThinking'));
  patchText(refs.callsLbl, t('cons.footCalls'));
  const grandTotalTokens = Number(totalsCtx?.totalTokens || 0);
  const share = grandTotalTokens > 0 ? +((total / grandTotalTokens) * 100).toFixed(1) : 0;
  const scaleRatio =
    grandTotalTokens > 0 && total > 0 ? Math.min(1, Math.max(0.008, total / grandTotalTokens)) : 0;
  patchAttr(refs.pctBadge, 'hidden', false);
  patchAttr(refs.pctBadge, 'title', null);
  patchText(refs.pctBadge, formatPctNumber(share, { withSymbol: true }));
  patchText(refs.totalTokEl, formatTokensPrecise(total));
  patchText(refs.costEl, costText);

  const responseTok =
    item.responseTokens != null
      ? Number(item.responseTokens)
      : Math.max(0, Number(item.outputTokens || 0) - Number(item.thinkingTokens || 0));
  const thinkingTok = Number(item.thinkingTokens || 0);

  patchAttr(refs.segBar.el, 'hidden', false);
  patchAttr(refs.metricBarEl, 'hidden', true);
  refs.segBar.update({
    inputTokens: Number(item.inputTokens || 0),
    cacheReadTokens: Number(item.cacheReadTokens || 0),
    responseTokens: responseTok,
    thinkingTokens: thinkingTok,
    scaleRatio,
  });

  patchAttr(refs.tokenFootEl, 'hidden', false);
  patchAttr(refs.focusFootEl, 'hidden', true);
  patchText(refs.inVal, formatTokensPrecise(item.inputTokens || 0));
  patchText(refs.cacheVal, formatTokensPrecise(item.cacheReadTokens || 0));
  patchText(refs.outVal, formatTokensPrecise(responseTok));
  patchText(refs.thinkVal, formatTokensPrecise(thinkingTok));
  patchText(refs.callsVal, String(callsCount));

  const hasPerfMeta = avgTps !== null || avgTtft !== null || effCostPer1M !== null;
  patchAttr(refs.perfFootEl, 'hidden', !hasPerfMeta);
  if (hasPerfMeta) {
    if (avgTps !== null || avgTtft !== null) {
      patchText(
        refs.perfMainEl,
        t('steps.modelPerfFoot', {
          tps: formatSpeedMetric(avgTps, ' tok/s'),
          ttft: formatMetric(avgTtft, 's'),
          cache: cachePctStr,
        })
      );
    } else {
      patchText(refs.perfMainEl, t('cons.topConvCacheMeta', { pct: cachePctStr }));
    }
    patchAttr(refs.perfUnitCostEl, 'hidden', effCostPer1M === null);
    patchText(
      refs.perfUnitCostEl,
      effCostPer1M !== null
        ? t('cons.modelUnitCost', {
            cost: formatUsd(effCostPer1M, { precise: effCostPer1M < 0.1 }),
          })
        : ''
    );
  }
}

/**
 * Binds shared popover hover callbacks to build source-breakdown and workspace/conversation rows.
 */
export function createConsumptionBreakdownRowBuilders({
  showPopover,
  movePopover,
  hidePopover,
  isHoveredTarget,
  onSelectConversation,
}) {
  function isNodeInside(root, node) {
    if (!root || !node) return false;
    if (typeof root.contains === 'function') return root.contains(node);
    let cur = node;
    while (cur) {
      if (cur === root) return true;
      cur = cur.parentNode || null;
    }
    return false;
  }

  function attachUnifiedHoverZone(zoneEl, compatTargets, rowState) {
    zoneEl.addEventListener('mouseenter', (e) => {
      if (rowState.hoverPayload) {
        showPopover(zoneEl, rowState.hoverPayload, e?.clientX ?? null, e?.clientY ?? null);
      }
    });
    zoneEl.addEventListener('mousemove', (e) => {
      if (rowState.hoverPayload && isHoveredTarget(zoneEl)) {
        movePopover(zoneEl, e?.clientX ?? null, e?.clientY ?? null);
      }
    });
    zoneEl.addEventListener('mouseleave', () => {
      if (isHoveredTarget(zoneEl)) hidePopover();
    });

    for (const childEl of compatTargets) {
      if (!childEl) continue;
      childEl.addEventListener('mouseenter', (e) => {
        if (rowState.hoverPayload) {
          showPopover(zoneEl, rowState.hoverPayload, e?.clientX ?? null, e?.clientY ?? null);
        }
      });
      childEl.addEventListener('mousemove', (e) => {
        if (rowState.hoverPayload && isHoveredTarget(zoneEl)) {
          movePopover(zoneEl, e?.clientX ?? null, e?.clientY ?? null);
        }
      });
      childEl.addEventListener('mouseleave', (e) => {
        const nextEl = e?.relatedTarget || null;
        if (isNodeInside(zoneEl, nextEl)) {
          return;
        }
        if (isHoveredTarget(zoneEl)) hidePopover();
      });
    }
  }

  function createSourceBreakdownRow() {
    const nameTextEl = h('span', { className: 'cons-row-title-text' });
    const nameEl = h('strong', { className: 'cons-row-title' }, [nameTextEl]);
    const pctBadge = h('span', { className: 'cons-share-pill text-mono', text: '0%' });
    const totalTokEl = h('span', { className: 'cons-row-tok text-mono' });
    const costEl = h('strong', { className: 'cons-row-cost text-mono' });
    const trackEl = h('div', { className: 'progress-track cons-seg-bar cons-source-model-bar' });
    const rowState = { hoverPayload: null };

    const barHitEl = h('div', { className: 'cons-source-bar-hit' }, [trackEl]);
    const topModelsEl = h('div', { className: 'cons-source-top-models', hidden: true });

    const callsLbl = h('span', { text: t('cons.footCalls') });
    const callsVal = h('strong', { className: 'text-mono' });

    const hoverZoneEl = h('div', { className: 'cons-source-hover-zone' }, [
      barHitEl,
      h('div', { className: 'cons-item-foot cons-source-foot' }, [
        topModelsEl,
        h('span', { className: 'legend-left cons-calls-stat' }, [callsLbl, callsVal]),
      ]),
    ]);
    attachUnifiedHoverZone(hoverZoneEl, [barHitEl, topModelsEl], rowState);

    const rowEl = h('div', { className: 'cons-item-row cons-source-row' }, [
      h('div', { className: 'panel-header' }, [
        nameEl,
        h('span', { className: 'cons-row-metrics' }, [pctBadge, totalTokEl, costEl]),
      ]),
      hoverZoneEl,
    ]);

    return {
      el: rowEl,
      refs: {
        nameEl,
        nameTextEl,
        pctBadge,
        totalTokEl,
        costEl,
        hoverZoneEl,
        barHitEl,
        trackEl,
        topModelsEl,
        callsLbl,
        callsVal,
        rowState,
      },
    };
  }

  function updateSourceBreakdownRow(refs, item, grandTotalTokens, modelColorMap) {
    patchText(refs.callsLbl, t('cons.footCalls'));
    const displayLabel = item.label || item.name || '—';
    patchText(refs.nameTextEl, displayLabel);
    patchAttr(refs.nameEl, 'title', item.title || displayLabel);

    const total = Number(item.totalTokens || 0);
    const share = grandTotalTokens > 0 ? +((total / grandTotalTokens) * 100).toFixed(1) : 0;
    const scaleRatio =
      grandTotalTokens > 0 && total > 0 ? Math.min(1, Math.max(0.01, total / grandTotalTokens)) : 0;
    patchText(refs.pctBadge, formatPctNumber(share, { withSymbol: true }));
    patchText(refs.totalTokEl, formatTokensPrecise(total));

    const costVal = Number(item.costUsd || 0);
    const callsCount = Number(item.calls || 0);
    const isAllUnpriced =
      callsCount > 0 && Number(item.unpricedCalls || 0) >= callsCount && !(costVal > 0);
    const costText = formatUsd(isAllUnpriced ? null : costVal, {
      precise: costVal > 0 && costVal < 0.1,
    });
    patchText(refs.costEl, costText);
    patchText(refs.callsVal, String(callsCount));

    const sourceModels = Array.isArray(item.mergedModels) ? item.mergedModels : [];
    const partitioned = partitionModelSegments(sourceModels, modelColorMap, {
      maxMain: 5,
      minSharePct: 1.5,
    });

    renderSegmentedModelBarAndTopPills(
      refs.trackEl,
      refs.topModelsEl,
      partitioned,
      total > 0 ? scaleRatio : 0,
      '__source_fallback__'
    );

    refs.rowState.hoverPayload =
      total > 0 || callsCount > 0
        ? {
            title: displayLabel,
            calls: callsCount,
            totalTokens: total,
            costText,
            inputTokens: item.inputTokens,
            cacheReadTokens: item.cacheReadTokens,
            thinkingTokens: item.thinkingTokens,
            responseTokens: item.responseTokens,
            outputTokens: item.outputTokens,
            segments: partitioned,
          }
        : null;
    patchClasses(refs.hoverZoneEl, { 'is-interactive': Boolean(refs.rowState.hoverPayload) });
  }

  function createTopConversationRow() {
    const titleTextEl = h('span', { className: 'cons-row-title-text' });
    const wsBadgeEl = h('span', { className: 'cons-ws-sessions-tag text-mono', hidden: true });
    const titleEl = h('strong', { className: 'cons-row-title cons-top-conv-title' }, [
      titleTextEl,
      wsBadgeEl,
    ]);
    const pctBadge = h('span', { className: 'cons-share-pill text-mono', text: '0%' });
    const totalTokEl = h('span', { className: 'cons-row-tok text-mono' });
    const costEl = h('strong', { className: 'cons-row-cost text-mono' });
    const trackEl = h('div', { className: 'progress-track cons-seg-bar cons-source-model-bar' });
    const rowState = { cascadeId: '', canJump: false, hoverPayload: null };

    const barHitEl = h('div', { className: 'cons-source-bar-hit' }, [trackEl]);
    const topModelsEl = h('div', { className: 'cons-source-top-models', hidden: true });

    const fallbackMetaEl = h('span', { className: 'cons-top-conv-meta', hidden: true });
    const callsLbl = h('span', { text: t('cons.footCalls') });
    const callsVal = h('strong', { className: 'text-mono' });

    const hoverZoneEl = h('div', { className: 'cons-source-hover-zone' }, [
      barHitEl,
      h('div', { className: 'cons-item-foot cons-source-foot' }, [
        topModelsEl,
        fallbackMetaEl,
        h('span', { className: 'legend-left cons-calls-stat' }, [callsLbl, callsVal]),
      ]),
    ]);
    attachUnifiedHoverZone(hoverZoneEl, [barHitEl, topModelsEl], rowState);

    const rowEl = h(
      'div',
      {
        className: 'cons-top-conv-row',
        onClick: () => {
          if (!rowState.canJump || !rowState.cascadeId) return;
          hidePopover();
          onSelectConversation?.(rowState.cascadeId);
        },
      },
      [
        h('div', { className: 'panel-header' }, [
          titleEl,
          h('span', { className: 'cons-row-metrics' }, [pctBadge, totalTokEl, costEl]),
        ]),
        hoverZoneEl,
      ]
    );

    return {
      el: rowEl,
      refs: {
        rowEl,
        titleEl,
        titleTextEl,
        wsBadgeEl,
        pctBadge,
        totalTokEl,
        costEl,
        hoverZoneEl,
        barHitEl,
        trackEl,
        topModelsEl,
        fallbackMetaEl,
        callsLbl,
        callsVal,
        rowState,
      },
    };
  }

  function updateTopConversationRow(refs, item, bases, modelColorMap, sortMode = 'cost') {
    patchText(refs.callsLbl, t('cons.footCalls'));
    const isWorkspaceRow = Boolean(item.isWorkspaceRow);
    const title = isWorkspaceRow
      ? item.isUnbound
        ? t('cons.workspaceUnbound')
        : String(item.label || item.workspacePath || '—').trim()
      : String(item.title || item.cascadeId || '—').trim();
    refs.rowState.cascadeId = isWorkspaceRow ? '' : String(item.cascadeId || '');
    refs.rowState.canJump =
      !isWorkspaceRow && item.canJump !== false && Boolean(refs.rowState.cascadeId);
    patchClasses(refs.rowEl, {
      'is-jumpable': refs.rowState.canJump,
      'cons-workspace-row': isWorkspaceRow,
    });
    const baseTip =
      isWorkspaceRow && item.workspacePath && item.workspacePath !== title
        ? `${title} (${item.workspacePath})`
        : title;
    patchAttr(
      refs.rowEl,
      'title',
      refs.rowState.canJump ? `${baseTip} — ${t('cons.topConvJumpTip')}` : baseTip
    );
    patchText(refs.titleTextEl, title);
    if (refs.wsBadgeEl) {
      const showWsBadge = isWorkspaceRow && Number(item.sessionCount || 0) > 0;
      patchAttr(refs.wsBadgeEl, 'hidden', !showWsBadge);
      if (showWsBadge) {
        patchText(refs.wsBadgeEl, t('cons.workspaceSessions', { count: item.sessionCount }));
      }
    }

    const total = Number(item.totalTokens || 0);
    const costVal = Number(item.costUsd || 0);
    const callsCount = Number(item.calls || 0);
    const isAllUnpriced =
      callsCount > 0 && Number(item.unpricedCalls || 0) >= callsCount && !(costVal > 0);
    const costText = formatUsd(isAllUnpriced ? null : costVal, {
      precise: costVal > 0 && costVal < 0.1,
    });

    const tokBase = Number(bases?.tokens || 0);
    const costBase = Number(bases?.cost || 0);
    const useCostBasis = sortMode === 'cost' && costBase > 0;
    const share = useCostBasis
      ? +((costVal / costBase) * 100).toFixed(1)
      : tokBase > 0
        ? +((total / tokBase) * 100).toFixed(1)
        : 0;
    const scaleRatio = useCostBasis
      ? costVal > 0
        ? Math.min(1, Math.max(0.01, costVal / costBase))
        : 0
      : tokBase > 0 && total > 0
        ? Math.min(1, Math.max(0.01, total / tokBase))
        : 0;

    patchText(refs.pctBadge, formatPctNumber(share, { withSymbol: true }));
    if (sortMode === 'tokens') {
      patchText(refs.totalTokEl, costText);
      patchText(refs.costEl, formatTokensPrecise(total));
    } else {
      patchText(refs.totalTokEl, formatTokensPrecise(total));
      patchText(refs.costEl, costText);
    }
    patchText(refs.callsVal, String(callsCount));

    const convModels = Array.isArray(item.mergedModels) ? item.mergedModels : [];
    const partitioned = partitionModelSegments(convModels, modelColorMap, {
      maxMain: 5,
      minSharePct: 1.5,
    });
    const topModels = renderSegmentedModelBarAndTopPills(
      refs.trackEl,
      refs.topModelsEl,
      partitioned,
      scaleRatio,
      '__conv_fallback__'
    );

    const showFallbackMeta = topModels.length === 0;
    patchAttr(refs.fallbackMetaEl, 'hidden', !showFallbackMeta);
    if (showFallbackMeta) {
      const srcLabel = item.sourceName || item.appSource || '';
      const cacheLabel = t('cons.topConvCacheMeta', {
        pct: formatPctNumber(item.cacheHitPct ?? 0),
      });
      patchText(refs.fallbackMetaEl, srcLabel ? `${srcLabel} · ${cacheLabel}` : cacheLabel);
    }

    refs.rowState.hoverPayload =
      partitioned.length > 0 && (total > 0 || callsCount > 0)
        ? {
            title,
            calls: callsCount,
            totalTokens: total,
            costText,
            inputTokens: item.inputTokens,
            cacheReadTokens: item.cacheReadTokens,
            thinkingTokens: item.thinkingTokens,
            responseTokens: item.responseTokens,
            outputTokens: item.outputTokens,
            segments: partitioned,
          }
        : null;
    patchClasses(refs.hoverZoneEl, { 'is-interactive': Boolean(refs.rowState.hoverPayload) });
  }

  return {
    createSourceBreakdownRow,
    updateSourceBreakdownRow,
    createTopConversationRow,
    updateTopConversationRow,
  };
}
