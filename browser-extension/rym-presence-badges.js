// Adds lightweight SuShe presence badges to visible RYM album links.
/* global MutationObserver, location */

(function () {
  const { ACTIONS } = globalThis.ExtensionConstants;
  const albumIdentity = globalThis.AlbumIdentity;
  const badgeAttribute = 'data-sushe-presence-badge';
  const badgeKeyAttribute = 'data-sushe-presence-badge-key';
  const badgeListsAttribute = 'data-sushe-presence-lists';
  const albumAttribute = 'data-sushe-presence-key';
  const maxAlbumsPerScan = 100;
  const freshValidationIntervalMs = 60 * 1000;
  let scanTimer = null;
  let validationInFlight = false;
  let lastValidationAt = 0;

  function injectBadgeStyles() {
    if (document.getElementById('sushe-presence-badge-styles')) return;

    const style = document.createElement('style');
    style.id = 'sushe-presence-badge-styles';
    style.textContent = `
      .sushe-presence-badge {
        display: inline-flex;
        align-items: center;
        margin-left: 6px;
        padding: 1px 5px;
        border: 1px solid #2f7d52;
        border-radius: 4px;
        background: #123522;
        color: #8ee0b0;
        font: 500 11px/1.35 system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        vertical-align: baseline;
        white-space: nowrap;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function getAlbumContainer(anchor) {
    return (
      anchor.closest('.page_section_charts_item_wrapper') ||
      anchor.closest('.page_charts_section_charts_item_wrapper') ||
      anchor.closest('[class*="chart_item"]') ||
      anchor.closest('[class*="release_row"]') ||
      anchor.closest('tr') ||
      anchor.parentElement
    );
  }

  function findCurrentPageTarget() {
    return (
      document.querySelector('h1') ||
      document.querySelector('.release_title') ||
      document.querySelector('[class*="release_title"]')
    );
  }

  function isTextAlbumLink(anchor) {
    return anchor.textContent.trim().length > 0 && !anchor.querySelector('img');
  }

  function shouldReplaceTarget(existing, candidateAnchor) {
    return (
      !isTextAlbumLink(existing.anchor) && isTextAlbumLink(candidateAnchor)
    );
  }

  function addTarget(targetByContainer, identity, anchor, container) {
    const key = albumIdentity.getAlbumKey(identity);
    if (!key || !anchor || !container) return;

    const existing = targetByContainer.get(container);
    if (existing && !shouldReplaceTarget(existing, anchor)) return;

    targetByContainer.set(container, { anchor, container, identity, key });
  }

  function collectAlbumTargets() {
    const targetByContainer = new Map();
    const anchors = Array.from(
      document.querySelectorAll('a[href*="/release/"]')
    );

    for (const anchor of anchors) {
      if (targetByContainer.size >= maxAlbumsPerScan) break;

      const identity = albumIdentity.getAlbumIdentityFromUrl(anchor.href);
      if (!identity) continue;

      addTarget(targetByContainer, identity, anchor, getAlbumContainer(anchor));
    }

    const targets = Array.from(targetByContainer.values());

    const pageIdentity = albumIdentity.getAlbumIdentityFromUrl(location.href);
    const pageTarget = findCurrentPageTarget();
    if (
      pageIdentity &&
      pageTarget &&
      !pageTarget.querySelector(`[${badgeAttribute}]`)
    ) {
      const key = albumIdentity.getAlbumKey(pageIdentity);
      if (!targets.some((target) => target.key === key)) {
        targets.push({
          anchor: pageTarget,
          container: pageTarget.parentElement || pageTarget,
          identity: pageIdentity,
          key,
        });
      }
    }

    return targets;
  }

  function getUniqueAlbums(targets) {
    const albumByKey = new Map();
    for (const target of targets) {
      if (!albumByKey.has(target.key)) {
        albumByKey.set(target.key, {
          key: target.key,
          artist: target.identity.artist,
          album: target.identity.album,
        });
      }
    }
    return Array.from(albumByKey.values());
  }

  function getListNames(matches) {
    return (matches || [])
      .map((match) => match.listName)
      .filter(Boolean)
      .filter((name, index, names) => names.indexOf(name) === index);
  }

  function getStoredBadgeListNames(badge) {
    const stored = badge.getAttribute(badgeListsAttribute);
    if (stored) {
      return stored.split('\n').filter(Boolean);
    }

    return badge.title
      .replace(/^In:\s*/, '')
      .split(/,\s*/)
      .filter(Boolean);
  }

  function updateBadgeListNames(badge, matches) {
    const listNames = [
      ...getStoredBadgeListNames(badge),
      ...getListNames(matches),
    ].filter((name, index, names) => names.indexOf(name) === index);

    badge.setAttribute(badgeListsAttribute, listNames.join('\n'));
    badge.title = `In: ${listNames.join(', ')}`;
  }

  function findBadgeForTarget(target) {
    return Array.from(
      target.container.querySelectorAll(`[${badgeAttribute}]`)
    ).find(
      (badge) =>
        badge.getAttribute(badgeKeyAttribute) === target.key ||
        (!badge.getAttribute(badgeKeyAttribute) &&
          target.container.getAttribute(albumAttribute) === target.key)
    );
  }

  function removeBadge(target) {
    const badge = findBadgeForTarget(target);
    if (badge) badge.remove();
    if (target.container.getAttribute(albumAttribute) === target.key) {
      target.container.removeAttribute(albumAttribute);
    }
  }

  function renderBadge(target, matches) {
    if (!matches || matches.length === 0) return;

    const existingBadge = findBadgeForTarget(target);
    if (target.container.getAttribute(albumAttribute) === target.key) {
      if (existingBadge) updateBadgeListNames(existingBadge, matches);
      return;
    }

    const badge = document.createElement('span');
    badge.className = 'sushe-presence-badge';
    badge.setAttribute(badgeAttribute, 'true');
    badge.setAttribute(badgeKeyAttribute, target.key);
    badge.textContent = 'In SuShe';
    updateBadgeListNames(badge, matches);

    target.anchor.insertAdjacentElement('afterend', badge);
    target.container.setAttribute(albumAttribute, target.key);
  }

  function applyPresenceMatches(targets, matches, options = {}) {
    for (const target of targets) {
      const targetMatches = matches?.[target.key];
      if (targetMatches?.length) {
        renderBadge(target, targetMatches);
      } else if (options.removeMissing) {
        removeBadge(target);
      }
    }
  }

  async function validateVisiblePresence(targets) {
    if (validationInFlight) return;
    if (Date.now() - lastValidationAt < freshValidationIntervalMs) return;

    validationInFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_ALBUM_PRESENCE,
        albums: getUniqueAlbums(targets),
        forceRefresh: true,
      });

      if (response?.success) {
        applyPresenceMatches(targets, response.matches, {
          removeMissing: true,
        });
        lastValidationAt = Date.now();
      }
    } catch (error) {
      console.debug(
        'Fresh SuShe presence validation unavailable:',
        error.message
      );
    } finally {
      validationInFlight = false;
    }
  }

  async function scanForPresence() {
    injectBadgeStyles();

    const targets = collectAlbumTargets();
    if (targets.length === 0) return;

    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_ALBUM_PRESENCE,
        albums: getUniqueAlbums(targets),
      });

      if (!response?.success) return;

      applyPresenceMatches(targets, response.matches);
      validateVisiblePresence(targets);
    } catch (error) {
      console.debug('SuShe presence lookup unavailable:', error.message);
    }
  }

  function renderAddedAlbumBadge(album, list) {
    const key = albumIdentity.getAlbumKey(album);
    if (!key) return;

    injectBadgeStyles();

    const matches = [
      {
        listId: list.listId,
        listName: list.listName,
        year: list.year || null,
      },
    ];

    for (const target of collectAlbumTargets()) {
      if (target.key === key) renderBadge(target, matches);
    }
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanForPresence();
    }, 300);
  }

  scheduleScan();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== ACTIONS.ALBUM_ADDED_TO_LIST) return false;

    renderAddedAlbumBadge(message.album, message.list);
    return false;
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
