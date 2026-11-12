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

function countLabels(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => `${label}=${count}`).join(", ") || "none"
}

function describeNumericTotals(attempts, fieldName, fields) {
  return fields.map((field) => {
    const values = attempts.map((attempt) => attempt[fieldName][field]).filter(isNumber)
    const total = values.reduce((sum, value) => sum + value, 0)
    const displayed = fieldName === "estimatedCost" ? Number(total.toPrecision(6)) : total
    return `${field}=${values.length ? displayed : "not reported"} (${values.length}/${attempts.length} attempts)`
  }).join(", ")
}

function describeGroup(label, requests, attempts = requests.flatMap((request) => request.usage)) {
  const sessions = new Set(requests.map((request) => request.start.sessionHash).filter((hash) => typeof hash === "string" && /^[\da-f]{64}$/.test(hash)))
  const latencies = requests.map((request) => request.finish?.elapsedMs).filter(isNumber)
  const maxLatency = Number(latencies.reduce((max, value) => Math.max(max, value), 0).toFixed(1))
  const requested = requests.filter((request) => request.finish?.modelRequested === true)
  const covered = requested.filter((request) => request.usage.length > 0).length
  const pending = requests.filter((request) => !request.finish).length
  const lines = [
    `${label}: ${requests.length} generations; ${sessions.size} sessions; ${attempts.length} usage attempts`,
    `  Triggers: ${countLabels(requests.map((request) => request.start.reason))}`,
    `  Outcomes: ${countLabels(requests.map((request) => request.finish?.status ?? "incomplete"))}`,
    `  Latency: ${latencies.length ? `mean ${(latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)} ms; max ${maxLatency} ms` : "not reported"} (${latencies.length}/${requests.length} generations)`,
    `  Usage coverage: ${covered}/${requested.length} completed model-requested generations; ${requested.length - covered} missing callbacks; ${pending} incomplete generations (model-request status unknown)`,
    `  Tokens: ${describeNumericTotals(attempts, "usage", tokenFields)}`,
    `  Estimated cost (provider-reported, not a bill): ${describeNumericTotals(attempts, "estimatedCost", costFields)}`,
  ]
  return lines.join("\n")
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
  const lines = [
    `Auto-retitle analytics — last ${days} UTC calendar days (${new Date(start).toISOString().slice(0, 10)} through ${today})`,
    "Local recorded data only. Requests, retries, and late usage are attributed to the request's UTC start day.",
    describeGroup("Total", requests),
    "By UTC day:",
  ]
  const dates = [...new Set(requests.map((request) => new Date(request.start.timestamp).toISOString().slice(0, 10)))].sort()
  for (const date of dates) {
    lines.push(describeGroup(date, requests.filter((request) => new Date(request.start.timestamp).toISOString().slice(0, 10) === date)))
  }
  lines.push("By actual provider/model (request outcomes and end-to-end latency repeat across retry groups):")
  const models = new Map()
  for (const request of requests) {
    for (const attempt of request.usage) {
      const key = JSON.stringify([attempt.provider, attempt.model])
      if (!models.has(key)) models.set(key, { requests: new Set(), attempts: [] })
      const group = models.get(key)
      group.requests.add(request)
      group.attempts.push(attempt)
    }
  }
  for (const [key, group] of [...models].sort(([a], [b]) => a.localeCompare(b))) {
    const [provider, model] = JSON.parse(key)
    lines.push(describeGroup(`${provider} / ${model}`, [...group.requests], group.attempts))
  }
  if (!models.size) lines.push("  No actual provider/model telemetry recorded.")
  lines.push("Missing callbacks do not establish local execution or zero usage; older hosts may not expose telemetry. No subscription quota or synthetic quality score is inferred.")
  const { malformed, unreadable, orphaned } = data.issues
  lines.push(`Storage warnings: ${malformed} malformed/incomplete records skipped; ${unreadable} unreadable files/directories; ${orphaned} requests without start records (excluded).`)
  return lines.join("\n")
}
