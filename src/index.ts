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

/**
 * The element's parent in the rendered tree: the slot it is assigned to, its
 * parent, or, at the top of a shadow root, the shadow host.
 */
function renderedParent(el: Element): Element | null {
  if (el.assignedSlot !== null) return el.assignedSlot;
  if (el.parentElement !== null) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Like `Element.closest`, but keeps climbing out of shadow roots. */
function closestRendered(el: Element, selector: string): Element | null {
  for (let node: Element | null = el; node !== null; node = renderedParent(node)) {
    if (node.matches(selector)) return node;
  }
  return null;
}

/** Like `Node.contains`, but also looks inside shadow roots. */
function containsDeep(ancestor: Node, node: Node | null): boolean {
  while (node !== null) {
    if (node === ancestor) return true;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return false;
}

/** The focused element itself: `document.activeElement` stops at the shadow host. */
function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** The node an event really started on: `event.target` is retargeted to the shadow host. */
function originalTarget(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target;
}

// Computed styles rather than offsetParent/rects: correct for position:fixed
// and in environments that don't compute layout (jsdom). Only explicitly
// hidden elements are excluded; anything ambiguous counts as visible.
function isVisible(el: HTMLElement): boolean {
  for (let node: Element | null = el; node !== null; node = renderedParent(node)) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  const { visibility } = getComputedStyle(el); // inherits, so the element alone is enough
  return visibility !== 'hidden' && visibility !== 'collapse';
}

/** Controls inside a disabled <fieldset> are disabled, except those in its first <legend>. */
function isInDisabledFieldset(el: HTMLElement): boolean {
  // Deliberately not crossing shadow boundaries: a fieldset only disables its own tree.
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset === null) return false;
  const legend = fieldset.querySelector(':scope > legend');
  return legend === null || !legend.contains(el);
}

/** Content of a closed <details> is not rendered, except its summary. */
function isInClosedDetails(el: HTMLElement): boolean {
  for (let node: Element | null = el; node !== null; node = renderedParent(node)) {
    if (!(node instanceof HTMLDetailsElement) || node.open) continue;
    const summary = node.querySelector(':scope > summary');
    if (summary === null || !containsDeep(summary, el)) return true;
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
  if (closestRendered(el, '[inert]') !== null) return false;

  // aria-hidden hides an element from assistive tech, so it must not receive
  // focus either. Only ancestors inside the container count: an overlay can
  // legitimately live next to an aria-hidden page.
  const hidden = closestRendered(el, '[aria-hidden="true"]');
  if (hidden !== null && containsDeep(container, hidden)) return false;

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

/** One slot in a scope's tab order: a single element, or a whole nested scope placed by its owner's tabindex. */
interface ScopeEntry {
  tabIndex: number;
  elements: HTMLElement[];
}

/**
 * Tabbable elements of one focus navigation scope, in browser order: positive
 * tabindex first (stable, so ties keep DOM order), then the rest in DOM order.
 * Each open shadow root and each <slot> is a scope of its own: its tabindex
 * values are sorted inside it, and it sits where its host or slot sits.
 */
function collectScope(nodes: Iterable<Element>, container: HTMLElement): HTMLElement[] {
  const entries: ScopeEntry[] = [];
  const tabbable = (el: Element): el is HTMLElement =>
    el.matches(FOCUSABLE_SELECTOR) && isTabbable(el as HTMLElement, container);

  const visit = (el: Element): void => {
    if (el instanceof HTMLSlotElement) {
      // Assigned elements render in place of the slot; with none, its fallback content does.
      const content = el.assignedNodes().length > 0 ? el.assignedElements() : [...el.children];
      entries.push({ tabIndex: tabIndexOf(el), elements: collectScope(content, container) });
      return;
    }

    const root = el.shadowRoot; // null for closed roots, which stay out of reach
    if (root !== null) {
      // Browsers skip a host with a negative tabindex together with its shadow tree.
      if (tabIndexOf(el as HTMLElement) < 0) return;
      const elements = tabbable(el) ? [el] : [];
      elements.push(...collectScope(root.children, container));
      entries.push({ tabIndex: tabIndexOf(el as HTMLElement), elements });
      return; // light DOM children only render through the shadow root's slots
    }

    if (tabbable(el)) entries.push({ tabIndex: tabIndexOf(el), elements: [el] });
    for (const child of el.children) visit(child);
  };

  for (const node of nodes) visit(node);

  const positive = entries.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  const natural = entries.filter((e) => e.tabIndex === 0);
  return [...positive, ...natural].flatMap((e) => e.elements);
}

/** Tabbable elements in the order the browser visits them, including those inside open shadow roots. */
function getTabbableElements(container: HTMLElement): HTMLElement[] {
  // A container that is itself a shadow host (a custom element) renders its shadow root.
  const top = container.shadowRoot ?? container;
  return keepOneRadioPerGroup(collectScope(top.children, container));
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
    return node instanceof Node && containers().some((c) => containsDeep(c, node));
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
    const current = deepActiveElement();
    const outside = !containsDeep(element, current);

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
    const target = originalTarget(event);
    if (isInside(target)) {
      if (target instanceof HTMLElement) lastFocusedInside = target;
      return;
    }
    // Focus moved out through a click or a script: bring it back.
    focusInside();
  }

  function onPointerDown(event: Event): void {
    const target = originalTarget(event);
    if (!isHandling() || isInside(target)) return;

    if (clickOutsideDeactivates) {
      // If the press lands on something focusable, focus naturally goes there,
      // so don't fight it by returning focus to the trigger.
      const lands = target instanceof Element && closestRendered(target, FOCUSABLE_SELECTOR) !== null;
      deactivateWith('outside-click', !lands);
      return;
    }
    if (!allowOutsideClick) event.preventDefault(); // keeps focus where it is
  }

  function onClick(event: Event): void {
    if (!isHandling() || isInside(originalTarget(event)) || allowOutsideClick || clickOutsideDeactivates) return;
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
    const active = deepActiveElement(); // the button inside a web component, not its host
    previouslyFocused = active instanceof HTMLElement ? active : null;

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
