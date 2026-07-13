# focus-trap

A lightweight, dependency-free focus trap written in TypeScript.

## The problem it solves

When a website opens something on top of the page — a modal, a dialog, a slide-out
menu — keyboard users expect focus to stay inside it. Press <kbd>Tab</kbd> and the
focus should cycle through the dialog's own controls, not leak to the links and
buttons hidden behind it.

Without that, someone navigating by keyboard (many people with visual or motor
disabilities, plus anyone using a screen reader) tabs "into" content they can't
see, gets lost, and can't reliably close or use the dialog. Trapping focus while
an overlay is open — and returning it to where it was on close — is a baseline
requirement of an accessible interface (WCAG 2.1, *2.4.3 Focus Order* and
*2.1.2 No Keyboard Trap*).

This library does exactly that, and nothing else:

- Confines <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> to a container while active.
- Returns focus to the previously focused element on close.
- Handles <kbd>Escape</kbd>, outside clicks, and content that changes while open.

Properties:

- **Tiny** — ~1 kB gzipped, zero runtime dependencies.
- **Typed** — ships with full TypeScript declarations.
- **Framework-agnostic** — it only touches the DOM, so it works with vanilla JS,
  React, Vue, Svelte, or anything else.

## Try the demo

```sh
npm install
npm run dev   # http://localhost:5173
```

Open the modal, then tab around: focus stays inside. Try <kbd>Escape</kbd>, click
the backdrop, and add/remove fields to see dynamic content handled.

## Use it in your project

> Not published to npm. For now, copy [`src/index.ts`](src/index.ts) into your
> project (or `npm run build` and use the files in `dist/`).

The pattern is always the same: **activate on open, deactivate on close.**

```ts
import { createFocusTrap } from './focus-trap';

const modal = document.querySelector<HTMLElement>('#modal')!;
const openButton = document.querySelector<HTMLElement>('#open')!;

const trap = createFocusTrap(modal, {
  clickOutsideDeactivates: true, // clicking the backdrop closes it
});

function openModal() {
  modal.hidden = false;
  trap.activate(); // focus moves inside; Tab is now confined
}

function closeModal() {
  trap.deactivate(); // focus returns to openButton automatically
  modal.hidden = true;
}

openButton.addEventListener('click', openModal);
modal.querySelector('#close')!.addEventListener('click', closeModal);
```

Because Escape and outside clicks deactivate the trap on their own, keep your UI
in sync by hiding the overlay when focus leaves it:

```ts
modal.addEventListener('focusout', () => {
  if (!trap.active) modal.hidden = true;
});
```

### With React

```tsx
import { useEffect, useRef } from 'react';
import { createFocusTrap } from './focus-trap';

function Modal({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || ref.current === null) return;
    const trap = createFocusTrap(ref.current, { escapeDeactivates: true });
    trap.activate();
    return () => trap.deactivate(); // cleanup restores focus on unmount/close
  }, [open]);

  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true">
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

## API

### `createFocusTrap(element, options?)`

Creates a focus trap bound to `element`. Returns a `FocusTrap` handle.

| Parameter | Type                | Description                             |
| --------- | ------------------- | --------------------------------------- |
| `element` | `HTMLElement`       | The container focus is confined to.     |
| `options` | `FocusTrapOptions`  | Optional behaviour overrides (below).   |

### Options

| Option                    | Type                                            | Default | Description                                                                                          |
| ------------------------- | ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `initialFocus`            | `HTMLElement \| (() => HTMLElement \| null)`    | —       | Element focused on activation. Defaults to the first focusable element, falling back to the container. |
| `returnFocusOnDeactivate` | `boolean`                                       | `true`  | Restore focus to the previously focused element on deactivate.                                       |
| `escapeDeactivates`       | `boolean`                                       | `true`  | Pressing <kbd>Escape</kbd> deactivates the trap.                                                     |
| `clickOutsideDeactivates` | `boolean`                                       | `false` | A pointer press outside the container deactivates the trap.                                          |

### `FocusTrap`

| Member         | Type         | Description                                                        |
| -------------- | ------------ | ------------------------------------------------------------------ |
| `activate()`   | `() => void` | Move focus inside and start confining Tab. Idempotent.             |
| `deactivate()` | `() => void` | Stop confining focus and (by default) restore the previous focus.  |
| `active`       | `boolean`    | Whether the trap is currently active (read-only).                  |

## How focusable elements are detected

The trap collects candidates matching common focusable selectors (links,
buttons, form controls, `[tabindex]`, `[contenteditable]`, media with controls)
and then filters out elements that are `disabled`, `aria-hidden="true"`, inside
an `[inert]` subtree, opted out via a negative `tabindex`, or hidden via
`display: none` / `visibility: hidden`.

Visibility is checked with `getComputedStyle` rather than `offsetParent` or
bounding rects, so it stays correct for `position: fixed` elements and in
environments that don't compute layout.

The candidate set is recomputed on every Tab press, so content added or removed
while the trap is active is handled automatically. A `MutationObserver` also
pulls focus back inside if the currently focused element is removed from the DOM.

## Development

```sh
npm install
npm run dev       # serve the browser demo (index.html) via Vite
npm test          # run the test suite (Vitest + jsdom)
npm run coverage  # run tests with coverage
npm run build     # produce dist/ (ESM + CJS + types)
```

## License

MIT
