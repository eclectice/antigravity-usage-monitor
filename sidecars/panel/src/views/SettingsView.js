/**
 * @fileoverview View 4: Control Center ("常规" / "结构" / "会话" / "账号" / "其他").
 * Orchestrates the five modular Control Center tabs
 * with top sub-navigation and a shared `CustomScrollbar` viewport.
 */

import { defineComponent } from '../core/component.js';
import { h, patchAttr, patchClasses } from '../core/domPatch.js';
import { i18nStore, t } from '../i18n/index.js';
import { telemetryStore } from '../store/telemetryStore.js';
import { getVisibleMonitorView, uiStore } from '../store/uiStore.js';
import { CustomScrollbar } from '../components/ui/CustomScrollbar.js';
import { SegmentedControl } from '../components/ui/SegmentedControl.js';
import { SettingsAccountTab } from './settings/SettingsAccountTab.js';
import { SettingsGeneralTab } from './settings/SettingsGeneralTab.js';
import { SettingsOtherTab } from './settings/SettingsOtherTab.js';
import { SettingsSessionsTab } from './settings/SettingsSessionsTab.js';
import { SettingsStructureTab } from './settings/SettingsStructureTab.js';

export const SHOW_ACCOUNT_TAB = true;

function getSettingsSubTabOptions() {
  return [
    { value: 'general', label: t('settings.subTab.general') },
    { value: 'structure', label: t('settings.subTab.structure') },
    { value: 'sessions', label: t('settings.subTab.sessions') },
    ...(SHOW_ACCOUNT_TAB ? [{ value: 'account', label: t('settings.subTab.account') }] : []),
    { value: 'other', label: t('settings.subTab.other') },
  ];
}

