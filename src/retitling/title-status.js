import { buildSessionTitleContext } from "../context/session-context.js"
import { canAutomaticallyRetitle, getLoadedPluginInfo } from "../omp/omp-adapter.js"
import { resolveTitlePolicy } from "../omp/title-policy.js"
import { hasPendingTitleRequest } from "./generate-title.js"
import { getTitleRepairBlocker } from "./repair-title.js"

const TITLE_CHANGE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

const TITLE_CHANGE_REASONS = new Map([
  ["omp-retitle:first-task", "First task"],
  ["omp-retitle:task", "Task changed"],
  ["omp-retitle:replan", "Replan"],
  ["omp-retitle:session_compact", "Session compacted"],
  ["omp-retitle:command", "On-demand refresh"],
  ["omp-retitle:native-repair", "Restored after an automatic change"],
  ["omp-retitle:settled-repair", "Restored after the turn finished"],
  ["omp-native-auto-title", "Automatic title trigger"],
  ["replan", "Replan"],
])

export function describeRetitleStatus(extensionContext, sessionState, options = {}) {
  const sessionManager = extensionContext?.sessionManager
  const titleContext = buildSessionTitleContext({}, extensionContext)
  const nextTitlePolicy = describeNextTitlePolicy(extensionContext, options)
  const runtime = getLoadedPluginInfo()
  const heading = `omp-retitle ${runtime.version} (loaded in this process)`
  if (options.statusDetails !== true) {
    return [heading, ...describeStatusOverview(sessionManager, sessionState, titleContext, nextTitlePolicy)].join("\n")
  }

  return [
    heading,
    `Process: ${runtime.pid}; module loaded: ${runtime.loadedAt}`,
    `Extension: ${runtime.entry}`,
    ...describeCurrentSession(sessionManager, titleContext),
    nextTitlePolicy,
    ...describeSessionLifecycle(sessionManager, sessionState),
    ...describeRecentTitleWrites(sessionManager),
  ].join("\n")
}

function describeStatusOverview(sessionManager, sessionState, titleContext, nextTitlePolicy) {
  const currentTitle = sessionManager?.getSessionName?.()
  const lines = [
    `Current title: ${currentTitle ?? "(untitled)"}`,
    describeTitleState(sessionManager, sessionState),
  ]
  const context = [titleContext?.repository, titleContext?.reference].filter(Boolean).join(" · ")
  if (context) {
    lines.push(`Context: ${context}`)
  }
  lines.push(describeLatestTitleChange(sessionManager, currentTitle))

  const lastGeneration = sessionState?.lastGenerationOutcome
  if (lastGeneration && lastGeneration.status !== "updated" && lastGeneration.status !== "unchanged") {
    lines.push(`Last generation outcome: ${lastGeneration.message}`)
  }
  if (nextTitlePolicy) {
    lines.push(nextTitlePolicy)
  }
  if (sessionState && typeof sessionState.unsubscribeFromTitleChanges !== "function") {
    lines.push("Title observer unavailable; automatic changes cannot be repaired.")
  }
  const lastRepair = sessionState?.lastRepairOutcome
  if (lastRepair?.startsWith("Error:")) {
    lines.push(`Last repair outcome: ${lastRepair}`)
  } else if (lastRepair?.startsWith("Skipped:") && canAutomaticallyRetitle(sessionManager)
    && sessionState.acceptedTitle && sessionState.acceptedTitle.title !== currentTitle) {
    lines.push(`Last repair outcome: ${lastRepair}`)
  }

  lines.push("Details: /retitle status details")
  return lines
}

function describeTitleState(sessionManager, sessionState) {
  if (!sessionManager) {
    return "No active session"
  }

  const generationPending = hasPendingTitleRequest(sessionManager)
  if (!canAutomaticallyRetitle(sessionManager)) {
    if (generationPending) {
      return "Manual · Protected while an earlier refresh finishes"
    }
    return "Manual · Automatic retitling won’t change this title"
  }

  let ownership = "Automatic"
  if (sessionManager.titleSource === undefined) {
    ownership = "No owner yet"
  }

  if (generationPending && sessionState?.replanRequested) {
    return `${ownership} · Refreshing now; another refresh is queued after the replan`
  }
  if (generationPending) {
    return `${ownership} · Refreshing now`
  }
  if (sessionState?.replanRequested) {
    return `${ownership} · Will refresh after the current turn`
  }
  if (!sessionState?.lastGenerationOutcome) {
    return `${ownership} · No refresh since this session opened`
  }

  return `${ownership} · Idle`
}

