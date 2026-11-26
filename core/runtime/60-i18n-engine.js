/**
 * Part 60: DOM Localization Engine (WeakMap-backed safe text & attribute translator)
 */
  // ============================================================================
  // 4. 高性能界面汉化引擎（无原型词典 + WeakMap O(1) 隔离缓存 + 单遍扫描 + 首字符分流）
  // ============================================================================
  if (window.__ag_i18n_observer) {
    try {
      window.__ag_i18n_observer.disconnect();
    } catch (e) {}
    window.__ag_i18n_observer = null;
  }

  const DICT = Object.assign(Object.create(null), boot.i18nDict || {});
  const LOWER_DICT = Object.create(null);
  for (const k in DICT) {
    const v = DICT[k];
    if (typeof v !== 'string' || !v || v === k) continue;
    if (!/\s/.test(k)) continue;
    const low = k.toLowerCase();
    if (LOWER_DICT[low] === undefined) {
      LOWER_DICT[low] = v;
    }
  }
  window.__ag_i18n_dict = DICT;

  let scanBodyFn = null;
  const I18N_OBS_OPTS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder']
  };

  if (MODULES.i18n) {
    function splitTopLevelSelectors(selStr) {
      const parts = [];
      let cur = '';
      let bracketDepth = 0;
      let parenDepth = 0;
      let quote = '';
      const s = String(selStr || '');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
          cur += ch;
          if (ch === quote && s[i - 1] !== '\\') quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          cur += ch;
        } else if (ch === '[') {
          bracketDepth++;
          cur += ch;
        } else if (ch === ']') {
          if (bracketDepth > 0) bracketDepth--;
          cur += ch;
        } else if (ch === '(') {
          parenDepth++;
          cur += ch;
        } else if (ch === ')') {
          if (parenDepth > 0) parenDepth--;
          cur += ch;
        } else if (ch === ',' && bracketDepth === 0 && parenDepth === 0) {
          if (cur.trim()) parts.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
    }

    const CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR =
      'code, pre, kbd, samp, style, script, noscript, [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, .monaco-editor, .monaco-diff-editor, .xterm, #ag-live-metrics-pill, .ag-live-metrics-pill, #ag-live-metrics-tooltip, #ag-turn-metrics-tooltip, .ag-turn-metrics';
    const TEXT_IMMUTABLE_EXCLUDE_SELECTOR = 'textarea, input, ' + CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR;

    const mergedExcludeParts = splitTopLevelSelectors(DEFAULT_EXCLUDE_I18N);
    const userExcludeParts = splitTopLevelSelectors(SELECTORS.excludeI18n);
    for (let i = 0; i < userExcludeParts.length; i++) {
      if (!mergedExcludeParts.includes(userExcludeParts[i])) {
        mergedExcludeParts.push(userExcludeParts[i]);
      }
    }
    const EXCLUDE_SELECTOR = mergedExcludeParts.join(', ');
    const FORM_ATTR_EXCLUDE_SELECTOR = mergedExcludeParts
      .filter((tok) => {
        const low = tok.toLowerCase();
        return low !== 'input' && low !== 'textarea';
      })
      .join(', ');

    const immutableTextExclCache = new WeakMap();
    const immutableContainerExclCache = new WeakMap();

    // 预编译模块级正则常量，消除热路径重复编译与二次匹配
    const RE_HAS_CJK = /[\u4e00-\u9fa5]/;
    const RE_PURE_ALPHA = /^\s*[a-zA-Z]+\s*$/;
    const RE_HAS_ALPHA = /[a-zA-Z]/;
    const RE_REL_TIME = /^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|w|mo|y|yr|yrs)\s+ago$/i;
    const REL_UNIT_MAP = {
      s: '秒',
      sec: '秒',
      secs: '秒',
      m: '分钟',
      min: '分钟',
      mins: '分钟',
      h: '小时',
      hr: '小时',
      hrs: '小时',
      d: '天',
      w: '周',
      mo: '个月',
      y: '年',
      yr: '年',
      yrs: '年'
    };
    const UNIT_MAP_SHORT = { s: '秒', m: '分钟', h: '小时', d: '天', w: '周', mo: '个月', y: '年', yr: '年' };
    const NAMED_PERIOD_MAP = { weekly: '每周', daily: '每日', monthly: '每月' };
    const MONTH_SHORT_MAP = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12
    };
    // 客户端 main.js ($Q 权限编辑器) 在 onBlur 中硬编码判断 relatedTarget.getAttribute("aria-label") === "Cancel"
    const SKIP_ARIA_LABEL_VALUES = new Set(['Cancel']);

    const RE_PCT_LEFT = /^(\d+(?:\.\d+)?)%\s*left$/i;
    const RE_WINDOW_LIMIT_COMBINED = /^(\d+)\s*([smhd])\s+limit,\s*resets in\s+(.+)$/i;
    const RE_WINDOW_LIMIT = /^(\d+)\s*([smhd])\s+limit$/i;
    const RE_NAMED_LIMIT_RESETS = /^(Weekly|Daily|Monthly)\s+limit,\s*resets in\s+(.+)$/i;
    const RE_MODEL_NAMED_LIMIT = /^(.+?)\s+(Weekly|Daily|Monthly)\s+limit$/i;
    const RE_RESETS_IN = /^Resets in\s+(.+)$/i;
    const RE_SEARCH_GOOGLE = /^Search Google for "(.+)"$/;
    const RE_UPDATED_AT =
      /^Updated\s+(?:((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}|\d{1,2}月\d{1,2}日),\s*)?((?:上午|下午)?\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)$/;

    const RE_FILES_CHANGED = /^(\d+)\s+files?\s+changed$/i;
    const RE_TOOLS = /^(\d+)\s+tools?$/i;
    const RE_DEMOTED = /^(\d+)\s+demoted$/i;
    const RE_EXCLUDED = /^(\d+)\s+excluded$/i;
    const RE_TOOLS_EXCLUDED = /^(\d+)\s+tools?\s+excluded$/i;
    const RE_ACTIVE_CONVS = /^(\d+)\s+active\s+conversations$/i;
    const RE_UPDATES_COUNT = /^(\d+)\s+updates?$/i;
    const RE_PROJECTS_COUNT = /^(\d+)\s+projects?$/i;
    const RE_CALLS_MB = /^(\d+)\s+calls?\s*·\s*([\d.]+\s*MB)$/i;
    const RE_SEE_ALL = /^See all\s*\((\d+)\)$/i;
    const RE_SHOW_BREAKDOWNS = /^Show\s+(\d+)\s+breakdowns?$/i;
    const RE_SHOW_MORE_SUBAGENTS = /^Show\s+(\d+)\s+more\s+subagents?$/i;
    const RE_SHOW_MORE_GENERIC = /^Show\s+(\d+)\s+more(?:\s+(results?|items?|commands?|options?))?(?:\.\.\.|…)?$/i;
    const RE_SEE_MORE_COUNT = /^(\+\s*)?See\s+(\d+)\s+more(?:\s+.+)?$/i;
    const RE_SEE_MORE_IN = /^See\s+more\s+in\s+(.+)$/i;
    const RE_MARKED_READ = /^Marked\s+(\d+)\s+conversations?\s+as\s+read$/i;
    const RE_NO_MORE_OLDER = /^No more older messages,\s*showing\s+(\d+)\s+of\s+(\d+)$/i;
    const RE_STEP_OF = /^Step\s+(\d+)\s+of\s+(\d+)$/i;
    const RE_QUESTION_OR_TURN_OF = /^(Question|Turn)\s+(\d+)\s+of\s+(\d+)$/i;
    const RE_TOOLS_ENABLED = /^(\d+)\s+tools?\s+enabled$/i;
    const RE_RUNNING_COUNT = /^(\d+)\s+(subagents\/tasks|subagents?|tasks?)\s+running$/i;
    const RE_SUBAGENTS_BLOCKED = /^(\d+)\s+subagents?\s+blocked$/i;
    const RE_MODEL_UNAVAILABLE_RETRY = /^Model unavailable,\s*retrying(?:\s+in\s+(\d+)s)?(?:\s*\(attempt\s+(\d+)\/(\d+)\))?$/i;
    const RE_WAITING_CMD_UP_TO = /^Waiting for command completion\s*\(up to (\d+) seconds\)$/i;
    const RE_THINKING_PAREN = /^Thinking\s*\((\d+)s\)(?:\.\.\.|…)$/i;
    const RE_STILL_THINKING = /^Still thinking,\s*(\d+)\s+seconds?$/i;
    const RE_WORKING_DOT_S = /^Working\s*·\s*(\d+)s$/i;
    const RE_SEND_ALL_COUNT = /^Send all\s*\((\d+)\)$/i;
    const RE_FOLD_LINES = /^(Unfold|Fold)\s+lines\s+(\d+)-(\d+)$/i;
    const RE_ZOOM_RESET = /^Zoom\s+(\d+)%,\s*reset to fit$/i;
    const RE_NOTHING_ON_PORT = /^Nothing is running on port\s+(\d+)$/i;
    const RE_COUNT_BADGE =
      /^(\d+)\s+(archived conversations?|background tasks?|browser steps?|models?\s+selected|waiting on you|references?|drafts?|plugins?)$/i;
    const RE_LINES_ADDED_REMOVED = /^(\d+)\s+lines?\s+added,\s*(\d+)\s+lines?\s+removed$/i;
    const RE_SHORTCUT_SUFFIX =
      /^(.+?)\s*\(((?:Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\+?[^)]*|Enter|Escape|Esc|Space|Tab|Backspace|Delete|⏎|←|→|↑|↓)\)$/i;
    const RE_PERM_SAVE_RULE =
      /^Yes,\s+save rule for\s+('[\s\S]*'|"[\s\S]*")\s+(in this conversation|globally)$/i;
    const RE_PERM_ALWAYS_ALLOW = /^Yes,\s+and always allow\s+([\s\S]+)$/i;
    const RE_PERM_ALLOW_DL = /^Yes,\s+(allow|always allow)\s+downloads from\s+(.+?)(?:\s+(for this run|in this conversation))?$/i;
    const RE_PERM_ALLOW_CONV = /^Yes,\s+allow\s+(.+?)\s+in this conversation$/i;
    const RE_PERM_ALWAYS_SIMPLE = /^Yes,\s+always allow\s+(.+)$/i;
    const RE_ZIPPING_FOLDER = /^Zipping\s+(.+?)(?:…|\.\.\.)$/i;
    const RE_PERM_DELETE = /^Permanently delete\s+(.*)\s+including\s+(\d+)\s+active\s+conversations\.?$/i;
    const RE_WORKED_FOR_UPDATES = /^Worked for\s+([<0-9smhd\s]+?)\s*·\s*(\d+)\s+updates?$/i;
    const RE_WORKED_FOR = /^Worked for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_THOUGHT_FOR = /^Thought for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_THINKING_FOR = /^Thinking for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_RUNNING_FOR = /^Running\s+for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
    const RE_EPHEMERAL_SUMMARY =
      /^(Explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|Ran\s+(?:\d+\s+)?commands?|Edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?)(?:,\s*(explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|ran\s+(?:\d+\s+)?commands?|edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?))*$/i;
    const EPHEMERAL_CLAUSE_MAP = {
      explored: '已探索',
      'explored file': '已探索文件',
      'explored files': '已探索文件',
      'explored artifact': '已探索交付工件',
      'explored artifacts': '已探索交付工件',
      'explored file and artifact': '已探索文件与交付工件',
      'explored files and artifact': '已探索文件与交付工件',
      'explored file and artifacts': '已探索文件与交付工件',
      'explored files and artifacts': '已探索文件与交付工件',
      'ran command': '已运行命令',
      'ran commands': '已运行命令',
      edited: '已编辑',
      'edited file': '已编辑文件',
      'edited files': '已编辑文件',
      'edited artifact': '已编辑交付工件',
      'edited artifacts': '已编辑交付工件',
      'edited file and artifact': '已编辑文件与交付工件',
      'edited files and artifact': '已编辑文件与交付工件',
      'edited file and artifacts': '已编辑文件与交付工件',
      'edited files and artifacts': '已编辑文件与交付工件'
    };
    const RE_EPHEMERAL_COUNT_CLAUSE = /^(explored|edited|ran)\s+(\d+)\s+(files?|artifacts?|commands?)$/i;
    function translateEphemeralClause(clause) {
      const low = clause.trim().toLowerCase();
      if (EPHEMERAL_CLAUSE_MAP[low]) return EPHEMERAL_CLAUSE_MAP[low];
      const mCount = low.match(RE_EPHEMERAL_COUNT_CLAUSE);
      if (mCount) {
        const vMap = { explored: '已探索', edited: '已编辑', ran: '已运行' };
        const nMap = {
          file: '个文件',
          files: '个文件',
          artifact: '个交付工件',
          artifacts: '个交付工件',
          command: '条命令',
          commands: '条命令'
        };
        return vMap[mCount[1]] + ' ' + mCount[2] + ' ' + nMap[mCount[3]];
      }
      return clause.trim();
    }
    const RE_EPHEMERAL_ACTIVE = /^(Editing|Reading|Listing|Searching)\s+(.+)$/;
    const EPHEMERAL_VERB_MAP = {
      Editing: '正在编辑',
      Reading: '正在读取',
      Listing: '正在列出',
      Searching: '正在搜索'
    };
    const EPHEMERAL_NOUN_MAP = {
      file: '文件',
      files: '文件',
      artifact: '交付工件',
      artifacts: '交付工件',
      'file and artifact': '文件与交付工件',
      'files and artifact': '文件与交付工件',
      'file and artifacts': '文件与交付工件',
      'files and artifacts': '文件与交付工件'
    };
    const RE_RUNNING_CMD = /^Running\s+(?!commands?\b|processes\b|for\b|\(Dev\b)(.+)$/;
    const RE_DELETED_RECORDINGS = /^Deleted\s+(\d+)\s+recordings?\s*\(([\d.]+\s*MB)\)$/i;
    const RE_DELETE_RECORDINGS_CONFIRM =
      /^This deletes\s+(\d+)\s+call recordings?\s*\(([\d.]+\s*MB)\)\s+from your machine\.\s*You can't undo this\.$/i;
    const RE_USED_LIMIT = /^You have used (some|all|most) of your (weekly|5-hour|five-hour|daily) limit,?\s*it will fully refresh in (.*)\.?$/i;
    const RE_NOT_USED_LIMIT = /^You have not used any of your (weekly|5-hour|five-hour|daily) limit\.?$/i;
    const RE_QUOTA_RESET_SWITCH =
      /^Your quota for (.+?) will reset on (.+?)\.\s*Switch to another available model to continue\.?$/i;
    const RE_QUOTA_REACHED_SWITCH =
      /^Your quota for (.+?) has been reached\.\s*Switch to another available model to continue\.?$/i;
    const RE_QUOTA_NEED_CREDITS =
      /^You need (?:at least (\d+)|more) AI Credits to send messages\.\s*To continue using (.+?) now, purchase more AI Credits\.?\s*/i;
    const RE_QUOTA_BASELINE_REFRESH =
      /^Your plan['’]s baseline quota will refresh on (.+?)\.(?=\s|$)\s*/i;
    const RE_QUOTA_ENABLE_OVERAGES =
      /^To continue using (.+?) now, enable AI Credit overages\.(?=\s|$)\s*/i;
    const RE_QUOTA_UPGRADE_PLAN =
      /^You can upgrade to a (higher )?Google AI (Ultra|Pro) plan to receive (higher|the highest) rate limits\.?$/i;

    function formatQuotaModelZh(rawModel) {
      const m = String(rawModel || '').trim();
      return !m || /^this model$/i.test(m) ? '该模型' : m;
    }

    function translateQuotaExhaustedZh(trimmed) {
      if (!trimmed || (!trimmed.includes('quota') && !trimmed.includes('AI Credit'))) return null;
      const mReset = trimmed.match(RE_QUOTA_RESET_SWITCH);
      if (mReset) {
        const mod = formatQuotaModelZh(mReset[1]);
        return (mod === '该模型' ? '该模型' : mod + ' ') + '的配额将于 ' + mReset[2].trim() + ' 重置。请切换至其他可用模型继续。';
      }
      const mReached = trimmed.match(RE_QUOTA_REACHED_SWITCH);
      if (mReached) {
        const mod = formatQuotaModelZh(mReached[1]);
        return (mod === '该模型' ? '该模型' : mod + ' ') + '的配额已用尽。请切换至其他可用模型继续。';
      }

      let rest = trimmed;
      const parts = [];

      const mCredits = rest.match(RE_QUOTA_NEED_CREDITS);
      if (mCredits) {
        const needPart = mCredits[1] ? '至少 ' + mCredits[1] + ' ' : '更多 ';
        const mod = formatQuotaModelZh(mCredits[2]);
        parts.push(
          '发送消息需要' + needPart + 'AI 点数。如需立即继续使用' + (mod === '该模型' ? '该模型' : ' ' + mod) + '，请购买更多 AI 点数。'
        );
        rest = rest.slice(mCredits[0].length);
      }

      const mRefresh = rest.match(RE_QUOTA_BASELINE_REFRESH);
      if (mRefresh) {
        parts.push('当前方案的基础配额将于 ' + mRefresh[1].trim() + ' 刷新。');
        rest = rest.slice(mRefresh[0].length);
      }

      const mOver = rest.match(RE_QUOTA_ENABLE_OVERAGES);
      if (mOver) {
        const mod = formatQuotaModelZh(mOver[1]);
        parts.push('如需立即继续使用' + (mod === '该模型' ? '该模型' : ' ' + mod) + '，请开启 AI 点数超额抵扣。');
        rest = rest.slice(mOver[0].length);
      }

      if (parts.length === 0) return null;

      rest = rest.trim();
      if (rest) {
        const exactRest = lookupRawDict(rest) ?? (rest.endsWith('.') ? lookupRawDict(rest.slice(0, -1)) : undefined);
        if (typeof exactRest === 'string') {
          parts.push(exactRest.endsWith('。') ? exactRest : exactRest + '。');
        } else {
          const mUp = rest.match(RE_QUOTA_UPGRADE_PLAN);
          if (mUp) {
            const higherPrefix = mUp[1] ? '更高的 ' : '';
            const limitDesc = mUp[3].toLowerCase() === 'the highest' ? '最高速率配额' : '更高的配额速率限制';
            parts.push('您可以升级到' + higherPrefix + 'Google AI ' + mUp[2] + ' 方案以获得' + limitDesc + '。');
          } else {
            parts.push(rest);
          }
        }
      }
      return parts.join('');
    }
    const RE_ARIA_BRANCH = /^Branch, current:\s*(.*)$/i;
    const RE_ARIA_PROJECT = /^Select project(?:, current)?:\s*(.*)$/i;
    const RE_ARIA_LOCATION = /^(?:Where the agent runs, current|Select location(?:, current)?):\s*(.*)$/i;
    const RE_ARIA_VERSION = /^Version\s+([\d.]+(?:\s*·\s*\S+)?)$/i;
    const RE_ARIA_MODEL = /^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:\s*(.*)$/i;
    const RE_ARIA_PERM_SEL =
      /^(?:(?:Permission mode|Agent permissions preset)\s+selector(?:,\s*current)?|(?:Permission mode|Agent permissions preset),\s*current):\s*(.*)$/i;
    const RE_ARIA_PERM_FIXED = /^(?:Permission mode|Agent permissions preset):\s*([^,(]+?)(?:\s*(?:,\s*(.+?)|\(([^)]+)\)))?$/i;
    const RE_ARIA_TURN = /^(?:Conversation turn\s+(\d+)\s+by\s+(User|Agent|Assistant)|Turn\s+(\d+)\s+of\s+(\d+))$/i;
    const RE_ARIA_LOAD_OLDER = /^(?:Load\s+(\d+)\s+older\s+turns?.*|Load older messages,\s*showing\s+(\d+)\s+of\s+(\d+))$/i;
    const RE_YOUR_PLAN = /^Your Plan:\s*([^\r\n]{1,80})$/i;
    const RE_AVAILABLE_AI_CREDITS = /^Available AI Credits:\s*([^\r\n]{1,40})$/i;
    const RE_EXITED_CODE_ONLY = /^Exited with code\s+(-?\d+)(\.)?$/i;
    const RE_SUMMARY_EXITED_CODE = /^([^\r\n]{1,220}?)\s*·\s*Exited with code\s+(-?\d+)$/;
    const RE_STARTED_SIDE_QUOTE = /^Started\s+(from|during)\s+[“"](.+)[”"]$/;

    function formatCompactDurationZh(str) {
      const s = String(str || '').trim();
      if (s === '<1m' || s === '< 1m') return '不到 1 分钟';
      return s
        .replace(/(\d+)\s*d\b/gi, '$1 天')
        .replace(/(\d+)\s*h\b/gi, '$1 小时')
        .replace(/(\d+)\s*m\b/gi, '$1 分钟')
        .replace(/(\d+)\s*s\b/gi, '$1 秒')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function formatUpdatedAtZh(datePart, timePart) {
      if (!datePart) return '更新于 ' + timePart.trim();
      const mEnDate = datePart.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
      if (mEnDate) {
        const mNum = MONTH_SHORT_MAP[mEnDate[1].toLowerCase()];
        if (mNum) {
          return '更新于 ' + mNum + '月' + mEnDate[2] + '日 ' + timePart.trim();
        }
      }
      return '更新于 ' + datePart.trim() + ' ' + timePart.trim();
    }

    function isExcludedElement(el, batchSafeSet) {
      if (!el || el.nodeType !== 1) return true;
      if (immutableTextExclCache.get(el) === true) return true;
      if (batchSafeSet && batchSafeSet.has(el)) return false;
      if (el.closest(TEXT_IMMUTABLE_EXCLUDE_SELECTOR)) {
        if (el.isConnected) immutableTextExclCache.set(el, true);
        return true;
      }
      if (el.closest(EXCLUDE_SELECTOR)) {
        return true;
      }
      if (batchSafeSet) batchSafeSet.add(el);
      return false;
    }

    function canTranslateElementAttrs(el, batchSafeSet) {
      if (!el || el.nodeType !== 1) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (immutableContainerExclCache.get(el) === true) return false;
        if (el.closest(CONTAINER_IMMUTABLE_EXCLUDE_SELECTOR)) {
          if (el.isConnected) immutableContainerExclCache.set(el, true);
          return false;
        }
        return FORM_ATTR_EXCLUDE_SELECTOR ? !el.closest(FORM_ATTR_EXCLUDE_SELECTOR) : true;
      }
      return !isExcludedElement(el, batchSafeSet);
    }

    function isInHeaderOrBreadcrumb(el) {
      return !!(el && el.closest && el.closest('header, [data-testid="breadcrumb-segment"]'));
    }

    function resolveContextualDictTranslation(trimmed, contextEl, baseVal) {
      if (!contextEl || !contextEl.closest) return baseVal;
      if (trimmed === 'Plan' && baseVal === '计划' && contextEl.closest('[role="dialog"]')) {
        return '方案套餐';
      }
      if (trimmed === 'Default') {
        if (contextEl.closest('[data-testid="permissions-default-tag"]')) {
          return '全局默认';
        }
        if (contextEl.closest('[data-testid="permissions-preset-option-default"], [data-testid="permissions-selector-trigger"]')) {
          return '敏感确认 (Default)';
        }
        const permOpt = contextEl.closest('[role="option"], [role="menuitem"]');
        const optTxt = permOpt ? permOpt.textContent || '' : '';
        if (optTxt.includes('Ask before sensitive operations') || optTxt.includes('执行敏感操作前进行确认')) {
          return '敏感确认 (Default)';
        }
      }
      if (
        trimmed === 'View' &&
        baseVal === '视图' &&
        contextEl.closest('button') &&
        !contextEl.closest('[aria-haspopup], [role="menuitem"], [role="menu"], header')
      ) {
        return '查看';
      }
      if (trimmed === 'Type' && baseVal === '类型') {
        const pTxt = contextEl.parentElement ? contextEl.parentElement.textContent || '' : '';
        if (/\band select\b|\/plan\b/i.test(pTxt)) return '键入';
      }
      if (trimmed === 'Actions' && baseVal === '操作') {
        const menuContainer = contextEl.closest('[role="menu"], [data-radix-popper-content-wrapper]');
        if (menuContainer && !contextEl.closest('[role="dialog"], [cmdk-list]')) {
          const mTxt = menuContainer.textContent || '';
          if (mTxt.includes('Mentions') || mTxt.includes('提及引用') || mTxt.includes('Add Context') || mTxt.includes('添加上下文')) {
            return '快捷指令 (/)';
          }
        }
      }
      if (trimmed === 'Machine' && baseVal === '整机') {
        const rowContainer = contextEl.closest('div') && contextEl.closest('div').parentElement;
        if (rowContainer && rowContainer.querySelector('[data-testid="new-sidecar-cloud-environment"]')) {
          return '运行主机';
        }
      }
      if (trimmed === 'Blocked' && baseVal === '已阻塞' && !contextEl.closest('[data-testid="conversation-row-sidebar"]')) {
        const aria = contextEl.getAttribute ? contextEl.getAttribute('aria-label') || '' : '';
        if (aria.startsWith('Blocked') || contextEl.closest('[class*="destructive"]')) {
          return '已受限';
        }
      }
      if (trimmed === 'when working') {
        const pTxt = contextEl.parentElement ? contextEl.parentElement.textContent || '' : '';
        if (pTxt.includes('Global Permissions') || pTxt.includes('全局权限')) return '，适用于';
      }
      if ((trimmed === 'in this project' || trimmed === 'in this workspace') && baseVal === undefined) {
        const pTxt = contextEl.parentElement ? contextEl.parentElement.textContent || '' : '';
        if (pTxt.includes('Global Permissions') || pTxt.includes('全局权限') || pTxt.includes('when working') || pTxt.includes('适用于')) {
          return trimmed === 'in this project' ? '当前项目' : '当前工作区';
        }
      }
      return baseVal;
    }

    const SWARM_SCOPED_DICT = Object.assign(Object.create(null), {
      Board: '看板',
      Graph: '关系图',
      Raw: '原始数据',
      Reconnecting: '正在重连',
      Replay: '回放',
      Follow: '跟随',
      Latest: '最新',
      Channels: '频道',
      Filters: '筛选',
      Coordinator: '协调器',
      Waiting: '等待中',
      Retired: '已退役',
      Paused: '已暂停',
      'Working...': '工作中...',
      Working: '工作中',
      'Empty.': '暂无内容。',
      '(empty)': '（空）',
      stale: '已过期',
      'system:': '系统：',
      Goal: '目标',
      Team: '团队',
      Threads: '工作线',
      Now: '当前',
      Progress: '进度',
      Tasks: '任务',
      Other: '其他',
      Moving: '推进中',
      Reply: '回复',
      Frames: '画面',
      All: '全部',
      'all channels': '全部频道',
      Remote: '远程',
      updating: '更新中',
      watching: '监听中',
      stopped: '已停止',
      'Needs you': '待你处理',
      'Not started': '未开始',
      Blocked: '受阻',
      Running: '运行中',
      Done: '已完成',
      Open: '打开',
      Active: '活跃',
      Killed: '已终止',
      Hive: '蜂巢',
      'Tasks done': '任务已完成',
      'Message just sent': '刚发送消息',
      'Waiting on': '等待中',
      Stuck: '已卡住',
      Resting: '休息中',
      'Latest action': '最新动作'
    });

    function translateSwarmDynamic(trimmed) {
      if (SWARM_SCOPED_DICT[trimmed] !== undefined) return SWARM_SCOPED_DICT[trimmed];
      const mWork = trimmed.match(/^Working for\s+(@\S+)$/i);
      if (mWork) return '正在为 ' + mWork[1] + ' 工作';
      const mWaitM = trimmed.match(/^Waiting on\s+(@\S+)$/i);
      if (mWaitM) return '正在等待 ' + mWaitM[1];
      const mWaitN = trimmed.match(/^Waiting on\s+(\d+)$/i);
      if (mWaitN) return '正在等待 ' + mWaitN[1] + ' 位成员';
      const mWaiters = trimmed.match(/^(\d+)\s+waiting on\s+(@\S+)$/i);
      if (mWaiters) return mWaiters[1] + ' 位正在等待 ' + mWaiters[2];
      const mOfDone = trimmed.match(/^(\d+)\s+of\s+(\d+)\s+(?:tasks?\s+)?done$/i);
      if (mOfDone) return '已完成 ' + mOfDone[1] + ' / ' + mOfDone[2] + ' 项';
      const mBees = trimmed.match(/^(\d+)\s+bees?$/i);
      if (mBees) return mBees[1] + ' 位成员';
      const mPosts = trimmed.match(/^(\d+)\s+posts?$/i);
      if (mPosts) return mPosts[1] + ' 条消息';
      if (/^seen just now$/i.test(trimmed)) return '刚刚在线';
      const mSeen = trimmed.match(/^last seen\s+(.+)\s+ago$/i);
      if (mSeen) return '最近活跃于 ' + formatCompactDurationZh(mSeen[1]) + ' 前';
      const mAlert = trimmed.match(/^@(\S+)\s+(ran out of quota|looks stuck|hit an error)$/i);
      if (mAlert) {
        const k = mAlert[2].toLowerCase();
        return '@' + mAlert[1] + (k === 'ran out of quota' ? ' 配额已耗尽' : k === 'looks stuck' ? ' 似乎卡住了' : ' 发生错误');
      }
      return null;
    }

    function normalizeLookupQuotes(s) {
      return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
    }

    function lookupRawDict(trimmed) {
      if (Object.prototype.hasOwnProperty.call(DICT, trimmed)) {
        return DICT[trimmed];
      }
      if (trimmed.indexOf(' ') !== -1) {
        const lowHit = LOWER_DICT[trimmed.toLowerCase()];
        if (lowHit !== undefined) return lowHit;
      }
      if (/[‘’“”…]/.test(trimmed)) {
        const normQ = normalizeLookupQuotes(trimmed);
        if (Object.prototype.hasOwnProperty.call(DICT, normQ)) {
          return DICT[normQ];
        }
        if (normQ.indexOf(' ') !== -1) {
          return LOWER_DICT[normQ.toLowerCase()];
        }
      }
      return undefined;
    }

    function translateShortcutSuffixed(trimmed) {
      if (trimmed.indexOf('(') === -1 || !trimmed.endsWith(')')) return null;
      const m = trimmed.match(RE_SHORTCUT_SUFFIX);
      if (!m) return null;
      const pref = m[1].trim();
      const hit = lookupRawDict(pref);
      if (typeof hit === 'string' && hit) {
        return hit + ' (' + m[2] + ')';
      }
      return null;
    }

    function translatePermissionChoiceZh(trimmed) {
      if (!trimmed.startsWith('Yes,') && !trimmed.startsWith('yes,')) return null;
      const mSave = trimmed.match(RE_PERM_SAVE_RULE);
      if (mSave) {
        const isConv = mSave[2].toLowerCase() === 'in this conversation';
        return isConv ? '是，在此会话中为 ' + mSave[1] + ' 保存规则' : '是，全局为 ' + mSave[1] + ' 保存规则';
      }
      const mAlways = trimmed.match(RE_PERM_ALWAYS_ALLOW);
      if (mAlways && !/^in this (?:project|conversation)$/i.test(mAlways[1].trim())) {
        const scoped = mAlways[1].match(/^('[\s\S]*'|"[\s\S]*")\s+in this (project|conversation)$/i);
        const cmd = scoped ? scoped[1] : mAlways[1].trimEnd();
        const scope = scoped && scoped[2] ? scoped[2].toLowerCase() : '';
        if (scope === 'conversation') return '是，且在此会话中始终允许运行 ' + cmd;
        if (scope === 'project') return '是，且在此项目中始终允许运行 ' + cmd;
        return '是，且始终允许运行 ' + cmd;
      }
      const mDl = trimmed.match(RE_PERM_ALLOW_DL);
      if (mDl) {
        const scope = (mDl[3] || '').toLowerCase();
        if (mDl[1].toLowerCase() === 'always allow') return '是，始终允许从 ' + mDl[2] + ' 下载';
        if (scope === 'in this conversation') return '是，在此会话中允许从 ' + mDl[2] + ' 下载';
        return '是，本次运行允许从 ' + mDl[2] + ' 下载';
      }
      const mConv = trimmed.match(RE_PERM_ALLOW_CONV);
      if (mConv) return '是，在此会话中允许 ' + mConv[1];
      const mSimple = trimmed.match(RE_PERM_ALWAYS_SIMPLE);
      if (mSimple) return '是，始终允许 ' + mSimple[1];
      return null;
    }

    function computeTextTranslation(raw, contextEl) {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;

      // 1. 无原型静态词典 O(1) 精确匹配（多词附 Sentence/Title Case 大小写回退）+ 上下文消歧（附句尾句号自动回退；函数式 replace 防止 $&/$1 二次展开）
      let replacement = resolveContextualDictTranslation(trimmed, contextEl, lookupRawDict(trimmed));
      if (typeof replacement !== 'string' && trimmed.endsWith('.')) {
        const withoutDot = lookupRawDict(trimmed.slice(0, -1));
        if (typeof withoutDot === 'string') {
          replacement = withoutDot.endsWith('。') ? withoutDot : withoutDot + '。';
        }
      }
      if (typeof replacement === 'string') {
        if (RE_HAS_CJK.test(replacement) && RE_PURE_ALPHA.test(raw)) {
          return replacement;
        }
        return raw.replace(trimmed, () => replacement);
      }

      // 2. 快速短路：不含任何英文字母直接跳过动态正则
      if (!RE_HAS_ALPHA.test(trimmed)) return null;

      // 2.5 Swarm 伴生 iframe 作用域词典与复合状态
      if (IS_SWARM_PLUGIN_FRAME || (contextEl && contextEl.closest && contextEl.closest('[data-testid^="swarm-"]'))) {
        const swarmHit = translateSwarmDynamic(trimmed);
        if (typeof swarmHit === 'string') return raw.replace(trimmed, () => swarmHit);
      }

      // 2.6 带快捷键后缀的标签/提示 (e.g. "Settings (Cmd+,)")
      const shortcutHit = translateShortcutSuffixed(trimmed);
      if (typeof shortcutHit === 'string') return raw.replace(trimmed, () => shortcutHit);

      // 3. 首字符 O(1) 分流动态正则匹配
      const c0 = trimmed.charCodeAt(0);
      if (c0 >= 48 && c0 <= 57) {
        // 以数字 '0'-'9' 开头
        if (RE_PCT_LEFT.test(trimmed)) return raw.replace(RE_PCT_LEFT, '$1% 剩余');
        const mWinComb = trimmed.match(RE_WINDOW_LIMIT_COMBINED);
        if (mWinComb) {
          const u = UNIT_MAP_SHORT[mWinComb[2].toLowerCase()] || mWinComb[2];
          return raw.replace(trimmed, () => mWinComb[1] + ' ' + u + '限额，' + formatCompactDurationZh(mWinComb[3]) + '后重置');
        }
        const mWin = trimmed.match(RE_WINDOW_LIMIT);
        if (mWin) {
          const u = UNIT_MAP_SHORT[mWin[2].toLowerCase()] || mWin[2];
          return raw.replace(trimmed, () => mWin[1] + ' ' + u + '限额');
        }
        const mRel = trimmed.match(RE_REL_TIME);
        if (mRel) {
          const unit = REL_UNIT_MAP[mRel[2].toLowerCase()] || mRel[2];
          return raw.replace(trimmed, () => mRel[1] + ' ' + unit + '前');
        }
        if (RE_UPDATES_COUNT.test(trimmed)) return raw.replace(RE_UPDATES_COUNT, '$1 条进展');
        if (RE_FILES_CHANGED.test(trimmed)) return raw.replace(RE_FILES_CHANGED, '$1 个文件变更');
        if (RE_TOOLS_ENABLED.test(trimmed)) return raw.replace(RE_TOOLS_ENABLED, '$1 个工具已启用');
        if (RE_TOOLS.test(trimmed)) return raw.replace(RE_TOOLS, '$1 个工具');
        if (RE_DEMOTED.test(trimmed)) return raw.replace(RE_DEMOTED, '$1 项已降级');
        if (RE_EXCLUDED.test(trimmed)) return raw.replace(RE_EXCLUDED, '$1 项已排除');
        if (RE_TOOLS_EXCLUDED.test(trimmed)) return raw.replace(RE_TOOLS_EXCLUDED, '$1 个工具已排除');
        if (RE_ACTIVE_CONVS.test(trimmed)) return raw.replace(RE_ACTIVE_CONVS, '$1 个进行中的会话');
        if (RE_PROJECTS_COUNT.test(trimmed)) return raw.replace(RE_PROJECTS_COUNT, '$1 个项目');
        if (RE_CALLS_MB.test(trimmed)) return raw.replace(RE_CALLS_MB, '$1 次通话 · $2');
        const mRunCnt = trimmed.match(RE_RUNNING_COUNT);
        if (mRunCnt) {
          const k = mRunCnt[2].toLowerCase();
          const noun = k === 'subagents/tasks' ? ' 个子智能体/任务' : k.startsWith('subagent') ? ' 个子智能体' : ' 个任务';
          return raw.replace(trimmed, () => mRunCnt[1] + noun + '运行中');
        }
        if (RE_SUBAGENTS_BLOCKED.test(trimmed)) return raw.replace(RE_SUBAGENTS_BLOCKED, '$1 个子智能体受阻');
        if (RE_LINES_ADDED_REMOVED.test(trimmed)) return raw.replace(RE_LINES_ADDED_REMOVED, '新增 $1 行，删除 $2 行');
        const mBadge = trimmed.match(RE_COUNT_BADGE);
        if (mBadge) {
          const bLow = mBadge[2].toLowerCase();
          if (bLow.startsWith('archived')) return raw.replace(trimmed, () => mBadge[1] + ' 个已归档会话');
          if (bLow.startsWith('background')) return raw.replace(trimmed, () => mBadge[1] + ' 个后台任务');
          if (bLow.startsWith('browser')) return raw.replace(trimmed, () => mBadge[1] + ' 个浏览器步骤');
          if (bLow.startsWith('model')) return raw.replace(trimmed, () => '已选择 ' + mBadge[1] + ' 个模型');
          if (bLow.startsWith('waiting')) return raw.replace(trimmed, () => mBadge[1] + ' 项待您处理');
          if (bLow.startsWith('reference')) return raw.replace(trimmed, () => mBadge[1] + ' 个引用');
          if (bLow.startsWith('draft')) return raw.replace(trimmed, () => mBadge[1] + ' 条草稿');
          if (bLow.startsWith('plugin')) return raw.replace(trimmed, () => mBadge[1] + ' 个插件');
        }
        return null;
      }

      const firstUpper = trimmed[0].toUpperCase();
      if (firstUpper === 'S' || firstUpper === '+') {
        if (RE_SEE_ALL.test(trimmed)) return raw.replace(RE_SEE_ALL, '查看全部 ($1)');
        if (RE_SEND_ALL_COUNT.test(trimmed)) return raw.replace(RE_SEND_ALL_COUNT, '全部发送 ($1)');
        if (RE_SHOW_BREAKDOWNS.test(trimmed)) return raw.replace(RE_SHOW_BREAKDOWNS, '展开明细 ($1 项)');
        if (RE_SHOW_MORE_SUBAGENTS.test(trimmed)) return raw.replace(RE_SHOW_MORE_SUBAGENTS, '显示另外 $1 个子代理');
        const mShowMore = trimmed.match(RE_SHOW_MORE_GENERIC);
        if (mShowMore) {
          const kind = (mShowMore[2] || '').toLowerCase();
          const unit = kind.startsWith('result')
            ? '个结果'
            : kind.startsWith('command')
            ? '个命令'
            : kind.startsWith('item')
            ? '个项目'
            : kind.startsWith('option')
            ? '个选项'
            : '个';
          return raw.replace(trimmed, () => '显示另外 ' + mShowMore[1] + ' ' + unit + '...');
        }
        const mSeeMore = trimmed.match(RE_SEE_MORE_COUNT);
        if (mSeeMore) return raw.replace(trimmed, () => (mSeeMore[1] ? '+ ' : '') + '展开另外 ' + mSeeMore[2] + ' 项');
        const mSeeIn = trimmed.match(RE_SEE_MORE_IN);
        if (mSeeIn) return raw.replace(trimmed, () => '在 ' + mSeeIn[1] + ' 中展开更多');
        if (RE_STEP_OF.test(trimmed)) return raw.replace(RE_STEP_OF, '第 $1 步，共 $2 步');
        if (RE_STILL_THINKING.test(trimmed)) return raw.replace(RE_STILL_THINKING, '仍在思考，$1 秒');
        if (RE_SEARCH_GOOGLE.test(trimmed)) return raw.replace(RE_SEARCH_GOOGLE, (_, q) => '使用 Google 搜索“' + q + '”');
        if (!isInHeaderOrBreadcrumb(contextEl)) {
          const mSearch = trimmed.match(RE_EPHEMERAL_ACTIVE);
          if (mSearch) {
            const noun = EPHEMERAL_NOUN_MAP[mSearch[2].toLowerCase()];
            const out = noun ? EPHEMERAL_VERB_MAP[mSearch[1]] + noun : EPHEMERAL_VERB_MAP[mSearch[1]] + ' ' + mSearch[2];
            return raw.replace(trimmed, () => out);
          }
        }
      } else if (firstUpper === 'P') {
        if (RE_PERM_DELETE.test(trimmed)) {
          return raw.replace(RE_PERM_DELETE, (_, target, cnt) => '永久删除 ' + target + ' 及 ' + cnt + ' 个进行中的会话。');
        }
      } else if (firstUpper === 'W' || firstUpper === 'M') {
        const mNamed = trimmed.match(RE_NAMED_LIMIT_RESETS);
        if (mNamed) {
          const pZh = NAMED_PERIOD_MAP[mNamed[1].toLowerCase()] || mNamed[1];
          return raw.replace(trimmed, () => pZh + '限额，' + formatCompactDurationZh(mNamed[2]) + '后重置');
        }
        if (firstUpper === 'M') {
          if (RE_MARKED_READ.test(trimmed)) return raw.replace(RE_MARKED_READ, '已将 $1 个会话标记为已读');
          const mUnavail = trimmed.match(RE_MODEL_UNAVAILABLE_RETRY);
          if (mUnavail) {
            const att = mUnavail[2] ? '（第 ' + mUnavail[2] + '/' + mUnavail[3] + ' 次尝试）' : '';
            const out = mUnavail[1]
              ? '模型暂不可用，' + mUnavail[1] + ' 秒后重试' + att
              : '模型暂不可用，正在重试' + att;
            return raw.replace(trimmed, () => out);
          }
        }
        if (firstUpper === 'W') {
          if (RE_WORKED_FOR_UPDATES.test(trimmed)) {
            return raw.replace(RE_WORKED_FOR_UPDATES, (_, dur, cnt) => '已工作 ' + dur.trim() + ' · ' + cnt + ' 条进展');
          }
          if (RE_WORKED_FOR.test(trimmed)) return raw.replace(RE_WORKED_FOR, '已工作 $1');
          if (RE_WORKING_DOT_S.test(trimmed)) return raw.replace(RE_WORKING_DOT_S, '工作中 · $1 秒');
          if (RE_WAITING_CMD_UP_TO.test(trimmed)) return raw.replace(RE_WAITING_CMD_UP_TO, '正在等待命令完成（最多 $1 秒）');
        }
      } else if (firstUpper === 'T' || firstUpper === 'Q') {
        if (RE_THOUGHT_FOR.test(trimmed)) return raw.replace(RE_THOUGHT_FOR, '已思考 $1');
        if (RE_THINKING_FOR.test(trimmed)) return raw.replace(RE_THINKING_FOR, '正在思考 $1');
        if (RE_THINKING_PAREN.test(trimmed)) return raw.replace(RE_THINKING_PAREN, '正在思考 ($1 秒)...');
        const mQt = trimmed.match(RE_QUESTION_OR_TURN_OF);
        if (mQt) {
          const out = /^Question/i.test(mQt[1]) ? '第 ' + mQt[2] + ' / ' + mQt[3] + ' 个问题' : '第 ' + mQt[2] + ' / ' + mQt[3] + ' 轮';
          return raw.replace(trimmed, () => out);
        }
        if (RE_DELETE_RECORDINGS_CONFIRM.test(trimmed)) {
          return raw.replace(
            RE_DELETE_RECORDINGS_CONFIRM,
            '这将从您的设备中删除 $1 条通话录音（$2），此操作无法撤销。'
          );
        }
        const mQuotaT = translateQuotaExhaustedZh(trimmed);
        if (mQuotaT) return raw.replace(trimmed, () => mQuotaT);
      } else if (firstUpper === 'N') {
        if (RE_NO_MORE_OLDER.test(trimmed)) return raw.replace(RE_NO_MORE_OLDER, '没有更多历史消息，当前显示 $1 / $2 条');
        if (RE_NOTHING_ON_PORT.test(trimmed)) return raw.replace(RE_NOTHING_ON_PORT, '端口 $1 上没有正在运行的服务');
      } else if (firstUpper === 'F') {
        const mFold = trimmed.match(RE_FOLD_LINES);
        if (mFold) return raw.replace(trimmed, () => '折叠第 ' + mFold[2] + '-' + mFold[3] + ' 行');
      } else if (firstUpper === 'E' || firstUpper === 'R' || firstUpper === 'L') {
        if (firstUpper === 'R') {
          const mResets = trimmed.match(RE_RESETS_IN);
          if (mResets) {
            return raw.replace(trimmed, () => formatCompactDurationZh(mResets[1]) + '后重置');
          }
        }
        if (RE_EPHEMERAL_SUMMARY.test(trimmed)) {
          const translatedSummary = trimmed
            .split(/,\s*/)
            .map((part) => translateEphemeralClause(part))
            .join('、');
          return raw.replace(trimmed, () => translatedSummary);
        }
        const inHdr = isInHeaderOrBreadcrumb(contextEl);
        if (!inHdr) {
          const mActive = trimmed.match(RE_EPHEMERAL_ACTIVE);
          if (mActive) {
            const noun = EPHEMERAL_NOUN_MAP[mActive[2].toLowerCase()];
            const out = noun ? EPHEMERAL_VERB_MAP[mActive[1]] + noun : EPHEMERAL_VERB_MAP[mActive[1]] + ' ' + mActive[2];
            return raw.replace(trimmed, () => out);
          }
        }
        if (firstUpper === 'R') {
          if (RE_RUNNING_FOR.test(trimmed)) {
            return raw.replace(RE_RUNNING_FOR, '已运行 $1');
          }
          if (!inHdr && RE_RUNNING_CMD.test(trimmed)) {
            return raw.replace(RE_RUNNING_CMD, (_, cmd) => '正在运行 ' + cmd);
          }
        }
      } else if (firstUpper === 'D') {
        const mNamedD = trimmed.match(RE_NAMED_LIMIT_RESETS);
        if (mNamedD) {
          const pZh = NAMED_PERIOD_MAP[mNamedD[1].toLowerCase()] || mNamedD[1];
          return raw.replace(trimmed, () => pZh + '限额，' + formatCompactDurationZh(mNamedD[2]) + '后重置');
        }
        if (RE_DELETED_RECORDINGS.test(trimmed)) {
          return raw.replace(RE_DELETED_RECORDINGS, '已删除 $1 条录音 ($2)');
        }
      } else if (firstUpper === 'U') {
        const mUnfold = trimmed.match(RE_FOLD_LINES);
        if (mUnfold) return raw.replace(trimmed, () => '展开第 ' + mUnfold[2] + '-' + mUnfold[3] + ' 行');
        const mUpd = trimmed.match(RE_UPDATED_AT);
        if (mUpd) {
          return raw.replace(trimmed, () => formatUpdatedAtZh(mUpd[1], mUpd[2]));
        }
      } else if (firstUpper === 'Z') {
        if (RE_ZOOM_RESET.test(trimmed)) return raw.replace(RE_ZOOM_RESET, '缩放 $1%，重置为适应窗口');
        if (RE_ZIPPING_FOLDER.test(trimmed)) {
          return raw.replace(RE_ZIPPING_FOLDER, (_, folder) => '正在打包 ' + folder + '…');
        }
      } else if (firstUpper === 'Y') {
        const mPermChoice = translatePermissionChoiceZh(trimmed);
        if (mPermChoice) return raw.replace(trimmed, () => mPermChoice);
        const mPlan = trimmed.match(RE_YOUR_PLAN);
        if (mPlan) {
          return raw.replace(trimmed, () => '当前套餐：' + mPlan[1].trim());
        }
        const mUsed = trimmed.match(RE_USED_LIMIT);
        if (mUsed) {
          const degreeMap = { some: '部分', all: '全部', most: '大部分' };
          const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
          const degree = degreeMap[mUsed[1].toLowerCase()] || mUsed[1];
          const type = typeMap[mUsed[2].toLowerCase()] || mUsed[2];
          const timeStr = mUsed[3]
            .replace(/\.$/, '')
            .replace(/(\d+)\s*days?/gi, '$1 天')
            .replace(/(\d+)\s*hours?/gi, '$1 小时')
            .replace(/(\d+)\s*minutes?/gi, '$1 分钟')
            .replace(/(\d+)\s*seconds?/gi, '$1 秒')
            .replace(/,\s*/g, ' ')
            .trim();
          return '您已消耗' + degree + type + '额度，将在 ' + timeStr + ' 后完全重置。';
        }
        const mNotUsed = trimmed.match(RE_NOT_USED_LIMIT);
        if (mNotUsed) {
          const typeMap = { weekly: '每周', '5-hour': '5 小时', 'five-hour': '5 小时', daily: '每日' };
          const type = typeMap[mNotUsed[1].toLowerCase()] || mNotUsed[1];
          return '您尚未消耗任何' + type + '额度。';
        }
        const mQuotaY = translateQuotaExhaustedZh(trimmed);
        if (mQuotaY) return raw.replace(trimmed, () => mQuotaY);
      } else if (firstUpper === 'A') {
        const mCred = trimmed.match(RE_AVAILABLE_AI_CREDITS);
        if (mCred) {
          return raw.replace(trimmed, () => '可用 AI 积分：' + mCred[1].trim());
        }
      }

      if (firstUpper === 'S' && trimmed.length < 240) {
        const mSideStart = trimmed.match(RE_STARTED_SIDE_QUOTE);
        if (mSideStart) {
          const quote = mSideStart[2].trim();
          const zh = mSideStart[1] === 'during' ? '发起于「' + quote + '」期间' : '发起自「' + quote + '」';
          return raw.replace(trimmed, () => zh);
        }
      }

      if (trimmed.length < 40 && firstUpper === 'E') {
        const mExit = trimmed.match(RE_EXITED_CODE_ONLY);
        if (mExit) {
          return raw.replace(trimmed, () => '退出码 ' + mExit[1] + (mExit[2] ? '。' : ''));
        }
      }
      if (trimmed.length < 240 && trimmed.includes('Exited with code')) {
        const mSumExit = trimmed.match(RE_SUMMARY_EXITED_CODE);
        if (mSumExit) {
          return raw.replace(trimmed, () => mSumExit[1].trim() + ' · 退出码 ' + mSumExit[2]);
        }
      }

      const lastCh = trimmed.charCodeAt(trimmed.length - 1);
      if (lastCh === 116 || lastCh === 84) {
        const mModLim = trimmed.match(RE_MODEL_NAMED_LIMIT);
        if (mModLim) {
          const pZh = NAMED_PERIOD_MAP[mModLim[2].toLowerCase()] || mModLim[2];
          return raw.replace(trimmed, () => mModLim[1].trim() + ' ' + pZh + '限额');
        }
      }

      return null;
    }

    function translateTextNode(node) {
      const currentVal = node.nodeValue;
      if (!currentVal) return;

      const rec = origTextMap.get(node);
      if (rec && rec.lastVal === currentVal && rec.ver === PATCH_VERSION) {
        return;
      }
      const origRaw = rec && rec.lastVal === currentVal ? rec.origRaw : currentVal;

      const nextVal = computeTextTranslation(origRaw, node.parentElement);
      if (nextVal !== null) {
        origTextMap.set(node, { origRaw, lastVal: nextVal, ver: PATCH_VERSION });
        if (node.nodeValue !== nextVal) {
          node.nodeValue = nextVal;
        }
      } else if (rec && rec.lastVal === currentVal) {
        node.nodeValue = origRaw;
        origTextMap.delete(node);
      }
    }

    function translateSingleAttr(el, attrName, origDataAttr, customResolver) {
      const verProp = '__ag_attr_ver_' + attrName;
      const lastDataAttr = origDataAttr + '-last';
      const cur = el.getAttribute(attrName);
      if (!cur) {
        if (el.hasAttribute(origDataAttr)) el.removeAttribute(origDataAttr);
        if (el.hasAttribute(lastDataAttr)) el.removeAttribute(lastDataAttr);
        delete el[verProp];
        return;
      }
      const savedOrig = el.getAttribute(origDataAttr);
      const savedLast = el.getAttribute(lastDataAttr);
      if (savedOrig !== null && savedLast === cur && el[verProp] === PATCH_VERSION) {
        return;
      }
      const origVal = savedOrig !== null && savedLast === cur ? savedOrig : cur;
      const trimmed = origVal.trim();
      const shouldSkipAttr = attrName === 'aria-label' && SKIP_ARIA_LABEL_VALUES.has(trimmed);
      const nextVal = shouldSkipAttr
        ? null
        : customResolver
        ? customResolver(trimmed, el)
        : typeof DICT[trimmed] === 'string'
        ? DICT[trimmed]
        : null;
      if (typeof nextVal === 'string') {
        if (savedOrig !== origVal) el.setAttribute(origDataAttr, origVal);
        if (savedLast !== nextVal) el.setAttribute(lastDataAttr, nextVal);
        el[verProp] = PATCH_VERSION;
        if (cur !== nextVal) {
          el.setAttribute(attrName, nextVal);
        }
      } else {
        if (savedOrig !== null && savedLast === cur) {
          el.setAttribute(attrName, savedOrig);
        }
        if (savedOrig !== null) el.removeAttribute(origDataAttr);
        if (savedLast !== null) el.removeAttribute(lastDataAttr);
        el[verProp] = PATCH_VERSION;
      }
    }

    function resolveAttrTranslation(atrim, el) {
      const directHit = lookupRawDict(atrim);
      if (typeof directHit === 'string') return resolveContextualDictTranslation(atrim, el, directHit);
      const mModel = atrim.match(RE_ARIA_MODEL);
      if (mModel) {
        let mName = mModel[1].trim();
        let noteZh = '';
        const commaIdx = mName.indexOf(', ');
        if (commaIdx > 0) {
          const maybeNote = mName.slice(commaIdx + 2).trim();
          const noteHit = lookupRawDict(maybeNote);
          if (typeof noteHit === 'string' && noteHit) {
            mName = mName.slice(0, commaIdx).trim();
            noteZh = '（' + noteHit + '）';
          }
        }
        if (mName === 'Select model') return '模型，当前：选择模型' + noteZh;
        return '模型，当前：' + mName + noteZh;
      }
      const lookupPerm = (s) => {
        if (s && s.toLowerCase() === 'default') return '敏感确认 (Default)';
        return lookupRawDict(s) || DICT[s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()] || s;
      };
      const mPermSel = atrim.match(RE_ARIA_PERM_SEL);
      if (mPermSel) {
        const pMode = mPermSel[1].trim();
        return '权限模式，当前：' + lookupPerm(pMode);
      }
      const mPermFixed = atrim.match(RE_ARIA_PERM_FIXED);
      if (mPermFixed) {
        const pMode = mPermFixed[1].trim();
        const rawNote = (mPermFixed[2] || mPermFixed[3] || '').trim();
        if (!rawNote) {
          return '权限模式：' + lookupPerm(pMode);
        }
        const mappedNote =
          rawNote.toLowerCase() === 'cannot be changed mid-conversation'
            ? '会话中途无法更改'
            : lookupRawDict(rawNote) || computeTextTranslation(rawNote, el) || rawNote;
        return '权限模式：' + lookupPerm(pMode) + '（' + mappedNote + '）';
      }
      const mTurn = atrim.match(RE_ARIA_TURN);
      if (mTurn) {
        if (mTurn[3] && mTurn[4]) {
          return '第 ' + mTurn[3] + ' / ' + mTurn[4] + ' 轮对话';
        }
        const roleZh = mTurn[2].toLowerCase() === 'user' ? '用户' : '智能体';
        return '第 ' + mTurn[1] + ' 轮对话（' + roleZh + '）';
      }
      const mOlder = atrim.match(RE_ARIA_LOAD_OLDER);
      if (mOlder) {
        if (mOlder[2] && mOlder[3]) {
          return '加载更早的消息（当前显示 ' + mOlder[2] + ' / ' + mOlder[3] + '）';
        }
        return '加载更早的 ' + mOlder[1] + ' 轮对话';
      }
      const mBranch = atrim.match(RE_ARIA_BRANCH);
      if (mBranch) {
        const bName = mBranch[1].trim();
        return '分支，当前：' + (bName === 'Select branch' ? '选择分支' : bName);
      }
      const mProj = atrim.match(RE_ARIA_PROJECT);
      if (mProj) {
        const pName = mProj[1].trim();
        return '选择项目，当前：' + (pName === 'No project' || pName === 'No Project' ? '未关联项目' : pName);
      }
      const mLoc = atrim.match(RE_ARIA_LOCATION);
      if (mLoc) {
        const locName = mLoc[1].trim();
        const mappedLoc =
          locName.toLowerCase() === 'this computer' ? '本机' : locName.toLowerCase() === 'remote' ? '远程' : lookupRawDict(locName) || locName;
        return '智能体运行位置，当前：' + mappedLoc;
      }
      const mVer = atrim.match(RE_ARIA_VERSION);
      if (mVer) {
        return '版本 ' + mVer[1].trim();
      }
      return computeTextTranslation(atrim, el);
    }

    function translateElementAttrs(el) {
      if (!el || el.nodeType !== 1) return;
      translateSingleAttr(el, 'title', 'data-ag-orig-title', resolveAttrTranslation);
      translateSingleAttr(el, 'placeholder', 'data-ag-orig-placeholder', resolveAttrTranslation);
      translateSingleAttr(el, 'aria-label', 'data-ag-orig-aria-label', resolveAttrTranslation);
    }

    const observedShadowRoots = new WeakSet();

    function observeRoot(root) {
      if (!root || !window.__ag_i18n_observer || observedShadowRoots.has(root)) return;
      try {
        window.__ag_i18n_observer.observe(root, I18N_OBS_OPTS);
        observedShadowRoots.add(root);
      } catch (e) {}
    }

    const walkerFilter = {
      acceptNode(node) {
        if (node.nodeType === 1) {
          if (node.matches && node.matches(EXCLUDE_SELECTOR)) {
            if (node.isConnected && node.matches(TEXT_IMMUTABLE_EXCLUDE_SELECTOR)) {
              immutableTextExclCache.set(node, true);
            }
            if (
              (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') &&
              canTranslateElementAttrs(node) &&
              (node.hasAttribute('title') || node.hasAttribute('aria-label') || node.hasAttribute('placeholder'))
            ) {
              translateElementAttrs(node);
            }
            return NodeFilter.FILTER_REJECT;
          }
          if (
            node.hasAttribute &&
            (node.hasAttribute('title') || node.hasAttribute('aria-label') || node.hasAttribute('placeholder'))
          ) {
            translateElementAttrs(node);
          }
          if (node.shadowRoot) {
            observeRoot(node.shadowRoot);
            scanAndTranslate(node.shadowRoot);
          }
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    };

    function scanAndTranslate(root = document.body) {
      if (!root) return;
      if (root.nodeType === 3) {
        if (root.parentElement && !isExcludedElement(root.parentElement)) {
          translateTextNode(root);
        }
        return;
      }
      if (root.nodeType === 11) {
        if (root.host && isExcludedElement(root.host)) return;
        observeRoot(root);
        const shadowWalker = document.createTreeWalker(
          root,
          NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
          walkerFilter
        );
        while (shadowWalker.nextNode()) {
          translateTextNode(shadowWalker.currentNode);
        }
        return;
      }
      if (root.nodeType !== 1) return;
      if (isExcludedElement(root)) {
        if (
          (root.tagName === 'INPUT' || root.tagName === 'TEXTAREA') &&
          canTranslateElementAttrs(root) &&
          (root.hasAttribute('title') || root.hasAttribute('aria-label') || root.hasAttribute('placeholder'))
        ) {
          translateElementAttrs(root);
        }
        return;
      }

      if (
        root.hasAttribute &&
        (root.hasAttribute('title') || root.hasAttribute('aria-label') || root.hasAttribute('placeholder'))
      ) {
        translateElementAttrs(root);
      }
      if (root.shadowRoot) {
        observeRoot(root.shadowRoot);
        scanAndTranslate(root.shadowRoot);
      }

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        walkerFilter
      );
      while (walker.nextNode()) {
        translateTextNode(walker.currentNode);
      }
    }

    scanBodyFn = scanAndTranslate;
    if (document.body) {
      scanAndTranslate(document.body);
    }

    const dirtyRoots = new Set();
    let pending = false;
    let fallbackTimer = null;

    function flushTranslations() {
      pending = false;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (dirtyRoots.size === 0) return;

      if (dirtyRoots.size > 200) {
        dirtyRoots.clear();
        try {
          scanAndTranslate(document.body);
        } catch (e) {}
        return;
      }

      const roots = Array.from(dirtyRoots);
      const rootSet = new Set(roots);
      dirtyRoots.clear();

      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        if (!r || (!r.isConnected && r.nodeType !== 11)) continue;
        let covered = false;
        for (let p = r.parentNode; p; p = p.parentNode) {
          if (rootSet.has(p)) {
            covered = true;
            break;
          }
        }
        if (!covered) {
          try {
            scanAndTranslate(r);
          } catch (e) {}
        }
      }
    }

    function scheduleFlush() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(flushTranslations);
      fallbackTimer = setTimeout(flushTranslations, 80);
    }

    window.__ag_i18n_observer = new MutationObserver((mutations) => {
      const batchSafeSet = new Set();
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'characterData') {
          const t = m.target;
          if (t && t.parentElement && !isExcludedElement(t.parentElement, batchSafeSet)) {
            dirtyRoots.add(t);
          }
        } else if (m.type === 'attributes') {
          const el = m.target;
          if (el && el.nodeType === 1 && canTranslateElementAttrs(el, batchSafeSet)) {
            try {
              translateElementAttrs(el);
            } catch (e) {}
          }
        } else if (m.type === 'childList' && m.addedNodes.length > 0) {
          if (m.target && m.target.nodeType === 1 && isExcludedElement(m.target, batchSafeSet)) {
            continue;
          }
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (n.nodeType === 1 || n.nodeType === 3) {
              dirtyRoots.add(n);
            }
          }
        }
      }
      if (dirtyRoots.size > 0) {
        scheduleFlush();
      }
    });

    if (document.body) {
      observeRoot(document.body);
    }

    window.__ag_on_attach_shadow = (sr) => {
      if (!sr) return;
      observeRoot(sr);
      dirtyRoots.add(sr);
      scheduleFlush();
    };
    if (
      typeof Element !== 'undefined' &&
      Element.prototype &&
      typeof Element.prototype.attachShadow === 'function' &&
      !Element.prototype.attachShadow.__agEnhancerHooked
    ) {
      const origAttachShadow = Element.prototype.attachShadow;
      const hookedAttachShadow = function () {
        const sr = origAttachShadow.apply(this, arguments);
        try {
          if (typeof window.__ag_on_attach_shadow === 'function') {
            window.__ag_on_attach_shadow(sr);
          }
        } catch (e) {}
        return sr;
      };
      hookedAttachShadow.__agEnhancerHooked = true;
      Element.prototype.attachShadow = hookedAttachShadow;
    }

    if (Array.isArray(window.__ag_cleanup_fns)) {
      window.__ag_cleanup_fns.push(() => {
        window.__ag_on_attach_shadow = null;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        if (window.__ag_i18n_observer) {
          try { window.__ag_i18n_observer.disconnect(); } catch (e) {}
          window.__ag_i18n_observer = null;
        }
      });
    }
  } else if (document.body) {
    window.__ag_on_attach_shadow = null;
    // 若用户在配置中关闭了 i18n 模块，实时将已翻译的文本与属性还原为原始英文
    restoreAllTranslations(document.body);
  }
