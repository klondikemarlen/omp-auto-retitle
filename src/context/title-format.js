export function formatSessionTitle(description, titleContext, format) {
  const text = typeof description === "string" ? description.trim() : ""
  if (!text) return ""
  if (!format) return text

  const values = {
    repository: titleContext.repository ?? "",
    reference: titleContext.reference ?? "",
    description: text,
    prefix: titleContext.reference ? `${titleContext.reference}: ` : "",
    suffix: titleContext.repository ? ` — ${titleContext.repository}` : "",
  }

  return format.replace(/\{(repository|reference|description|prefix|suffix)\}/g, (_match, field) => values[field])
    .replace(/\s+/g, " ").trim()
}

export function validateTitleFormat(format, sourcePath) {
  if (format !== undefined && (typeof format !== "string" || !format.trim())) {
    throw new Error(`Title format must be a nonblank string: ${sourcePath}`)
  }
  if (format?.match(/\{(?!repository\}|reference\}|description\}|prefix\}|suffix\})[^{}]+\}/)) {
    throw new Error(`Unknown title format field: ${sourcePath}`)
  }
}
