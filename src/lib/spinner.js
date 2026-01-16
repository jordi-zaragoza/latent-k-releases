// Simple CLI spinner for progress indication
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
let interval = null
let frameIndex = 0

export function startSpinner(message) {
  if (interval) stopSpinner()
  frameIndex = 0
  process.stdout.write(`${frames[0]} ${message}`)
  interval = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length
    process.stdout.write(`\r${frames[frameIndex]} ${message}`)
  }, 80)
}

export function stopSpinner(finalMessage = null) {
  if (interval) {
    clearInterval(interval)
    interval = null
    process.stdout.write('\r' + ' '.repeat(60) + '\r')
    if (finalMessage) {
      console.log(finalMessage)
    }
  }
}

export async function withSpinner(message, fn) {
  startSpinner(message)
  try {
    const result = await fn()
    stopSpinner()
    return result
  } catch (err) {
    stopSpinner()
    throw err
  }
}
