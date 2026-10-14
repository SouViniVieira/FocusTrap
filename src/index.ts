/**
 * focus-trap: a lightweight, dependency-free focus trap.
 *
 * Confines keyboard focus (Tab / Shift+Tab) to a container while active, keeps
 * focus from leaving through clicks or scripts, then restores focus on
 * deactivate. Core accessibility pattern for custom dialogs, drawers and other
 * overlays that can't use a native <dialog>.
 */

/** Why a trap was deactivated. */
export type DeactivateReason = 'escape' | 'outside-click' | 'api';

/** Options accepted by {@link createFocusTrap}. */
export interface FocusTrapOptions {
  /** Element focused on activation. Defaults to the first tabbable element, then the container. */
  initialFocus?: HTMLElement | (() => HTMLElement | null) | undefined;
  /** Restore focus to the pre-activation element on deactivate. Default `true`. */
  returnFocusOnDeactivate?: boolean | undefined;
  /** Deactivate when Escape is pressed (unless something inside already handled it). Default `true`. */
  escapeDeactivates?: boolean | undefined;
  /** Deactivate when a pointer press lands outside the container. Default `false`. */
  clickOutsideDeactivates?: boolean | undefined;
  /**
   * Let clicks outside the container go through without deactivating. Default `false`:
   * outside clicks are blocked, the way a modal backdrop blocks the page behind it.
   */
  allowOutsideClick?: boolean | undefined;
  /**
   * Extra elements that count as "inside" the trap, such as a date picker or menu
   * rendered in a portal at the end of <body>.
   */
  additionalContainers?: HTMLElement[] | (() => HTMLElement[]) | undefined;
  /** Called after the trap activates. */
  onActivate?: (() => void) | undefined;
  /**
   * Called after the trap deactivates, with the reason. Use it to close the overlay
   * when the user presses Escape or clicks outside.
   */
  onDeactivate?: ((reason: DeactivateReason) => void) | undefined;
}

/** The public handle returned by {@link createFocusTrap}. */
export interface FocusTrap {
  activate: () => void;
  deactivate: () => void;
  /** Temporarily stop trapping without deactivating (nested traps do this automatically). */
  pause: () => void;
  unpause: () => void;
  readonly active: boolean;
  readonly paused: boolean;
}

interface StackEntry {
  pause: () => void;
  unpause: () => void;
}

/** Active traps, innermost last. Only the top of the stack handles events. */
const trapStack: StackEntry[] = [];

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  'details > summary:first-of-type',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

// Computed styles rather than offsetParent/rects: correct for position:fixed
// and in environments that don't compute layout (jsdom). Only explicitly
// hidden elements are excluded; anything ambiguous counts as visible.
function isVisible(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node !== null) {
    if (getComputedStyle(node).display === 'none') return false;
    node = node.parentElement;
  }
  const { visibility } = getComputedStyle(el); // inherits, so the element alone is enough
  return visibility !== 'hidden' && visibility !== 'collapse';
}

/** Controls inside a disabled <fieldset> are disabled, except those in its first <legend>. */
function isInDisabledFieldset(el: HTMLElement): boolean {
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset === null) return false;
  const legend = fieldset.querySelector(':scope > legend');
  return legend === null || !legend.contains(el);
}

/** Content of a closed <details> is not rendered, except its summary. */
function isInClosedDetails(el: HTMLElement): boolean {
  let details = el.closest('details');
  while (details !== null) {
    const summary = details.querySelector(':scope > summary');
    if (!details.open && !(summary !== null && summary.contains(el))) return true;
    details = details.parentElement?.closest('details') ?? null;
  }
  return false;
}

function tabIndexOf(el: HTMLElement): number {
  const value = Number.parseInt(el.getAttribute('tabindex') ?? '', 10);
  return Number.isNaN(value) ? 0 : value; // missing or invalid: natural order
}

