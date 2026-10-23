import { buildSessionTitleContext } from "../context/session-context.js"
import { getLoadedPluginInfo } from "../omp/omp-adapter.js"
import { resolveTitlePolicy } from "../omp/title-policy.js"
import { hasPendingTitleRequest } from "./generate-title.js"
import { getTitleRepairBlocker } from "./repair-title.js"

export function describeRetitleStatus(extensionContext, sessionState, options) {
  const sessionManager = extensionContext?.sessionManager
  const titleContext = buildSessionTitleContext({}, extensionContext)
  return [
    ...describeLoadedExtension(),
    ...describeCurrentSession(sessionManager, titleContext),
    describeNextTitlePolicy(extensionContext, options),
    ...describeSessionLifecycle(sessionManager, sessionState),
    ...describeRecentTitleWrites(sessionManager),
  ].join("\n")
}

function describeLoadedExtension() {
  const runtime = getLoadedPluginInfo()
  return [
    `Auto Retitle ${runtime.version} (loaded in this process)`,
    `Process: ${runtime.pid}; module loaded: ${runtime.loadedAt}`,
    `Extension: ${runtime.entry}`,
  ]
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
    const mode = describeTitlePolicyMode(titlePolicy)
    return `Title prompt (next generation): ${titlePolicy.path}; mode: ${mode}`
  } catch (error) {
    return `Title prompt (next generation): unavailable — ${error.message ?? error}`
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
