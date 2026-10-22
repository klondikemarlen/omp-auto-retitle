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
    description: "Regenerate the auto title, or use /retitle status for loaded version and diagnostics.",
    getArgumentCompletions: completeRetitleArgument,
    handler: (args, extensionContext) => handleRetitleCommand(args, extensionContext, options),
  })
}

function completeRetitleArgument(prefix) {
  if (!"status".startsWith(prefix.trim())) return null

  return [{ value: "status", label: "status — loaded version and title diagnostics" }]
}

async function handleRetitleCommand(args, extensionContext, options) {
  const action = args.trim()
  if (action === "status") {
    extensionContext.ui?.notify?.(getRetitleStatus(extensionContext, options), "info")
    return
  }
  if (action) {
    extensionContext.ui?.notify?.("Usage: /retitle [status]", "info")
    return
  }

  const changed = await retitleSession({}, extensionContext, options, "command")
  let message = "Session title unchanged"
  if (changed) message = "Session title regenerated"

  extensionContext.ui?.notify?.(message, "info")
}
