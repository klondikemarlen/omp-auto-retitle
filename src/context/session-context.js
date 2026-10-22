import { normalizeContextText, getRecentUniqueText, getMessageText } from "./context-text.js"
import { selectWorkEvidence } from "./work-references.js"

const MAX_COMPACTION_HISTORY = 5
const MAX_USER_CONTEXT = 5
const MAX_ORIGINAL_TASK_LENGTH = 200
const MAX_COMPACTION_SUMMARY_LENGTH = 100
const MAX_REPOSITORY_LENGTH = 80

export function buildSessionTitleContext(event, extensionContext) {
  const sessionManager = extensionContext?.sessionManager
  const entries = sessionEntries(sessionManager)
  const repository = repositoryIdentity(extensionContext, sessionManager)
  const workEvidence = selectWorkEvidence([
    ...entries,
    event?.compactionEntry && { ...event.compactionEntry, type: "compaction" },
  ])
  const originalTask = firstUserMessage(entries)
  const userContext = recentUniqueUserContext(entries)
  const summaries = recentUniqueCompactionSummaries(entries, event?.compactionEntry)

  if (!originalTask && userContext.length === 0 && summaries.length === 0) return null

  return {
    input: titlePrompt(repository, workEvidence.map((item) => item.text), originalTask, userContext, summaries),
    repository,
    reference: titleReference(workEvidence.at(-1), repository),
    originalTask,
    subject: workEvidence.at(-1)?.subject ?? "",
  }
}

export function getCompactionSummary(entry) {
  return normalizeContextText(entry?.shortSummary, MAX_COMPACTION_SUMMARY_LENGTH) ||
    normalizeContextText(entry?.summary, MAX_COMPACTION_SUMMARY_LENGTH)
}

function titleReference(evidence, repository) {
  if (!evidence) return ""
  if (evidence.repository === repository) return evidence.shortReference

  return evidence.reference
}

function titlePrompt(repository, workEvidence, originalTask, userContext, summaries) {
  return [
    repository && section("Repository", repository),
    originalTask && section("Original user request", originalTask),
    userContext.length > 0 && section("Recent user context", bulletList(userContext)),
    summaries.length > 0 && section("Compaction history", bulletList(summaries)),
    workEvidence.length > 0 && section("Relevant issue or PR", bulletList(workEvidence)),
  ].filter(Boolean).join("\n\n")
}

function recentUniqueCompactionSummaries(entries, currentCompactionEntry) {
  return getRecentUniqueText([
    ...compactionSummaries(entries),
    getCompactionSummary(currentCompactionEntry),
  ].filter(Boolean), MAX_COMPACTION_HISTORY)
}

function firstUserMessage(entries) {
  for (const entry of entries) {
    const text = userMessageText(entry)
    if (text) return text
  }

  return ""
}

function userMessageText(entry) {
  if (entry?.type !== "message" || entry?.message?.role !== "user") return ""

  return normalizeContextText(getMessageText(entry.message), MAX_ORIGINAL_TASK_LENGTH)
}

function recentUniqueUserContext(entries) {
  return getRecentUniqueText(entries.map(userMessageContext).filter(Boolean).slice(1), MAX_USER_CONTEXT)
}

function userMessageContext(entry) {
  if (entry?.type !== "message" || entry?.message?.role !== "user") return ""

  return normalizeContextText(getMessageText(entry.message))
}

function compactionSummaries(entries) {
  return entries
    .filter((entry) => entry?.type === "compaction")
    .map(getCompactionSummary)
    .filter(Boolean)
}

function sessionEntries(sessionManager) {
  return sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? []
}

function repositoryIdentity(extensionContext, sessionManager) {
  const cwd = extensionContext?.cwd ?? sessionManager?.getCwd?.()
  if (typeof cwd !== "string") return ""

  const segments = cwd.split(/[\\/]+/).filter(Boolean)
  return normalizeContextText(segments.at(-1) ?? "", MAX_REPOSITORY_LENGTH)
}

function section(title, body) {
  return `${title}:\n${body}`
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n")
}
