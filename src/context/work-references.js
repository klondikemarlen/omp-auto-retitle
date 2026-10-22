import { getMessageText, getRecentUniqueText, normalizeContextText } from "./context-text.js"

const MAX_USER_CONTEXT_LENGTH = 120
const MAX_WORK_EVIDENCE = 3
const MAX_WORK_EVIDENCE_LENGTH = 130
const GITHUB_WORK_REFERENCE = /https?:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/(issues|pull)\/(\d+)/i
const JIRA_REFERENCE = /\b[A-Z][A-Z0-9]+-\d+\b/
const SHORT_WORK_REFERENCE = /(?:\b(issue|PR|pull request)\s*)?#(\d+)\b/gi

export function selectWorkEvidence(entries) {
  const evidence = []
  const userEvidence = []

  for (const entry of entries) {
    const text = workEvidenceText(entry)
    if (!text) continue

    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      const reference = findWorkReference(line)
      if (!reference) continue

      const item = compactEvidence(line, adjacentDescription(lines, index), reference)
      evidence.push(item)
      if (entry.message?.role === "user") userEvidence.push(item)
    }
  }

  // Keep the latest explicit user reference even when later tool output is noisy.
  const selected = userEvidence.at(-1) ?? evidence.at(-1)
  if (selected) {
    selected.subject = evidence.findLast((item) => item.reference === selected.reference && item.subject)?.subject ?? ""
  }

  const otherTexts = evidence.filter((item) => item !== selected).map((item) => item.text)
  const recentTexts = getRecentUniqueText(otherTexts, MAX_WORK_EVIDENCE - 1)
  return [...recentTexts.map((text) => evidence.findLast((item) => item.text === text)), selected].filter(Boolean)
}

function workEvidenceText(entry) {
  if (entry?.type === "compaction") {
    return [entry.shortSummary, entry.summary].filter((value) => typeof value === "string").join("\n")
  }

  if (entry?.type !== "message") return ""

  const role = entry?.message?.role
  if (!["user", "assistant", "toolResult"].includes(role)) return ""

  return getMessageText(entry.message)
}

function findWorkReference(line) {
  const githubMatch = line.match(GITHUB_WORK_REFERENCE)
  if (githubMatch) return describeGithubReference(githubMatch)

  const jiraMatch = line.match(JIRA_REFERENCE)
  if (jiraMatch) {
    return {
      match: jiraMatch,
      reference: jiraMatch[0],
      shortReference: jiraMatch[0],
    }
  }

  const shortMatch = findShortWorkReference(line)
  if (shortMatch) return describeShortReference(shortMatch)

  return null
}

function describeGithubReference(match) {
  const [, owner, repository, kind, number] = match
  let shortReference = `#${number}`
  if (kind === "pull") shortReference = `PR#${number}`

  return {
    match,
    repository,
    shortReference,
    reference: `${owner}/${repository} ${shortReference}`,
  }
}

function describeShortReference(match) {
  const [, label, number] = match
  let shortReference = `#${number}`
  if (/^(PR|pull request)$/i.test(label ?? "")) shortReference = `PR#${number}`

  return {
    match,
    shortReference,
    reference: shortReference,
  }
}

function findShortWorkReference(line) {
  for (const match of line.matchAll(SHORT_WORK_REFERENCE)) {
    const before = line.slice(0, match.index)
    if (/(?:^|[\s[(])(?:image|screenshot|attachment)\s*$/i.test(before)) continue

    return match
  }

  return null
}

function adjacentDescription(lines, index) {
  const candidates = [lines[index - 1], lines[index + 1]]
  return candidates.find((line) => {
    const value = line?.trim()
    return value && value.length <= 180 && !findWorkReference(value)
  })?.trim() ?? ""
}

function compactEvidence(line, description, { match, reference, repository, shortReference }) {
  const before = line.slice(Math.max(0, match.index - 35), match.index)
  const after = line.slice(match.index + match[0].length)
  const details = `${after} ${description} ${before}`
  const explicitSubject = after.match(/^\s*:\s*(.+?)(?:[.!?](?:\s|$)|$)/)?.[1]

  return {
    reference,
    repository,
    shortReference,
    subject: normalizeContextText(explicitSubject, MAX_USER_CONTEXT_LENGTH),
    text: normalizeContextText(`${reference}: ${details}`, MAX_WORK_EVIDENCE_LENGTH),
  }
}
