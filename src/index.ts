/**
 * focus-trap — a lightweight, dependency-free focus trap.
 *
 * Confines keyboard focus (Tab / Shift+Tab) to a container while active, then
 * restores focus on deactivate. Core accessibility pattern for modals, dialogs
 * and overlays.
 */

/** Options accepted by {@link createFocusTrap}. */
export interface FocusTrapOptions {
  /** Element focused on activation. Defaults to the first focusable element, then the container. */
  initialFocus?: HTMLElement | (() => HTMLElement | null) | undefined;
  /** Restore focus to the pre-activation element on deactivate. Default `true`. */
  returnFocusOnDeactivate?: boolean | undefined;
  /** Deactivate when Escape is pressed. Default `true`. */
  escapeDeactivates?: boolean | undefined;
  /** Deactivate when a pointer press lands outside the container. Default `false`. */
  clickOutsideDeactivates?: boolean | undefined;
}

/** The public handle returned by {@link createFocusTrap}. */
export interface FocusTrap {
  activate: () => void;
  deactivate: () => void;
  readonly active: boolean;
}

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
  '[contenteditable]',
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

function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[inert]') !== null) return false;

  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) < 0) return false;

  return isVisible(el);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const result: HTMLElement[] = [];
  for (const el of candidates) {
    if (isFocusable(el)) result.push(el);
  }
  return result;
}

function resolveInitialFocus(
  container: HTMLElement,
  option: FocusTrapOptions['initialFocus'],
): HTMLElement {
  if (typeof option === 'function') {
    const resolved = option();
    if (resolved !== null) return resolved;
  } else if (option !== undefined) {
    return option;
  }

  const focusable = getFocusableElements(container);
  return focusable[0] ?? container;
}

/**
 * Create a focus trap bound to `element`.
 *
 * @example
 * ```ts
 * const trap = createFocusTrap(document.querySelector('#modal')!);
 * trap.activate();
 * trap.deactivate();
 * ```
 */
export function createFocusTrap(
  element: HTMLElement,
  options: FocusTrapOptions = {},
): FocusTrap {
  const {
    initialFocus,
    returnFocusOnDeactivate = true,
    escapeDeactivates = true,
    clickOutsideDeactivates = false,
  } = options;

  let isActive = false;
  let previouslyFocused: HTMLElement | null = null;
  let observer: MutationObserver | null = null;

  function focusFirst(): void {
    const focusable = getFocusableElements(element);
    (focusable[0] ?? element).focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!isActive) return;

    if (event.key === 'Escape' && escapeDeactivates) {
      event.preventDefault();
      deactivate();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(element);
    if (focusable.length === 0) {
      event.preventDefault();
      element.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const current = document.activeElement;

    if (event.shiftKey) {
      if (current === first || !element.contains(current)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (current === last || !element.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function onPointerDown(event: Event): void {
    if (!isActive) return;
    const target = event.target;
    if (target instanceof Node && !element.contains(target)) {
      deactivate();
    }
  }

  // Dynamic content can remove the focused node, dropping focus to <body> and
  // escaping the trap; pull it back in when that happens.
  function onMutation(): void {
    if (!isActive) return;
    if (!element.contains(document.activeElement)) {
      focusFirst();
    }
  }

  function activate(): void {
    if (isActive) return;
    isActive = true;

    previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Fallback focus target when the container has nothing focusable.
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
    }

    document.addEventListener('keydown', onKeydown, true);
    if (clickOutsideDeactivates) {
      document.addEventListener('pointerdown', onPointerDown, true);
    }

    observer = new MutationObserver(onMutation);
    observer.observe(element, { childList: true, subtree: true });

    resolveInitialFocus(element, initialFocus).focus();
  }

  function deactivate(): void {
    if (!isActive) return;
    isActive = false;

    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    observer?.disconnect();
    observer = null;

    if (returnFocusOnDeactivate && previouslyFocused !== null) {
      previouslyFocused.focus();
    }
    previouslyFocused = null;
  }

  return {
    activate,
    deactivate,
    get active(): boolean {
      return isActive;
    },
  };
}
