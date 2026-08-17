// Adds lightweight SuShe presence badges to visible RYM album links.
/* global MutationObserver, location */

(function () {
  const { ACTIONS } = globalThis.ExtensionConstants;
  const albumIdentity = globalThis.AlbumIdentity;
  const badgeAttribute = 'data-sushe-presence-badge';
  const badgeKeyAttribute = 'data-sushe-presence-badge-key';
  const badgeListsAttribute = 'data-sushe-presence-lists';
  const badgeVariantAttribute = 'data-sushe-presence-variant';
  const badgeLinkListAttribute = 'data-sushe-list-id';
  const badgeLinkAlbumAttribute = 'data-sushe-album-id';
  const badgeLinkMainAttribute = 'data-sushe-list-main';
  const badgeLinkYearAttribute = 'data-sushe-list-year';
  const badgeApiBaseAttribute = 'data-sushe-api-base';
  const albumAttribute = 'data-sushe-presence-key';
  const platformRowAttribute = 'data-sushe-presence-platform-row';
  const maxAlbumsPerScan = 100;
  const freshValidationIntervalMs = 60 * 1000;
  const platformHosts = [
    'bandcamp.com',
    'music.apple.com',
    'open.spotify.com',
    'qobuz.com',
    'soundcloud.com',
    'tidal.com',
    'youtube.com',
    'youtu.be',
  ];
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
      .sushe-presence-badge--platform {
        box-sizing: border-box;
        width: 36px;
        height: 36px;
        margin: 0 4px 0 0;
        padding: 0;
        border: 2px solid #4ade80;
        border-radius: 5px;
        overflow: hidden;
        background: #080808;
        vertical-align: middle;
      }
      .sushe-presence-badge--platform img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .sushe-presence-badge--platform:focus-visible {
        outline: 2px solid #8ee0b0;
        outline-offset: 2px;
      }
      .sushe-presence-platform-row {
        display: flex;
        align-items: center;
        margin-top: 12px;
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

  function isTextAlbumLink(anchor) {
    return anchor.textContent.trim().length > 0 && !anchor.querySelector('img');
  }

  function getBadgeAlbumIdentityFromUrl(url) {
    const releaseMatch = String(url || '').match(/\/release\/([^/?#]+)\//);
    if (!releaseMatch || releaseMatch[1].toLowerCase() !== 'album') return null;

    return albumIdentity.getAlbumIdentityFromUrl(url);
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

    targetByContainer.set(container, {
      anchor,
      container,
      identity,
      key,
      variant: 'listing',
    });
  }

  function collectListingTargets() {
    const targetByContainer = new Map();
    const anchors = Array.from(
      document.querySelectorAll('a[href*="/release/"]')
    );

    for (const anchor of anchors) {
      if (targetByContainer.size >= maxAlbumsPerScan) break;
      if (!isTextAlbumLink(anchor)) continue;

      const identity = getBadgeAlbumIdentityFromUrl(anchor.href);
      if (!identity) continue;

      addTarget(targetByContainer, identity, anchor, getAlbumContainer(anchor));
    }

    return Array.from(targetByContainer.values());
  }

  function findAlbumCover() {
    const selectors = [
      'img.coverart_img',
      'img[itemprop="image"]',
      '.release_left_column img',
      '[class*="release_left"] img',
      '[class*="coverart"] img',
    ];

    for (const selector of selectors) {
      const covers = Array.from(document.querySelectorAll(selector));
      const visibleCover = covers.find(
        (cover) =>
          typeof cover.getClientRects !== 'function' ||
          cover.getClientRects().length > 0
      );
      if (visibleCover) return visibleCover;
      if (covers[0]) return covers[0];
    }

    return null;
  }

  function getCoverScope(cover) {
    return (
      cover.closest('.release_left_column') ||
      cover.closest('[class*="release_left"]') ||
      cover.parentElement?.parentElement ||
      cover.parentElement
    );
  }

  function isPlatformLink(anchor) {
    const linkedContent =
      `${anchor.href || ''} ${anchor.querySelector('img')?.src || ''}`.toLowerCase();
    if (platformHosts.some((host) => linkedContent.includes(host))) {
      return true;
    }

    try {
      const hostname = new URL(
        anchor.href,
        location.href
      ).hostname.toLowerCase();
      return platformHosts.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
      );
    } catch (_error) {
      return false;
    }
  }

  function findCommonPlatformRow(platformLinks, scope) {
    let candidate = platformLinks[0]?.parentElement;
    while (candidate && candidate !== scope) {
      const candidateLinks = Array.from(
        candidate.querySelectorAll('a[href]')
      ).filter(isPlatformLink);
      if (candidateLinks.length === platformLinks.length) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function findNativePlatformRow(scope) {
    const platformLinks = Array.from(scope.querySelectorAll('a[href]')).filter(
      isPlatformLink
    );
    if (platformLinks.length > 0) {
      return (
        findCommonPlatformRow(platformLinks, scope) ||
        platformLinks[0].parentElement
      );
    }

    const selectors = [
      '.release_media_links',
      '[class*="media_links"]',
      '[class*="streaming_links"]',
    ];
    for (const selector of selectors) {
      const row = scope.querySelector(selector);
      if (row) return row;
    }

    return null;
  }

  function ensureFallbackPlatformRow(cover) {
    const existing = document.querySelector(`[${platformRowAttribute}]`);
    if (existing) return existing;

    const row = document.createElement('div');
    row.className = 'sushe-presence-platform-row';
    row.setAttribute(platformRowAttribute, 'true');

    const placement = cover.closest('a') || cover;
    placement.insertAdjacentElement('afterend', row);
    return row;
  }

  function removeAlbumDetailDuplicates(platformRow) {
    for (const badge of document.querySelectorAll(`[${badgeAttribute}]`)) {
      if (badge.parentElement !== platformRow) badge.remove();
    }

    for (const container of document.querySelectorAll(`[${albumAttribute}]`)) {
      if (container !== platformRow) container.removeAttribute(albumAttribute);
    }
  }

  function collectAlbumDetailTarget(identity) {
    const cover = findAlbumCover();
    if (!cover) {
      removeAlbumDetailDuplicates(null);
      return [];
    }

    const scope = getCoverScope(cover);
    const nativePlatformRow = findNativePlatformRow(scope);
    const fallbackPlatformRow = document.querySelector(
      `[${platformRowAttribute}]`
    );
    if (
      nativePlatformRow &&
      fallbackPlatformRow &&
      fallbackPlatformRow !== nativePlatformRow
    ) {
      fallbackPlatformRow.remove();
    }
    const platformRow =
      nativePlatformRow ||
      fallbackPlatformRow ||
      ensureFallbackPlatformRow(cover);
    removeAlbumDetailDuplicates(platformRow);

    const key = albumIdentity.getAlbumKey(identity);
    if (!key) return [];

    return [
      {
        anchor: null,
        container: platformRow,
        identity,
        key,
        variant: 'platform',
      },
    ];
  }

  function collectAlbumTargets() {
    const pageIdentity = getBadgeAlbumIdentityFromUrl(location.href);
    return pageIdentity
      ? collectAlbumDetailTarget(pageIdentity)
      : collectListingTargets();
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
      .replace(/^In(?: SuShe)?:\s*/, '')
      .split(/,\s*/)
      .filter(Boolean);
  }

  function updateBadgeListNames(
    badge,
    matches,
    variant = 'listing',
    options = {}
  ) {
    const existingListNames = options.replaceExisting
      ? []
      : getStoredBadgeListNames(badge);
    const listNames = [...existingListNames, ...getListNames(matches)].filter(
      (name, index, names) => names.indexOf(name) === index
    );

    badge.setAttribute(badgeListsAttribute, listNames.join('\n'));
    const listLabel = listNames.join(', ');
    badge.title =
      variant === 'platform' ? `In SuShe: ${listLabel}` : `In: ${listLabel}`;
    badge.setAttribute('aria-label', `In SuShe: ${listLabel}`);
  }

  function comparePresenceMatches(left, right) {
    if (!!left?.isMain !== !!right?.isMain) return left?.isMain ? -1 : 1;

    const leftYear = Number(left?.year) || 0;
    const rightYear = Number(right?.year) || 0;
    if (leftYear !== rightYear) return rightYear - leftYear;

    return String(left?.listName || '').localeCompare(
      String(right?.listName || '')
    );
  }

  function getPreferredMatch(matches) {
    return [...(matches || [])]
      .filter((match) => match.listId && match.albumId)
      .sort(comparePresenceMatches)[0];
  }

  function getStoredLinkMatch(badge) {
    const listId = badge.getAttribute(badgeLinkListAttribute);
    const albumId = badge.getAttribute(badgeLinkAlbumAttribute);
    if (!listId || !albumId) return null;

    return {
      listId,
      albumId,
      isMain: badge.getAttribute(badgeLinkMainAttribute) === 'true',
      year: badge.getAttribute(badgeLinkYearAttribute) || null,
    };
  }

  function buildAlbumLink(apiBase, match) {
    if (!apiBase || !match?.listId || !match?.albumId) return null;

    try {
      const url = new URL('/', apiBase);
      url.searchParams.set('listId', match.listId);
      url.searchParams.set('albumId', match.albumId);
      return url.toString();
    } catch (_error) {
      return null;
    }
  }

  function updateBadgeLink(badge, matches, options = {}) {
    if (badge.getAttribute(badgeVariantAttribute) !== 'platform') return;

    const storedMatch = getStoredLinkMatch(badge);
    const linkMatches = (matches || []).map((match) => ({
      ...match,
      albumId: match.albumId || storedMatch?.albumId,
    }));
    const candidate = getPreferredMatch(linkMatches);
    const existing = options.replaceExisting ? null : storedMatch;
    const preferred =
      existing &&
      (!candidate || comparePresenceMatches(existing, candidate) <= 0)
        ? existing
        : candidate;
    const apiBase =
      options.apiBase || badge.getAttribute(badgeApiBaseAttribute);
    const href = buildAlbumLink(apiBase, preferred);
    if (!href) return;

    badge.href = href;
    badge.setAttribute('target', '_blank');
    badge.setAttribute('rel', 'noopener noreferrer');
    badge.setAttribute(badgeLinkListAttribute, preferred.listId);
    badge.setAttribute(badgeLinkAlbumAttribute, preferred.albumId);
    badge.setAttribute(badgeLinkMainAttribute, String(!!preferred.isMain));
    badge.setAttribute(badgeLinkYearAttribute, preferred.year || '');
    badge.setAttribute(badgeApiBaseAttribute, apiBase);
  }

  function handleBadgeClick(event, badge) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const listId = badge.getAttribute(badgeLinkListAttribute);
    const albumId = badge.getAttribute(badgeLinkAlbumAttribute);
    if (!listId || !albumId) return;

    event.preventDefault();
    chrome.runtime
      .sendMessage({
        action: ACTIONS.OPEN_ALBUM_IN_SUSHE,
        listId,
        albumId,
      })
      .catch((error) => {
        console.debug('Could not open SuShe album link:', error.message);
      });
  }

  function findBadgeForTarget(target) {
    const scope = target.variant === 'platform' ? document : target.container;
    return Array.from(scope.querySelectorAll(`[${badgeAttribute}]`)).find(
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

  function renderBadge(target, matches, options = {}) {
    if (!matches || matches.length === 0) return;

    const existingBadge = findBadgeForTarget(target);
    if (target.container.getAttribute(albumAttribute) === target.key) {
      if (existingBadge) {
        updateBadgeListNames(existingBadge, matches, target.variant, options);
        updateBadgeLink(existingBadge, matches, options);
      }
      return;
    }

    if (existingBadge && target.variant === 'platform') {
      target.container.appendChild(existingBadge);
      updateBadgeListNames(existingBadge, matches, target.variant, options);
      updateBadgeLink(existingBadge, matches, options);
      target.container.setAttribute(albumAttribute, target.key);
      return;
    }

    const badge = document.createElement(
      target.variant === 'platform' ? 'a' : 'span'
    );
    badge.className =
      target.variant === 'platform'
        ? 'sushe-presence-badge sushe-presence-badge--platform'
        : 'sushe-presence-badge';
    badge.setAttribute(badgeAttribute, 'true');
    badge.setAttribute(badgeKeyAttribute, target.key);
    badge.setAttribute(badgeVariantAttribute, target.variant);

    if (target.variant === 'platform') {
      const image = document.createElement('img');
      image.src = chrome.runtime.getURL('store-icon-128.png');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      badge.appendChild(image);
    } else {
      badge.textContent = 'In SuShe';
    }

    updateBadgeListNames(badge, matches, target.variant, options);
    updateBadgeLink(badge, matches, options);

    if (target.variant === 'platform') {
      badge.addEventListener('click', (event) =>
        handleBadgeClick(event, badge)
      );
    }

    if (target.variant === 'platform') {
      target.container.appendChild(badge);
    } else {
      target.anchor.insertAdjacentElement('afterend', badge);
    }
    target.container.setAttribute(albumAttribute, target.key);
  }

  function applyPresenceMatches(targets, matches, options = {}) {
    for (const target of targets) {
      const targetMatches = matches?.[target.key];
      if (targetMatches?.length) {
        renderBadge(target, targetMatches, {
          replaceExisting: options.replaceExisting,
          apiBase: options.apiBase,
        });
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
          replaceExisting: true,
          apiBase: response.apiBase,
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

      applyPresenceMatches(targets, response.matches, {
        apiBase: response.apiBase,
      });
      validateVisiblePresence(targets);
    } catch (error) {
      console.debug('SuShe presence lookup unavailable:', error.message);
    }
  }

  function renderAddedAlbumBadge(album, list, apiBase) {
    const key = albumIdentity.getAlbumKey(album);
    if (!key) return;

    injectBadgeStyles();

    const matches = [
      {
        albumId: album.album_id || album.albumId || '',
        listId: list.listId,
        listName: list.listName,
        year: list.year || null,
        isMain: !!list.isMain,
      },
    ];

    for (const target of collectAlbumTargets()) {
      if (target.key === key) renderBadge(target, matches, { apiBase });
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

    renderAddedAlbumBadge(message.album, message.list, message.apiBase);
    return false;
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
