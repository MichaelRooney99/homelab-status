import { useEffect, useRef } from 'react'
import type { StatusPage } from '../services/types'

const BASE_TITLE = 'Homelab Status'

// Reflects alert state two places a visitor might notice without the tab
// being focused: the title (visible even backgrounded) and the favicon
// itself, via a small red dot composited onto whatever the real favicon
// already is. The compositing happens at runtime against the actual
// <link rel="icon"> already in the page, not a separate pre-made "alert"
// asset — works regardless of what the favicon looks like, zero new
// image files needed.
export function useTabAlert(statusPage: StatusPage | undefined) {
  const originalFaviconHref = useRef<string | null>(null)

  useEffect(() => {
    if (!statusPage) return

    const activeIncidentCount = statusPage.incidents.filter(
      i => i.status !== 'resolved'
    ).length
    const hasAlert = statusPage.overall !== 'operational' || activeIncidentCount > 0

    document.title = hasAlert
      ? `🔴 ${activeIncidentCount > 0 ? `(${activeIncidentCount}) ` : ''}${BASE_TITLE}`
      : BASE_TITLE

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return

    if (originalFaviconHref.current === null) {
      originalFaviconHref.current = link.href
    }
    const baseHref = originalFaviconHref.current

    if (!hasAlert) {
      link.href = baseHref
      return
    }

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || 64
      canvas.height = img.naturalHeight || 64
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const dotRadius = canvas.width * 0.26
      const cx = canvas.width - dotRadius * 0.95
      const cy = canvas.height - dotRadius * 0.95

      // Dark ring first so the dot stays legible regardless of what
      // color sits underneath it in the actual favicon art.
      ctx.beginPath()
      ctx.arc(cx, cy, dotRadius * 1.15, 0, Math.PI * 2)
      ctx.fillStyle = '#09090b'
      ctx.fill()

      ctx.beginPath()
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
      ctx.fillStyle = '#ef4444'
      ctx.fill()

      link.href = canvas.toDataURL('image/png')
    }
    img.src = baseHref
  }, [statusPage])
}