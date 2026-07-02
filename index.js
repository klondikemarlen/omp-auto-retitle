export default function autoRetitleExtension(pi) {
  pi.setLabel("Auto Retitle")

  pi.on("session_compact", async (event, ctx) => {
    const title = titleFromCompaction(event.compactionEntry)

    if (!title || !canRetitle(ctx.sessionManager)) {
      return
    }

    await setAutoSessionName(ctx.sessionManager, pi, title)
  })
}

export function titleFromCompaction(entry) {
  return cleanTitle(entry?.shortSummary) || cleanTitle(entry?.summary)
}

export function canRetitle(sessionManager) {
  const source = sessionManager?.titleSource

  return source === undefined || source === "auto"
}

export async function setAutoSessionName(sessionManager, _pi, title) {
  if (sessionManager?.getSessionName?.() === title) {
    return false
  }

  if (typeof sessionManager?.setSessionName !== "function") {
    return false
  }

  return sessionManager.setSessionName(title, "auto", "omp-auto-retitle:session_compact")
}

function cleanTitle(value) {
  if (typeof value !== "string") {
    return ""
  }

  const line = value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean)

  if (!line) {
    return ""
  }

  return line
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/[*_`#[\]]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}
