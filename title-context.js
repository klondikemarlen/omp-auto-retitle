const MAX_COMPACTION_HISTORY = 5
const MAX_USER_CONTEXT = 5
// Keep each source bounded so all selected-branch context fits OMP's 2,000-character input limit.
const MAX_ORIGINAL_TASK_LENGTH = 200
const MAX_USER_CONTEXT_LENGTH = 120
const MAX_COMPACTION_SUMMARY_LENGTH = 100
const MAX_REPOSITORY_LENGTH = 80
const MAX_WORK_EVIDENCE = 3
const MAX_WORK_EVIDENCE_LENGTH = 130

const GITHUB_WORK_REFERENCE = /https?:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/(issues|pull)\/(\d+)/i
const JIRA_REFERENCE = /\b[A-Z][A-Z0-9]+-\d+\b/

export function titleContextFromSession(event, ctx) {
  const sessionManager = ctx?.sessionManager
  const entries = sessionEntries(sessionManager)
  const repository = repositoryIdentity(ctx, sessionManager)
  const workEvidence = selectedBranchWorkEvidence([
    ...entries,
    event?.compactionEntry && { ...event.compactionEntry, type: "compaction" },
  ])
  const originalTask = firstUserMessage(entries)
  const userContext = recentUniqueUserContext(entries)
  const summaries = recentUniqueCompactionSummaries(entries, event?.compactionEntry)

  if (!originalTask && userContext.length === 0 && summaries.length === 0) {
    return null
  }

  return {
    input: titlePrompt(repository, workEvidence.map((item) => item.text), originalTask, userContext, summaries),
    repository,
    reference: titleReference(workEvidence[0], repository),
    originalTask,
  }
}

export function titleInputFromCompaction(entry) {
  return compactText(entry?.shortSummary, MAX_COMPACTION_SUMMARY_LENGTH) ||
    compactText(entry?.summary, MAX_COMPACTION_SUMMARY_LENGTH)
}

export function titleWithIdentity(description, context) {
  const text = typeof description === "string" ? description.trim() : ""
  if (!text) return ""

  const prefix = [context.repository, context.reference].filter(Boolean).join(" ")
  return prefix ? `${prefix}: ${text}` : text
}

function titleReference(evidence, repository) {
  if (!evidence) return ""
  if (evidence.repository === repository) return evidence.shortReference

  return evidence.reference
}

function titlePrompt(repository, workEvidence, originalTask, userContext, summaries) {
  return [
    repository && section("Repository", repository),
    workEvidence.length > 0 && section("Relevant issue or PR", bulletList(workEvidence)),
    originalTask && section("Original user request", originalTask),
    userContext.length > 0 && section("Recent user context", bulletList(userContext)),
    summaries.length > 0 && section("Compaction history", bulletList(summaries)),
  ].filter(Boolean).join("\n\n")
}

function recentUniqueCompactionSummaries(entries, currentCompactionEntry) {
  return latestUnique([
    ...compactionSummaries(entries),
    titleInputFromCompaction(currentCompactionEntry),
  ].filter(Boolean), MAX_COMPACTION_HISTORY)
}

function firstUserMessage(entries) {
  for (const entry of entries) {
    const text = userMessageText(entry)
    if (text) {
      return text
    }
  }

  return ""
}

function userMessageText(entry) {
  if (entry?.type !== "message" || entry?.message?.role !== "user") {
    return ""
  }

  return compactText(messageText(entry.message), MAX_ORIGINAL_TASK_LENGTH)
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

function repositoryIdentity(ctx, sessionManager) {
  const cwd = ctx?.cwd ?? sessionManager?.getCwd?.()
  if (typeof cwd !== "string") {
    return ""
  }

  const segments = cwd.split(/[\\/]+/).filter(Boolean)
  return compactText(segments.at(-1) ?? "", MAX_REPOSITORY_LENGTH)
}

function selectedBranchWorkEvidence(entries) {
  const evidence = []
  const userEvidence = []

  for (const entry of entries) {
    const text = workEvidenceText(entry)
    if (!text) {
      continue
    }

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!hasWorkReference(line)) {
        continue
      }

      const item = compactEvidence(line, adjacentDescription(lines, index))
      evidence.push(item)
      if (entry.message?.role === "user") {
        userEvidence.push(item)
      }
    }
  }

  // Keep the latest explicit user reference even when later tool output is noisy.
  const selected = userEvidence.at(-1) ?? evidence.at(-1)
  const otherTexts = evidence.filter((item) => item !== selected).map((item) => item.text)
  const recentTexts = latestUnique(otherTexts, MAX_WORK_EVIDENCE - 1)
  return [selected, ...recentTexts.map((text) => evidence.findLast((item) => item.text === text))].filter(Boolean)
}

function workEvidenceText(entry) {
  if (entry?.type === "compaction") {
    return [entry.shortSummary, entry.summary].filter((value) => typeof value === "string").join("\n")
  }

  if (entry?.type !== "message") {
    return ""
  }

  const role = entry?.message?.role
  if (!["user", "assistant", "toolResult"].includes(role)) {
    return ""
  }

  return messageText(entry.message)
}

function hasWorkReference(line) {
  return GITHUB_WORK_REFERENCE.test(line) || JIRA_REFERENCE.test(line) || shortWorkReference(line) !== null
}

function shortWorkReference(line) {
  for (const match of line.matchAll(/(?:\b(issue|PR|pull request)\s*)?#(\d+)\b/gi)) {
    const before = line.slice(0, match.index)
    if (/(?:^|[\s[(])(?:image|screenshot|attachment)\s*$/i.test(before)) {
      continue
    }

    return match
  }

  return null
}

function adjacentDescription(lines, index) {
  const candidates = [lines[index - 1], lines[index + 1]]
  return candidates.find((line) => {
    const value = line?.trim()
    return value && value.length <= 180 && !hasWorkReference(value)
  })?.trim() ?? ""
}

function compactEvidence(line, description) {
  const github = line.match(GITHUB_WORK_REFERENCE)
  const jira = line.match(JIRA_REFERENCE)
  const short = shortWorkReference(line)
  const match = github ?? jira ?? short
  const isPullRequest = github ? github[3] === "pull" : /^(PR|pull request)$/i.test(short?.[1] ?? "")
  const shortReference = `${isPullRequest ? "PR" : ""}#${github ? github[4] : short?.[2]}`
  const reference = github ? `${github[1]}/${github[2]} ${shortReference}` : jira?.[0] ?? shortReference
  const before = line.slice(Math.max(0, match.index - 35), match.index)
  const after = line.slice(match.index + match[0].length)
  const details = `${after} ${description} ${before}`
  return {
    reference,
    repository: github?.[2],
    shortReference,
    text: compactText(`${reference}: ${details}`, MAX_WORK_EVIDENCE_LENGTH),
  }
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

function compactText(value, limit = MAX_USER_CONTEXT_LENGTH) {
  if (typeof value !== "string") {
    return ""
  }

  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
}
