import type * as React from 'react'

/** A plain primary click: one that in-page state may take over (a modified click keeps the link's default, e.g. a new tab). */
export const isPlainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
