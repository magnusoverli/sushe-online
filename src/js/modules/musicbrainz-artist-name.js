export function hasNonLatinCharacters(str) {
  if (!str) return false;

  const alphaChars = str.match(/\p{L}/gu) || [];
  const nonLatinChars = str.match(/[^\u0020-\u024F\u1E00-\u1EFF]/gu) || [];
  return (
    alphaChars.length > 0 && nonLatinChars.length / alphaChars.length > 0.5
  );
}

export function extractLatinName(artist) {
  let latinName = null;

  if (artist['sort-name'] && artist['sort-name'] !== artist.name) {
    if (!hasNonLatinCharacters(artist['sort-name'])) {
      const sortName = artist['sort-name'];
      if (sortName.includes(',')) {
        const parts = sortName.split(',').map((p) => p.trim());
        if (parts.length === 2) {
          latinName = `${parts[1]} ${parts[0]}`;
        } else {
          latinName = sortName;
        }
      } else {
        latinName = sortName;
      }
    }
  }

  if (!latinName && artist.name) {
    const nameParenMatch = artist.name.match(/\(([^)]+)\)/);
    if (nameParenMatch) {
      const extracted = nameParenMatch[1].trim();
      if (!hasNonLatinCharacters(extracted)) {
        latinName = extracted;
      }
    }
  }

  if (!latinName && artist.disambiguation) {
    if (!hasNonLatinCharacters(artist.disambiguation)) {
      const looksLikeName =
        !artist.disambiguation.includes(' ') ||
        artist.disambiguation.split(' ').length <= 3;
      if (
        looksLikeName &&
        !artist.disambiguation.toLowerCase().includes('group') &&
        !artist.disambiguation.toLowerCase().includes('band')
      ) {
        latinName = artist.disambiguation;
      }
    }
  }

  if (!latinName && artist.aliases && Array.isArray(artist.aliases)) {
    for (const alias of artist.aliases) {
      if (alias.name && !hasNonLatinCharacters(alias.name)) {
        if (alias.primary || alias.type === 'Artist name') {
          latinName = alias.name;
          break;
        }
      }
    }

    if (!latinName) {
      const latinAlias = artist.aliases.find(
        (a) => a.name && !hasNonLatinCharacters(a.name)
      );
      if (latinAlias) {
        latinName = latinAlias.name;
      }
    }
  }

  return latinName;
}

export function formatArtistDisplayName(artist) {
  const hasNonLatin = hasNonLatinCharacters(artist.name);

  if (!hasNonLatin) {
    return {
      primary: artist.name,
      secondary: artist.disambiguation || null,
      original: artist.name,
    };
  }

  const latinName = extractLatinName(artist);

  if (latinName) {
    return {
      primary: latinName,
      secondary: artist.name,
      original: artist.name,
    };
  }

  return {
    primary: artist.name,
    secondary: 'Non-Latin script',
    original: artist.name,
    warning: true,
  };
}
