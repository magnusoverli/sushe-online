/**
 * HTML utility functions for safe string handling.
 *
 * escapeHtml / escapeHtmlAttr both re-export the single canonical escaper in
 * utils/escape-html.js (shared with the server), so element-text and
 * attribute escaping use one implementation. Both names are kept so every
 * existing import keeps resolving.
 */
import * as escapeHtmlModule from '../../../utils/escape-html.js';

export const escapeHtml = escapeHtmlModule.escapeHtml;
export const escapeHtmlAttr = escapeHtmlModule.escapeHtml;

/**
 * Album placeholder SVG for missing cover images
 * @param {number} size - Size in pixels (default 120)
 * @returns {string} Data URI for placeholder SVG
 */
export function getPlaceholderSvg(size = 120) {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Ccircle cx='12' cy='12' r='4'/%3E%3Ccircle cx='12' cy='12' r='1'/%3E%3C/svg%3E`;
}
