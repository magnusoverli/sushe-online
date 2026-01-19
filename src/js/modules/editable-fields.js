/**
 * Editable Fields Module
 *
 * Handles inline editing of album fields (country, genre, comments) with
 * datalist autocomplete and validation. Uses dependency injection for testability.
 *
 * @module editable-fields
 */

/**
 * Factory function to create the editable fields module with injected dependencies
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getListData - Get album array for a list
 * @param {Function} deps.getCurrentList - Get current list name
 * @param {Function} deps.apiCall - Make API calls
 * @param {Function} deps.showToast - Show toast notification
 * @param {Function} deps.getAvailableCountries - Get available countries list
 * @param {Function} deps.getAvailableGenres - Get available genres list
 * @param {Function} deps.isTextTruncated - Check if text element is truncated
 * @returns {Object} Editable fields module API
 */
export function createEditableFields(deps = {}) {
  const {
    getListData,
    getCurrentList,
    apiCall,
    showToast,
    getAvailableCountries,
    getAvailableGenres,
    isTextTruncated,
  } = deps;

  /**
   * Make country field editable with datalist autocomplete
   * @param {HTMLElement} countryDiv - Country container element
   * @param {number} albumIndex - Album index in list
   */
  function makeCountryEditable(countryDiv, albumIndex) {
    const currentList = getCurrentList();
    const availableCountries = getAvailableCountries();

    // Check if we're already editing
    if (countryDiv.querySelector('input')) {
      return;
    }

    // Get current country from the live data
    const albums = getListData(currentList);
    if (!albums || !albums[albumIndex]) return;
    const currentCountry = albums[albumIndex].country || '';

    // Create input with datalist
    const input = document.createElement('input');
    input.type = 'text';
    input.className =
      'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded-sm border border-gray-700 focus:outline-hidden focus:border-gray-500';
    input.value = currentCountry;
    input.placeholder = 'Type to search countries...';
    input.setAttribute('list', `country-list-${currentList}-${albumIndex}`);

    // Create datalist
    const datalist = document.createElement('datalist');
    datalist.id = `country-list-${currentList}-${albumIndex}`;

    // Add all available countries
    availableCountries.forEach((country) => {
      const option = document.createElement('option');
      option.value = country;
      datalist.appendChild(option);
    });

    // Store the original onclick handler
    const originalOnClick = countryDiv.onclick;
    countryDiv.onclick = null; // Temporarily remove click handler

    // Replace content with input and datalist
    countryDiv.innerHTML = '';
    countryDiv.appendChild(input);
    countryDiv.appendChild(datalist);
    input.focus();
    input.select();

    // Create handleClickOutside function so we can reference it for removal
    let handleClickOutside;

    const restoreDisplay = (valueToDisplay) => {
      // Remove the click outside listener if it exists
      if (handleClickOutside) {
        document.removeEventListener('click', handleClickOutside);
        handleClickOutside = null;
      }

      // Show placeholder if empty
      const displayValue = valueToDisplay || 'Country';
      const displayClass = valueToDisplay
        ? 'text-gray-300'
        : 'text-gray-500 italic';

      countryDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

      // Restore the original click handler
      countryDiv.onclick = originalOnClick;
    };

    const saveCountry = async (newCountry) => {
      // Trim the input
      newCountry = newCountry.trim();

      // Check if value actually changed
      if (newCountry === currentCountry) {
        restoreDisplay(currentCountry);
        return;
      }

      // VALIDATION: Only allow empty string or values from availableCountries
      if (newCountry !== '') {
        const isValid = availableCountries.some(
          (country) => country.toLowerCase() === newCountry.toLowerCase()
        );

        if (!isValid) {
          // Invalid country entered - revert to original
          restoreDisplay(currentCountry);
          return;
        }

        // Find the exact case-matched country from the list
        const matchedCountry = availableCountries.find(
          (country) => country.toLowerCase() === newCountry.toLowerCase()
        );
        newCountry = matchedCountry; // Use the properly cased version
      }

      // Update the data
      const albumsToUpdate = getListData(currentList);
      if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;

      // Get album_id for canonical update
      const album = albumsToUpdate[albumIndex];
      const albumId = album.album_id || album.albumId;

      if (!albumId) {
        showToast('Cannot update - album not linked', 'error');
        restoreDisplay(currentCountry);
        return;
      }

      // Close the dropdown immediately for better UX
      restoreDisplay(newCountry);

      try {
        // Use lightweight endpoint to update canonical country
        await apiCall(`/api/albums/${encodeURIComponent(albumId)}/country`, {
          method: 'PATCH',
          body: JSON.stringify({ country: newCountry || null }),
        });

        // Update local state
        albumsToUpdate[albumIndex].country = newCountry;

        showToast(newCountry === '' ? 'Country cleared' : 'Country updated');
      } catch (_error) {
        showToast('Error saving country', 'error');
        // Revert on error
        albumsToUpdate[albumIndex].country = currentCountry;
        restoreDisplay(currentCountry);
      }
    };

    // Handle input change (when selecting from datalist)
    input.addEventListener('change', (e) => {
      saveCountry(e.target.value);
    });

    // Handle blur (when clicking away)
    input.addEventListener('blur', () => {
      saveCountry(input.value);
    });

    // Handle keyboard
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveCountry(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        restoreDisplay(currentCountry);
      }
    });

    // Define handleClickOutside
    handleClickOutside = (e) => {
      if (!countryDiv.contains(e.target)) {
        saveCountry(input.value);
      }
    };

    // Small delay to prevent immediate trigger
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
  }

  /**
   * Make genre field editable with searchable dropdown
   * Features: search/filter with highlight, matches float to top, non-matches dimmed but visible
   * @param {HTMLElement} genreDiv - Genre container element
   * @param {number} albumIndex - Album index in list
   * @param {string} genreField - Field name ('genre_1' or 'genre_2')
   */
  function makeGenreEditable(genreDiv, albumIndex, genreField) {
    const currentList = getCurrentList();
    const availableGenres = getAvailableGenres();

    // Check if we're already editing
    if (genreDiv.querySelector('input')) {
      return;
    }

    // Get current genre from the live data
    const albumsForGenre = getListData(currentList);
    if (!albumsForGenre || !albumsForGenre[albumIndex]) return;
    const currentGenre = albumsForGenre[albumIndex][genreField] || '';

    // Track highlighted index for keyboard navigation
    let highlightedIndex = -1;
    let isDropdownOpen = false;

    // Create container for input + dropdown
    const container = document.createElement('div');
    container.className = 'relative';
    container.style.zIndex = '1000';

    // Create input
    const input = document.createElement('input');
    input.type = 'text';
    input.className =
      'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded-sm border border-gray-700 focus:outline-hidden focus:border-gray-500';
    input.value = currentGenre;
    input.placeholder = `Search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
    input.autocomplete = 'off';

    // Create dropdown list
    const dropdown = document.createElement('div');
    dropdown.className =
      'absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-sm shadow-lg max-h-48 overflow-y-auto';
    dropdown.style.display = 'none';
    dropdown.style.zIndex = '1001';

    // Store the original onclick handler
    const originalOnClick = genreDiv.onclick;
    genreDiv.onclick = null; // Temporarily remove click handler

    // Create handleClickOutside function so we can reference it for removal
    let handleClickOutside;

    const restoreDisplay = (valueToDisplay) => {
      // Remove the click outside listener if it exists
      if (handleClickOutside) {
        document.removeEventListener('click', handleClickOutside);
        handleClickOutside = null;
      }

      // Determine what to display based on value and field
      let displayValue = valueToDisplay;
      let displayClass;

      if (genreField === 'genre_1') {
        // For Genre 1: show placeholder if empty
        displayValue = valueToDisplay || 'Genre 1';
        displayClass = valueToDisplay
          ? 'text-gray-300'
          : 'text-gray-500 italic';
      } else {
        // For Genre 2: show placeholder if empty, but treat 'Genre 2' and '-' as empty
        if (
          !valueToDisplay ||
          valueToDisplay === 'Genre 2' ||
          valueToDisplay === '-'
        ) {
          displayValue = 'Genre 2';
          displayClass = 'text-gray-500 italic';
        } else {
          displayValue = valueToDisplay;
          displayClass = 'text-gray-400';
        }
      }

      genreDiv.innerHTML = `<span class="text-sm ${displayClass} truncate cursor-pointer hover:text-gray-100">${displayValue}</span>`;

      // Restore the original click handler
      genreDiv.onclick = originalOnClick;
    };

    const saveGenre = async (newGenre) => {
      // Trim the input
      newGenre = newGenre.trim();

      // Check if value actually changed
      if (newGenre === currentGenre) {
        restoreDisplay(currentGenre);
        return;
      }

      // VALIDATION: Only allow empty string or values from availableGenres
      if (newGenre !== '') {
        const isValid = availableGenres.some(
          (genre) => genre.toLowerCase() === newGenre.toLowerCase()
        );

        if (!isValid) {
          // Invalid genre entered - revert to original
          restoreDisplay(currentGenre);
          return;
        }

        // Find the exact case-matched genre from the list
        const matchedGenre = availableGenres.find(
          (genre) => genre.toLowerCase() === newGenre.toLowerCase()
        );
        newGenre = matchedGenre; // Use the properly cased version
      }

      // Update the data
      const albumsToUpdate = getListData(currentList);
      if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;

      // Get album_id for canonical update
      const album = albumsToUpdate[albumIndex];
      const albumId = album.album_id || album.albumId;

      if (!albumId) {
        showToast('Cannot update - album not linked', 'error');
        restoreDisplay(currentGenre);
        return;
      }

      // Close the dropdown immediately for better UX
      restoreDisplay(newGenre);

      try {
        // Use lightweight endpoint to update canonical genre
        // Build request body with only the field being updated
        const body = {};
        body[genreField] = newGenre || null;

        await apiCall(`/api/albums/${encodeURIComponent(albumId)}/genres`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });

        // Update local state
        albumsToUpdate[albumIndex][genreField] = newGenre;

        showToast(newGenre === '' ? 'Genre cleared' : 'Genre updated');
      } catch (_error) {
        showToast('Error saving genre', 'error');
        // Revert on error
        albumsToUpdate[albumIndex][genreField] = currentGenre;
        restoreDisplay(currentGenre);
      }
    };

    /**
     * Render the dropdown with filtered/sorted options
     * Matches appear at top (highlighted), non-matches below (dimmed)
     */
    const renderDropdown = (searchTerm) => {
      const term = searchTerm.toLowerCase().trim();
      dropdown.innerHTML = '';

      // Add "Clear" option at top if there's a current value
      if (currentGenre || input.value) {
        const clearOption = document.createElement('div');
        clearOption.className =
          'px-2 py-1.5 text-sm cursor-pointer text-gray-500 hover:bg-gray-700 hover:text-gray-300 border-b border-gray-700 italic';
        clearOption.textContent = 'Clear selection';
        clearOption.dataset.value = '';
        clearOption.dataset.index = '0';
        dropdown.appendChild(clearOption);
      }

      // Separate matches and non-matches
      const matches = [];
      const nonMatches = [];

      availableGenres.forEach((genre) => {
        const lowerGenre = genre.toLowerCase();
        if (term === '' || lowerGenre.includes(term)) {
          matches.push({ genre, isMatch: true });
        } else {
          nonMatches.push({ genre, isMatch: false });
        }
      });

      // Sort matches: exact matches first, then starts-with, then contains
      if (term) {
        matches.sort((a, b) => {
          const aLower = a.genre.toLowerCase();
          const bLower = b.genre.toLowerCase();
          const aExact = aLower === term;
          const bExact = bLower === term;
          const aStarts = aLower.startsWith(term);
          const bStarts = bLower.startsWith(term);

          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.genre.localeCompare(b.genre);
        });
      }

      // Combine: matches first, then non-matches
      const allOptions = [...matches, ...nonMatches];

      // Add separator if we have both matches and non-matches
      let separatorAdded = false;
      const clearOptionOffset = currentGenre || input.value ? 1 : 0;

      allOptions.forEach((item, idx) => {
        // Add separator between matches and non-matches
        if (!separatorAdded && !item.isMatch && matches.length > 0 && term) {
          const separator = document.createElement('div');
          separator.className =
            'px-2 py-1 text-xs text-gray-600 bg-gray-900 border-t border-gray-700';
          separator.textContent = 'Other genres';
          dropdown.appendChild(separator);
          separatorAdded = true;
        }

        const option = document.createElement('div');
        option.dataset.value = item.genre;
        option.dataset.index = String(idx + clearOptionOffset);

        // Highlight matching text in the genre name
        let displayText = item.genre;
        if (term && item.isMatch) {
          const matchIndex = item.genre.toLowerCase().indexOf(term);
          if (matchIndex !== -1) {
            const before = item.genre.slice(0, matchIndex);
            const match = item.genre.slice(
              matchIndex,
              matchIndex + term.length
            );
            const after = item.genre.slice(matchIndex + term.length);
            displayText = `${before}<span class="text-green-400 font-medium">${match}</span>${after}`;
          }
        }

        // Style based on match status
        if (item.isMatch) {
          option.className =
            'px-2 py-1.5 text-sm cursor-pointer text-gray-300 hover:bg-gray-700';
        } else {
          option.className =
            'px-2 py-1.5 text-sm cursor-pointer text-gray-600 hover:bg-gray-700 hover:text-gray-400';
        }

        // Mark current selection
        if (item.genre === currentGenre) {
          option.className += ' bg-gray-700/50';
          displayText += ' <span class="text-green-500 text-xs ml-1">●</span>';
        }

        option.innerHTML = displayText;
        dropdown.appendChild(option);
      });

      // Reset highlight
      highlightedIndex = -1;
      updateHighlight();
    };

    /**
     * Update visual highlight for keyboard navigation
     */
    const updateHighlight = () => {
      const options = dropdown.querySelectorAll('[data-value]');
      options.forEach((opt, idx) => {
        if (idx === highlightedIndex) {
          opt.classList.add('bg-gray-600');
          opt.scrollIntoView({ block: 'nearest' });
        } else {
          opt.classList.remove('bg-gray-600');
        }
      });
    };

    /**
     * Get total number of selectable options
     */
    const getOptionCount = () => {
      return dropdown.querySelectorAll('[data-value]').length;
    };

    /**
     * Get value at highlighted index
     */
    const getHighlightedValue = () => {
      const options = dropdown.querySelectorAll('[data-value]');
      if (highlightedIndex >= 0 && highlightedIndex < options.length) {
        return options[highlightedIndex].dataset.value;
      }
      return null;
    };

    const showDropdown = () => {
      if (!isDropdownOpen) {
        dropdown.style.display = 'block';
        isDropdownOpen = true;
        renderDropdown(input.value);
      }
    };

    const hideDropdown = () => {
      dropdown.style.display = 'none';
      isDropdownOpen = false;
      highlightedIndex = -1;
    };

    // Event: Input changes - filter dropdown
    input.addEventListener('input', () => {
      showDropdown();
      renderDropdown(input.value);
    });

    // Event: Focus - show dropdown
    input.addEventListener('focus', () => {
      showDropdown();
    });

    // Event: Click on dropdown option
    dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('[data-value]');
      if (option) {
        e.stopPropagation(); // Prevent event from bubbling to document
        const value = option.dataset.value;
        input.value = value;
        hideDropdown(); // Close dropdown immediately on selection
        // saveGenre will call restoreDisplay() which replaces the entire content
        saveGenre(value);
      }
    });

    // Event: Keyboard navigation
    input.addEventListener('keydown', (e) => {
      const optionCount = getOptionCount();

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isDropdownOpen) {
          showDropdown();
        } else {
          highlightedIndex = Math.min(highlightedIndex + 1, optionCount - 1);
          updateHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (isDropdownOpen) {
          highlightedIndex = Math.max(highlightedIndex - 1, 0);
          updateHighlight();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isDropdownOpen && highlightedIndex >= 0) {
          const value = getHighlightedValue();
          if (value !== null) {
            input.value = value;
            hideDropdown(); // Close dropdown immediately on selection
            // saveGenre will call restoreDisplay() which replaces the entire content
            saveGenre(value);
          }
        } else {
          // Save current input value
          hideDropdown(); // Close dropdown before saving
          saveGenre(input.value);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isDropdownOpen) {
          hideDropdown();
        } else {
          restoreDisplay(currentGenre);
        }
      } else if (e.key === 'Tab') {
        // Allow tab to save and move focus
        hideDropdown();
        saveGenre(input.value);
      }
    });

    // Define handleClickOutside
    handleClickOutside = (e) => {
      if (!container.contains(e.target)) {
        hideDropdown();
        saveGenre(input.value);
      }
    };

    // Assemble and render
    container.appendChild(input);
    container.appendChild(dropdown);
    genreDiv.innerHTML = '';
    genreDiv.appendChild(container);
    input.focus();
    input.select();

    // Small delay to prevent immediate trigger
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);
  }

  /**
   * Make comment field editable with textarea
   * @param {HTMLElement} commentDiv - Comment container element
   * @param {number} albumIndex - Album index in list
   */
  function makeCommentEditable(commentDiv, albumIndex) {
    const currentList = getCurrentList();
    const albumsForComment = getListData(currentList);
    if (!albumsForComment || !albumsForComment[albumIndex]) return;

    const currentComment =
      albumsForComment[albumIndex].comments ||
      albumsForComment[albumIndex].comment ||
      '';

    // Create textarea
    const textarea = document.createElement('textarea');
    textarea.className =
      'w-full bg-gray-800 text-gray-300 text-sm p-2 rounded-sm border border-gray-700 focus:outline-hidden focus:border-gray-500 resize-none';
    textarea.value = currentComment;
    textarea.rows = 2;

    // Replace div content with textarea
    commentDiv.innerHTML = '';
    commentDiv.appendChild(textarea);
    textarea.focus();
    textarea.select();

    // Save on blur or enter
    const saveComment = async () => {
      const albumsToUpdate = getListData(currentList);
      if (!albumsToUpdate || !albumsToUpdate[albumIndex]) return;

      const newComment = textarea.value.trim();
      const album = albumsToUpdate[albumIndex];

      // Get identifier (prefer album_id, fallback to _id for legacy albums)
      const identifier = album.album_id || album.albumId || album._id;

      if (!identifier) {
        showToast('Cannot update - album not identified', 'error');
        return;
      }

      try {
        // Use lightweight endpoint to update comment
        await apiCall(
          `/api/lists/${encodeURIComponent(currentList)}/items/${encodeURIComponent(identifier)}/comment`,
          {
            method: 'PATCH',
            body: JSON.stringify({ comment: newComment || null }),
          }
        );

        // Update local state
        albumsToUpdate[albumIndex].comments = newComment;
        albumsToUpdate[albumIndex].comment = newComment;

        // Update display without re-rendering everything
        let displayComment = newComment;
        let displayClass = 'text-gray-300';

        // If comment is empty, show placeholder with almost invisible styling
        if (!displayComment) {
          displayComment = 'Comment';
          displayClass = 'text-gray-800 italic';
        }

        commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;

        // Re-add click handler
        commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

        // Add tooltip only if comment is truncated
        const commentTextEl = commentDiv.querySelector('.comment-text');
        if (commentTextEl && newComment) {
          setTimeout(() => {
            if (isTextTruncated(commentTextEl)) {
              commentTextEl.setAttribute('data-comment', newComment);
            }
          }, 0);
        }

        if (newComment !== currentComment) {
          showToast('Comment updated');
        }
      } catch (_error) {
        showToast('Error saving comment', 'error');
        // Revert on error - also handle placeholder for empty comments
        let revertDisplay = currentComment;
        let revertClass = 'text-gray-300';
        if (!revertDisplay) {
          revertDisplay = 'Comment';
          revertClass = 'text-gray-500';
        }
        commentDiv.innerHTML = `<span class="text-sm ${revertClass} italic line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${revertDisplay}</span>`;
        commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

        // Add tooltip only if comment is truncated
        const revertTextEl = commentDiv.querySelector('.comment-text');
        if (revertTextEl && currentComment) {
          setTimeout(() => {
            if (isTextTruncated(revertTextEl)) {
              revertTextEl.setAttribute('data-comment', currentComment);
            }
          }, 0);
        }
      }
    };

    textarea.addEventListener('blur', saveComment);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        textarea.blur();
      }
      if (e.key === 'Escape') {
        // Cancel editing
        let displayComment = currentComment;
        let displayClass = 'text-gray-300';

        // If comment is empty, show placeholder
        if (!displayComment) {
          displayComment = 'Comment';
          displayClass = 'text-gray-500';
        }

        commentDiv.innerHTML = `<span class="text-sm ${displayClass} line-clamp-2 cursor-pointer hover:text-gray-100 comment-text">${displayComment}</span>`;
        commentDiv.onclick = () => makeCommentEditable(commentDiv, albumIndex);

        // Add tooltip only if comment is truncated
        const cancelTextEl = commentDiv.querySelector('.comment-text');
        if (cancelTextEl && currentComment) {
          setTimeout(() => {
            if (isTextTruncated(cancelTextEl)) {
              cancelTextEl.setAttribute('data-comment', currentComment);
            }
          }, 0);
        }
      }
    });
  }

  // Return public API
  return {
    makeCountryEditable,
    makeGenreEditable,
    makeCommentEditable,
  };
}
