import { createHash, randomUUID } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { getAgentDir } from "@oh-my-pi/pi-utils"

const processLogName = `requests-${process.pid}-${randomUUID()}.jsonl`
const tokenFields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "reasoningTokens"]
const costFields = ["input", "output", "cacheRead", "cacheWrite", "total"]
const reasons = new Set(["first-task", "task", "replan", "session_compact", "command"])
const outcomes = new Set(["updated", "unchanged", "fallback", "unavailable", "stale", "error"])
const dayMs = 86_400_000

function defaultDirectory() {
  return join(getAgentDir(), "auto-retitle", "analytics")
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function numericFields(source, fields) {
  const result = {}
  for (const field of fields) {
    if (isNumber(source?.[field])) result[field] = source[field]
  }
  return result
}

function modelLabel(value) {
  if (typeof value !== "string" || !value.length || value.length > 256) return "unknown"
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return "unknown"
  }
  return value
}

export function createTitleAnalytics({ sessionId, reason, version }, options = {}) {
  const requestId = randomUUID()
  let finished = false
  let warned = false

  function append(record) {
    try {
      const directory = options.directory ?? defaultDirectory()
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      appendFileSync(join(directory, processLogName), `${JSON.stringify({
        schema: 1, requestId, timestamp: new Date().toISOString(), ...record,
      })}\n`, { mode: 0o600 })
    } catch {
      if (!warned) {
        warned = true
        console.warn("Auto-retitle analytics could not be saved; local usage reporting may be incomplete.")
      }
    }
  }

  const start = { type: "start", reason: reasons.has(reason) ? reason : "unknown" }
  if (typeof sessionId === "string" && sessionId) {
    start.sessionHash = createHash("sha256").update(sessionId).digest("hex")
  }
  if (typeof version === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) start.version = version
  append(start)

  return {
    onUsage(message) {
      if (message?.role !== "assistant") return
      const usage = numericFields(message.usage, tokenFields)
      const estimatedCost = numericFields(message.usage?.cost, costFields)
      append({
        type: "usage",
        provider: modelLabel(message.provider),
        model: modelLabel(message.model),
        usage,
        ...(Object.keys(estimatedCost).length ? { estimatedCost } : {}),
      })
    },
    finish({ status, modelRequested, elapsedMs }) {
      if (finished) return
      finished = true
      append({
        type: "finish",
        status: outcomes.has(status) ? status : "unknown",
        modelRequested: modelRequested === true,
        ...(isNumber(elapsedMs) ? { elapsedMs } : {}),
      })
    },
  }
}

// Treat disk records as untrusted: never echo arbitrary fields or parse failures.
function validRecord(record) {
  if (!record || record.schema !== 1 || typeof record.requestId !== "string" ||
      !/^[\da-f-]{36}$/.test(record.requestId) || typeof record.timestamp !== "string" ||
      !Number.isFinite(Date.parse(record.timestamp))) return false
  if (record.type === "start") return reasons.has(record.reason) || record.reason === "unknown"
  if (record.type === "finish") {
    return (outcomes.has(record.status) || record.status === "unknown") && typeof record.modelRequested === "boolean"
  }
  return record.type === "usage" && record.usage && typeof record.usage === "object"
}

