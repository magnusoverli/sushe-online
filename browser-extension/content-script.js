


console.log('SuShe Online content script loaded on RateYourMusic');


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);

  if (message.action === 'extractAlbumData') {
    try {
      console.log('Extracting album data from page...');

      const albumData = extractAlbumDataFromPage(message);
      console.log('Extracted album data:', albumData);

      
      sendResponse(albumData);
    } catch (error) {
      console.error('Error in content script:', error);
      sendResponse({ error: error.message });
    }
    return true; 
  }

  
  return false;
});


function extractAlbumDataFromPage(context) {
  const data = {
    artist: '',
    album: '',
  };

  
  if (context.linkUrl || context.pageUrl) {
    const url = context.linkUrl || context.pageUrl;
    const match = url.match(/\/release\/[^/]+\/([^/]+)\/([^/]+)/);

    if (match) {
      
      
      data.artist = decodeURIComponent(match[1].replace(/[-_]/g, ' '));
      data.album = decodeURIComponent(match[2].replace(/[-_]/g, ' '));

      
      data.artist = cleanName(data.artist);
      data.album = cleanName(data.album);
    }
  }

  
  if (!data.artist || !data.album) {
    
    const pageTitle = document.title;
    const match = pageTitle.match(/^(.+?)\s+by\s+(.+?)(?:\s+\||$)/i);

    if (match) {
      data.album = match[1].trim();
      data.artist = match[2].trim();
    }
  }

  return data;
}


function cleanName(name) {
  
  try {
    name = decodeURIComponent(name);
  } catch (_e) {
    
    console.warn('Could not decode name:', name);
  }

  
  name = name.replace(/\s+\d+$/, '');

  
  if (typeof name.normalize === 'function') {
    name = name.normalize('NFC');
  }

  
  
  const isAllLowercase = name === name.toLowerCase();
  const isAllUppercase = name === name.toUpperCase();

  if (isAllLowercase || isAllUppercase) {
    
    name = name
      .split(' ')
      .map((word) => {
        if (!word) return word;
        
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }
  

  return name;
}
