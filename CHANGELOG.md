# Changelog

## 0.2.0 (2026-10-13)

### Added
- `onActivate` and `onDeactivate(reason)` callbacks, so the overlay can close itself on Escape or outside clicks.
- Nested traps: activating a trap pauses the one below; deactivating resumes it. Manual `pause()` / `unpause()` and a `paused` getter.
- Focus that leaves through a click or a script is pulled back in (`focusin` guard).
- Outside clicks are blocked by default; `allowOutsideClick` lets them through.
- `additionalContainers` for portals rendered outside the trap.
- Browser-accurate tab order: positive `tabindex` first, one stop per radio group, disabled `<fieldset>` and closed `<details>` content skipped, `<summary>` included.
- Interactive demo published to GitHub Pages, CI workflow, LICENSE file.

### Changed
- Escape is handled in the bubble phase and ignored when an inner component already called `preventDefault`.
- After an outside-click deactivation, focus is restored once the browser finishes its mousedown handling, so it isn't undone.
- `aria-hidden="true"` is checked on ancestors inside the container, not only on the element itself.
- The `tabindex="-1"` added as a fallback is removed on deactivate.
- Package renamed to `@souvinivieira/focus-trap` (the unscoped name is taken on npm).
- Dev dependencies updated (Vite 8, Vitest 5, TypeScript 6); `npm audit` is clean.

## 0.1.0 (2026-07-12)

- First version: Tab confinement, focus return, Escape, `clickOutsideDeactivates`, dynamic content handling.
