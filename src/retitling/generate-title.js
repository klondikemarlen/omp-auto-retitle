import { formatSessionTitle } from "../context/title-format.js"
import { canAutomaticallyRetitle, generateTitleWithOmp, writeAutomaticTitle } from "../omp/omp-adapter.js"
import { resolveTitlePolicy } from "../omp/title-policy.js"
import { getConversationLeafId, getTaskIdentity } from "./session-identity.js"

// Requests can outlive a lifecycle subscription, so their ownership has its own store.
const pendingRequests = new WeakMap()

export function hasPendingTitleRequest(sessionManager) {
  return pendingRequests.has(sessionManager)
}

export function invalidatePendingTitleRequest(sessionManager) {
  pendingRequests.delete(sessionManager)
}

export async function generateAndCommitTitle(titleContext, extensionContext, sessionState, options, reason) {
  const sessionManager = extensionContext.sessionManager
  const request = {
    sessionId: sessionManager.getSessionId?.(),
    conversationLeafId: getConversationLeafId(sessionManager),
  }
  pendingRequests.set(sessionManager, request)

  try {
    const resolvePolicy = options.resolveTitlePolicy ?? resolveTitlePolicy
    const titlePolicy = resolvePolicy(extensionContext)
    let description = titleContext.subject
    if (titlePolicy.custom || !description) {
      const generateTitle = options.generateTitle ?? generateTitleWithOmp
      description = await generateTitle(titleContext.input, extensionContext, options.pi, titlePolicy)
    }
    const title = formatSessionTitle(description, titleContext, titlePolicy.format)

    if (!title || !isCurrentTitleRequest(sessionManager, request)) return false

    const changed = await writeAutomaticTitle(sessionManager, title, reason)
    if (isCurrentTitleRequest(sessionManager, request) && sessionManager.getSessionName?.() === title) {
      rememberAcceptedTitle(sessionState, titleContext, request, title)
    }

    return changed
  } finally {
    if (pendingRequests.get(sessionManager) === request) {
      pendingRequests.delete(sessionManager)
    }
  }
}

function isCurrentTitleRequest(sessionManager, request) {
  if (pendingRequests.get(sessionManager) !== request) return false
  if (sessionManager.getSessionId?.() !== request.sessionId) return false
  if (getConversationLeafId(sessionManager) !== request.conversationLeafId) return false

  return canAutomaticallyRetitle(sessionManager)
}

function rememberAcceptedTitle(sessionState, titleContext, request, title) {
  const taskIdentity = getTaskIdentity(titleContext)
  sessionState.acceptedTitle = {
    title,
    input: titleContext.input,
    sessionId: request.sessionId,
    conversationLeafId: request.conversationLeafId,
    taskIdentity,
    branchRevision: sessionState.branchRevision,
  }
  sessionState.hasGeneratedTitle = true
  sessionState.taskIdentity = taskIdentity
}
