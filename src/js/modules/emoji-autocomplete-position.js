function getLineHeight(style) {
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) return parsed;

  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 18;
}

function copyMirrorStyles(mirror, textarea, style) {
  const properties = [
    'boxSizing',
    'width',
    'height',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'textAlign',
    'textIndent',
    'wordSpacing',
    'tabSize',
  ];

  properties.forEach((property) => {
    mirror.style[property] = style[property];
  });

  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.overflow = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.minHeight = `${textarea.clientHeight}px`;
}

export function getTextareaCaretPoint(textarea, caretIndex, doc, win) {
  const style = win.getComputedStyle(textarea);
  const mirror = doc.createElement('div');
  copyMirrorStyles(mirror, textarea, style);

  const before = textarea.value.slice(0, caretIndex);
  const marker = doc.createElement('span');
  mirror.textContent = before || '';
  marker.textContent = textarea.value.slice(caretIndex, caretIndex + 1) || '.';
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);

  const textareaRect = textarea.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const point = {
    left:
      textareaRect.left +
      markerRect.left -
      mirrorRect.left -
      textarea.scrollLeft,
    top:
      textareaRect.top +
      markerRect.top -
      mirrorRect.top -
      textarea.scrollTop +
      getLineHeight(style),
  };

  mirror.remove();
  return point;
}
