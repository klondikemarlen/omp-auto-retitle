import assert from "node:assert/strict"
import { test } from "node:test"

import { observeNativeTitleReason } from "../../src/omp/native-title-reason.js"

test("when title calls overlap, capture only each call's reasons before cancellation", async () => {
  // Arrange
  const sinks = new Set()
  const logger = {
    registerLogSink(sink) {
      sinks.add(sink)
      return () => sinks.delete(sink)
    },
  }
  function emit(reason) {
    for (const sink of sinks) {
      sink({
        message: "title-generator: no title returned",
        context: {
          reason,
        },
      })
    }
  }
  const firstReasons = []
  const secondReasons = []
  const finishFirst = Promise.withResolvers()
  const finishSecond = Promise.withResolvers()
  const controller = new AbortController()

  // Act
  const first = observeNativeTitleReason(logger, controller.signal, (reason) => firstReasons.push(reason), async () => {
    emit("invalid-title")
    await finishFirst.promise
    emit("exception")
  })
  const second = observeNativeTitleReason(logger, undefined, (reason) => secondReasons.push(reason), async () => {
    await finishSecond.promise
    emit("private arbitrary text")
    emit("model-returned-none")
  })
  emit("provider-response-error")
  controller.abort()
  finishFirst.resolve()
  finishSecond.resolve()
  await Promise.all([first, second])

  // Assert
  assert.deepEqual(firstReasons, ["invalid-title"])
  assert.deepEqual(secondReasons, ["model-returned-none"])
})
