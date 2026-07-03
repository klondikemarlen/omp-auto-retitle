export default function autoRetitleExtension(pi) {
  pi.setLabel("Auto Retitle")

  pi.on("session_compact", async (event, ctx) => {
    await retitleFromCompaction(event, ctx, { pi })
  })
}

export async function retitleFromCompaction(event, ctx, options = {}) {
  if (!canRetitle(ctx?.sessionManager)) {
    return false
  }

  const input = titleInputFromSession(event, ctx)
  if (!input) {
    return false
  }

  const title = await (options.generateTitle ?? generateTitleWithOmp)(input, ctx, options.pi)
  if (!title) {
    return false
  }

  return setAutoSessionName(ctx.sessionManager, title)
}

export function titleInputFromSession(event, ctx) {
  const originalTask = firstUserMessage(ctx?.sessionManager)
  const summaries = unique([
    ...compactionSummaries(ctx?.sessionManager),
    titleInputFromCompaction(event?.compactionEntry),
  ].filter(Boolean)).slice(-5)

  if (!originalTask && summaries.length === 0) {
    return ""
  }

  return [
    "Generate an intelligent session title for the overall session task over time, not a narrow latest subtask.",
    originalTask && `Original user request:\n${originalTask}`,
    summaries.length > 0 && `Compaction history:\n${summaries.map((text) => `- ${text}`).join("\n")}`,
  ].filter(Boolean).join("\n\n")
}

export function titleInputFromCompaction(entry) {
  return firstText(entry?.shortSummary) || firstText(entry?.summary)
}

export function canRetitle(sessionManager) {
  const source = sessionManager?.titleSource

  return source === undefined || source === "auto"
}

export async function setAutoSessionName(sessionManager, title) {
  if (sessionManager?.getSessionName?.() === title) {
    return false
  }

  if (typeof sessionManager?.setSessionName !== "function") {
    return false
  }

  return sessionManager.setSessionName(title, "auto", "omp-auto-retitle:session_compact")
}

export async function generateTitleWithOmp(input, ctx, pi) {
  const settings = pi?.pi?.settings
  if (!settings) {
    return null
  }

  const { generateSessionTitle } = await import("@oh-my-pi/pi-coding-agent/utils/title-generator")
  return generateSessionTitle(
    input,
    ctx.modelRegistry,
    settings,
    ctx.sessionManager?.getSessionId?.(),
    ctx.model,
  )
}

function firstUserMessage(sessionManager) {
  for (const entry of sessionEntries(sessionManager)) {
    if (entry?.type === "message" && entry?.message?.role === "user") {
      const text = firstText(messageText(entry.message))
      if (text) return text
    }
  }

  return ""
}

function compactionSummaries(sessionManager) {
  return sessionEntries(sessionManager)
    .filter((entry) => entry?.type === "compaction")
    .map(titleInputFromCompaction)
    .filter(Boolean)
}

function sessionEntries(sessionManager) {
  return sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? []
}

function messageText(message) {
  const content = message?.content

  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part?.type === "text" ? part.text : "")
      .filter(Boolean)
      .join(" ")
  }

  return ""
}

function unique(values) {
  return [...new Set(values)]
}

function firstText(value) {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) || ""
}