function readRequests(directory) {
  const requests = new Map()
  const issues = { malformed: 0, unreadable: 0, orphaned: 0 }
  let files
  try {
    files = readdirSync(directory).filter((file) => file.endsWith(".jsonl")).sort()
  } catch (error) {
    if (error.code !== "ENOENT") issues.unreadable++
    return { requests: [], issues }
  }

  for (const file of files) {
    let text
    try {
      text = readFileSync(join(directory, file), "utf8")
    } catch {
      issues.unreadable++
      continue
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        issues.malformed++
        continue
      }
      if (!validRecord(record)) {
        issues.malformed++
        continue
      }
      let request = requests.get(record.requestId)
      if (!request) {
        request = { usage: [] }
        requests.set(record.requestId, request)
      }
      if (record.type === "start") request.start ??= record
      if (record.type === "finish") request.finish ??= record
      if (record.type === "usage") {
        request.usage.push({
          provider: modelLabel(record.provider),
          model: modelLabel(record.model),
          usage: numericFields(record.usage, tokenFields),
          estimatedCost: numericFields(record.estimatedCost, costFields),
        })
      }
    }
  }
  for (const request of requests.values()) {
    if (!request.start) issues.orphaned++
  }
  return { requests: [...requests.values()].filter((request) => request.start), issues }
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`
}

function describeTokens(attempts, field) {
  const values = attempts.map((attempt) => attempt.usage[field]).filter(isNumber)
  if (!values.length) return "not reported"
  const total = values.reduce((sum, value) => sum + value, 0).toLocaleString("en-US")
  return values.length === attempts.length ? total : `${total} reported (${values.length}/${attempts.length} calls)`
}

function describeOutcomes(requests) {
  const labels = {
    updated: "updated", unchanged: "unchanged", fallback: "fallback",
    unavailable: "unavailable", stale: "superseded", error: "failed",
    incomplete: "unfinished", unknown: "unknown",
  }
  const counts = new Map()
  for (const request of requests) {
    const label = labels[request.finish?.status ?? "incomplete"] ?? "unknown"
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => `${count} ${label}`).join(" · ")
}

function describeModels(attempts) {
  const models = new Map()
  for (const attempt of attempts) {
    const label = `${attempt.provider} / ${attempt.model}`
    if (!models.has(label)) models.set(label, [])
    models.get(label).push(attempt)
  }
  if (!models.size) return ["Model: not reported"]
  if (models.size === 1) return [`Model: ${models.keys().next().value}`]
  return ["Models:", ...[...models].sort(([a], [b]) => a.localeCompare(b)).map(([label, usage]) =>
    `  ${label}: ${countLabel(usage.length, "call")} · tokens: ${describeTokens(usage, "totalTokens")}`,
  )]
}

function describeWarnings(requests, issues) {
  const lines = []
  const missing = requests.filter((request) => request.finish?.modelRequested && !request.usage.length).length
  const unfinished = requests.filter((request) => !request.finish).length
  if (missing) lines.push(`Usage unavailable for ${countLabel(missing, "completed model request")}; token totals may be incomplete.`)
  if (unfinished) lines.push(`${countLabel(unfinished, "request")} unfinished; usage may be incomplete.`)
  const warnings = []
  if (issues.malformed) warnings.push(`${countLabel(issues.malformed, "invalid record")} skipped`)
  if (issues.unreadable) warnings.push(`${countLabel(issues.unreadable, "unreadable file or directory", "unreadable files or directories")}`)
  if (issues.orphaned) warnings.push(`${countLabel(issues.orphaned, "request")} without a start record`)
  if (warnings.length) lines.push(`Storage warning: ${warnings.join("; ")}. Totals may be incomplete.`)
  return lines
}

export function describeTitleAnalytics({ days = 7, directory } = {}) {
  if (!Number.isInteger(days) || days < 1) {
    return "Auto-retitle analytics: days must be a positive integer."
  }
  let data
  try {
    data = readRequests(directory ?? defaultDirectory())
  } catch {
    return "Auto-retitle analytics unavailable: local storage could not be read."
  }
  const today = new Date().toISOString().slice(0, 10)
  const end = Date.parse(today) + dayMs
  const start = end - days * dayMs
  if (!Number.isFinite(new Date(start).getTime())) {
    return "Auto-retitle analytics: requested UTC date range is out of bounds."
  }
  const requests = data.requests.filter((request) => {
    const timestamp = Date.parse(request.start.timestamp)
    return timestamp >= start && timestamp < end
  })
  const lines = [`Title analytics — last ${countLabel(days, "day")} (UTC)`]
  if (!requests.length) {
    return [...lines, "No title activity recorded in this period.", ...describeWarnings(requests, data.issues)].join("\n")
  }
  const attempts = requests.flatMap((request) => request.usage)
  const sessions = new Set(requests.map((request) => request.start.sessionHash).filter((hash) => typeof hash === "string" && /^[\da-f]{64}$/.test(hash)))
  const latencies = requests.map((request) => request.finish?.elapsedMs).filter(isNumber)
  lines.push(
    `${countLabel(requests.length, "request")} across ${countLabel(sessions.size, "session")}`,
    `Titles: ${describeOutcomes(requests)}`,
    `Model calls: ${attempts.length} reported (including retries)`,
    `Tokens: ${describeTokens(attempts, "totalTokens")} total · ${describeTokens(attempts, "input")} input · ${describeTokens(attempts, "output")} output`,
  )
  if (latencies.length) {
    const mean = latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    const max = latencies.reduce((longest, value) => Math.max(longest, value), 0)
    const coverage = latencies.length === requests.length ? "" : ` (${latencies.length}/${requests.length} requests)`
    lines.push(`Time: ${(mean / 1000).toFixed(2)} s average · ${(max / 1000).toFixed(2)} s slowest${coverage}`)
  }
  lines.push(...describeModels(attempts), ...describeWarnings(requests, data.issues))
  lines.push("Recorded locally. Tokens do not measure subscription quota.")
  return lines.join("\n")
}
