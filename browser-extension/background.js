


let SUSHE_API_BASE = 'http://localhost:3000'; 
let userLists = [];
let listsLastFetched = 0;
const CACHE_DURATION = 5 * 60 * 1000; 


async function loadApiUrl() {
  const settings = await chrome.storage.local.get(['apiUrl']);
  if (settings.apiUrl) {
    SUSHE_API_BASE = settings.apiUrl;
    console.log('Loaded API URL from settings:', SUSHE_API_BASE);
  } else {
    console.log('Using default API URL:', SUSHE_API_BASE);
  }
}


chrome.runtime.onInstalled.addListener(async () => {
  console.log('SuShe Online extension installed');
  await loadApiUrl();
  createContextMenus();
});


chrome.runtime.onStartup.addListener(async () => {
  await loadApiUrl();
  createContextMenus();
});


async function createContextMenus() {
  
  await chrome.contextMenus.removeAll();

  
  chrome.contextMenus.create({
    id: 'sushe-main',
    title: 'Add to SuShe Online',
    contexts: ['image', 'link'],
    documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
  });

  
  chrome.contextMenus.create({
    id: 'sushe-loading',
    parentId: 'sushe-main',
    title: 'Loading lists...',
    contexts: ['image', 'link'],
    enabled: false,
  });

  
  fetchUserLists();
}


async function fetchUserLists() {
  const now = Date.now();

  
  if (userLists.length > 0 && now - listsLastFetched < CACHE_DURATION) {
    updateContextMenuWithLists();
    return;
  }

  try {
    const response = await fetch(`${SUSHE_API_BASE}/api/lists`, {
      credentials: 'include', 
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 401) {
      console.log('Not authenticated, showing login menu');
      userLists = [];
      listsLastFetched = 0;
      showErrorMenu('Not logged in');
      return;
    }

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const listsData = await response.json();
    userLists = Object.keys(listsData);
    listsLastFetched = now;

    
    await chrome.storage.local.set({ userLists, listsLastFetched });

    updateContextMenuWithLists();
  } catch (error) {
    console.error('Failed to fetch lists:', error);
    
    userLists = [];
    showErrorMenu(error.message);
  }
}


async function updateContextMenuWithLists() {
  console.log('Updating context menu with lists:', userLists);

  
  await chrome.contextMenus.removeAll();

  
  chrome.contextMenus.create({
    id: 'sushe-main',
    title: 'Add to SuShe Online',
    contexts: ['image', 'link'],
    documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
  });

  if (userLists.length === 0) {
    chrome.contextMenus.create({
      id: 'sushe-no-lists',
      parentId: 'sushe-main',
      title: 'No lists found - Create one first!',
      contexts: ['image', 'link'],
      enabled: false,
    });
    return;
  }

  
  userLists.forEach((listName, index) => {
    console.log(
      `Creating menu item: sushe-list-${index} for list "${listName}"`
    );
    
    chrome.contextMenus.create({
      id: `sushe-list-${index}`,
      parentId: 'sushe-main',
      title: listName,
      contexts: ['image', 'link'],
    });
  });

  
  chrome.contextMenus.create({
    id: 'sushe-separator',
    parentId: 'sushe-main',
    type: 'separator',
    contexts: ['image', 'link'],
  });

  chrome.contextMenus.create({
    id: 'sushe-refresh',
    parentId: 'sushe-main',
    title: '🔄 Refresh Lists',
    contexts: ['image', 'link'],
  });

  console.log('Context menu updated successfully');
}


async function showErrorMenu(message) {
  console.log('Showing error menu:', message);

  
  await chrome.contextMenus.removeAll();

  
  chrome.contextMenus.create({
    id: 'sushe-main',
    title: 'Add to SuShe Online',
    contexts: ['image', 'link'],
    documentUrlPatterns: ['*://*.rateyourmusic.com/*'],
  });

  chrome.contextMenus.create({
    id: 'sushe-error',
    parentId: 'sushe-main',
    title: '⚠️ Not logged in to SuShe Online',
    contexts: ['image', 'link'],
    enabled: false,
  });

  chrome.contextMenus.create({
    id: 'sushe-login',
    parentId: 'sushe-main',
    title: 'Click to login',
    contexts: ['image', 'link'],
  });
}


chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);

  
  if (info.menuItemId === 'sushe-refresh') {
    console.log('Refreshing lists...');
    listsLastFetched = 0; 
    userLists = []; 
    await fetchUserLists();
    return;
  }

  
  if (info.menuItemId === 'sushe-login') {
    
    const settings = await chrome.storage.local.get(['apiUrl']);
    const apiUrl = settings.apiUrl || SUSHE_API_BASE;
    chrome.tabs.create({ url: `${apiUrl}/login` });
    return;
  }

  
  if (info.menuItemId.startsWith('sushe-list-')) {
    const listIndex = parseInt(info.menuItemId.replace('sushe-list-', ''));
    console.log(
      `Menu item clicked: ${info.menuItemId}, extracted index: ${listIndex}`
    );
    console.log('Available lists:', userLists);
    console.log(
      `Looking up index ${listIndex} in array of length ${userLists.length}`
    );

    const listName = userLists[listIndex];
    console.log(`List name for index ${listIndex}: "${listName}"`);

    if (listName && typeof listName === 'string') {
      await addAlbumToList(info, tab, listName);
    } else {
      console.error('List not found for index:', listIndex);
      console.error('userLists array:', JSON.stringify(userLists));
      showNotification('✗ Error', 'List not found. Try refreshing lists.');
    }
  }
});


