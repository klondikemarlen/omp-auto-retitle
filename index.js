import {
  canRetitle,
  generateTitleWithOmp,
  setAutoSessionName,
  subscribeToSessionTitles,
} from "./omp-adapter.js"
import { titleContextFromSession, titleWithIdentity } from "./title-context.js"

const pendingRetitles = new WeakMap()
const lifecycleByManager = new WeakMap()
const PLUGIN_TRIGGER_PREFIX = "omp-auto-retitle:"

export default function autoRetitleExtension(pi, options = {}) {
  pi.setLabel("Auto Retitle")

  pi.on("agent_end", async (event, ctx) => {
    const sessionManager = ctx?.sessionManager
    const lifecycle = getLifecycle(sessionManager)
    const context = titleContextFromSession(event, ctx)
    if (!lifecycle || !context) return

    updateLifecycleContext(lifecycle, sessionManager, ctx)
    const identity = contextIdentity(context)
    const changed = lifecycle.identity !== identity
    if (changed) {
      lifecycle.identity = identity
    }

    if (!changed && lifecycle.accepted?.identity === identity) {
      lifecycle.accepted.input = context.input
      lifecycle.accepted.leafId = conversationLeafId(sessionManager)
    }

    if (lifecycle.replanPending) {
      lifecycle.generated = true
      lifecycle.replanPending = false
      await retitleSession(event, ctx, { ...options, pi }, "replan")
      return
    }

    if (!lifecycle.generated || changed) {
      let reason = "task"
      if (!lifecycle.generated) reason = "first-task"

      lifecycle.generated = true
      await retitleSession(event, ctx, { ...options, pi }, reason)
    }
  })

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "todo" || event.isError || event.details?.op !== "init") return
    const lifecycle = getLifecycle(ctx?.sessionManager)
    if (lifecycle) lifecycle.replanPending = true
  })

  pi.on("session_compact", async (event, ctx) => {
    await retitleSession(event, ctx, { ...options, pi }, "session_compact")
  })

  pi.on("session_branch", (_event, ctx) => resetBranchEligibility(ctx?.sessionManager))
  pi.on("session_tree", (_event, ctx) => resetBranchEligibility(ctx?.sessionManager))
  pi.on("session_switch", (_event, ctx) => resetSessionEligibility(ctx?.sessionManager))
  pi.on("session_start", (_event, ctx) => updateSessionContext(ctx))
  pi.on("session_shutdown", (_event, ctx) => disposeLifecycle(ctx?.sessionManager))

  pi.registerCommand("retitle", {
    description: "Regenerate the auto title from repository, ticket or PR, and session task.",
    handler: async (_args, ctx) => {
      const changed = await retitleSession({}, ctx, { ...options, pi }, "command")
      ctx.ui?.notify?.(changed ? "Session title regenerated" : "Session title unchanged", "info")
    },
  })
}

export async function retitleSession(event, ctx, options = {}, reason = "command") {
  const sessionManager = ctx?.sessionManager

  if (!sessionManager || !canRetitle(sessionManager)) {
    return false
  }

  const context = titleContextFromSession(event, ctx)
  if (!context) return false
  const lifecycle = getLifecycle(sessionManager)
  if (lifecycle) updateLifecycleContext(lifecycle, sessionManager, ctx)

  const request = {
    sessionId: sessionManager.getSessionId?.(),
    leafId: conversationLeafId(sessionManager),
  }
  pendingRetitles.set(sessionManager, request)

  try {
    const generateTitle = options.generateTitle ?? generateTitleWithOmp
    let description = context.subject
    if (!description) {
      description = await generateTitle(context.input, ctx, options.pi)
    }
    const title = titleWithIdentity(description, context)

    if (
      !title ||
      pendingRetitles.get(sessionManager) !== request ||
      sessionManager.getSessionId?.() !== request.sessionId ||
      conversationLeafId(sessionManager) !== request.leafId ||
      !canRetitle(sessionManager)
    ) {
      return false
    }

    const changed = await setAutoSessionName(sessionManager, title, `${PLUGIN_TRIGGER_PREFIX}${reason}`)
    if (
      lifecycle &&
      pendingRetitles.get(sessionManager) === request &&
      sessionManager.getSessionId?.() === request.sessionId &&
      conversationLeafId(sessionManager) === request.leafId &&
      canRetitle(sessionManager) &&
      sessionManager.getSessionName?.() === title
    ) {
      lifecycle.accepted = {
        title,
        input: context.input,
        sessionId: request.sessionId,
        leafId: request.leafId,
        identity: contextIdentity(context),
        branchEpoch: lifecycle.branchEpoch,
      }
      lifecycle.generated = true
      lifecycle.identity = lifecycle.accepted.identity
    }
    return changed
  } finally {
    if (pendingRetitles.get(sessionManager) === request) {
      pendingRetitles.delete(sessionManager)
    }
  }
}

