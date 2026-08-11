export type JobId = string
export type ThreadId = string
export type FlowId = string

export type JobState = 'New' | 'Active' | 'Completing' | 'Completed' | 'Cancelling' | 'Cancelled'

export interface CtxSummary {
  dispatcher: string
  name: string | null
  isSupervisor: boolean
  hasHandler: boolean
}

export type EventBody =
  | { k: 'COROUTINE_CREATED'; id: JobId; parentId: JobId | null
      builder: 'launch' | 'async' | 'runBlocking' | 'coroutineScope' | 'supervisorScope' | 'withContext'
      ctx: CtxSummary }
  | { k: 'COROUTINE_STARTED'; id: JobId; threadId: ThreadId }
  | { k: 'COROUTINE_SUSPENDED'; id: JobId; reason: 'delay' | 'await' | 'join' | 'yield' | 'collect' | 'emit' }
  | { k: 'COROUTINE_RESUMED'; id: JobId; threadId: ThreadId }
  | { k: 'JOB_STATE'; id: JobId; from: JobState; to: JobState; cause?: string }
  | { k: 'EXCEPTION_THROWN'; id: JobId; exType: string; message: string }
  | { k: 'EXCEPTION_CAUGHT'; id: JobId; exType: string }
  | { k: 'FAILURE_PROPAGATED'; from: JobId; to: JobId; blockedBySupervisor: boolean }
  | { k: 'CANCEL_REQUESTED'; from: JobId | 'user'; to: JobId; cause: string }
  | { k: 'HANDLER_RECEIVED'; id: JobId; handler: 'CEH' | 'platform'; exType: string }
  | { k: 'DISPATCH'; id: JobId; dispatcher: string; threadId: ThreadId }
  | { k: 'THREAD_STATE'; threadId: ThreadId; state: 'RUNNING' | 'FREE' }
  | { k: 'PRINTLN'; id: JobId; text: string }

export type Event = EventBody & { seq: number; t: number; srcLine?: number }
