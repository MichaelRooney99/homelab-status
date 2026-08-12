import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useCommandPalette } from './useCommandPalette'

// renderHook is the React Testing Library equivalent of "just call the
// function" for a plain unit test — it mounts a hook inside a real,
// disposable component under the hood, without needing to write that
// throwaway component by hand every time. cleanup() after each test
// unmounts it, which matters here specifically: the hook's own effect
// attaches a real document-level keydown listener, and an unmounted
// hook needs its cleanup function to actually run or leftover listeners
// leak across tests and start reacting to keystrokes from a completely
// different test's assertions.
afterEach(() => {
  cleanup()
})

// Dispatches a real KeyboardEvent, the same way a browser does — not a
// synthetic call directly into the hook's internals. `target` matters
// for the typing-guard tests below: dispatching on a specific element
// and letting the event bubble (the default) is what makes
// event.target read as that element inside the hook's real listener,
// same as it would for an actual keystroke typed into that element.
function pressKey(
  target: EventTarget,
  key: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {}
) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    )
  })
}

describe('useCommandPalette', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useCommandPalette())
    expect(result.current.isOpen).toBe(false)
  })

  it('opens on Cmd+K', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressKey(document.body, 'k', { metaKey: true })
    expect(result.current.isOpen).toBe(true)
  })

  it('opens on Ctrl+K', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressKey(document.body, 'k', { ctrlKey: true })
    expect(result.current.isOpen).toBe(true)
  })

  it('opens on a bare "/" when nothing is focused', () => {
    const { result } = renderHook(() => useCommandPalette())
    pressKey(document.body, '/')
    expect(result.current.isOpen).toBe(true)
  })

  // The actual reason this hook exists as more than a two-line
  // keydown listener — confirms the guard the file's own top comment
  // describes actually works, not just that it's there.
  it('does not open on "/" when the event target is a text input', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    const { result } = renderHook(() => useCommandPalette())
    pressKey(input, '/')

    expect(result.current.isOpen).toBe(false)
    document.body.removeChild(input)
  })

  it('does not open on "/" when the event target is a textarea', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    const { result } = renderHook(() => useCommandPalette())
    pressKey(textarea, '/')

    expect(result.current.isOpen).toBe(false)
    document.body.removeChild(textarea)
  })

  // Cmd/Ctrl+K is deliberately NOT guarded by isTypingTarget the way
  // "/" is — confirms that's a real, working distinction and not an
  // oversight. A modifier chord is unambiguous in a way a bare "/"
  // typed into a search box isn't, so it's expected to fire regardless
  // of focus.
  it('still opens on Cmd+K even when a text input is focused', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    const { result } = renderHook(() => useCommandPalette())
    pressKey(input, 'k', { metaKey: true })

    expect(result.current.isOpen).toBe(true)
    document.body.removeChild(input)
  })

  it('does nothing when disabled', () => {
    const { result } = renderHook(() => useCommandPalette(true))
    pressKey(document.body, 'k', { metaKey: true })
    pressKey(document.body, '/')
    expect(result.current.isOpen).toBe(false)
  })

  it('open() and close() work directly, independent of any keyboard event', () => {
    const { result } = renderHook(() => useCommandPalette())

    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)

    act(() => result.current.close())
    expect(result.current.isOpen).toBe(false)
  })

  // The guard is `if (disabled || isOpen) return` — once open, a second
  // shortcut press should be a no-op, not toggle it closed or do
  // anything else unexpected. Closing is close()'s job alone.
  it('a second shortcut press while already open does not close it', () => {
    const { result } = renderHook(() => useCommandPalette())

    pressKey(document.body, 'k', { metaKey: true })
    expect(result.current.isOpen).toBe(true)

    pressKey(document.body, 'k', { metaKey: true })
    expect(result.current.isOpen).toBe(true)
  })
})