function getLifecycle(sessionManager) {
  if (!sessionManager) return undefined
  let lifecycle = lifecycleByManager.get(sessionManager)
  if (!lifecycle) {
    lifecycle = {
      sessionId: sessionManager.getSessionId?.(),
      branchEpoch: 0,
      generated: false,
      replanPending: false,
      identity: undefined,
      context: undefined,
      accepted: undefined,
      unsubscribe: undefined,
    }
    lifecycle.unsubscribe = subscribeToSessionTitles(sessionManager, (change) => {
      return onNativeTitleChange(sessionManager, lifecycle, change)
    }, (error) => {
      lifecycle.context?.ui?.notify?.(`Auto-retitle title observer failed: ${error?.message ?? error}`, "error")
    })
    if (typeof lifecycle.unsubscribe !== "function") {
      console.warn("[omp-auto-retitle] Session title observer unavailable; native automatic title writes cannot be repaired.")
    }
    lifecycleByManager.set(sessionManager, lifecycle)
  }

  return lifecycle
}

function updateLifecycleContext(lifecycle, sessionManager, ctx) {
  const sessionId = sessionManager.getSessionId?.()
  if (lifecycle.sessionId !== sessionId) {
    lifecycle.sessionId = sessionId
    lifecycle.generated = false
    lifecycle.replanPending = false
    lifecycle.identity = undefined
    lifecycle.accepted = undefined
    lifecycle.branchEpoch += 1
  }

  if (ctx) lifecycle.context = ctx
}

function updateSessionContext(ctx) {
  const manager = ctx?.sessionManager
  const lifecycle = getLifecycle(manager)
  if (!lifecycle) return

  updateLifecycleContext(lifecycle, manager, ctx)
}

function contextIdentity(context) {
  return JSON.stringify([context.repository, context.reference, context.originalTask])
}

async function onNativeTitleChange(sessionManager, lifecycle, change) {
  if (typeof change?.trigger === "string" && change.trigger.startsWith(PLUGIN_TRIGGER_PREFIX)) return
  if (change?.source !== "auto" || pendingRetitles.has(sessionManager)) return

  const accepted = lifecycle.accepted
  const ctx = lifecycle.context
  if (
    !accepted ||
    !ctx ||
    !canRetitle(sessionManager) ||
    sessionManager.getSessionId?.() !== accepted.sessionId ||
    conversationLeafId(sessionManager) !== accepted.leafId ||
    lifecycle.branchEpoch !== accepted.branchEpoch ||
    lifecycle.identity !== accepted.identity ||
    change?.title === accepted.title
  ) {
    return
  }

  const current = titleContextFromSession({}, ctx)
  if (!current || contextIdentity(current) !== accepted.identity || current.input !== accepted.input) return
  await setAutoSessionName(sessionManager, accepted.title, `${PLUGIN_TRIGGER_PREFIX}native-repair`)
}

function resetBranchEligibility(sessionManager) {
  const lifecycle = getLifecycle(sessionManager)
  if (!lifecycle) return
  pendingRetitles.delete(sessionManager)
  lifecycle.generated = false
  lifecycle.identity = undefined
  lifecycle.accepted = undefined
  lifecycle.branchEpoch += 1
}

function resetSessionEligibility(sessionManager) {
  const lifecycle = getLifecycle(sessionManager)
  if (!lifecycle) return
  pendingRetitles.delete(sessionManager)
  lifecycle.sessionId = sessionManager.getSessionId?.()
  lifecycle.generated = false
  lifecycle.replanPending = false
  lifecycle.identity = undefined
  lifecycle.accepted = undefined
  lifecycle.branchEpoch += 1
}

function disposeLifecycle(sessionManager) {
  const lifecycle = sessionManager && lifecycleByManager.get(sessionManager)
  if (!lifecycle) return
  lifecycle.unsubscribe?.()
  lifecycleByManager.delete(sessionManager)
}

function conversationLeafId(sessionManager) {
  const branch = sessionManager.getBranch?.()
  if (!branch) return sessionManager.getLeafId?.()

  return branch.findLast((entry) => entry.type !== "title_change")?.id ?? null
}
