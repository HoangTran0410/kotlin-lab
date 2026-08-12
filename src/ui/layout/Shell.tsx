import type { ReactNode } from 'react'
import { SimulationNotice } from '../common/SimulationNotice'
import './shell.css'

export function Shell({ nav, editor, graph, timeline, side }: {
  nav: ReactNode; editor: ReactNode; graph: ReactNode; timeline: ReactNode; side: ReactNode
}) {
  return (
    <div className="shell">
      <header className="shell__head">
        <h1>Kotlin Coroutines Lab</h1>
        {nav}
      </header>
      <SimulationNotice />
      <div className="shell__main">
        <div className="shell__left">{editor}</div>
        <div className="shell__center">{graph}</div>
        <div className="shell__right">{side}</div>
      </div>
      <footer className="shell__foot">{timeline}</footer>
    </div>
  )
}
