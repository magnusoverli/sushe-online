import { escapeHtml } from './html-utils.js';

export function groupCommunityLists(lists, currentUsername = '') {
  const users = new Map();

  for (const list of Array.isArray(lists) ? lists : []) {
    const username = list?.owner?.username || '';
    if (!username || username === currentUsername) continue;
    if (!users.has(username)) users.set(username, []);
    users.get(username).push(list);
  }

  return [...users.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([username, userLists]) => ({
      username,
      lists: userLists.sort(
        (a, b) =>
          Number(b.year || 0) - Number(a.year || 0) ||
          String(a.name || '').localeCompare(String(b.name || ''), undefined, {
            sensitivity: 'base',
          })
      ),
    }));
}

export function renderCommunityRootHtml({
  expanded,
  status,
  users,
  userExpandState,
  activeListId,
  isMobile,
}) {
  const chevron = expanded ? 'fa-chevron-down' : 'fa-chevron-right';
  let content = '';

  if (expanded && (status === 'idle' || status === 'loading')) {
    content = `<div class="px-3 py-3 text-sm text-gray-500"><i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>Loading user lists...</div>`;
  } else if (expanded && status === 'error') {
    content = `<div class="px-3 py-3 text-sm text-red-300">
      <p>Could not load user lists.</p>
      <button type="button" data-community-retry class="mt-2 text-gray-200 underline">Try again</button>
    </div>`;
  } else if (expanded && users.length === 0) {
    content =
      '<p class="px-3 py-3 text-sm text-gray-500">No user lists are available.</p>';
  } else if (expanded) {
    content = users
      .map(({ username, lists }) => {
        const userExpanded = userExpandState[username] === true;
        const userChevron = userExpanded
          ? 'fa-chevron-down'
          : 'fa-chevron-right';
        const listItems = userExpanded
          ? lists
              .map((list) => {
                const active = activeListId === list.id ? ' active' : '';
                const padding = isMobile ? 'py-2.5' : 'py-2';
                return `<li>
                  <button type="button" data-community-list-id="${escapeHtml(list.id)}" class="community-list-btn${active} w-full text-left pl-9 pr-3 ${padding} rounded-sm text-sm text-gray-300 flex items-center gap-2">
                    <i class="fas fa-list shrink-0" aria-hidden="true"></i>
                    <span class="truncate flex-1">${escapeHtml(list.year)} · ${escapeHtml(list.name)} (${escapeHtml(list.itemCount ?? 0)})</span>
                  </button>
                </li>`;
              })
              .join('')
          : '';

        return `<div class="community-user" data-community-user="${escapeHtml(username)}">
          <button type="button" data-community-user-toggle="${escapeHtml(username)}" class="w-full text-left px-3 py-2 text-sm text-gray-200 flex items-center" aria-expanded="${userExpanded}">
            <i class="fas ${userChevron} fa-fw mr-2 text-xs" aria-hidden="true"></i>
            <i class="fas fa-user mr-2 text-xs text-gray-400" aria-hidden="true"></i>
            <span class="truncate">${escapeHtml(username)}</span>
          </button>
          ${userExpanded ? `<ul>${listItems}</ul>` : ''}
        </div>`;
      })
      .join('');
  }

  return `<div class="community-root mt-2 pt-2 border-t border-gray-700" data-community-root>
    <button type="button" data-community-root-toggle class="w-full text-left px-3 py-2 text-sm font-bold text-white flex items-center" aria-expanded="${expanded}">
      <i class="fas ${chevron} fa-fw mr-2 text-xs" aria-hidden="true"></i>
      <i class="fas fa-users mr-2 text-xs text-gray-300" aria-hidden="true"></i>
      <span>User lists</span>
    </button>
    ${expanded ? `<div class="community-root-content">${content}</div>` : ''}
  </div>`;
}

export function createCommunityListNav(deps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const storage =
    deps.storage ||
    (typeof localStorage !== 'undefined' ? localStorage : undefined);
  const {
    apiCall,
    getCurrentUser = () => ({}),
    getActiveCommunityListId = () => null,
    selectCommunityList,
    updateListNav,
  } = deps;

  let status = 'idle';
  let summaries = [];
  let loadPromise = null;

  function getStorageScope() {
    const user = getCurrentUser() || {};
    return user._id || user.username || 'anonymous';
  }

  function rootStorageKey() {
    return `communityRootExpanded:${getStorageScope()}`;
  }

  function userStorageKey() {
    return `communityUserExpandState:${getStorageScope()}`;
  }

  function isRootExpanded() {
    try {
      return storage?.getItem(rootStorageKey()) === 'true';
    } catch (_error) {
      return false;
    }
  }

  function setRootExpanded(expanded) {
    try {
      storage?.setItem(rootStorageKey(), String(expanded));
    } catch (_error) {
      // Expansion persistence is optional.
    }
  }

  function getUserExpandState() {
    try {
      const parsed = JSON.parse(storage?.getItem(userStorageKey()) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function setUserExpanded(username, expanded) {
    const state = { ...getUserExpandState(), [username]: expanded };
    try {
      storage?.setItem(userStorageKey(), JSON.stringify(state));
    } catch (_error) {
      // Expansion persistence is optional.
    }
  }

  function ensureSummaries() {
    if (status === 'loaded' || loadPromise) return loadPromise;
    status = 'loading';
    loadPromise = apiCall('/api/community/main-lists')
      .then((response) => {
        summaries = Array.isArray(response?.lists) ? response.lists : [];
        status = 'loaded';
      })
      .catch(() => {
        status = 'error';
      })
      .finally(() => {
        loadPromise = null;
        updateListNav();
      });
    return loadPromise;
  }

  function appendCommunityRoot(container, isMobile) {
    if (!doc) return;
    const expanded = isRootExpanded();
    const users = groupCommunityLists(
      summaries,
      getCurrentUser()?.username || ''
    );
    const root = doc.createElement('div');
    root.className = 'community-root-shell';
    root.setAttribute('data-community-root-shell', '');
    root.innerHTML = renderCommunityRootHtml({
      expanded,
      status,
      users,
      userExpandState: getUserExpandState(),
      activeListId: getActiveCommunityListId(),
      isMobile,
    });

    root.addEventListener('click', (event) => {
      const rootToggle = event.target.closest('[data-community-root-toggle]');
      if (rootToggle) {
        setRootExpanded(!isRootExpanded());
        updateListNav();
        return;
      }

      if (event.target.closest('[data-community-retry]')) {
        status = 'idle';
        updateListNav();
        return;
      }

      const userToggle = event.target.closest('[data-community-user-toggle]');
      if (userToggle) {
        const username = userToggle.dataset.communityUserToggle;
        setUserExpanded(username, getUserExpandState()[username] !== true);
        updateListNav();
        return;
      }

      const listButton = event.target.closest('[data-community-list-id]');
      if (!listButton) return;
      const list = summaries.find(
        (item) => String(item.id) === listButton.dataset.communityListId
      );
      if (!list || getActiveCommunityListId() === list.id) return;
      selectCommunityList(list.id, list);
      if (isMobile) deps.toggleMobileLists?.();
    });

    container.appendChild(root);

    if (expanded && status === 'idle') {
      void ensureSummaries();
    }
  }

  function updateActiveState(container, activeListId) {
    container
      ?.querySelectorAll('[data-community-list-id]')
      .forEach((button) => {
        button.classList.toggle(
          'active',
          button.dataset.communityListId === activeListId
        );
      });
  }

  return {
    appendCommunityRoot,
    updateActiveState,
  };
}
