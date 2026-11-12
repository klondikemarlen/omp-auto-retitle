import { describeTitleAnalytics } from "./omp/title-analytics.js"

import {
  getRetitleStatus,
  handleCompletedAgentRun,
  requestReplanRefresh,
  resetBranchRetitling,
  resetSessionRetitling,
  retitleSession,
  startRetitleSession,
  stopRetitleSession,
} from "./retitling/session-retitler.js"

export default function registerAutoRetitleExtension(pi, options = {}) {
  const retitleOptions = { ...options, pi }
  pi.setLabel("Auto Retitle")
  registerSessionEvents(pi, retitleOptions)
  registerRetitleCommand(pi, retitleOptions)
}

function registerSessionEvents(pi, options) {
  pi.on("agent_end", (event, extensionContext) => {
    return handleCompletedAgentRun(event, extensionContext, options)
  })
  pi.on("tool_result", requestReplanRefresh)
  pi.on("session_compact", (event, extensionContext) => {
    return retitleSession(event, extensionContext, options, "session_compact")
  })
  pi.on("session_branch", (_event, extensionContext) => {
    resetBranchRetitling(extensionContext?.sessionManager)
  })
  pi.on("session_tree", (_event, extensionContext) => {
    resetBranchRetitling(extensionContext?.sessionManager)
  })
  pi.on("session_switch", (_event, extensionContext) => {
    resetSessionRetitling(extensionContext?.sessionManager)
  })
  pi.on("session_start", (_event, extensionContext) => {
    startRetitleSession(extensionContext)
  })
  pi.on("session_shutdown", (_event, extensionContext) => {
    stopRetitleSession(extensionContext?.sessionManager)
  })
}

function registerRetitleCommand(pi, options) {
  pi.registerCommand("retitle", {
    description: "Regenerate the auto title, inspect status, or report local title analytics.",
    getArgumentCompletions: completeRetitleArgument,
    handler: (args, extensionContext) => handleRetitleCommand(args, extensionContext, options),
  })
}

function completeRetitleArgument(prefix) {
  const actions = [
    { value: "status", label: "status — loaded version and title diagnostics" },
    { value: "analytics", label: "analytics — local title usage over the last 7 UTC days" },
  ].filter(({ value }) => value.startsWith(prefix.trim()))
  return actions.length ? actions : null
}

async function handleRetitleCommand(args, extensionContext, options) {
  const action = args.trim()
  if (action === "status") {
    extensionContext.ui?.notify?.(getRetitleStatus(extensionContext, options), "info")
    return
  }
  if (action === "analytics") {
    const describeAnalytics = options.describeAnalytics ?? describeTitleAnalytics
    extensionContext.ui?.notify?.(describeAnalytics(), "info")
    return
  }
  if (action) {
    extensionContext.ui?.notify?.("Usage: /retitle [status|analytics]", "info")
    return
  }

  const outcome = await retitleSession({}, extensionContext, options, "command")
  const severity = outcome.status === "fallback" || outcome.status === "unavailable" ? "warning" : "info"
  extensionContext.ui?.notify?.(outcome.message, severity)
}
