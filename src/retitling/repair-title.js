import { buildSessionTitleContext } from "../context/session-context.js"
import { canAutomaticallyRetitle, writeAutomaticTitle } from "../omp/omp-adapter.js"
import { hasPendingTitleRequest } from "./generate-title.js"
import { getConversationLeafId, getTaskIdentity } from "./session-identity.js"

export async function restoreAcceptedTitle(sessionManager, sessionState, reason) {
  const acceptedTitle = sessionState.acceptedTitle
  if (acceptedTitle && sessionManager.getSessionName?.() === acceptedTitle.title) return false

  const blocker = getTitleRepairBlocker(sessionManager, sessionState)
  if (blocker) {
    sessionState.lastRepairOutcome = `Skipped: ${blocker}`
    return false
  }

  const changed = await writeAutomaticTitle(sessionManager, acceptedTitle.title, reason)
  if (changed) {
    sessionState.lastRepairOutcome = `Restored: ${reason}`
  } else {
    sessionState.lastRepairOutcome = "No title write accepted"
  }

  return changed
}

export function getTitleRepairBlocker(sessionManager, sessionState) {
  if (!canAutomaticallyRetitle(sessionManager)) return "manual title ownership"
  if (hasPendingTitleRequest(sessionManager)) return "newer title request pending"

  const acceptedTitle = sessionState.acceptedTitle
  const extensionContext = sessionState.extensionContext
  if (!acceptedTitle) return "no accepted title cached in this process"
  if (!extensionContext) return "no active session context"
  if (sessionManager.getSessionId?.() !== acceptedTitle.sessionId) return "session changed"
  if (sessionState.branchRevision !== acceptedTitle.branchRevision) return "branch changed"
  if (getConversationLeafId(sessionManager) !== acceptedTitle.conversationLeafId) return "conversation advanced"
  if (sessionState.taskIdentity !== acceptedTitle.taskIdentity) return "task identity changed"

  const currentTitleContext = buildSessionTitleContext({}, extensionContext)
  if (!currentTitleContext || getTaskIdentity(currentTitleContext) !== acceptedTitle.taskIdentity) {
    return "task identity changed"
  }
  if (currentTitleContext.input !== acceptedTitle.input) return "title context changed"

  return undefined
}