function isTabbable(el: HTMLElement, container: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || isInDisabledFieldset(el)) return false;
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
  if (el.closest('[inert]') !== null) return false;

  // aria-hidden hides an element from assistive tech, so it must not receive
  // focus either. Only ancestors inside the container count: an overlay can
  // legitimately live next to an aria-hidden page.
  const hidden = el.closest('[aria-hidden="true"]');
  if (hidden !== null && container.contains(hidden)) return false;

  if (tabIndexOf(el) < 0) return false;
  if (isInClosedDetails(el)) return false;

  return isVisible(el);
}

/**
 * Radios in the same group behave as one tab stop: the checked one, or the
 * first one when none is checked. Arrow keys move inside the group.
 */
function keepOneRadioPerGroup(elements: HTMLElement[]): HTMLElement[] {
  const chosen = new Map<string, HTMLInputElement>();
  for (const el of elements) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.name === '') continue;
    const key = `${el.form?.id ?? ''}::${el.name}`;
    const current = chosen.get(key);
    if (current === undefined || (!current.checked && el.checked)) chosen.set(key, el);
  }
  return elements.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || el.name === '') return true;
    return chosen.get(`${el.form?.id ?? ''}::${el.name}`) === el;
  });
}

/** Tabbable elements in the order the browser visits them: positive tabindex first, then DOM order. */
function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const candidates = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  const tabbable = keepOneRadioPerGroup(candidates.filter((el) => isTabbable(el, container)));
  const positive = tabbable
    .filter((el) => tabIndexOf(el) > 0)
    .sort((a, b) => tabIndexOf(a) - tabIndexOf(b)); // stable: ties keep DOM order
  const natural = tabbable.filter((el) => tabIndexOf(el) === 0);
  return [...positive, ...natural];
}

/**
 * Create a focus trap bound to `element`.
 *
 * @example
 * ```ts
 * const trap = createFocusTrap(dialog, { onDeactivate: () => (dialog.hidden = true) });
 * dialog.hidden = false;
 * trap.activate();
 * ```
 */
