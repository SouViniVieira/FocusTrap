# focus-trap

A lightweight, dependency-free focus trap written in TypeScript.

A **focus trap** keeps keyboard focus (Tab / Shift+Tab) confined to a container
element while it is active — a core accessibility requirement for modals,
dialogs, drawers, and any overlay that shouldn't let focus escape to the content
behind it. When the trap is deactivated, focus is returned to wherever it was
before.

- **Tiny** — ~1 kB gzipped, zero runtime dependencies.
- **Typed** — ships with full TypeScript declarations.
- **Dual format** — ESM and CommonJS builds.

## Install

```sh
npm install focus-trap
```

## Usage

```ts
import { createFocusTrap } from 'focus-trap';

const modal = document.querySelector<HTMLElement>('#modal')!;
const trap = createFocusTrap(modal);

// Open the modal and confine focus to it.
trap.activate();

// Close the modal and restore focus to the previously focused element.
trap.deactivate();
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

## Development

```sh
npm install
npm test          # run the test suite (Vitest + jsdom)
npm run coverage  # run tests with coverage
npm run build     # produce dist/ (ESM + CJS + types)
```

## License

MIT
