#!/usr/bin/env bun

const usage = `Usage: omp-retitle <command>

Commands:
  analytics   Show local title usage for the last 7 UTC days.

Options:
  -h, --help  Show this help.`

const [, , command] = process.argv
const hasOneArgument = process.argv.length === 3

if (hasOneArgument && command === "analytics") {
  const { describeTitleAnalytics } = await import("../src/omp/title-analytics.js")
  console.log(describeTitleAnalytics())
} else if (hasOneArgument && (command === "--help" || command === "-h")) {
  console.log(usage)
} else {
  console.error(`Invalid invocation.\n\n${usage}`)
  process.exitCode = 1
}
