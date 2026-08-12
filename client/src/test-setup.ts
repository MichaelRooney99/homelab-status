import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView at all — calling it throws
// "not implemented" rather than silently no-op-ing. CommandPalette.tsx
// calls it directly (keeping the highlighted row in view as arrow keys
// move past it), so without this stub, any test that renders the
// palette and presses an arrow key fails on something that has nothing
// to do with the actual behavior being tested.
Element.prototype.scrollIntoView = () => {}
