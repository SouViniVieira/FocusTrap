import { afterEach, describe, expect, it } from 'vitest';
import { createFocusTrap } from './index';

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

/** Dispatch a Tab keydown from the currently focused element. */
function pressTab(shiftKey = false): void {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
}

/** MutationObserver callbacks run in a microtask; let them settle. */
function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createFocusTrap', () => {
  it('focuses the first focusable element on activate', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container);

    trap.activate();

    expect(trap.active).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Tab from the last element back to the first', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    buttons[2].focus();
    pressTab();

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    buttons[0].focus();
    pressTab(true);

    expect(document.activeElement).toBe(buttons[2]);
  });

  it('pulls focus back inside when it escapes the container', () => {
    const { container, buttons } = mountContainer();
    const outside = document.createElement('button');
    document.body.append(outside);
    const trap = createFocusTrap(container);
    trap.activate();

    outside.focus();
    pressTab();

    expect(document.activeElement).toBe(buttons[0]);
  });

  it('restores focus to the previously focused element on deactivate', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { container } = mountContainer();
    const trap = createFocusTrap(container);

    trap.activate();
    expect(document.activeElement).not.toBe(trigger);

    trap.deactivate();
    expect(trap.active).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore focus when returnFocusOnDeactivate is false', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { container } = mountContainer();
    const trap = createFocusTrap(container, { returnFocusOnDeactivate: false });

    trap.activate();
    trap.deactivate();

    expect(document.activeElement).not.toBe(trigger);
  });

  it('deactivates on Escape by default', () => {
    const { container } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(trap.active).toBe(false);
  });

  it('respects a custom initialFocus element', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container, { initialFocus: buttons[1] });

    trap.activate();

    expect(document.activeElement).toBe(buttons[1]);
  });

  it('skips disabled and tabindex="-1" elements', () => {
    const { container, buttons } = mountContainer();
    buttons[0].setAttribute('disabled', '');
    buttons[1].setAttribute('tabindex', '-1');
    const trap = createFocusTrap(container);

    trap.activate();

    expect(document.activeElement).toBe(buttons[2]);
  });

  it('is idempotent: activating twice does not overwrite the stored focus', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { container } = mountContainer();
    const trap = createFocusTrap(container);

    trap.activate();
    trap.activate(); // second call is a no-op
    trap.deactivate();

    expect(document.activeElement).toBe(trigger);
  });

  it('deactivates on outside pointerdown when clickOutsideDeactivates is set', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { container } = mountContainer();
    const trap = createFocusTrap(container, { clickOutsideDeactivates: true });
    trap.activate();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(trap.active).toBe(false);
  });

  it('ignores pointerdown inside the container', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container, { clickOutsideDeactivates: true });
    trap.activate();

    buttons[1].dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(trap.active).toBe(true);
  });

  it('does not deactivate on outside pointerdown by default', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { container } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(trap.active).toBe(true);
  });

  it('pulls focus back inside when the focused element is removed', async () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    buttons[1].focus();
    buttons[1].remove();
    await flushMutations();

    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('includes dynamically added elements in the tab cycle', () => {
    const { container, buttons } = mountContainer();
    const trap = createFocusTrap(container);
    trap.activate();

    const added = document.createElement('button');
    container.append(added);

    added.focus(); // the new last element wraps around to the first
    pressTab();

    expect(document.activeElement).toBe(buttons[0]);
  });
});
