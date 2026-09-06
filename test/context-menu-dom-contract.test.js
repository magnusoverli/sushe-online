/**
 * The client modules address the sidebar menus and their modals by element id.
 * Nothing links the two halves at build time, so a rename on one side is a
 * silent break on the other — "Pivot to list IDs" (1bfdf74) renamed the
 * `currentListName` lookup in openRenameModal to `currentListIdName` without
 * renaming the element, and Edit Details stopped opening for eight months
 * because the missing element was part of an early-return guard.
 *
 * These tests hold both halves together: every id the menu code looks up must
 * exist in the markup, and every menu the markup renders must be one that
 * hideAllContextMenus() knows to close.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  createSpotifyComponents,
} = require('../templates/spotify-components.js');
const { modalShell, menuItem } = require('../utils/template-helpers.js');

const repoRoot = path.join(__dirname, '..');

const readSource = (relPath) =>
  fs.readFileSync(path.join(repoRoot, relPath), 'utf8');

const { contextMenusComponent, modalPortalComponent } = createSpotifyComponents(
  { modalShell, menuItem }
);

/** Every id the server actually renders onto the app page. */
function renderedElementIds() {
  const markup = [
    contextMenusComponent(),
    modalPortalComponent(),
    readSource('views/spotify-page.ejs'),
  ].join('\n');

  return new Set([...markup.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}

/** Every `getElementById('…')` literal in a module. */
function referencedElementIds(relPath) {
  const source = readSource(relPath);
  return [
    ...new Set(
      [...source.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(
        (m) => m[1]
      )
    ),
  ];
}

// The modules that drive the sidebar list menu, the category menu and the
// modals they open. Mobile menus address elements through an injected `doc`
// and their own action sheets, so they have nothing to check here.
const MENU_MODULES = [
  'src/js/modules/context-menu.js',
  'src/js/modules/context-menus.js',
  'src/js/modules/list-crud.js',
  'src/js/modules/list-nav.js',
  'src/js/modules/album-context-menu.js',
];

describe('context menu DOM contract', () => {
  it('every element the menu code looks up is actually rendered', () => {
    const rendered = renderedElementIds();

    const dangling = [];
    for (const modulePath of MENU_MODULES) {
      for (const id of referencedElementIds(modulePath)) {
        if (!rendered.has(id)) {
          dangling.push(`${modulePath} -> #${id}`);
        }
      }
    }

    assert.deepStrictEqual(
      dangling,
      [],
      `getElementById on ids that no template renders:\n  ${dangling.join('\n  ')}`
    );
  });

  it('the edit-list modal renders every element openRenameModal needs', () => {
    const rendered = renderedElementIds();

    // The exact set the editor reads on open and on save. `currentListName` is
    // the one that was renamed out from under it.
    for (const id of [
      'renameListModal',
      'newListNameInput',
      'currentListName',
      'editListYear',
      'editYearError',
      'cancelRenameBtn',
      'confirmRenameBtn',
    ]) {
      assert.ok(rendered.has(id), `edit-list modal is missing #${id}`);
    }
  });

  it('hideAllContextMenus knows about every menu the template renders', () => {
    const menuIds = [
      ...new Set(
        [...contextMenusComponent().matchAll(/id="([^"]+)"/g)]
          .map((m) => m[1])
          .filter((id) => /^contextMenu$|ContextMenu$|Submenu$/.test(id))
      ),
    ];

    // Guard the guard: if the naming convention drifts this finds nothing and
    // would pass vacuously.
    assert.ok(
      menuIds.length >= 10,
      `expected the template to render the known menus, found ${menuIds.length}`
    );

    const hideSource = readSource('src/js/modules/context-menu.js');
    const declared = new Set(
      [...hideSource.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
    );

    const unclosable = menuIds.filter((id) => !declared.has(id));
    assert.deepStrictEqual(
      unclosable,
      [],
      `menus that no click outside them would ever close:\n  ${unclosable.join('\n  ')}`
    );
  });
});
