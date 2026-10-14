import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFocusTrap, type FocusTrap } from './index';

/** Build a container with three buttons and mount it in the document. */
function mountContainer(): {
  container: HTMLElement;
  buttons: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
} {
  const container = document.createElement('div');
  const first = document.createElement('button');
  const second = document.createElement('button');
  const third = document.createElement('button');
  first.textContent = 'first';
  second.textContent = 'second';
  third.textContent = 'third';
  container.append(first, second, third);
  document.body.append(container);
  return { container, buttons: [first, second, third] };
}

/** Mount arbitrary markup and return its wrapper. */
function mountHtml(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

function outsideButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'outside';
  document.body.append(button);
  return button;
}

/** Dispatch a Tab keydown from the currently focused element. */
function pressTab(shiftKey = false): void {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
}

/** Dispatch an Escape keydown from `target` (default: the focused element). */
function pressEscape(target: EventTarget = document.activeElement ?? document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Walk the tab cycle from the first tabbable element and record the order. */
function tabOrder(trap: FocusTrap, steps: number): string[] {
  trap.activate();
  const visited = [(document.activeElement as HTMLElement).id];
  for (let i = 1; i < steps; i++) {
    // jsdom has no native Tab navigation, so emulate it for the middle of the
    // cycle and let the trap handle the wrap-around.
    const current = document.activeElement as HTMLElement;
    const all = [...document.querySelectorAll<HTMLElement>('[data-order]')].sort(
      (a, b) => Number(a.dataset['order']) - Number(b.dataset['order']),
    );
    const next = all[all.indexOf(current) + 1];
    if (next === undefined) pressTab();
    else next.focus();
    visited.push((document.activeElement as HTMLElement).id);
  }
  return visited;
}

/** MutationObserver callbacks run in a microtask; let them settle. */
function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const traps: FocusTrap[] = [];
function trapOf(...args: Parameters<typeof createFocusTrap>): FocusTrap {
  const trap = createFocusTrap(...args);
  traps.push(trap);
  return trap;
}

afterEach(() => {
  // Deactivate in reverse so the module-level stack starts clean for each test.
  for (const trap of traps.reverse()) trap.deactivate();
  traps.length = 0;
  document.body.innerHTML = '';
});

describe('activation and the tab cycle', () => {
  it('focuses the first tabbable element on activate', () => {
    const { container, buttons } = mountContainer();
    const trap = trapOf(container);
    trap.activate();
    expect(trap.active).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Tab from the last element back to the first', () => {
    const { container, buttons } = mountContainer();
    trapOf(container).activate();
    buttons[2].focus();
    pressTab();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const { container, buttons } = mountContainer();
    trapOf(container).activate();
    buttons[0].focus();
    pressTab(true);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('respects a custom initialFocus element and function', () => {
    const { container, buttons } = mountContainer();
    trapOf(container, { initialFocus: buttons[1] }).activate();
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('falls back to the container when nothing inside is tabbable', () => {
    const container = mountHtml('<p>Nothing to focus</p>');
    trapOf(container).activate();
    expect(document.activeElement).toBe(container);
    pressTab();
    expect(document.activeElement).toBe(container);
  });

  it('is idempotent: activating twice does not overwrite the stored focus', () => {
    const trigger = outsideButton();
    trigger.focus();
    const { container } = mountContainer();
    const trap = trapOf(container);
    trap.activate();
    trap.activate();
    trap.deactivate();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('what counts as tabbable', () => {
  it('skips disabled and tabindex="-1" elements', () => {
    const { container, buttons } = mountContainer();
    buttons[0].setAttribute('disabled', '');
    buttons[1].setAttribute('tabindex', '-1');
    trapOf(container).activate();
    expect(document.activeElement).toBe(buttons[2]);
  });

  it('skips elements inside aria-hidden or inert subtrees', () => {
    const container = mountHtml(`
      <div aria-hidden="true"><button id="a">a</button></div>
      <div inert><button id="b">b</button></div>
      <button id="c">c</button>`);
    trapOf(container).activate();
    expect(document.activeElement?.id).toBe('c');
  });

  it('skips controls inside a disabled fieldset, except in its legend', () => {
    const container = mountHtml(`
      <fieldset disabled>
        <legend><button id="in-legend">legend</button></legend>
        <input id="in-fieldset">
      </fieldset>`);
    trapOf(container).activate();
    expect(document.activeElement?.id).toBe('in-legend');
  });

  it('skips the content of a closed <details> but keeps its summary', () => {
    const container = mountHtml(`
      <details><summary id="summary">More</summary><button id="hidden">hidden</button></details>`);
    trapOf(container).activate();
    expect(document.activeElement?.id).toBe('summary');
    pressTab(true); // the summary is the only stop, so Shift+Tab stays on it
    expect(document.activeElement?.id).toBe('summary');
  });

  it('treats a radio group as a single stop: the checked radio', () => {
    const container = mountHtml(`
      <input type="radio" name="size" id="s" value="s">
      <input type="radio" name="size" id="m" value="m" checked>
      <input type="radio" name="size" id="l" value="l">
      <button id="after">after</button>`);
    trapOf(container).activate();
    expect(document.activeElement?.id).toBe('m');
    (document.getElementById('after') as HTMLElement).focus();
    pressTab(); // wraps to the group's single stop
    expect(document.activeElement?.id).toBe('m');
  });

  it('uses the first radio of a group when none is checked', () => {
    const container = mountHtml(`
      <input type="radio" name="plan" id="p1"><input type="radio" name="plan" id="p2">`);
    trapOf(container).activate();
    expect(document.activeElement?.id).toBe('p1');
  });

  it('visits positive tabindex values first, in ascending order', () => {
    const container = mountHtml(`
      <button id="natural" data-order="3">natural</button>
      <button id="two" tabindex="2" data-order="2">two</button>
      <button id="one" tabindex="1" data-order="1">one</button>`);
    expect(tabOrder(trapOf(container), 4)).toEqual(['one', 'two', 'natural', 'one']);
  });
});

describe('keeping focus inside', () => {
  it('pulls focus back when a script or click focuses something outside', () => {
    const { container, buttons } = mountContainer();
    const outside = outsideButton();
    trapOf(container).activate();
    buttons[1].focus();
    outside.focus();
    expect(document.activeElement).toBe(buttons[1]); // back to the last focused element
  });

  it('blocks outside clicks by default', () => {
    const { container } = mountContainer();
    const outside = outsideButton();
    const onOutsideClick = vi.fn();
    outside.addEventListener('click', onOutsideClick);
    trapOf(container).activate();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    outside.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onOutsideClick).not.toHaveBeenCalled();
  });

  it('lets outside clicks through with allowOutsideClick', () => {
    const { container } = mountContainer();
    const outside = outsideButton();
    const onOutsideClick = vi.fn();
    outside.addEventListener('click', onOutsideClick);
    const trap = trapOf(container, { allowOutsideClick: true });
    trap.activate();

    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onOutsideClick).toHaveBeenCalledOnce();
    expect(trap.active).toBe(true);
  });

  it('treats additionalContainers as inside (portals)', () => {
    const { container } = mountContainer();
    const portal = mountHtml('<button id="portal-option">option</button>');
    trapOf(container, { additionalContainers: () => [portal] }).activate();

    const option = document.getElementById('portal-option') as HTMLElement;
    option.focus();

    expect(document.activeElement).toBe(option);
  });

  it('pulls focus back inside when the focused element is removed', async () => {
    const { container, buttons } = mountContainer();
    trapOf(container).activate();
    buttons[1].focus();
    buttons[1].remove();
    await flushMutations();
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('includes dynamically added elements in the tab cycle', () => {
    const { container, buttons } = mountContainer();
    trapOf(container).activate();
    const added = document.createElement('button');
    container.append(added);
    added.focus();
    pressTab();
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('deactivation', () => {
  it('restores focus to the previously focused element', () => {
    const trigger = outsideButton();
    trigger.focus();
    const { container } = mountContainer();
    const trap = trapOf(container);
    trap.activate();
    trap.deactivate();
    expect(trap.active).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore focus when returnFocusOnDeactivate is false', () => {
    const trigger = outsideButton();
    trigger.focus();
    const { container } = mountContainer();
    const trap = trapOf(container, { returnFocusOnDeactivate: false });
    trap.activate();
    trap.deactivate();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('deactivates on Escape and reports the reason, so the overlay can close', () => {
    const { container } = mountContainer();
    const onDeactivate = vi.fn();
    const trap = trapOf(container, { onDeactivate });
    trap.activate();

    pressEscape();

    expect(trap.active).toBe(false);
    expect(onDeactivate).toHaveBeenCalledWith('escape');
  });

  it('leaves Escape to an inner component that already handled it', () => {
    const container = mountHtml('<input id="combobox">');
    const combobox = document.getElementById('combobox') as HTMLElement;
    // e.g. a combobox closing its listbox on the first Escape
    combobox.addEventListener('keydown', (event) => event.preventDefault());
    const trap = trapOf(container);
    trap.activate();

    pressEscape(combobox);

    expect(trap.active).toBe(true);
  });

  it('ignores Escape when escapeDeactivates is false', () => {
    const { container } = mountContainer();
    const trap = trapOf(container, { escapeDeactivates: false });
    trap.activate();
    pressEscape();
    expect(trap.active).toBe(true);
  });

  it('deactivates on outside pointerdown with clickOutsideDeactivates', async () => {
    const outside = mountHtml('<div id="backdrop"></div>');
    const trigger = outsideButton();
    trigger.focus();
    const { container } = mountContainer();
    const onDeactivate = vi.fn();
    const trap = trapOf(container, { clickOutsideDeactivates: true, onDeactivate });
    trap.activate();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

    expect(trap.active).toBe(false);
    expect(onDeactivate).toHaveBeenCalledWith('outside-click');
    // Focus returns after the click sequence, so the browser's own mousedown
    // focus handling can't undo it. The backdrop isn't focusable: focus goes home.
    document.body.focus(); // what the browser does on mousedown over plain content
    await flushMutations();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus back when the outside press lands on something focusable', () => {
    const trigger = outsideButton();
    trigger.focus();
    const target = outsideButton();
    const { container } = mountContainer();
    const trap = trapOf(container, { clickOutsideDeactivates: true });
    trap.activate();

    target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

    expect(trap.active).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
  });

  it('ignores pointerdown inside the container', () => {
    const { container, buttons } = mountContainer();
    const trap = trapOf(container, { clickOutsideDeactivates: true });
    trap.activate();
    buttons[1].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(trap.active).toBe(true);
  });

  it('removes the tabindex it added, and keeps one that was already there', () => {
    const { container } = mountContainer();
    const trap = trapOf(container);
    trap.activate();
    expect(container.getAttribute('tabindex')).toBe('-1');
    trap.deactivate();
    expect(container.hasAttribute('tabindex')).toBe(false);

    container.setAttribute('tabindex', '0');
    trap.activate();
    trap.deactivate();
    expect(container.getAttribute('tabindex')).toBe('0');
  });

  it('calls onActivate and reports "api" for programmatic deactivation', () => {
    const { container } = mountContainer();
    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const trap = trapOf(container, { onActivate, onDeactivate });
    trap.activate();
    trap.deactivate();
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onDeactivate).toHaveBeenCalledWith('api');
  });
});

describe('nested traps', () => {
  it('pauses the outer trap while an inner one is active, then hands control back', () => {
    const outer = mountHtml('<button id="open-inner">open</button><button id="outer-2">two</button>');
    const inner = mountHtml('<button id="inner-1">yes</button><button id="inner-2">no</button>');
    const outerTrap = trapOf(outer);
    const innerTrap = trapOf(inner);

    outerTrap.activate();
    expect(document.activeElement?.id).toBe('open-inner');

    innerTrap.activate();
    expect(outerTrap.paused).toBe(true);
    expect(document.activeElement?.id).toBe('inner-1');

    (document.getElementById('inner-2') as HTMLElement).focus();
    pressTab(); // the inner trap wraps; the paused outer one stays out of it
    expect(document.activeElement?.id).toBe('inner-1');

    pressEscape(); // closes only the inner trap
    expect(innerTrap.active).toBe(false);
    expect(outerTrap.active).toBe(true);
    expect(outerTrap.paused).toBe(false);
    expect(document.activeElement?.id).toBe('open-inner'); // back to what opened it
  });

  it('supports manual pause and unpause', () => {
    const { container } = mountContainer();
    const outside = outsideButton();
    const trap = trapOf(container);
    trap.activate();

    trap.pause();
    outside.focus();
    expect(document.activeElement).toBe(outside);

    trap.unpause();
    expect(container.contains(document.activeElement)).toBe(true);
  });
});
