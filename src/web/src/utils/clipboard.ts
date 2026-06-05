/**
 * Copy text to clipboard with fallback for non-secure contexts.
 * navigator.clipboard.writeText requires HTTPS or localhost.
 * Falls back to execCommand('copy') for HTTP environments.
 */
export async function copyToClipboard(text: string): Promise<void> {
  // Try modern Clipboard API first (requires secure context)
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to legacy method
    }
  }

  // Fallback: use execCommand with a temporary textarea
  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []

  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.setAttribute('tabindex', '-1')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.width = '2px'
  textarea.style.height = '2px'
  textarea.style.padding = '0'
  textarea.style.border = 'none'
  textarea.style.outline = 'none'
  textarea.style.boxShadow = 'none'
  textarea.style.background = 'transparent'
  textarea.style.color = 'transparent'
  textarea.style.fontSize = '16px'
  textarea.style.userSelect = 'text'
  textarea.style.clipPath = 'inset(50%)'

  document.body.appendChild(textarea)

  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)

    const success = document.execCommand('copy')
    if (!success) {
      throw new Error('execCommand copy failed')
    }
  } finally {
    document.body.removeChild(textarea)
    if (selection) {
      selection.removeAllRanges()
      for (const range of selectedRanges) {
        selection.addRange(range)
      }
    }
    activeElement?.focus({ preventScroll: true })
  }
}
