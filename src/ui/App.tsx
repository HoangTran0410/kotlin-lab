import { Panel } from './layout/Panel'
import { Shell } from './layout/Shell'

export function App() {
  return (
    <Shell
      nav={<nav>Bài học</nav>}
      editor={
        <Panel title="Mã Kotlin" grow>
          <p>Trình soạn thảo sẽ vào đây ở task sau.</p>
        </Panel>
      }
      graph={
        <Panel title="Sơ đồ coroutine" grow>
          <p>Sơ đồ coroutine sẽ vào đây ở task sau.</p>
        </Panel>
      }
      timeline={
        <Panel title="Dòng thời gian">
          <p>Thanh kéo dòng thời gian sẽ vào đây ở task sau.</p>
        </Panel>
      }
      side={
        <Panel title="Console & chẩn đoán" grow>
          <p>Console và chẩn đoán sẽ vào đây ở task sau.</p>
        </Panel>
      }
    />
  )
}
