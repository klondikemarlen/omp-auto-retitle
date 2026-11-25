import { performance } from "node:perf_hooks"

import { withoutFileCitations } from "../context/context-text.js"
import { formatSessionTitle, getRequestTitleExcerpt } from "../context/title-format.js"
import { canAutomaticallyRetitle, generateTitleWithOmp, getLoadedPluginInfo, writeAutomaticTitle } from "../omp/omp-adapter.js"
import { resolveTitlePolicy } from "../omp/title-policy.js"
import { createTitleAnalytics } from "../omp/title-analytics.js"
import { getConversationLeafId, getTaskIdentity } from "./session-identity.js"

// Requests can outlive a lifecycle subscription, so their ownership has its own store.
const pendingRequests = new WeakMap()
const GENERATION_TIMEOUT_MS = 30_000
const NO_ANALYTICS = Object.freeze({ onUsage() {}, finish() {} })
const staleReasonMessages = {
  "newer-request": "a newer request took ownership",
  "branch-changed": "selected branch changed",
  "session-changed": "session changed",
  "session-shutdown": "session shut down",
  "conversation-advanced": "conversation advanced",
  "manual-title": "manual title ownership",
}

export function hasPendingTitleRequest(sessionManager) {
  return pendingRequests.has(sessionManager)
}

export function invalidatePendingTitleRequest(sessionManager, reason) {
  const request = pendingRequests.get(sessionManager)
  if (!request) return

  request.staleReason ??= reason
  pendingRequests.delete(sessionManager)
  request.controller.abort(new Error("Request cancelled"))
}

export async function generateAndCommitTitle(titleContext, extensionContext, sessionState, options, reason) {
  const sessionManager = extensionContext.sessionManager
  invalidatePendingTitleRequest(sessionManager, "newer-request")
  const request = {
    sessionId: sessionManager.getSessionId?.(),
    conversationLeafId: getConversationLeafId(sessionManager),
    controller: new AbortController(),
    startedAt: performance.now(),
    modelRequested: false,
    outcomeStatus: "error",
  }
  pendingRequests.set(sessionManager, request)
  const createAnalytics = options.createAnalytics ?? (options.generateTitle ? () => NO_ANALYTICS : createTitleAnalytics)
  request.analytics = createAnalytics({
    sessionId: request.sessionId,
    reason,
    version: getLoadedPluginInfo().version,
  })

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
      request.failureKind = generated.failureKind
      source = "model"
      if (!titlePolicy.custom && description) {
        description = withoutFileCitations(description).trim()
        if (!description) {
          failure = "OMP returned only a file citation"
          request.failureKind = "citation-only"
        }
      }
    }

    const staleReason = getRequestStaleReason(sessionManager, request)
    if (staleReason) {
      return recordStaleOutcome(sessionState, sessionManager, request, staleReason, "Title not applied")
    }

    let title = formatSessionTitle(description, titleContext, titlePolicy.format)
    if (!title) {
      failure ??= "Title formatting produced no usable title"
      const fallback = selectFallbackTitle(titleContext, titlePolicy, sessionState, request)
      title = fallback.title
      source = fallback.source
    }
    if (!title) {
      return recordOutcome(sessionState, sessionManager, request, "unavailable", `Title generation unavailable: ${failure}. Existing title preserved.`)
    }

    const changed = await writeAutomaticTitle(sessionManager, title, reason)
    const persistenceStaleReason = getRequestStaleReason(sessionManager, request)
    if (persistenceStaleReason) {
      return recordStaleOutcome(sessionState, sessionManager, request, persistenceStaleReason, "Title not cached")
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
    request.analytics.finish({
      status: request.outcomeStatus,
      modelRequested: request.modelRequested,
      failureKind: request.outcomeStatus === "stale" ? undefined : request.failureKind,
      staleReason: request.outcomeStatus === "stale" ? request.staleReason : undefined,
      elapsedMs: performance.now() - request.startedAt,
    })
    if (pendingRequests.get(sessionManager) === request) {
      pendingRequests.delete(sessionManager)
    }
  }
}

async function requestDescription(titleContext, extensionContext, options, titlePolicy, request) {
  const generateTitle = options.generateTitle ?? generateTitleWithOmp
  const signal = request.controller.signal
  const interrupted = Promise.withResolvers()
  let timedOut = false
  const onAbort = () => interrupted.resolve({
    failure: String(signal.reason?.message ?? signal.reason),
    failureKind: timedOut ? "timeout" : undefined,
  })
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) onAbort()

  const timer = setTimeout(
    () => {
      timedOut = true
      request.controller.abort(new Error("Title generation timed out"))
    },
    options.generationTimeoutMs ?? GENERATION_TIMEOUT_MS,
  )

  // Recent hosts cancel inference; older hosts ignore the signal. Race the wait
  // as well, so neither can commit a late result or hold the command open.
  const generation = Promise.resolve()
    .then(() => {
      signal.throwIfAborted()
      request.modelRequested = true
      return generateTitle(
        titleContext.input,
        extensionContext,
        options.pi,
        titlePolicy,
        signal,
        (message) => request.analytics.onUsage(message),
        (reason) => request.analytics.onNativeReason?.(reason),
      )
    })
    .then((description) => {
      if (typeof description === "string" && description.trim()) {
        return { description }
      }

      const requestId = request.analytics.requestId
      const correlation = requestId ? ` (request ${requestId})` : ""
      return {
        failure: `OMP returned no usable title; its worker, provider, or output validation may be unavailable; see /retitle analytics${correlation}`,
        failureKind: "host-no-title",
      }
    }, (error) => ({
      failure: String(error?.message ?? error),
      failureKind: "generator-error",
    }))

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

function getRequestStaleReason(sessionManager, request) {
  if (request.staleReason) {
    return request.staleReason
  }

  if (pendingRequests.get(sessionManager) !== request) {
    return "newer-request"
  }

  if (sessionManager.getSessionId?.() !== request.sessionId) {
    return "session-changed"
  }

  if (getConversationLeafId(sessionManager) !== request.conversationLeafId) {
    return "conversation-advanced"
  }

  if (!canAutomaticallyRetitle(sessionManager)) {
    return "manual-title"
  }
}

function recordStaleOutcome(sessionState, sessionManager, request, staleReason, messagePrefix) {
  request.staleReason = staleReason
  return recordOutcome(sessionState, sessionManager, request, "stale", `${messagePrefix}: ${staleReasonMessages[staleReason]}`)
}

function recordOutcome(sessionState, sessionManager, request, status, message) {
  request.outcomeStatus = status
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
