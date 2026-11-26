/**
 * antigravity-enhancer · Browser Runtime Bundle
 * Part 00: Bootstrap, Lifecycle Cleanup & Stylesheet Injection (No Theme Overrides)
 */
((boot) => {
  const IS_SWARM_PLUGIN_FRAME = Boolean(
    window.top !== window &&
      window.location &&
      window.location.protocol === 'plugin:' &&
      /^swarm--/i.test(window.location.hostname || '')
  );
  if (window.top !== window && !IS_SWARM_PLUGIN_FRAME) return;
  if (!boot || typeof boot !== 'object') return;

  const PATCH_VERSION = boot.version || '0.1.1';
  const ENABLED = boot.enabled !== false;
  const CSS_TEXT = boot.cssText || '';
  const CUSTOM_CSS_TEXT = boot.customCss || '';
  const MODULES = Object.assign(
    {
      i18n: true,
      metrics: true,
      openIn: true,
      promptSuggestions: false,
      deadlockHealer: true,
      zoomShortcuts: true,
      cdpAutoRelaunch: true,
      customCss: true,
      customJs: true
    },
    boot.modules || {}
  );
  if (typeof MODULES.sessionStatus !== 'boolean') {
    MODULES.sessionStatus = MODULES.metrics !== false;
  }
  if (typeof MODULES.usageStats !== 'boolean') {
    MODULES.usageStats = MODULES.metrics !== false;
  }
  MODULES.metrics = Boolean(MODULES.sessionStatus || MODULES.usageStats);

  const DEFAULT_EXCLUDE_I18N =
    'code, pre, kbd, samp, textarea, input, style, script, noscript, [contenteditable="true"], [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, .monaco-editor, .monaco-diff-editor, .xterm, [class*="onyx-key"], .prose, .markdown, [class*="chat-message"], [class*="group/file-title"], [data-testid="conversation-row-sidebar"] a[href^="/c/"], [data-testid="conversation-row-sidebar"] span.truncate, [data-testid="conversation-row-history"] a[href^="/c/"], [data-testid="conversation-row-history"] span.truncate, [data-testid="conversation-navigator-turn"], #ag-live-metrics-pill, .ag-live-metrics-pill, #ag-live-metrics-tooltip, #ag-turn-metrics-tooltip, .ag-turn-metrics, .ag-prompt-ghost-overlay, .ag-prompt-ghost-text, .ag-prompt-ghost-kbd, #ag-open-in-menu, #ag-settings-nav-wrap, #ag-settings-pane, #ag-settings-model-menu, #ag-settings-effort-menu';

  const SELECTORS = Object.assign(
    {
      inputBoxId: 'antigravity.agentSidePanelInputBox',
      branchPillInBox:
        '[data-testid="branch-pill-trigger"], [data-testid="project-branch-picker"], [data-testid="project-selector-trigger"], [data-testid="location-selector-trigger"], [aria-label^="Select project"], [aria-label^="选择项目"]',
      homeGreeting: '[data-testid="home-greeting"], [data-testid="home-splash-content"]',
      excludeI18n: DEFAULT_EXCLUDE_I18N
    },
    boot.selectors || {}
  );

  if (Array.isArray(window.__ag_cleanup_fns) && window.__ag_cleanup_fns.length > 0) {
    const prevCleanups = window.__ag_cleanup_fns.splice(0, window.__ag_cleanup_fns.length);
    for (let i = 0; i < prevCleanups.length; i++) {
      try {
        if (typeof prevCleanups[i] === 'function') prevCleanups[i]();
      } catch (e) {}
    }
  }
  window.__ag_cleanup_fns = [];
  if (window.__ag_dcl_handler) {
    try {
      window.removeEventListener('DOMContentLoaded', window.__ag_dcl_handler);
    } catch (e) {}
    window.__ag_dcl_handler = null;
  }
  if (window.__ag_turn_metrics_observer) {
    try {
      window.__ag_turn_metrics_observer.disconnect();
    } catch (e) {}
    window.__ag_turn_metrics_observer = null;
  }

  // Retire any legacy DOM nodes left over from antigravity-codex-theme or standalone antigravity-open-in
  for (const legacyId of [
    'ag-codex-theme',
    'ag-user-theme-vars',
    'ag-open-in-style',
    'ag-open-in-nav-divider',
    'ag-open-in-nav-wrap',
    'ag-open-in-pane'
  ]) {
    const stale = document.getElementById(legacyId);
    if (stale) stale.remove();
  }
  for (const legacyAttr of ['data-ag-preset', 'data-ag-theme-mode', 'data-ag-custom-font-size']) {
    document.documentElement.removeAttribute(legacyAttr);
  }
  document.querySelectorAll('[data-ag-codex-settings-open], [data-ag-open-in-settings-open]').forEach((el) => {
    el.removeAttribute('data-ag-codex-settings-open');
    el.removeAttribute('data-ag-open-in-settings-open');
  });
  if (typeof window.__agOpenInCleanup === 'function') {
    try { window.__agOpenInCleanup(); } catch (e) {}
  }

  if (!window.__ag_orig_text_map) {
    window.__ag_orig_text_map = new WeakMap();
  }
  const origTextMap = window.__ag_orig_text_map;

  function restoreAllTranslations(root = document.body) {
    if (!root) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === 3) {
          const rec = origTextMap.get(node);
          if (rec) {
            if (node.nodeValue === rec.lastVal) {
              node.nodeValue = rec.origRaw;
            }
            origTextMap.delete(node);
          }
        } else if (node.nodeType === 1 && node.shadowRoot) {
          restoreAllTranslations(node.shadowRoot);
        }
      }
      const attrNames = ['title', 'placeholder', 'aria-label'];
      const attrEls = root.querySelectorAll
        ? root.querySelectorAll(
            '[data-ag-orig-title], [data-ag-orig-title-last], [data-ag-orig-placeholder], [data-ag-orig-placeholder-last], [data-ag-orig-aria-label], [data-ag-orig-aria-label-last]'
          )
        : [];
      for (let i = 0; i < attrEls.length; i++) {
        const el = attrEls[i];
        for (let j = 0; j < attrNames.length; j++) {
          const attr = attrNames[j];
          const origAttr = 'data-ag-orig-' + attr;
          const lastAttr = origAttr + '-last';
          if (el.hasAttribute(origAttr) || el.hasAttribute(lastAttr)) {
            const savedOrig = el.getAttribute(origAttr);
            const savedLast = el.getAttribute(lastAttr);
            const cur = el.getAttribute(attr);
            if (savedOrig !== null && (savedLast === null || cur === savedLast)) {
              el.setAttribute(attr, savedOrig);
            }
            el.removeAttribute(origAttr);
            el.removeAttribute(lastAttr);
            delete el['__ag_attr_ver_' + attr];
          }
        }
        delete el.__ag_attr_ver;
      }
    } catch (e) {}
  }

  if (!ENABLED) {
    for (const id of [
      'ag-enhancer-style',
      'ag-user-custom-style',
      'ag-live-metrics-pill',
      'ag-side-metrics-pill',
      'ag-live-metrics-tooltip',
      'ag-turn-metrics-tooltip',
      'ag-open-in-menu',
      'ag-settings-nav-divider',
      'ag-settings-nav-wrap',
      'ag-settings-pane',
      'ag-settings-model-menu',
      'ag-settings-effort-menu'
    ]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    document.querySelectorAll('.ag-turn-metrics, .ag-live-metrics-pill, .ag-prompt-ghost-overlay').forEach((el) => el.remove());
    document.querySelectorAll('[data-ag-has-suggestion]').forEach((el) => el.removeAttribute('data-ag-has-suggestion'));
    document.querySelectorAll('[data-ag-enhancer-settings-open]').forEach((el) => el.removeAttribute('data-ag-enhancer-settings-open'));
    document.querySelectorAll('[data-ag-settings-right-pane]').forEach((el) => el.removeAttribute('data-ag-settings-right-pane'));
    if (window.__ag_i18n_observer) {
      try { window.__ag_i18n_observer.disconnect(); } catch (e) {}
      window.__ag_i18n_observer = null;
    }
    if (window.__ag_metrics_ro) {
      try { window.__ag_metrics_ro.disconnect(); } catch (e) {}
      window.__ag_metrics_ro = null;
      window.__ag_metrics_ro_target = null;
      window.__ag_metrics_ro_observed = null;
      window.__ag_last_metrics_layout_sig = '';
    }
    if (window.__ag_metrics_route_watcher) {
      try { clearInterval(window.__ag_metrics_route_watcher); } catch (e) {}
      window.__ag_metrics_route_watcher = null;
    }
    if (window.__ag_pending_wait_timer) {
      try { clearInterval(window.__ag_pending_wait_timer); } catch (e) {}
      window.__ag_pending_wait_timer = null;
    }
    if (window.__ag_live_probe_timer) {
      try { clearInterval(window.__ag_live_probe_timer); } catch (e) {}
      window.__ag_live_probe_timer = null;
    }
    window.__ag_zoom_keydown_fn = null;
    window.__ag_settings_click_fn = null;
    window.__ag_body_ready = false;
    for (const attr of ['data-ag-page-type', 'data-ag-os']) {
      document.documentElement.removeAttribute(attr);
    }
    restoreAllTranslations(document.body);
    window.__ag_patch_version = PATCH_VERSION + '-disabled';
    return;
  }

  const headTarget = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
  let style = document.getElementById('ag-enhancer-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'ag-enhancer-style';
    if (headTarget) headTarget.appendChild(style);
  }
  const nextCssText = CSS_TEXT || '/* antigravity-enhancer active */';
  if (style && style.textContent !== nextCssText) {
    style.textContent = nextCssText;
  }

  const detectedOs =
    boot.platform || (/Win/i.test(navigator.platform || '') ? 'win32' : /Mac/i.test(navigator.platform || '') ? 'darwin' : 'linux');
  document.documentElement.setAttribute('data-ag-os', detectedOs);
  if (IS_SWARM_PLUGIN_FRAME) {
    document.documentElement.setAttribute('data-ag-page-type', 'plugin');
  }

  let userStyle = document.getElementById('ag-user-custom-style');
  if (MODULES.customCss && CUSTOM_CSS_TEXT.trim()) {
    if (!userStyle) {
      userStyle = document.createElement('style');
      userStyle.id = 'ag-user-custom-style';
      if (headTarget) headTarget.appendChild(userStyle);
    }
    if (userStyle.textContent !== CUSTOM_CSS_TEXT) {
      userStyle.textContent = CUSTOM_CSS_TEXT;
    }
  } else if (userStyle) {
    userStyle.remove();
  }

  function ensureStylesAtEndOfHead() {
    const h = document.head || document.getElementsByTagName('head')[0];
    if (!h) return;
    const base = document.getElementById('ag-enhancer-style');
    if (!base) return;
    let needsMove = base.parentNode !== h;
    if (!needsMove) {
      for (let sib = base.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (sib.id !== 'ag-user-custom-style' && (sib.tagName === 'LINK' || sib.tagName === 'STYLE')) {
          needsMove = true;
          break;
        }
      }
    }
    if (needsMove) {
      for (const id of ['ag-enhancer-style', 'ag-user-custom-style']) {
        const el = document.getElementById(id);
        if (el) h.appendChild(el);
      }
    }
  }
  ensureStylesAtEndOfHead();
