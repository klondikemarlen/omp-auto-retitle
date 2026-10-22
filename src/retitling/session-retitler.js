import { buildSessionTitleContext } from "../context/session-context.js"
import { canAutomaticallyRetitle, observeExternalAutomaticTitles } from "../omp/omp-adapter.js"
import { generateAndCommitTitle, invalidatePendingTitleRequest } from "./generate-title.js"
import { restoreAcceptedTitle } from "./repair-title.js"
import { getConversationLeafId, getTaskIdentity } from "./session-identity.js"
import { describeRetitleStatus } from "./title-status.js"

const sessionStates = new WeakMap()

export async function retitleSession(event, extensionContext, options = {}, reason = "command") {
  const sessionManager = extensionContext?.sessionManager
  if (!sessionManager || !canAutomaticallyRetitle(sessionManager)) return false

  const titleContext = buildSessionTitleContext(event, extensionContext)
  if (!titleContext) return false

  const sessionState = getOrCreateSessionState(sessionManager)
  updateSessionContext(sessionState, sessionManager, extensionContext)
  return generateAndCommitTitle(titleContext, extensionContext, sessionState, options, reason)
}

export async function handleCompletedAgentRun(event, extensionContext, options) {
  const sessionManager = extensionContext?.sessionManager
  const sessionState = getOrCreateSessionState(sessionManager)
  const titleContext = buildSessionTitleContext(event, extensionContext)
  if (!sessionState || !titleContext) return

  updateSessionContext(sessionState, sessionManager, extensionContext)
  const taskIdentity = getTaskIdentity(titleContext)
  const taskChanged = sessionState.taskIdentity !== taskIdentity
  sessionState.taskIdentity = taskIdentity

  if (!taskChanged && sessionState.acceptedTitle?.taskIdentity === taskIdentity) {
    sessionState.acceptedTitle.input = titleContext.input
    sessionState.acceptedTitle.conversationLeafId = getConversationLeafId(sessionManager)
  }

  const refreshReason = getAutomaticRefreshReason(sessionState, taskChanged)
  if (refreshReason) {
    sessionState.hasGeneratedTitle = true
    sessionState.replanRequested = false
    await retitleSession(event, extensionContext, options, refreshReason)
    return
  }

  await restoreAcceptedTitle(sessionManager, sessionState, "settled-repair")
}

export function requestReplanRefresh(event, extensionContext) {
  if (event.toolName !== "todo" || event.isError || event.details?.op !== "init") return

  const sessionState = getOrCreateSessionState(extensionContext?.sessionManager)
  if (sessionState) sessionState.replanRequested = true
}

export function startRetitleSession(extensionContext) {
  const sessionManager = extensionContext?.sessionManager
  const sessionState = getOrCreateSessionState(sessionManager)
  if (!sessionState) return

  updateSessionContext(sessionState, sessionManager, extensionContext)
}

export function resetBranchRetitling(sessionManager) {
  const sessionState = getOrCreateSessionState(sessionManager)
  if (!sessionState) return

  invalidatePendingTitleRequest(sessionManager)
  sessionState.hasGeneratedTitle = false
  sessionState.taskIdentity = undefined
  sessionState.acceptedTitle = undefined
  sessionState.lastRepairOutcome = "Repair cache cleared after branch change"
  sessionState.branchRevision += 1
}

export function resetSessionRetitling(sessionManager) {
  const sessionState = getOrCreateSessionState(sessionManager)
  if (!sessionState) return

  invalidatePendingTitleRequest(sessionManager)
  resetSessionState(sessionState, sessionManager)
}

export function stopRetitleSession(sessionManager) {
  const sessionState = sessionManager && sessionStates.get(sessionManager)
  if (!sessionState) return

  sessionState.unsubscribeFromTitleChanges?.()
  sessionStates.delete(sessionManager)
}

export function getRetitleStatus(extensionContext, options) {
  const sessionManager = extensionContext?.sessionManager
  const sessionState = sessionManager && sessionStates.get(sessionManager)
  return describeRetitleStatus(extensionContext, sessionState, options)
}

function getAutomaticRefreshReason(sessionState, taskChanged) {
  if (sessionState.replanRequested) return "replan"
  if (!sessionState.hasGeneratedTitle) return "first-task"
  if (taskChanged) return "task"

  return undefined
}

function getOrCreateSessionState(sessionManager) {
  if (!sessionManager) return undefined

  const existingState = sessionStates.get(sessionManager)
  if (existingState) return existingState

  const sessionState = {
    sessionId: sessionManager.getSessionId?.(),
    branchRevision: 0,
    hasGeneratedTitle: false,
    replanRequested: false,
    taskIdentity: undefined,
    extensionContext: undefined,
    acceptedTitle: undefined,
    unsubscribeFromTitleChanges: undefined,
    lastRepairOutcome: "No repair attempt in this process",
  }
  sessionState.unsubscribeFromTitleChanges = observeExternalAutomaticTitles(
    sessionManager,
    () => restoreAcceptedTitle(sessionManager, sessionState, "native-repair"),
    (error) => reportTitleObserverError(sessionState, error),
  )
  if (typeof sessionState.unsubscribeFromTitleChanges !== "function") {
    console.warn("[omp-auto-retitle] Session title observer unavailable; native automatic title writes cannot be repaired.")
  }
  sessionStates.set(sessionManager, sessionState)
  return sessionState
}

function updateSessionContext(sessionState, sessionManager, extensionContext) {
  if (sessionState.sessionId !== sessionManager.getSessionId?.()) {
    resetSessionState(sessionState, sessionManager)
  }

  sessionState.extensionContext = extensionContext
}

function resetSessionState(sessionState, sessionManager) {
  sessionState.sessionId = sessionManager.getSessionId?.()
  sessionState.hasGeneratedTitle = false
  sessionState.replanRequested = false
  sessionState.taskIdentity = undefined
  sessionState.acceptedTitle = undefined
  sessionState.lastRepairOutcome = "No repair attempt in this session"
  sessionState.branchRevision += 1
}

function reportTitleObserverError(sessionState, error) {
  const message = error?.message ?? error
  sessionState.lastRepairOutcome = `Error: ${message}`
  sessionState.extensionContext?.ui?.notify?.(`Auto-retitle title observer failed: ${message}`, "error")
}
