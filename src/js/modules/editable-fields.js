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
 * @param {Function} deps.saveList - Save list to server
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
    saveList,
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
      albumsToUpdate[albumIndex].country = newCountry;

      // Close the dropdown immediately for better UX
      restoreDisplay(newCountry);

      try {
        await saveList(currentList, albumsToUpdate);
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
   * Make genre field editable with datalist autocomplete
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

    // Create input with datalist
    const input = document.createElement('input');
    input.type = 'text';
    input.className =
      'w-full bg-gray-800 text-gray-300 text-sm p-1 rounded-sm border border-gray-700 focus:outline-hidden focus:border-gray-500';
    input.value = currentGenre;
    input.placeholder = `Type to search ${genreField === 'genre_1' ? 'primary' : 'secondary'} genre...`;
    input.setAttribute(
      'list',
      `genre-list-${currentList}-${albumIndex}-${genreField}`
    );

    // Create datalist
    const datalist = document.createElement('datalist');
    datalist.id = `genre-list-${currentList}-${albumIndex}-${genreField}`;

    // Add all available genres
    availableGenres.forEach((genre) => {
      const option = document.createElement('option');
      option.value = genre;
      datalist.appendChild(option);
    });

    // Store the original onclick handler
    const originalOnClick = genreDiv.onclick;
    genreDiv.onclick = null; // Temporarily remove click handler

    // Replace content with input and datalist
    genreDiv.innerHTML = '';
    genreDiv.appendChild(input);
    genreDiv.appendChild(datalist);
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
      albumsToUpdate[albumIndex][genreField] = newGenre;

      // Close the dropdown immediately for better UX
      restoreDisplay(newGenre);

      try {
        await saveList(currentList, albumsToUpdate);
        showToast(newGenre === '' ? 'Genre cleared' : 'Genre updated');
      } catch (_error) {
        showToast('Error saving genre', 'error');
        // Revert on error
        albumsToUpdate[albumIndex][genreField] = currentGenre;
        restoreDisplay(currentGenre);
      }
    };

    // Handle input change (when selecting from datalist)
    input.addEventListener('change', (e) => {
      saveGenre(e.target.value);
    });

    // Handle blur (when clicking away)
    input.addEventListener('blur', () => {
      saveGenre(input.value);
    });

    // Handle keyboard
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveGenre(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        restoreDisplay(currentGenre);
      }
    });

    // Define handleClickOutside
    handleClickOutside = (e) => {
      if (!genreDiv.contains(e.target)) {
        saveGenre(input.value);
      }
    };

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
      albumsToUpdate[albumIndex].comments = newComment;
      albumsToUpdate[albumIndex].comment = newComment;

      try {
        await saveList(currentList, albumsToUpdate);

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