export const SettingsView = defineComponent({
  name: 'SettingsView',
  setup({ onCleanup }) {
    const initialSubTab = uiStore.getState().settingsSubTab || 'general';

    const subNavSwitch = SegmentedControl({
      ariaLabel: t('settings.subTab.aria'),
      modelValue: initialSubTab,
      options: getSettingsSubTabOptions(),
      onUpdateModelValue: (nextSubTab) => {
        uiStore.setState({ settingsSubTab: nextSubTab }, { sync: true });
      },
    });

    const subNavBar = h('div', { className: 'settings-subnav-bar' }, [subNavSwitch.el]);

    let viewScrollbar = null;
    const refreshScroll = () => {
      if (viewScrollbar) {
        viewScrollbar.refresh();
      }
    };

    const generalTab = SettingsGeneralTab({ onLayoutChange: refreshScroll });
    const structureTab = SettingsStructureTab({ onLayoutChange: refreshScroll });
    const sessionsTab = SettingsSessionsTab({ onLayoutChange: refreshScroll });
    const accountTab = SettingsAccountTab({ onLayoutChange: refreshScroll });
    const otherTab = SettingsOtherTab({ onLayoutChange: refreshScroll });

    let showingAccount = false;
    let preloadedAccountOnce = false;
    function applyActiveSubTab(subTab, activeView) {
      const target =
        subTab === 'structure' ||
        subTab === 'sessions' ||
        subTab === 'other' ||
        (accountTab && subTab === 'account')
          ? subTab
          : 'general';
      subNavSwitch.setValue(target);
      patchAttr(generalTab.el, 'hidden', target !== 'general');
      patchAttr(structureTab.el, 'hidden', target !== 'structure');
      patchAttr(structureTab.refs.thirdNavBar, 'hidden', target !== 'structure');
      patchAttr(sessionsTab.el, 'hidden', target !== 'sessions');
      patchAttr(sessionsTab.refs.thirdNavBar, 'hidden', target !== 'sessions');
      patchClasses(viewScrollbar?.el, { 'is-full-height-tab': target === 'sessions' });
      patchAttr(otherTab.el, 'hidden', target !== 'other');
      if (target === 'sessions' && activeView === 'settings') {
        void sessionsTab.refs.ensureLoaded();
      }
      if (accountTab) {
        patchAttr(accountTab.el, 'hidden', target !== 'account');
        if (activeView === 'settings' && !preloadedAccountOnce) {
          preloadedAccountOnce = true;
          void accountTab.refs.preload?.();
        }
        const nextShowingAccount = target === 'account' && activeView === 'settings';
        if (nextShowingAccount && !showingAccount) void accountTab.refs.load();
        showingAccount = nextShowingAccount;
      }
      refreshScroll();
    }

    const contentContainer = h(
      'div',
      {},
      accountTab
        ? [generalTab.el, structureTab.el, sessionsTab.el, accountTab.el, otherTab.el]
        : [generalTab.el, structureTab.el, sessionsTab.el, otherTab.el]
    );
    viewScrollbar = CustomScrollbar({
      contentEl: contentContainer,
      className: 'view-pane',
    });

    applyActiveSubTab(initialSubTab, uiStore.getState().activeView);

    const rootEl = h('div', { className: 'settings-view-root' }, [
      subNavBar,
      structureTab.refs.thirdNavBar,
      sessionsTab.refs.thirdNavBar,
      viewScrollbar.el,
    ]);

    let lastEndpointId = telemetryStore.getState().telemetry?.endpoint?.id || '';
    function syncActiveTab() {
      const ui = uiStore.getState();
      const { settingsSubTab } = ui;
      const telemetry = telemetryStore.getState().telemetry;
      const curEndpointId = telemetry?.endpoint?.id || '';
      if (curEndpointId && curEndpointId !== lastEndpointId) {
        lastEndpointId = curEndpointId;
        sessionsTab.refs.markStale?.();
      }
      if (getVisibleMonitorView(ui) !== 'settings') return;
      const settings = telemetry?.settings;
      if (accountTab) {
        accountTab.refs.renderAccount(telemetry?.account, telemetry?.quotas, settings);
      }
      if (settingsSubTab === 'structure') {
        if (settings) {
          structureTab.refs.renderSettings(
            settings,
            telemetry?.windowBridge,
            telemetry?.hostPlatform,
            telemetry?.cliStatusLine,
            telemetry?.quotas
          );
        }
      } else if (settingsSubTab === 'sessions') {
        void sessionsTab.refs.ensureLoaded();
      } else if (settingsSubTab === 'other') {
        if (settings) {
          otherTab.refs.renderSettings(
            settings,
            telemetry.contextWindowModels || [],
            telemetry?.windowBridge,
            telemetry?.hostPlatform,
            telemetry?.cloudCodeProxy,
            telemetry?.cacheRebuild
          );
        }
      } else if (settingsSubTab !== 'account') {
        if (settings) {
          generalTab.refs.renderSettings(
            settings,
            telemetry?.windowBridge,
            telemetry?.hostPlatform
          );
        }
        void generalTab.refs.loadHostI18n?.(false);
        if (telemetry?.cloudStatus) generalTab.refs.renderCloudStatus(telemetry.cloudStatus);
        if (telemetry?.fxRates) generalTab.refs.renderFxRates?.(telemetry.fxRates);
      }
      refreshScroll();
    }

    const unsubTelemetry = telemetryStore.subscribe(
      (st) => ({
        endpointId: st.telemetry?.endpoint?.id,
        settings: st.telemetry?.settings,
        windowBridge: st.telemetry?.windowBridge,
        cloudCodeProxy: st.telemetry?.cloudCodeProxy,
        cliStatusLine: st.telemetry?.cliStatusLine,
        hostPlatform: st.telemetry?.hostPlatform,
        cloudStatus: st.telemetry?.cloudStatus,
        fxRates: st.telemetry?.fxRates,
        contextWindowModels: st.telemetry?.contextWindowModels,
        account: st.telemetry?.account,
        quotas: st.telemetry?.quotas,
        cacheRebuild: st.telemetry?.cacheRebuild,
      }),
      syncActiveTab
    );

    const unsubUi = uiStore.subscribe(
      (st) => ({
        activeView: getVisibleMonitorView(st),
        settingsSubTab: st.settingsSubTab,
      }),
      (slice) => {
        applyActiveSubTab(slice.settingsSubTab, slice.activeView);
        syncActiveTab();
      }
    );

    const unsubI18n = i18nStore.subscribe(
      (st) => st.locale,
      () => {
        subNavSwitch.setProps({
          ariaLabel: t('settings.subTab.aria'),
          modelValue: uiStore.getState().settingsSubTab || 'general',
          options: getSettingsSubTabOptions(),
        });
        generalTab.refs.refreshLabels();
        structureTab.refs.refreshLabels();
        sessionsTab.refs.refreshLabels();
        accountTab?.refs.refreshLabels();
        otherTab.refs.refreshLabels();
        refreshScroll();
      }
    );

    onCleanup(() => {
      unsubTelemetry();
      unsubUi();
      unsubI18n();
      subNavSwitch.destroy();
      generalTab.destroy();
      structureTab.destroy();
      sessionsTab.destroy();
      accountTab?.destroy();
      otherTab.destroy();
      viewScrollbar.destroy();
    });

    return {
      el: rootEl,
      refs: {
        subNavSwitch,
        generalTab,
        structureTab,
        sessionsTab,
        accountTab,
        otherTab,
        viewScrollbar,
        // Convenience aliases for external callers / tests
        windowMountSelect: structureTab.refs.windowMountSelect,
        multiSessionToggle: structureTab.refs.multiSessionToggle,
        topbarSlotsList: structureTab.refs.topbarSlotsList,
        sessionMigrationCard: sessionsTab.refs.sessionMigrationCard,
        stepModelSelect: otherTab.refs.stepModelSelect,
        autoUpdateSelect: generalTab.refs.autoUpdateSelect,
      },
    };
  },
});
