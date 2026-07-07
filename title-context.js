const MAX_COMPACTION_HISTORY = 5
const MAX_USER_CONTEXT = 5
const MAX_USER_CONTEXT_LENGTH = 240
const TITLE_INSTRUCTION =
  "Generate an intelligent session title for the overall session task over time. Prefer durable user goals, final deliverables, repeated concepts, and explicit title feedback over temporary implementation details."

export function titleInputFromSession(event, ctx) {
  const sessionManager = ctx?.sessionManager
  const entries = sessionEntries(sessionManager)
  const originalTask = firstUserMessage(entries)
  const userContext = recentUniqueUserContext(entries)
  const summaries = recentUniqueCompactionSummaries(entries, event?.compactionEntry)

  if (!originalTask && userContext.length === 0 && summaries.length === 0) {
    return ""
  }

  return titlePrompt(originalTask, userContext, summaries)
}

export function titleInputFromCompaction(entry) {
  return firstText(entry?.shortSummary) || firstText(entry?.summary)
}

function titlePrompt(originalTask, userContext, summaries) {
  return [
    TITLE_INSTRUCTION,
    originalTask && section("Original user request", originalTask),
    userContext.length > 0 && section("Recent user context", bulletList(userContext)),
    summaries.length > 0 && section("Compaction history", bulletList(summaries)),
  ].filter(Boolean).join("\n\n")
}

function recentUniqueCompactionSummaries(entries, currentCompactionEntry) {
  return unique([
    ...compactionSummaries(entries),
    titleInputFromCompaction(currentCompactionEntry),
  ].filter(Boolean)).slice(-MAX_COMPACTION_HISTORY)
}

function firstUserMessage(entries) {
  for (const entry of entries) {
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

function recentUniqueUserContext(entries) {
  return latestUnique(entries.map(userMessageContext).filter(Boolean).slice(1), MAX_USER_CONTEXT)
}

function latestUnique(values, limit) {
  const seen = new Set()
  const result = []

  for (let index = values.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const value = values[index]
    if (!seen.has(value)) {
      seen.add(value)
      result.unshift(value)
    }
  }

  return result
}

function userMessageContext(entry) {
  if (entry?.type !== "message" || entry?.message?.role !== "user") {
    return ""
  }

  return compactText(messageText(entry.message))
}

function compactionSummaries(entries) {
  return entries
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

function compactText(value) {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_USER_CONTEXT_LENGTH)
}
