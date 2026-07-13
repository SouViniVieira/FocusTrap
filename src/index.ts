/**
 * focus-trap — a lightweight, dependency-free focus trap.
 *
 * A focus trap keeps keyboard focus (Tab / Shift+Tab) confined to a container
 * element while it is active. This is a core accessibility pattern for modals,
 * dialogs, drawers and any overlay that should not let focus escape to the
 * content behind it.
 */

/** Options accepted by {@link createFocusTrap}. */
export interface FocusTrapOptions {
  /**
   * The element that receives focus when the trap is activated. May be an
   * element or a function returning one. When omitted, the first focusable
   * element in the container is used, falling back to the container itself.
   */
  initialFocus?: HTMLElement | (() => HTMLElement | null) | undefined;
  /**
   * When `true` (the default), focus is returned to the element that was
   * focused before activation once the trap is deactivated.
   */
  returnFocusOnDeactivate?: boolean | undefined;
  /**
   * When `true` (the default), pressing Escape while the trap is active
   * deactivates it.
   */
  escapeDeactivates?: boolean | undefined;
}

/** The public handle returned by {@link createFocusTrap}. */
export interface FocusTrap {
  /** Activate the trap: move focus inside and start confining Tab presses. */
  activate: () => void;
  /** Deactivate the trap and, by default, restore the previous focus. */
  deactivate: () => void;
  /** Whether the trap is currently active. */
  readonly active: boolean;
}

/**
 * Selector matching elements that are potentially focusable. Actual focusability
 * is refined at runtime (visibility, `disabled`, negative `tabindex`, ...).
 */
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

/**
 * Whether an element is visible in the layout. Uses computed styles rather than
 * `offsetParent`/bounding rects so it stays correct for `position: fixed`
 * elements and in environments that don't compute layout. Only *explicitly*
 * hidden elements are excluded; anything ambiguous is treated as visible.
 */
function isVisible(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node !== null) {
    if (getComputedStyle(node).display === 'none') return false;
    node = node.parentElement;
  }
  // `visibility` inherits, so checking the element itself is sufficient.
  const { visibility } = getComputedStyle(el);
  return visibility !== 'hidden' && visibility !== 'collapse';
}

/**
 * Determine whether an element is actually focusable right now: visible,
 * not disabled, not `inert`, and not opted out with `tabindex="-1"`.
 */
function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[inert]') !== null) return false;

  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) < 0) return false;

  return isVisible(el);
}

/** Collect the focusable elements inside `container`, in DOM order. */
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
 * @param element - The container that focus should be confined to.
 * @param options - Optional behaviour overrides. See {@link FocusTrapOptions}.
 * @returns A {@link FocusTrap} handle with `activate` / `deactivate`.
 *
 * @example
 * ```ts
 * const trap = createFocusTrap(document.querySelector('#modal')!);
 * trap.activate();
 * // ...later
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
  } = options;

  let isActive = false;
  let previouslyFocused: HTMLElement | null = null;

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
      // Nothing to focus inside: keep focus pinned on the container itself.
      event.preventDefault();
      element.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const current = document.activeElement;

    if (event.shiftKey) {
      // Shift+Tab from the first element wraps to the last.
      if (current === first || !element.contains(current)) {
        event.preventDefault();
        last.focus();
      }
    } else {
      // Tab from the last element wraps to the first.
      if (current === last || !element.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function activate(): void {
    if (isActive) return;
    isActive = true;

    previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // The container needs to be programmatically focusable as a fallback.
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
    }

    document.addEventListener('keydown', onKeydown, true);

    const target = resolveInitialFocus(element, initialFocus);
    target.focus();
  }

  function deactivate(): void {
    if (!isActive) return;
    isActive = false;

    document.removeEventListener('keydown', onKeydown, true);

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
