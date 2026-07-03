const MAX_COMPACTION_HISTORY = 5
const TITLE_INSTRUCTION =
  "Generate an intelligent session title for the overall session task over time, not a narrow latest subtask."

export function titleInputFromSession(event, ctx) {
  const sessionManager = ctx?.sessionManager
  const originalTask = firstUserMessage(sessionManager)
  const summaries = recentUniqueCompactionSummaries(sessionManager, event?.compactionEntry)

  if (!originalTask && summaries.length === 0) {
    return ""
  }

  return titlePrompt(originalTask, summaries)
}

export function titleInputFromCompaction(entry) {
  return firstText(entry?.shortSummary) || firstText(entry?.summary)
}

function titlePrompt(originalTask, summaries) {
  return [
    TITLE_INSTRUCTION,
    originalTask && section("Original user request", originalTask),
    summaries.length > 0 && section("Compaction history", bulletList(summaries)),
  ].filter(Boolean).join("\n\n")
}

function recentUniqueCompactionSummaries(sessionManager, currentCompactionEntry) {
  return unique([
    ...compactionSummaries(sessionManager),
    titleInputFromCompaction(currentCompactionEntry),
  ].filter(Boolean)).slice(-MAX_COMPACTION_HISTORY)
}

function firstUserMessage(sessionManager) {
  for (const entry of sessionEntries(sessionManager)) {
    const text = userMessageText(entry)
    if (text) return text
  }

  return ""
}

function userMessageText(entry) {
  if (entry?.type !== "message" || entry?.message?.role !== "user") {
    return ""
  }

  return firstText(messageText(entry.message))
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

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => part?.type === "text" ? part.text : "")
    .filter(Boolean)
    .join(" ")
}

function section(title, body) {
  return `${title}:\n${body}`
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n")
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
