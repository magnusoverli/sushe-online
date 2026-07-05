const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

function createClassList() {
  return {
    added: [],
    removed: [],
    add(...classes) {
      this.added.push(...classes);
    },
    remove(...classes) {
      this.removed.push(...classes);
    },
  };
}

describe('app-shell-ui module', () => {
  let createAppShellUi;

  beforeEach(async () => {
    const module = await import('../src/js/modules/app-shell-ui.js');
    createAppShellUi = module.createAppShellUi;
  });

  it('shows loading spinner in target container', () => {
    const created = [];
    const doc = {
      getElementById() {
        return null;
      },
      createElement(tag) {
        const el = { tag, className: '', innerHTML: '' };
        created.push(el);
        return el;
      },
    };

    const container = {
      cleared: false,
      appended: [],
      replaceChildren() {
        this.cleared = true;
      },
      appendChild(node) {
        this.appended.push(node);
      },
    };

    const ui = createAppShellUi({ doc, win: {} });
    ui.showLoadingSpinner(container);

    assert.strictEqual(container.cleared, true);
    assert.strictEqual(created[0].tag, 'div');
    assert.match(created[0].className, /text-center/);
    assert.match(created[0].innerHTML, /Loading\.\.\./);
    assert.strictEqual(container.appended[0], created[0]);
  });

  it('updates header title state when list is selected', () => {
    const headerAddAlbumBtn = { classList: createClassList() };
    const mobileListName = {
      textContent: '',
      classList: createClassList(),
    };

    const doc = {
      getElementById(id) {
        if (id === 'headerAddAlbumBtn') return headerAddAlbumBtn;
        if (id === 'mobileCurrentListName') return mobileListName;
        return null;
      },
      createElement() {
        return null;
      },
    };

    const ui = createAppShellUi({ doc, win: {} });
    ui.updateHeaderTitle('Best of 2024');

    assert.deepStrictEqual(headerAddAlbumBtn.classList.removed, ['hidden']);
    assert.deepStrictEqual(mobileListName.classList.removed, ['hidden']);
    assert.strictEqual(mobileListName.textContent, 'Best of 2024');
  });

  it('hides and clears mobile header when no list is selected', () => {
    const mobileListName = {
      textContent: 'Will be cleared',
      classList: createClassList(),
    };

    const doc = {
      getElementById(id) {
        if (id === 'mobileCurrentListName') return mobileListName;
        return null;
      },
      createElement() {
        return null;
      },
    };

    const ui = createAppShellUi({ doc, win: {} });
    ui.updateHeaderTitle('');

    assert.deepStrictEqual(mobileListName.classList.added, ['hidden']);
    assert.strictEqual(mobileListName.textContent, '');
  });

  it('detects text truncation by comparing heights', () => {
    const ui = createAppShellUi({ doc: {}, win: {} });

    assert.strictEqual(
      ui.isTextTruncated({ scrollHeight: 120, clientHeight: 100 }),
      true
    );
    assert.strictEqual(
      ui.isTextTruncated({ scrollHeight: 80, clientHeight: 100 }),
      false
    );
  });
});
