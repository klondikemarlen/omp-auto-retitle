import { formatSessionTitle, getRequestTitleExcerpt } from "../context/title-format.js"
import { canAutomaticallyRetitle, generateTitleWithOmp, writeAutomaticTitle } from "../omp/omp-adapter.js"
import { resolveTitlePolicy } from "../omp/title-policy.js"
import { getConversationLeafId, getTaskIdentity } from "./session-identity.js"

// Requests can outlive a lifecycle subscription, so their ownership has its own store.
const pendingRequests = new WeakMap()
const GENERATION_TIMEOUT_MS = 10_000

export function hasPendingTitleRequest(sessionManager) {
  return pendingRequests.has(sessionManager)
}

export function invalidatePendingTitleRequest(sessionManager) {
  pendingRequests.get(sessionManager)?.controller.abort(new Error("Request cancelled"))
  pendingRequests.delete(sessionManager)
}

export async function generateAndCommitTitle(titleContext, extensionContext, sessionState, options, reason) {
  const sessionManager = extensionContext.sessionManager
  invalidatePendingTitleRequest(sessionManager)
  const request = {
    sessionId: sessionManager.getSessionId?.(),
    conversationLeafId: getConversationLeafId(sessionManager),
    controller: new AbortController(),
  }
  pendingRequests.set(sessionManager, request)

  try {
    const resolvePolicy = options.resolveTitlePolicy ?? resolveTitlePolicy
    const titlePolicy = resolvePolicy(extensionContext)
    let description = titleContext.subject
    let source = "ticket subject"
    let failure
    if (titlePolicy.custom || !description) {
      const generated = await requestDescription(titleContext, extensionContext, options, titlePolicy, request)
      description = generated.description
      failure = generated.failure
      source = "model"
    }

    const blocker = getRequestBlocker(sessionManager, request)
    if (blocker) return recordOutcome(sessionState, sessionManager, request, "stale", `Title not applied: ${blocker}`)

    let title = formatSessionTitle(description, titleContext, titlePolicy.format)
    if (!title) {
      failure ??= "OMP returned no usable title; its worker, provider, or output validation may be unavailable"
      const fallback = selectFallbackTitle(titleContext, titlePolicy, sessionState, request)
      title = fallback.title
      source = fallback.source
    }
    if (!title) {
      return recordOutcome(sessionState, sessionManager, request, "unavailable", `Title generation unavailable: ${failure}. Existing title preserved.`)
    }

    const changed = await writeAutomaticTitle(sessionManager, title, reason)
    const persistenceBlocker = getRequestBlocker(sessionManager, request)
    if (persistenceBlocker) {
      return recordOutcome(sessionState, sessionManager, request, "stale", `Title not cached: ${persistenceBlocker}`)
    }
    if (sessionManager.getSessionName?.() !== title) {
      return recordOutcome(sessionState, sessionManager, request, "unavailable", "Title write was not accepted")
    }
    rememberAcceptedTitle(sessionState, titleContext, request, title, titlePolicy)

    if (failure) {
      return recordOutcome(sessionState, sessionManager, request, "fallback", `Session title ${changed ? "updated" : "retained"} from ${source}; generation unavailable: ${failure}`)
    }
    return recordOutcome(sessionState, sessionManager, request, changed ? "updated" : "unchanged", changed ? `Session title regenerated (${source})` : "Session title unchanged")
  } catch (error) {
    recordOutcome(sessionState, sessionManager, request, "error", `Title generation failed: ${error?.message ?? String(error)}`)
    throw error
  } finally {
    if (pendingRequests.get(sessionManager) === request) {
      pendingRequests.delete(sessionManager)
    }
  }
}

async function requestDescription(titleContext, extensionContext, options, titlePolicy, request) {
  const generateTitle = options.generateTitle ?? generateTitleWithOmp
  const signal = request.controller.signal
  const interrupted = Promise.withResolvers()
  const onAbort = () => interrupted.resolve({ failure: String(signal.reason?.message ?? signal.reason) })
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) onAbort()

  const timer = setTimeout(
    () => request.controller.abort(new Error("Title generation timed out")),
    options.generationTimeoutMs ?? GENERATION_TIMEOUT_MS,
  )

  // Recent hosts cancel inference; older hosts ignore the signal. Race the wait
  // as well, so neither can commit a late result or hold the command open.
  const generation = Promise.resolve()
    .then(() => {
      signal.throwIfAborted()
      return generateTitle(titleContext.input, extensionContext, options.pi, titlePolicy, signal)
    })
    .then((description) => ({ description }), (error) => ({ failure: String(error?.message ?? error) }))

  try {
    return await Promise.race([generation, interrupted.promise])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

function selectFallbackTitle(titleContext, titlePolicy, sessionState, request) {
  if (titlePolicy.custom) return { title: "" }

  const accepted = sessionState.acceptedTitle
  if (accepted && !accepted.policy.custom
    && accepted.sessionId === request.sessionId
    && accepted.branchRevision === sessionState.branchRevision
    && accepted.taskIdentity === getTaskIdentity(titleContext)) {
    return { title: accepted.title, source: "accepted same-task title" }
  }

  return {
    title: formatSessionTitle(getRequestTitleExcerpt(titleContext), titleContext, titlePolicy.format),
    source: "original request excerpt",
  }
}

function getRequestBlocker(sessionManager, request) {
  if (pendingRequests.get(sessionManager) !== request) return "newer request or lifecycle change"
  if (sessionManager.getSessionId?.() !== request.sessionId) return "session changed"
  if (getConversationLeafId(sessionManager) !== request.conversationLeafId) return "conversation advanced"
  if (!canAutomaticallyRetitle(sessionManager)) return "manual title ownership"

  return undefined
}

function recordOutcome(sessionState, sessionManager, request, status, message) {
  const outcome = { status, message }
  if (pendingRequests.get(sessionManager) === request) sessionState.lastGenerationOutcome = outcome
  return outcome
}

function rememberAcceptedTitle(sessionState, titleContext, request, title, titlePolicy) {
  const taskIdentity = getTaskIdentity(titleContext)
  sessionState.acceptedTitle = {
    title,
    input: titleContext.input,
    sessionId: request.sessionId,
    conversationLeafId: request.conversationLeafId,
    taskIdentity,
    branchRevision: sessionState.branchRevision,
    policy: titlePolicy,
  }
  sessionState.hasGeneratedTitle = true
  sessionState.taskIdentity = taskIdentity
}
