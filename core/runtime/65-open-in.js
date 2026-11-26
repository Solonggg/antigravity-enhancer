/**
 * Part 65: Passive Right-Click "Open In" Context Menu for File References
 * Intercepts contextmenu ONLY when the right-clicked target (or selection) resolves to
 * a local absolute file path / file:// URI. Never touches left-click behavior.
 */
  function cleanupOpenInDom() {
    try {
      const menu = document.getElementById('ag-open-in-menu');
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      const legacyStyle = document.getElementById('ag-open-in-style');
      if (legacyStyle && legacyStyle.parentNode) legacyStyle.parentNode.removeChild(legacyStyle);
    } catch {}
  }

  function mountOpenIn() {
    cleanupOpenInDom();
    if (IS_SWARM_PLUGIN_FRAME || !ENABLED || !MODULES.openIn) return;
    if (typeof document === 'undefined' || !document.body) return;

    (function initOpenIn() {
      const MENU_ID = 'ag-open-in-menu';
      const BINDING_NAME = '__agOpenInAction';
      const MAX_ANCESTOR_DEPTH = 8;
      const MAX_FIBER_DEPTH = 6;
      const MAX_TEXT_SCAN_LEN = 512;

      const openInConfig =
        boot.openIn && typeof boot.openIn === 'object'
          ? boot.openIn
          : {
              copyPath: true,
              debug: false,
              targets: [
                { id: 'idea', labelZh: '在 IDEA 中打开', labelEn: 'Open in IDEA', type: 'idea' },
                { id: 'finder', labelZh: '在 Finder 中显示', labelEn: 'Reveal in Finder', type: 'finder' }
              ]
            };

      function toPositiveInt(raw) {
        if (raw === undefined || raw === null || raw === '') return null;
        const num = Number(raw);
        if (!Number.isSafeInteger(num) || num < 1) return null;
        return num;
      }

      function decodePathSafe(rawPath) {
        try {
          return decodeURIComponent(rawPath);
        } catch {
          return null;
        }
      }

      function parseLocationHash(hash) {
        if (!hash || typeof hash !== 'string') {
          return { line: null, endLine: null, column: null, matched: false };
        }
        const trimmed = hash.trim();
        if (!trimmed.startsWith('#')) {
          return { line: null, endLine: null, column: null, matched: false };
        }

        let m = trimmed.match(/^#L?(\d+)(?:C|:)(\d+)(?:-L?(\d+)(?:(?:C|:)\d+)?)?$/i);
        if (m) {
          const line = toPositiveInt(m[1]);
          const column = line ? toPositiveInt(m[2]) : null;
          const endLine = line ? toPositiveInt(m[3]) : null;
          return { line, endLine, column, matched: true };
        }

        m = trimmed.match(/^#L?(\d+)-L?(\d+)$/i);
        if (m) {
          const l1 = toPositiveInt(m[1]);
          const l2 = l1 ? toPositiveInt(m[2]) : null;
          return { line: l1, endLine: l2, column: null, matched: true };
        }

        m = trimmed.match(/^#L?(\d+)$/i);
        if (m) {
          return { line: toPositiveInt(m[1]), endLine: null, column: null, matched: true };
        }

        return { line: null, endLine: null, column: null, matched: false };
      }

      function splitPathTrailingLocation(rawPath) {
        const cleanPath = rawPath;
        const hashIdx = cleanPath.indexOf('#');
        if (hashIdx > 0) {
          const loc = parseLocationHash(cleanPath.slice(hashIdx));
          if (loc.matched) {
            return {
              path: cleanPath.slice(0, hashIdx),
              line: loc.line,
              endLine: loc.endLine,
              column: loc.column
            };
          }
        }

        let m = cleanPath.match(/^(\/.+?):(\d+):(\d+)$/);
        if (m) {
          const line = toPositiveInt(m[2]);
          const col = line ? toPositiveInt(m[3]) : null;
          return { path: m[1], line, endLine: null, column: col };
        }

        m = cleanPath.match(/^(\/.+?):(\d+)$/);
        if (m) {
          return { path: m[1], line: toPositiveInt(m[2]), endLine: null, column: null };
        }

        return { path: cleanPath, line: null, endLine: null, column: null };
      }

      function isValidLocalPosixPath(p) {
        if (!p || typeof p !== 'string') return false;
        if (!p.startsWith('/') || p.startsWith('//')) return false;
        if (p.length <= 1) return false;
        if (p.includes('\0') || p.includes('\r') || p.includes('\n')) return false;
        return true;
      }

      function parseFileTarget(rawInput) {
        if (typeof rawInput !== 'string') return null;
        const trimmed = rawInput.trim();
        if (!trimmed) return null;

        const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
        if (schemeMatch) {
          if (schemeMatch[1].toLowerCase() !== 'file') return null;
          let urlObj;
          try {
            urlObj = new URL(trimmed);
          } catch {
            return null;
          }
          if (urlObj.protocol !== 'file:') return null;
          if (urlObj.hostname && urlObj.hostname.toLowerCase() !== 'localhost') return null;

          const decoded = decodePathSafe(urlObj.pathname);
          if (!decoded) return null;

          const hashLoc = parseLocationHash(urlObj.hash);
          if (hashLoc.matched) {
            if (!isValidLocalPosixPath(decoded)) return null;
            return {
              path: decoded,
              line: hashLoc.line,
              endLine: hashLoc.endLine,
              column: hashLoc.column
            };
          }

          const splitUrl = splitPathTrailingLocation(decoded);
          if (!isValidLocalPosixPath(splitUrl.path)) return null;
          return {
            path: splitUrl.path,
            line: splitUrl.line,
            endLine: splitUrl.endLine,
            column: splitUrl.column
          };
        }

        if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
        const split = splitPathTrailingLocation(trimmed);
        if (!isValidLocalPosixPath(split.path)) return null;
        return {
          path: split.path,
          line: split.line,
          endLine: split.endLine,
          column: split.column
        };
      }

      function formatDisplayTarget(target) {
        if (!target || typeof target.path !== 'string' || !target.path) return '';
        const segments = target.path.split('/').filter(Boolean);
        const name = segments.length > 0 ? segments[segments.length - 1] : target.path;
        if (target.line && target.endLine && target.endLine > target.line) {
          return name + ':' + target.line + '-' + target.endLine;
        }
        if (target.line) return name + ':' + target.line;
        return name;
      }

      function formatCopyPath(target) {
        if (!target || typeof target.path !== 'string' || !target.path) return '';
        return target.line ? target.path + ':' + target.line : target.path;
      }

      function stripWrappingPunctuation(raw) {
        return String(raw || '')
          .trim()
          .replace(/^["'`(<\[{]+/, '')
          .replace(/["'`>\]})]+$/, '')
          .replace(/[.,;!?。，；！？]+$/, '');
      }

      function hasMultipleSegments(p) {
        return /^\/[^/\s]+\/[^/\s]+/.test(p);
      }

      function extractTargetFromFreeText(raw, requireMultiSegment) {
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.length > MAX_TEXT_SCAN_LEN) return null;

        const cleaned = stripWrappingPunctuation(trimmed);
        const direct = parseFileTarget(cleaned);
        if (direct && (!requireMultiSegment || hasMultipleSegments(direct.path))) {
          return direct;
        }

        const fileUriMatch = trimmed.match(/file:\/\/\/[^\s"'<>()]+/i);
        if (fileUriMatch) {
          const fromUri = parseFileTarget(stripWrappingPunctuation(fileUriMatch[0]));
          if (fromUri) return fromUri;
        }

        const posixMatch = trimmed.match(
          /(?:^|[\s"'`(\[<{])(\/(?:Users|Volumes|Applications|Library|System|tmp|var|opt|etc|home|private)\/[^\s"'<>()\]}`]+|(?:\/[A-Za-z0-9._-]+){2,}(?::\d+(?::\d+)?)?(?:#L?\d+(?:-L?\d+)?(?:C\d+)?)?)/
        );
        if (posixMatch && posixMatch[1]) {
          const candidate = stripWrappingPunctuation(posixMatch[1]);
          const parsed = parseFileTarget(candidate);
          if (parsed && (!requireMultiSegment || hasMultipleSegments(parsed.path))) {
            return parsed;
          }
        }

        return null;
      }

      function inspectUriObject(val) {
        if (!val || typeof val !== 'object') return null;
        if (typeof val.scheme === 'string' && val.scheme !== 'file') return null;
        if (typeof val.fsPath === 'string') {
          const fromFsPath = parseFileTarget(val.fsPath);
          if (fromFsPath) return fromFsPath;
        }
        if (typeof val.path === 'string') {
          const fromPath = parseFileTarget(val.path);
          if (fromPath) return fromPath;
        }
        return null;
      }

      function inspectReactPropsObject(props) {
        if (!props || typeof props !== 'object') return null;
        const candidateKeys = ['href', 'uri', 'url', 'fileUri', 'filePath', 'absolutePath', 'fsPath', 'targetPath', 'path'];
        let found = null;

        for (let i = 0; i < candidateKeys.length; i += 1) {
          const key = candidateKeys[i];
          const val = props[key];
          if (typeof val === 'string') {
            found = extractTargetFromFreeText(val, false);
            if (found) break;
          } else if (val && typeof val === 'object') {
            found = inspectUriObject(val);
            if (found) break;
          }
        }

        if (!found && props.file && typeof props.file === 'object') {
          found = inspectUriObject(props.file);
          if (!found && typeof props.file.path === 'string') {
            found = parseFileTarget(props.file.path);
          }
        }

        if (!found) return null;

        if (!found.line) {
          const line =
            toPositiveInt(props.line) ||
            toPositiveInt(props.startLine) ||
            toPositiveInt(props.lineNumber) ||
            toPositiveInt(props.startLineNumber);
          if (line) {
            found = {
              path: found.path,
              line,
              endLine: toPositiveInt(props.endLine) || toPositiveInt(props.endLineNumber) || null,
              column: toPositiveInt(props.column) || toPositiveInt(props.startColumn) || toPositiveInt(props.col) || null
            };
          }
        }

        return found;
      }

      function extractFromReactNode(el) {
        if (!el || typeof el !== 'object') return null;
        let keys;
        try {
          keys = Object.keys(el);
        } catch {
          return null;
        }

        for (let i = 0; i < keys.length; i += 1) {
          if (keys[i].indexOf('__reactProps$') === 0) {
            const fromProps = inspectReactPropsObject(el[keys[i]]);
            if (fromProps) return fromProps;
          }
        }

        for (let j = 0; j < keys.length; j += 1) {
          if (keys[j].indexOf('__reactFiber$') === 0 || keys[j].indexOf('__reactInternalInstance$') === 0) {
            let fiber = el[keys[j]];
            for (let depth = 0; depth < MAX_FIBER_DEPTH && fiber; depth += 1, fiber = fiber.return) {
              const fromMemo = inspectReactPropsObject(fiber.memoizedProps);
              if (fromMemo) return fromMemo;
              const fromPending = inspectReactPropsObject(fiber.pendingProps);
              if (fromPending) return fromPending;
            }
          }
        }

        return null;
      }

      function enrichLineFromAnchorText(target, el) {
        if (!target || target.line || !el) return target;
        const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
        if (tag !== 'A' && tag !== 'CODE' && tag !== 'SPAN' && tag !== 'BUTTON') return target;
        const txt = typeof el.textContent === 'string' ? el.textContent.trim() : '';
        if (!txt || txt.length > 160) return target;

        const m = txt.match(/(?::|#L)(\d+)(?:-L?(\d+))?(?::(\d+))?$/i);
        if (m) {
          const line = toPositiveInt(m[1]);
          if (line) {
            return {
              path: target.path,
              line,
              endLine: toPositiveInt(m[2]) || null,
              column: toPositiveInt(m[3]) || null
            };
          }
        }
        return target;
      }

      function extractFromAttributes(el) {
        if (!el || typeof el.getAttribute !== 'function') return null;
        const attrNames = ['href', 'data-href', 'data-uri', 'data-path', 'data-file-path', 'data-url', 'title', 'aria-label'];
        for (let i = 0; i < attrNames.length; i += 1) {
          const val = el.getAttribute(attrNames[i]);
          if (!val) continue;
          const parsed = extractTargetFromFreeText(val, attrNames[i] === 'title' || attrNames[i] === 'aria-label');
          if (parsed) return enrichLineFromAnchorText(parsed, el);
        }
        return null;
      }

      function extractFromElementText(el) {
        if (!el) return null;
        const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
        const isChipLike =
          tag === 'A' ||
          tag === 'CODE' ||
          tag === 'SPAN' ||
          tag === 'BUTTON' ||
          tag === 'DIV' ||
          tag === 'LI';
        if (!isChipLike) return null;
        const txt = typeof el.textContent === 'string' ? el.textContent.trim() : '';
        if (!txt || txt.length > MAX_TEXT_SCAN_LEN) return null;
        return extractTargetFromFreeText(txt, true);
      }

      function extractFileTargetFromElement(startEl, selectionText) {
        let cur = startEl;
        if (cur && cur.nodeType === 3) {
          cur = cur.parentElement;
        }

        for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && cur; depth += 1) {
          if (cur.tagName && String(cur.tagName).toUpperCase() === 'BODY') break;

          const attrTarget = extractFromAttributes(cur);
          if (attrTarget) return attrTarget;

          const reactTarget = extractFromReactNode(cur);
          if (reactTarget) return enrichLineFromAnchorText(reactTarget, cur);

          const textTarget = extractFromElementText(cur);
          if (textTarget) return textTarget;

          cur = cur.parentElement;
        }

        if (typeof selectionText === 'string' && selectionText.trim()) {
          const selTarget = extractTargetFromFreeText(selectionText, true);
          if (selTarget) return selTarget;
        }

        return null;
      }

      function parseRgbLuminance(colorStr) {
        const m = String(colorStr || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return null;
        return (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
      }

      function isDarkThemeActive(doc, win) {
        try {
          const rootEl = doc && doc.documentElement;
          if (rootEl && rootEl.classList && rootEl.classList.contains('dark')) return true;
          const bodyEl = doc && doc.body;
          if (bodyEl && bodyEl.classList && (bodyEl.classList.contains('dark') || bodyEl.classList.contains('theme-dark'))) {
            return true;
          }
          if (bodyEl && bodyEl.getAttribute) {
            const agyTheme = String(bodyEl.getAttribute('data-agy-theme') || '').toLowerCase();
            const newuxTheme = String(bodyEl.getAttribute('data-newux-theme') || '').toLowerCase();
            if (agyTheme.includes('dark') || newuxTheme.includes('dark')) return true;
            if (agyTheme.includes('light') || newuxTheme.includes('light')) return false;
          }
          if (win && typeof win.getComputedStyle === 'function' && bodyEl) {
            const lum = parseRgbLuminance(win.getComputedStyle(bodyEl).backgroundColor);
            if (lum !== null) return lum < 0.5;
          }
          if (win && typeof win.matchMedia === 'function') {
            return Boolean(win.matchMedia('(prefers-color-scheme: dark)').matches);
          }
        } catch {}
        return false;
      }

      window.__agOpenInHelpers = {
        parseFileTarget,
        formatDisplayTarget,
        formatCopyPath,
        extractFileTargetFromElement,
        isDarkThemeActive
      };

      let activeMenu = null;

      function closeMenu() {
        if (activeMenu && activeMenu.parentNode) {
          activeMenu.parentNode.removeChild(activeMenu);
        }
        activeMenu = null;
      }

      function copyTextToClipboard(text) {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
          return;
        }
        fallbackCopy(text);
      }

      function fallbackCopy(text) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          ta.style.top = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        } catch {}
      }

      function invokeHostAction(targetId, target) {
        const fn = window[BINDING_NAME];
        if (typeof fn !== 'function') return;
        fn(
          JSON.stringify({
            targetId,
            path: target.path,
            line: target.line || null,
            column: target.column || null
          })
        );
      }

      function showMenu(clientX, clientY, target) {
        closeMenu();

        const targets = Array.isArray(openInConfig.targets) ? openInConfig.targets : [];
        const showCopy = openInConfig.copyPath !== false;
        if (targets.length === 0 && !showCopy) return;

        const zh = MODULES.i18n !== false;
        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-theme', isDarkThemeActive(document, window) ? 'dark' : 'light');

        const header = document.createElement('div');
        header.className = 'ag-open-in-header';
        header.textContent = formatDisplayTarget(target);
        header.title = target.path;
        menu.appendChild(header);

        for (let i = 0; i < targets.length; i += 1) {
          const item = targets[i];
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ag-open-in-item';
          btn.setAttribute('role', 'menuitem');

          let label = (zh ? item.labelZh : item.labelEn) || item.label || item.id;
          if ((item.type === 'idea' || item.type === 'preset' || item.type === 'command') && target.line) {
            label += zh ? '（第 ' + target.line + ' 行）' : ' (Line ' + target.line + ')';
          }
          btn.textContent = label;
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closeMenu();
            invokeHostAction(item.id, target);
          });
          menu.appendChild(btn);
        }

        if (showCopy) {
          if (targets.length > 0) {
            const sep = document.createElement('div');
            sep.className = 'ag-open-in-sep';
            menu.appendChild(sep);
          }
          const copyBtn = document.createElement('button');
          copyBtn.type = 'button';
          copyBtn.className = 'ag-open-in-item';
          copyBtn.setAttribute('role', 'menuitem');
          copyBtn.textContent = target.line
            ? zh
              ? '复制路径:行号'
              : 'Copy path:line'
            : zh
            ? '复制路径'
            : 'Copy path';
          copyBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const text = formatCopyPath(target);
            closeMenu();
            copyTextToClipboard(text);
          });
          menu.appendChild(copyBtn);
        }

        menu.style.visibility = 'hidden';
        menu.style.left = '0px';
        menu.style.top = '0px';
        (document.body || document.documentElement).appendChild(menu);

        const rect = menu.getBoundingClientRect();
        const maxX = Math.max(8, (window.innerWidth || 800) - rect.width - 8);
        const maxY = Math.max(8, (window.innerHeight || 600) - rect.height - 8);
        menu.style.left = Math.min(Math.max(8, clientX), maxX) + 'px';
        menu.style.top = Math.min(Math.max(8, clientY), maxY) + 'px';
        menu.style.visibility = 'visible';
        activeMenu = menu;
      }

      function onContextMenu(event) {
        let sel = '';
        try {
          const selection = window.getSelection ? window.getSelection() : null;
          sel = selection ? selection.toString() : '';
        } catch {}

        const target = extractFileTargetFromElement(event.target, sel);
        if (!target) {
          closeMenu();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        showMenu(event.clientX, event.clientY, target);
      }

      function onDocumentMouseDown(event) {
        if (!activeMenu) return;
        if (activeMenu.contains(event.target)) return;
        closeMenu();
      }

      function onDocumentKeyDown(event) {
        if (!activeMenu) return;
        if (event.key === 'Escape') closeMenu();
      }

      function onWindowScroll() {
        if (activeMenu) closeMenu();
      }

      function onWindowBlur() {
        if (activeMenu) closeMenu();
      }

      document.addEventListener('contextmenu', onContextMenu, true);
      document.addEventListener('mousedown', onDocumentMouseDown, true);
      document.addEventListener('keydown', onDocumentKeyDown, true);
      window.addEventListener('scroll', onWindowScroll, true);
      window.addEventListener('blur', onWindowBlur);

      if (Array.isArray(window.__ag_cleanup_fns)) {
        window.__ag_cleanup_fns.push(() => {
          closeMenu();
          document.removeEventListener('contextmenu', onContextMenu, true);
          document.removeEventListener('mousedown', onDocumentMouseDown, true);
          document.removeEventListener('keydown', onDocumentKeyDown, true);
          window.removeEventListener('scroll', onWindowScroll, true);
          window.removeEventListener('blur', onWindowBlur);
          cleanupOpenInDom();
        });
      }
    })();
  }