function describeLatestTitleChange(sessionManager, currentTitle) {
  const entries = sessionManager?.getEntries?.() ?? []
  const change = entries.findLast((entry) => entry.type === "title_change")
  if (!change) {
    return "No title changes recorded yet"
  }

  const reason = describeTitleChangeReason(change)
  const time = Date.parse(change.timestamp)
  let timestamp = "time unavailable"
  if (Number.isFinite(time)) {
    timestamp = `${TITLE_CHANGE_TIME.format(time)} UTC`
  }
  const latestChange = `Last recorded change: ${reason} · ${timestamp}`
  if (change.title && change.title !== currentTitle) {
    return `${latestChange} — ${change.title}`
  }

  return latestChange
}

function describeTitleChangeReason(change) {
  const reason = TITLE_CHANGE_REASONS.get(change.trigger)
  if (reason) {
    return reason
  }
  if (change.trigger) {
    return `Trigger: ${change.trigger}`
  }
  if (change.source === "user") {
    return "Manual title recorded"
  }
  if (change.source === "auto") {
    return "Automatic title recorded (no reason recorded)"
  }

  return "Reason not recorded"
}

function describeCurrentSession(sessionManager, titleContext) {
  return [
    `Current title: ${sessionManager?.getSessionName?.() ?? "(untitled)"}`,
    `Ownership: ${sessionManager?.titleSource ?? "unowned"}`,
    `Repository: ${titleContext?.repository || "(unknown)"}; reference: ${titleContext?.reference || "(none)"}`,
  ]
}

function describeNextTitlePolicy(extensionContext, options) {
  try {
    const resolvePolicy = options.resolveTitlePolicy ?? resolveTitlePolicy
    const titlePolicy = resolvePolicy(extensionContext)
    if (options.statusDetails !== true) {
      return undefined
    }

    const mode = describeTitlePolicyMode(titlePolicy)
    return `Title prompt (next generation): ${titlePolicy.path}; mode: ${mode}`
  } catch (error) {
    if (options.statusDetails !== true) return "Title prompt unavailable; see details."
    return `Title prompt (next generation): unavailable — ${error?.message ?? error}`
  }
}

function describeTitlePolicyMode(titlePolicy) {
  if (!titlePolicy.custom) return "default ticket-first format and description"
  if (titlePolicy.format) return "custom format and description prompt"

  return "custom full title"
}

function describeSessionLifecycle(sessionManager, sessionState) {
  if (!sessionState) return ["Lifecycle: not initialized in this process"]

  let observer = "unavailable"
  if (typeof sessionState.unsubscribeFromTitleChanges === "function") observer = "active"

  let generation = "idle"
  if (hasPendingTitleRequest(sessionManager)) generation = "pending"

  return [
    `Title observer: ${observer}; generation: ${generation}; replan pending: ${sessionState.replanRequested}`,
    `Last generation outcome: ${sessionState.lastGenerationOutcome?.message ?? "No generation attempt in this process"}`,
    `Accepted title: ${sessionState.acceptedTitle?.title ?? "(none cached in this process)"}`,
    `Repair eligibility: ${getTitleRepairBlocker(sessionManager, sessionState) ?? "ready"}`,
    `Last repair outcome: ${sessionState.lastRepairOutcome}`,
  ]
}

function describeRecentTitleWrites(sessionManager) {
  const entries = sessionManager?.getEntries?.() ?? []
  const recentWrites = entries.filter((entry) => entry.type === "title_change").slice(-3)
  const lines = ["Recent title writes (persisted source/trigger, not inferred writer identity):"]
  if (recentWrites.length === 0) {
    lines.push("- No title history available")
    return lines
  }

  for (const entry of recentWrites) {
    const timestamp = entry.timestamp ?? "(time unavailable)"
    const source = entry.source ?? "unknown"
    const trigger = entry.trigger ?? "(trigger not recorded)"
    lines.push(`- ${timestamp} | ${source} | ${trigger} | ${entry.title}`)
  }

  return lines
}
