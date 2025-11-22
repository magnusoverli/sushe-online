import { showToast } from './utils.js';

export async function downloadListAsJSON(listName) {
  try {
    // Fetch list with embedded base64 images from server
    showToast('Preparing export with images...', 'info', 2000);

    const response = await fetch(
      `/api/lists/${encodeURIComponent(listName)}?export=true`,
      { credentials: 'include' }
    );

    if (!response.ok) {
      if (response.status === 404) {
        showToast('List not found', 'error');
        return;
      }
      throw new Error(`Failed to fetch list: ${response.status}`);
    }

    // Server returns data with rank, points, and cover_image already included
    const exportData = await response.json();

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${listName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    try {
      await navigator.clipboard.writeText(jsonStr);
      if (navigator.share) {
        await navigator.share({
          title: `Album List: ${listName}`,
          text: `Album list export: ${listName}`,
          files: [
            new File([blob], `${listName}.json`, {
              type: 'application/json',
            }),
          ],
        });
      }
    } catch (shareErr) {
      console.log('Share not available or cancelled', shareErr);
    }

    showToast('List exported successfully!', 'success');
  } catch (error) {
    console.error('Export error:', error);
    showToast('Error exporting list', 'error');
  }
}
