# focus-trap

[![CI](https://github.com/SouViniVieira/FocusTrap/actions/workflows/ci.yml/badge.svg)](https://github.com/SouViniVieira/FocusTrap/actions/workflows/ci.yml)

A small, dependency-free focus trap for accessible dialogs, drawers and overlays, written in TypeScript.

**[Try the live demo with your keyboard →](https://souvinivieira.github.io/FocusTrap/)**

## The problem it solves

When something opens on top of the page, like a dialog or a slide-out menu, keyboard users expect focus to stay inside it. <kbd>Tab</kbd> should cycle through the overlay's own controls instead of leaking to the links and buttons hidden behind it, and closing the overlay should put focus back where it was.

Without that, people who navigate by keyboard (many people with motor or visual disabilities, and everyone using a screen reader) tab into content they can't see, get lost, and can't reliably use or close the overlay.

## Reach for native `<dialog>` first

Modern browsers ship a lot of this for free. A `<dialog>` opened with `showModal()` keeps focus inside, closes on <kbd>Esc</kbd>, makes the rest of the page inert and returns focus on close. If your overlay can be a modal `<dialog>`, use it.

This library is for the cases where it can't:

- **Drawers, sheets and custom popovers** that aren't built on `<dialog>`.
- **Design systems and legacy code** where the overlay markup is already set, or where you need behavior `<dialog>` doesn't offer, such as blocking outside clicks or keeping a portal "inside".
- **Nested overlays** that need predictable stacking: a confirmation opened from inside a form dialog.

## What it handles

- **The real tab order.** Positive `tabindex` values first, then document order. A radio group counts as one stop (the checked radio, or the first one), the way browsers do it.
- **Web components.** Buttons and inputs inside open shadow roots are part of the cycle, in the order the browser visits them: slotted content where its slot is, positive `tabindex` sorted within each shadow root, and a host with `tabindex="-1"` skipped along with its shadow content.
- **What shouldn't get focus.** Disabled controls, controls inside a disabled `<fieldset>` (except its legend), content of a closed `<details>`, `inert` subtrees, `aria-hidden="true"` regions, negative `tabindex`, and anything hidden with `display` or `visibility`.
- **Focus that escapes without Tab.** Clicks and scripts that move focus outside are pulled back in. Outside clicks are blocked by default, like a backdrop, and can be allowed or used to close.
- **Escape that plays well with others.** If a component inside the trap handles <kbd>Esc</kbd> first (a combobox closing its list, say) and calls `preventDefault`, the trap stays open.
- **Focus return that sticks.** On close, focus goes back to the element that opened the overlay. After an outside click, it waits until the browser finishes its own mouse handling, so it isn't undone.
- **Nested traps.** Activating a trap pauses the one underneath. Closing it hands control back.
- **Portals and dynamic content.** Extra containers (a date picker rendered at the end of `<body>`) can count as inside, and content added or removed while open is handled.
- **No leftovers.** Listeners, observers and any `tabindex` the trap added are removed on deactivate.

About 2.4 kB minified and gzipped, zero runtime dependencies, fully typed.

## Usage

> Not published to npm yet. Copy [`src/index.ts`](src/index.ts) into your project, or run `npm run build` and use the files in `dist/`.

Activate on open, deactivate on close, and let `onDeactivate` keep your UI in sync when the user presses <kbd>Esc</kbd> or clicks outside:

```html
<button id="open">Request access</button>

<div id="backdrop" hidden>
  <div id="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <h2 id="dialog-title">Request access</h2>
    <!-- form fields -->
    <button id="close">Cancel</button>
  </div>
</div>
```

```ts
import { createFocusTrap } from './focus-trap';

const backdrop = document.querySelector<HTMLElement>('#backdrop')!;
const dialog = document.querySelector<HTMLElement>('#dialog')!;

const trap = createFocusTrap(dialog, {
  clickOutsideDeactivates: true, // a click on the backdrop closes it
  onDeactivate: () => {
    backdrop.hidden = true; // runs for Esc, outside clicks and trap.deactivate()
  },
});

document.querySelector('#open')!.addEventListener('click', () => {
  backdrop.hidden = false;
  trap.activate(); // focus moves inside; Tab is now confined
});

document.querySelector('#close')!.addEventListener('click', () => trap.deactivate());
```

### With React

```tsx
import { useEffect, useRef } from 'react';
import { createFocusTrap } from './focus-trap';

function Dialog({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || ref.current === null) return;
    const trap = createFocusTrap(ref.current, {
      onDeactivate: (reason) => {
        if (reason !== 'api') onClose(); // Esc or outside click
      },
    });
    trap.activate();
    return () => trap.deactivate(); // focus returns on close or unmount
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title}>
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

## Accessibility checklist for your overlay

The trap handles focus. The rest is still up to the markup:

- [ ] `role="dialog"` (or `alertdialog` for confirmations) and `aria-modal="true"`.
- [ ] An accessible name: `aria-labelledby` pointing to the visible title.
- [ ] A visible way to close it, not only <kbd>Esc</kbd>.
- [ ] A visible focus indicator on everything inside.
- [ ] The trigger reflects state when relevant, like `aria-expanded` on a menu button.

Together, these support WCAG 2.2 criteria such as **2.1.1 Keyboard**, **2.1.2 No Keyboard Trap** (<kbd>Esc</kbd> and the close button always provide a way out), **2.4.3 Focus Order** and **2.4.11 Focus Not Obscured**.

## API

### `createFocusTrap(element, options?)`

Creates a trap bound to `element` and returns a `FocusTrap` handle.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `initialFocus` | `HTMLElement \| (() => HTMLElement \| null)` | first tabbable | Element focused on activation. Falls back to the container. |
| `returnFocusOnDeactivate` | `boolean` | `true` | Return focus to the element that was focused before activation. |
| `escapeDeactivates` | `boolean` | `true` | <kbd>Esc</kbd> deactivates, unless something inside already handled it. |
| `clickOutsideDeactivates` | `boolean` | `false` | A pointer press outside deactivates the trap. |
| `allowOutsideClick` | `boolean` | `false` | Let outside clicks through instead of blocking them. |
| `additionalContainers` | `HTMLElement[] \| (() => HTMLElement[])` | none | Extra elements treated as inside, such as portals. |
| `onActivate` | `() => void` | none | Called after activation. |
| `onDeactivate` | `(reason: 'escape' \| 'outside-click' \| 'api') => void` | none | Called after deactivation, with the reason. |

### `FocusTrap`

| Member | Type | Description |
| --- | --- | --- |
| `activate()` | `() => void` | Move focus inside and start trapping. Pauses any trap below it. Idempotent. |
| `deactivate()` | `() => void` | Stop trapping and, by default, return focus. Resumes the trap below. |
| `pause()` / `unpause()` | `() => void` | Temporarily stop and resume trapping without deactivating. |
| `active` | `boolean` | Whether the trap is active (read-only). |
| `paused` | `boolean` | Whether the trap is paused (read-only). |

## Known limitations

- Doesn't look inside closed shadow roots or iframes, and doesn't special-case `delegatesFocus`.
- The trap container itself can't live inside a shadow root (it can be a shadow host).
- If the focused element is removed from inside a shadow root, focus isn't pulled back until the next Tab or focus change: content changes are only watched in the container's light DOM.
- Radio buttons with the same `name` in different shadow roots are treated as one group.
- Browsers don't report focus moves inside a single shadow root to the page. If the user tabs between buttons of the same web component and focus then escapes the trap, it returns to the element that was focused when focus entered that component, not the last one inside it.
- Composite widgets other than radio groups (toolbars, grids with roving `tabindex`) should manage their own internal tab stop with `tabindex="-1"` on the inactive items, which the trap already respects.

## Development

```sh
npm install
npm run dev         # interactive demo at http://localhost:5173
npm test            # unit tests (Vitest + jsdom)
npm run coverage    # tests with coverage
npm run build       # library build: ESM + CJS + types in dist/
npm run build:demo  # static demo for GitHub Pages in demo-dist/
```

CI runs the type check, tests and build on every push and pull request. The demo deploys to GitHub Pages from `master`.

## License

[MIT](LICENSE) © Vinicius Vieira