async function addAlbumToList(info, tab, listName) {
  console.log('Adding album to list:', listName);
  console.log('Context info:', info);
  console.log('Using API base:', SUSHE_API_BASE);

  try {
    
    console.log('Sending message to content script...');
    let albumData;

    try {
      albumData = await chrome.tabs.sendMessage(tab.id, {
        action: 'extractAlbumData',
        srcUrl: info.srcUrl,
        linkUrl: info.linkUrl,
        pageUrl: info.pageUrl,
      });
    } catch (err) {
      console.error('Content script communication error:', err);
      
      console.log('Attempting to inject content script...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        });
        
        await new Promise((resolve) => setTimeout(resolve, 100));
        
        albumData = await chrome.tabs.sendMessage(tab.id, {
          action: 'extractAlbumData',
          srcUrl: info.srcUrl,
          linkUrl: info.linkUrl,
          pageUrl: info.pageUrl,
        });
      } catch (injectErr) {
        console.error('Failed to inject content script:', injectErr);
        throw new Error(
          'Could not communicate with page. Try refreshing RateYourMusic.'
        );
      }
    }

    if (!albumData || albumData.error) {
      console.error('Content script returned error:', albumData?.error);
      throw new Error(albumData?.error || 'Content script error');
    }

    if (!albumData.artist || !albumData.album) {
      console.error('Invalid album data received:', albumData);
      throw new Error('Could not extract album information from page');
    }

    console.log('Extracted album data:', albumData);

    
    showNotification(
      'Adding album...',
      `Adding ${albumData.album} by ${albumData.artist} to ${listName}`
    );

    
    console.log('Searching MusicBrainz for album...');

    const searchQuery = `${albumData.artist} ${albumData.album}`;
    const mbEndpoint = `release-group/?query=${encodeURIComponent(searchQuery)}&type=album|ep&fmt=json&limit=5`;

    const mbResponse = await fetch(
      `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(mbEndpoint)}&priority=high`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      }
    );

    if (!mbResponse.ok) {
      throw new Error('Failed to search MusicBrainz');
    }

    const mbData = await mbResponse.json();
    const releaseGroups = mbData['release-groups'] || [];

    if (releaseGroups.length === 0) {
      throw new Error(
        'Album not found in MusicBrainz. Try adding manually in SuShe Online.'
      );
    }

    
    const releaseGroup = releaseGroups[0];
    console.log('Found release group:', releaseGroup);

    
    console.log('Fetching cover art from Deezer...');

    const deezerQuery = `${albumData.artist} ${albumData.album}`
      .replace(/[^\w\s]/g, ' ')
      .trim();
    const deezerResponse = await fetch(
      `${SUSHE_API_BASE}/api/proxy/deezer?q=${encodeURIComponent(deezerQuery)}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      }
    );

    let coverImageData = '';
    let coverImageFormat = '';

    if (deezerResponse.ok) {
      const deezerData = await deezerResponse.json();
      if (deezerData.data && deezerData.data.length > 0) {
        const coverUrl =
          deezerData.data[0].cover_xl || deezerData.data[0].cover_big;
        if (coverUrl) {
          console.log('Found cover art, processing through proxy...');
          try {
            const proxyUrl = `${SUSHE_API_BASE}/api/proxy/image?url=${encodeURIComponent(coverUrl)}`;
            const imageResponse = await fetch(proxyUrl, {
              credentials: 'include',
              headers: {
                Accept: 'application/json',
              },
            });

            if (imageResponse.ok) {
              const imageData = await imageResponse.json();
              if (imageData.data && imageData.contentType) {
                coverImageData = imageData.data;
                coverImageFormat = imageData.contentType
                  .split('/')[1]
                  .toUpperCase();
                console.log('Cover image processed successfully');
              }
            }
          } catch (error) {
            console.warn('Error processing cover image:', error);
          }
        }
      }
    }

    
    console.log(
      `Fetching current list: ${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`
    );
    const listResponse = await fetch(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`,
      {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      }
    );

    console.log('Fetch response status:', listResponse.status);

    let currentList = [];
    if (listResponse.ok) {
      currentList = await listResponse.json();
      console.log('Current list has', currentList.length, 'albums');
    } else if (listResponse.status === 401) {
      throw new Error('Not logged in to SuShe Online. Please login first.');
    } else if (listResponse.status === 404) {
      console.log('List not found, will create new one');
      
    } else {
      throw new Error(`API returned status ${listResponse.status}`);
    }

    
    const isDuplicate = currentList.some(
      (item) =>
        item.artist === albumData.artist && item.album === albumData.album
    );

    if (isDuplicate) {
      showNotification(
        'ℹ Already in list',
        `${albumData.album} is already in ${listName}`
      );
      return;
    }

    
    let artistCountry = '';
    if (
      releaseGroup['artist-credit'] &&
      releaseGroup['artist-credit'].length > 0
    ) {
      const artistId = releaseGroup['artist-credit'][0].artist.id;
      try {
        const artistEndpoint = `artist/${artistId}?fmt=json`;
        const artistResponse = await fetch(
          `${SUSHE_API_BASE}/api/proxy/musicbrainz?endpoint=${encodeURIComponent(artistEndpoint)}&priority=normal`,
          {
            credentials: 'include',
            headers: {
              Accept: 'application/json',
            },
          }
        );

        if (artistResponse.ok) {
          const artistData = await artistResponse.json();
          if (artistData.country && artistData.country.length === 2) {
            
            artistCountry = await resolveCountryCode(artistData.country);
            console.log(
              `Resolved country code ${artistData.country} to: ${artistCountry}`
            );
          } else if (artistData.country) {
            
            artistCountry = artistData.country;
          }
        }
      } catch (error) {
        console.warn('Could not fetch artist country:', error);
      }
    }

    
    currentList.push({
      artist: albumData.artist,
      album: albumData.album,
      album_id: releaseGroup.id || '',
      release_date: releaseGroup['first-release-date'] || '',
      country: artistCountry,
      genre_1: '',
      genre_2: '',
      comments: '',
      tracks: null,
      track_pick: null,
      cover_image: coverImageData,
      cover_image_format: coverImageFormat,
    });

    
    console.log('Saving list with', currentList.length, 'albums');
    const saveResponse = await fetch(
      `${SUSHE_API_BASE}/api/lists/${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ data: currentList }),
      }
    );

    console.log('Save response status:', saveResponse.status);

    if (!saveResponse.ok) {
      const errorText = await saveResponse.text();
      console.error('Save failed:', errorText);
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        throw new Error(`Failed to save album (HTTP ${saveResponse.status})`);
      }
      throw new Error(errorData.error || 'Failed to save album');
    }

    
    const albumCoverUrl = coverImageData
      ? `data:image/${coverImageFormat.toLowerCase()};base64,${coverImageData}`
      : 'icons/icon128.png';

    showNotificationWithImage(
      '✓ Successfully added',
      `${albumData.album} added to ${listName}`,
      albumCoverUrl
    );
  } catch (error) {
    console.error('Error adding album:', error);
    showNotification('✗ Error', error.message || 'Failed to add album to list');
  }
}


function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
  });
}


function showNotificationWithImage(title, message, imageUrl) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: imageUrl,
    title: title,
    message: message,
  });
}


async function resolveCountryCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    console.debug(`Invalid country code: ${countryCode}`);
    return '';
  }

  try {
    
    const response = await fetch(
      `https://restcountries.com/v3.1/alpha/${countryCode}`
    );

    if (!response.ok) {
      console.warn(
        `Country code ${countryCode} not found in RestCountries API`
      );
      return '';
    }

    const data = await response.json();
    if (!data || !data[0]) {
      console.warn(`Empty data from RestCountries API for ${countryCode}`);
      return '';
    }

    const countryData = data[0];

    
    let countryName = countryData.name.common;

    
    if (countryCode === 'US') {
      countryName = 'United States';
    } else if (countryCode === 'GB') {
      countryName = 'United Kingdom';
    } else if (countryCode === 'KR') {
      countryName = 'Korea, South';
    } else if (countryCode === 'KP') {
      countryName = 'Korea, North';
    }

    console.debug(`Resolved ${countryCode} to ${countryName}`);
    return countryName;
  } catch (error) {
    console.error(`Error resolving country code ${countryCode}:`, error);
    return '';
  }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshLists') {
    listsLastFetched = 0;
    fetchUserLists().then(() => {
      sendResponse({ success: true });
    });
    return true; 
  }

  if (message.action === 'updateApiUrl') {
    SUSHE_API_BASE = message.apiUrl;
    console.log('API URL updated to:', SUSHE_API_BASE);
    listsLastFetched = 0; 
    createContextMenus();
    return true;
  }

  if (message.action === 'getApiUrl') {
    sendResponse({ apiUrl: SUSHE_API_BASE });
    return true;
  }
});
