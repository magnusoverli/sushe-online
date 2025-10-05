import { showToast, apiCall } from './utils.js';

function getPointsForPosition(position) {
  const POSITION_POINTS = {
    1: 60,
    2: 54,
    3: 50,
    4: 46,
    5: 43,
    6: 40,
    7: 38,
    8: 36,
    9: 34,
    10: 32,
    11: 30,
    12: 29,
    13: 28,
    14: 27,
    15: 26,
    16: 25,
    17: 24,
    18: 23,
    19: 22,
    20: 21,
    21: 20,
    22: 19,
    23: 18,
    24: 17,
    25: 16,
    26: 15,
    27: 14,
    28: 13,
    29: 12,
    30: 11,
    31: 10,
    32: 9,
    33: 8,
    34: 7,
    35: 6,
    36: 5,
    37: 4,
    38: 3,
    39: 2,
    40: 1,
  };
  return POSITION_POINTS[position] || 1;
}

export async function downloadListAsJSON(listName, lists) {
  const listData = lists[listName];
  if (!listData) {
    showToast('List not found', 'error');
    return;
  }

  try {
    const exportData = listData.map((album, index) => {
      const exported = { ...album };
      exported.rank = index + 1;
      exported.points = getPointsForPosition(index + 1);
      return exported;
    });

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

export function initializeImportHandler(onImport) {
  const importInput = document.getElementById('importInput');
  const importBtn = document.getElementById('importBtn');

  if (!importInput || !importBtn) return;

  importBtn.addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data)) {
        throw new Error('Invalid format: expected an array of albums');
      }

      if (onImport) {
        await onImport(data, file.name);
      }

      importInput.value = '';
    } catch (error) {
      console.error('Import error:', error);
      showToast('Error importing file: ' + error.message, 'error');
      importInput.value = '';
    }
  });
}
