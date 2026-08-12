# Kotlin Coroutine Lab Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Independent tasks may execute in parallel; do not edit files outside the task scope and do not commit.

**Goal:** Make the simulator honest about unsupported Kotlin, finish the agreed core coroutine subset, remove the ELK test rejection, and make the existing workbench usable on narrow screens without redesigning its visual identity.

**Architecture:** Keep the existing lexer/parser/interpreter/runtime/event pipeline and Zustand UI store. Extend behavior at existing dispatch points, reject everything outside the executable subset at validation time, and implement responsive behavior with the current panel visibility primitives and CSS. Do not add dependencies or speculative abstractions.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Vite, ELK, CSS.

## Global Constraints

- TDD: each behavior change starts with a failing focused test and records the RED and GREEN commands.
- Unknown calls and unsupported coroutine features must produce a diagnostic; they must never silently return `Unit`.
- Preserve all current lesson outputs and deterministic virtual-clock behavior.
- Do not add dependencies, implement Channel/Mutex/Semaphore/select, or redesign the desktop visual system.
- Existing desktop three-panel behavior remains unchanged above the responsive breakpoint.
- At 375 CSS pixels there is no horizontal document overflow and Code, Graph, and Explain remain reachable.
- All interactive controls retain keyboard access and have visible focus.
- Do not commit; the primary agent owns integration and final verification.

---

### Task 1: Honest validator and agreed core coroutine semantics

**Files:**
- Modify: `src/engine/validator/diagnostics.ts`
- Modify: `src/engine/validator/validator.ts`
- Modify: `src/engine/interpreter/interpreter.ts`
- Modify: existing runtime/value files only where required
- Modify: `src/engine/runtime/dispatcher.ts` and its direct UI description if required for an honest Unconfined model
- Test: focused files under `tests/engine/`
- Modify: `src/ui/about/capabilities.ts` only to reflect verified executable behavior

**Required behavior:**

- Add regression tests proving `flowOf(...).collect {}` and misspelled calls such as `laucnch {}` return diagnostics and do not execute as valid Kotlin.
- Either implement a `CoroutineStart` mode completely or explicitly reject it. For this milestone reject all explicit `start = CoroutineStart.*` arguments, including `LAZY`, because the scheduler only promises DEFAULT semantics.
- Implement `withTimeout` and `withTimeoutOrNull` using the existing deterministic virtual clock and structured cancellation.
- Implement `NonCancellable` for suspending cleanup inside `finally` after cancellation.
- Implement the minimum correct `CoroutineExceptionHandler` behavior supported by the current root/child propagation model; reject syntactic forms the simulator cannot model honestly.
- Correct the Unconfined presentation/model so it is not described as a dedicated one-thread pool. Preserve deterministic simulation and label any unavoidable approximation.
- Add every newly executable API to capabilities; remove it from unsupported diagnostics only after its focused tests pass.

**Verification:** focused RED/GREEN tests, then `npm test -- --run --project engine` and `npm run typecheck`.

### Task 2: ELK layout lifecycle and test stability

**Files:**
- Modify: `src/ui/graph/useLayout.ts`
- Modify: `src/ui/graph/elkLayout.ts` only if root cause requires it
- Modify: focused UI layout tests, including `tests/ui/use-layout.test.tsx` and/or `tests/ui/breakpoints.test.tsx`

**Required behavior:**

- Reproduce the unhandled `Layout algorithm 'layered' not found` rejection in a focused test before changing production code.
- A layout request that rejects must not become an unhandled promise rejection.
- Stale/unmounted requests must not update React state.
- Surface a small explicit layout error state through the existing hook contract or nearest existing graph boundary; do not silently swallow the error.
- Preserve lazy loading and successful deterministic ELK layout.

**Verification:** focused RED/GREEN tests, isolated breakpoint and ELK tests, then the full UI test project.

### Task 3: Responsive workbench and UX safeguards

**Files:**
- Modify: `src/ui/layout/Shell.tsx`, `src/ui/layout/shell.css`, and existing panel visibility helpers as needed
- Modify: `src/state/store.ts`
- Modify: lesson/source loading controls and capability modal files as needed
- Modify: existing component CSS for focus and touch targets
- Test: focused files under `tests/ui/`

**Required behavior:**

- Below a single responsive breakpoint near 900px, show one primary workspace region at a time using the existing Code/Graph/Explain visibility controls; hide splitters and remove fixed 460px/280px grid constraints.
- Header controls wrap or remain reachable; use dynamic viewport height where supported; no document horizontal overflow at 375px.
- Preserve the desktop three-panel layout.
- Loading a lesson, blank source, or example saves one previous source and exposes a one-click Restore/Undo action. Avoid confirmation modals.
- Make the initial empty workspace actionable with a direct Start lesson 1 affordance.
- Group capability content into Core, Context, Flow, and Advanced sections without changing the actual source-of-truth capability lists.
- Add visible `:focus-visible` styles and practical mobile touch targets to existing buttons/tabs.

**Verification:** focused RED/GREEN component/store tests, `npm test -- --run --project ui`, and browser checks at 1440x900 and 375x812.

### Task 4: Integration and review

**Owner:** primary agent.

- Review every diff against this plan and remove unrelated changes.
- Run `npm run typecheck`, `npm run lint`, `npm test -- --run`, and `npm run build`.
- Run browser smoke checks for desktop, mobile, lesson switch/undo, empty-state onboarding, focus navigation, and graph layout failure behavior where practical.
- Dispatch a separate final reviewer, fix Critical/Important findings, then re-run all verification.
