import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useLabStore } from '../../src/state/store'

const { mockUseLayout } = vi.hoisted(() => ({ mockUseLayout: vi.fn() }))

vi.mock('../../src/ui/graph/useLayout', () => ({ useLayout: mockUseLayout }))

import { App } from '../../src/ui/App'

describe('graph layout error', () => {
  beforeEach(() => {
    useLabStore.setState({ source: '', stepIndex: 0, lessonId: null })
    mockUseLayout.mockReturnValue({
      layout: new Map(),
      error: "Layout algorithm 'layered' not found",
    })
  })

  it('shows the rejected ELK request at the graph boundary', () => {
    render(<App />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Could not lay out graph: Layout algorithm 'layered' not found",
    )
  })
})
