import { useCallback, useEffect, useState } from 'react'

// Cmd/Ctrl+K and "/" both open the palette — "/" matches GitHub's own
// jump-to convention. The guard against typing targets doesn't protect
// any real input in this app today (there isn't one yet), but it's cheap
// insurance against "/" swallowing a keystroke the moment one gets added.
export function useCommandPalette(disabled = false) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (disabled || isOpen) return

      const target = event.target as HTMLElement | null
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable)

      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const isSlash = event.key === '/' && !isTypingTarget

      if (isCmdK || isSlash) {
        event.preventDefault()
        setIsOpen(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled, isOpen])

  return { isOpen, open, close }
}