export default function autoRetitleExtension(pi) {
  pi.setLabel("Auto Retitle")

  pi.on("session_compact", async (event, ctx) => {
    await retitleFromCompaction(event, ctx)
  })
}

export async function retitleFromCompaction(event, ctx, options = {}) {
  if (!canRetitle(ctx?.sessionManager)) {
    return false
  }

  const input = titleInputFromCompaction(event?.compactionEntry)
  if (!input) {
    return false
  }

  const title = await (options.generateTitle ?? generateTitleWithOmp)(input, ctx)
  if (!title) {
    return false
  }

  return setAutoSessionName(ctx.sessionManager, title)
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

export async function generateTitleWithOmp(input, ctx) {
  const [{ generateSessionTitle }, { settings }] = await Promise.all([
    import("@oh-my-pi/pi-coding-agent/utils/title-generator"),
    import("@oh-my-pi/pi-coding-agent"),
  ])

  return generateSessionTitle(
    input,
    ctx.modelRegistry,
    settings,
    ctx.sessionManager?.getSessionId?.(),
    ctx.model,
  )
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