export function createFocusTrap(element: HTMLElement, options: FocusTrapOptions = {}): FocusTrap {
  const {
    initialFocus,
    returnFocusOnDeactivate = true,
    escapeDeactivates = true,
    clickOutsideDeactivates = false,
    allowOutsideClick = false,
    additionalContainers,
    onActivate,
    onDeactivate,
  } = options;

  let isActive = false;
  let isPaused = false;
  let previouslyFocused: HTMLElement | null = null;
  let lastFocusedInside: HTMLElement | null = null;
  let addedTabindex = false;
  let observer: MutationObserver | null = null;
  const entry: StackEntry = { pause: pauseFromStack, unpause: unpauseFromStack };

  const isHandling = (): boolean => isActive && !isPaused;

  function containers(): HTMLElement[] {
    const extra = typeof additionalContainers === 'function' ? additionalContainers() : (additionalContainers ?? []);
    return [element, ...extra];
  }

  function isInside(node: unknown): boolean {
    return node instanceof Node && containers().some((c) => c.contains(node));
  }

  function resolveInitialFocus(): HTMLElement {
    if (typeof initialFocus === 'function') {
      const resolved = initialFocus();
      if (resolved !== null) return resolved;
    } else if (initialFocus !== undefined) {
      return initialFocus;
    }
    return getTabbableElements(element)[0] ?? element;
  }

  function focusInside(): void {
    const target =
      lastFocusedInside !== null && lastFocusedInside.isConnected && isInside(lastFocusedInside)
        ? lastFocusedInside
        : (getTabbableElements(element)[0] ?? element);
    target.focus();
  }

  function onTabKey(event: KeyboardEvent): void {
    if (!isHandling() || event.key !== 'Tab') return;

    const tabbable = getTabbableElements(element);
    if (tabbable.length === 0) {
      event.preventDefault();
      element.focus();
      return;
    }

    const first = tabbable[0]!;
    const last = tabbable[tabbable.length - 1]!;
    const current = document.activeElement;
    const outside = !element.contains(current);

    if (event.shiftKey && (current === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  // Listened in the bubble phase so a component inside the trap (a combobox
  // closing its list, for example) can handle Escape first and preventDefault.
  function onEscapeKey(event: KeyboardEvent): void {
    if (!isHandling() || event.key !== 'Escape' || !escapeDeactivates) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    deactivateWith('escape');
  }

  function onFocusIn(event: FocusEvent): void {
    if (!isHandling()) return;
    if (isInside(event.target)) {
      if (event.target instanceof HTMLElement) lastFocusedInside = event.target;
      return;
    }
    // Focus moved out through a click or a script: bring it back.
    focusInside();
  }

  function onPointerDown(event: Event): void {
    if (!isHandling() || isInside(event.target)) return;

    if (clickOutsideDeactivates) {
      // If the press lands on something focusable, focus naturally goes there,
      // so don't fight it by returning focus to the trigger.
      const lands =
        event.target instanceof Element && event.target.closest(FOCUSABLE_SELECTOR) !== null;
      deactivateWith('outside-click', !lands);
      return;
    }
    if (!allowOutsideClick) event.preventDefault(); // keeps focus where it is
  }

  function onClick(event: Event): void {
    if (!isHandling() || isInside(event.target) || allowOutsideClick || clickOutsideDeactivates) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // Dynamic content can remove the focused node, dropping focus to <body> and
  // escaping the trap; pull it back in when that happens.
  function onMutation(): void {
    if (!isHandling()) return;
    if (!isInside(document.activeElement)) focusInside();
  }

  function addListeners(): void {
    document.addEventListener('keydown', onTabKey, true);
    document.addEventListener('keydown', onEscapeKey);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    observer = new MutationObserver(onMutation);
    observer.observe(element, { childList: true, subtree: true });
  }

  function removeListeners(): void {
    document.removeEventListener('keydown', onTabKey, true);
    document.removeEventListener('keydown', onEscapeKey);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    observer?.disconnect();
    observer = null;
  }

  function pauseFromStack(): void {
    isPaused = true;
  }

  function unpauseFromStack(): void {
    isPaused = false;
    if (isActive && !isInside(document.activeElement)) focusInside();
  }

  function activate(): void {
    if (isActive) return;

    trapStack[trapStack.length - 1]?.pause();
    trapStack.push(entry);

    isActive = true;
    isPaused = false;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Fallback focus target when the container has nothing tabbable.
    addedTabindex = !element.hasAttribute('tabindex');
    if (addedTabindex) element.setAttribute('tabindex', '-1');

    addListeners();
    const target = resolveInitialFocus();
    target.focus();
    lastFocusedInside = target;
    onActivate?.();
  }

  function deactivateWith(reason: DeactivateReason, restoreFocus = true): void {
    if (!isActive) return;
    isActive = false;
    isPaused = false;
    removeListeners();

    if (addedTabindex) element.removeAttribute('tabindex');
    addedTabindex = false;

    const index = trapStack.indexOf(entry);
    const wasTop = index === trapStack.length - 1;
    if (index !== -1) trapStack.splice(index, 1);

    if (restoreFocus && returnFocusOnDeactivate && previouslyFocused?.isConnected) {
      const target = previouslyFocused;
      if (reason === 'outside-click') {
        // We're still inside the pointerdown: the browser moves focus on the
        // mousedown that follows. Restore after that, or it would be undone.
        setTimeout(() => target.focus(), 0);
      } else {
        target.focus();
      }
    }
    previouslyFocused = null;
    lastFocusedInside = null;

    // Hand control back to the trap underneath, if this one was on top.
    if (wasTop) trapStack[trapStack.length - 1]?.unpause();
    onDeactivate?.(reason);
  }

  return {
    activate,
    deactivate: () => deactivateWith('api'),
    pause: () => {
      if (isActive) isPaused = true;
    },
    unpause: () => {
      if (isActive && trapStack[trapStack.length - 1] === entry) unpauseFromStack();
    },
    get active(): boolean {
      return isActive;
    },
    get paused(): boolean {
      return isPaused;
    },
  };
}
