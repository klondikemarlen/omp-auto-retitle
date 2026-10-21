import {
  canRetitle,
  generateTitleWithOmp,
  getLoadedPluginInfo,
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
      return
    }

    await repairAcceptedTitle(sessionManager, lifecycle, "settled-repair")
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
    description: "Regenerate the auto title, or use /retitle status for loaded version and diagnostics.",
    getArgumentCompletions: (prefix) => {
      if ("status".startsWith(prefix.trim())) {
        return [{ value: "status", label: "status — loaded version and title diagnostics" }]
      }
      return null
    },
    handler: async (args, ctx) => {
      const action = args.trim()
      if (action === "status") {
        ctx.ui?.notify?.(retitleStatus(ctx), "info")
        return
      }
      if (action) {
        ctx.ui?.notify?.("Usage: /retitle [status]", "info")
        return
      }

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
      lastRepair: "No repair attempt in this process",
    }
    lifecycle.unsubscribe = subscribeToSessionTitles(sessionManager, (change) => {
      return onNativeTitleChange(sessionManager, lifecycle, change)
    }, (error) => {
      lifecycle.lastRepair = `Error: ${error?.message ?? error}`
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
    lifecycle.lastRepair = "No repair attempt in this session"
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
  if (change?.source !== "auto") return

  await repairAcceptedTitle(sessionManager, lifecycle, "native-repair")
}

async function repairAcceptedTitle(sessionManager, lifecycle, reason) {
  const blocker = repairBlocker(sessionManager, lifecycle)
  if (blocker) {
    lifecycle.lastRepair = `Skipped: ${blocker}`
    return false
  }
  if (sessionManager.getSessionName?.() === lifecycle.accepted.title) return false

  const changed = await setAutoSessionName(sessionManager, lifecycle.accepted.title, `${PLUGIN_TRIGGER_PREFIX}${reason}`)
  if (changed) {
    lifecycle.lastRepair = `Restored: ${reason}`
  } else {
    lifecycle.lastRepair = "No title write accepted"
  }
  return changed
}

function repairBlocker(sessionManager, lifecycle) {
  if (!canRetitle(sessionManager)) return "manual title ownership"
  if (pendingRetitles.has(sessionManager)) return "newer title request pending"

  const accepted = lifecycle.accepted
  const ctx = lifecycle.context
  if (!accepted) return "no accepted title cached in this process"
  if (!ctx) return "no active session context"
  if (sessionManager.getSessionId?.() !== accepted.sessionId) return "session changed"
  if (lifecycle.branchEpoch !== accepted.branchEpoch) return "branch changed"
  if (conversationLeafId(sessionManager) !== accepted.leafId) return "conversation advanced"
  if (lifecycle.identity !== accepted.identity) return "task identity changed"

  const current = titleContextFromSession({}, ctx)
  if (!current || contextIdentity(current) !== accepted.identity) return "task identity changed"
  if (current.input !== accepted.input) return "title context changed"

  return undefined
}

function retitleStatus(ctx) {
  const manager = ctx?.sessionManager
  const lifecycle = manager && lifecycleByManager.get(manager)
  const runtime = getLoadedPluginInfo()
  const context = titleContextFromSession({}, ctx)
  const history = (manager?.getEntries?.() ?? []).filter((entry) => entry.type === "title_change").slice(-3)
  const lines = [
    `Auto Retitle ${runtime.version} (loaded in this process)`,
    `Process: ${runtime.pid}; module loaded: ${runtime.loadedAt}`,
    `Extension: ${runtime.entry}`,
    `Current title: ${manager?.getSessionName?.() ?? "(untitled)"}`,
    `Ownership: ${manager?.titleSource ?? "unowned"}`,
    `Repository: ${context?.repository || "(unknown)"}; reference: ${context?.reference || "(none)"}`,
  ]
  if (lifecycle) {
    let observer = "unavailable"
    if (typeof lifecycle.unsubscribe === "function") observer = "active"
    let generation = "idle"
    if (pendingRetitles.has(manager)) generation = "pending"
    lines.push(
      `Title observer: ${observer}; generation: ${generation}; replan pending: ${lifecycle.replanPending}`,
      `Accepted title: ${lifecycle.accepted?.title ?? "(none cached in this process)"}`,
      `Repair eligibility: ${repairBlocker(manager, lifecycle) ?? "ready"}`,
      `Last repair outcome: ${lifecycle.lastRepair}`,
    )
  } else {
    lines.push("Lifecycle: not initialized in this process")
  }
  lines.push("Recent title writes (persisted source/trigger, not inferred writer identity):")
  for (const entry of history) {
    lines.push(`- ${entry.timestamp ?? "(time unavailable)"} | ${entry.source ?? "unknown"} | ${entry.trigger ?? "(trigger not recorded)"} | ${entry.title}`)
  }
  if (history.length === 0) lines.push("- No title history available")

  return lines.join("\n")
}

function resetBranchEligibility(sessionManager) {
  const lifecycle = getLifecycle(sessionManager)
  if (!lifecycle) return
  pendingRetitles.delete(sessionManager)
  lifecycle.generated = false
  lifecycle.identity = undefined
  lifecycle.accepted = undefined
  lifecycle.lastRepair = "Repair cache cleared after branch change"
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
  lifecycle.lastRepair = "No repair attempt in this session"
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
