/**
 * Pure Fisher-Yates array shuffle.
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
export function fisherYatesShuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function getRandomInt(min, max) {
  const minCeil = Math.ceil(min)
  const maxFloor = Math.floor(max)
  return Math.floor(Math.random() * (maxFloor - minCeil + 1)) + minCeil
}

/**
 * Generates ordinal suffix for numbers (1st, 2nd, 3rd, 4th, etc.).
 * @param {number} i
 * @returns {string}
 */
export function ordinalSuffixOf(i) {
  const j = i % 10
  const k = i % 100
  if (j === 1 && k !== 11) {
    return i + 'st'
  }
  if (j === 2 && k !== 12) {
    return i + 'nd'
  }
  if (j === 3 && k !== 13) {
    return i + 'rd'
  }
  return i + 'th'
}

/**
 * Sorts players descending by total points, kills, escaped, and assigns competition ranks.
 * @template T
 * @param {T[]} players
 * @returns {(T & { _rank: number, _rankLabel: string })[]}
 */
export function sortScoreboardPlayers(players) {
  if (!Array.isArray(players) || players.length === 0) {
    return []
  }

  const sorted = [...players].sort((a, b) => {
    const totalDiff = (b.total ?? 0) - (a.total ?? 0)
    if (totalDiff !== 0) return totalDiff
    const killsDiff = (b.kills ?? 0) - (a.kills ?? 0)
    if (killsDiff !== 0) return killsDiff
    const escapedDiff = (b.escaped ?? 0) - (a.escaped ?? 0)
    if (escapedDiff !== 0) return escapedDiff
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })

  let currentRank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      const isTied =
        (curr.total ?? 0) === (prev.total ?? 0) &&
        (curr.kills ?? 0) === (prev.kills ?? 0) &&
        (curr.escaped ?? 0) === (prev.escaped ?? 0)
      if (!isTied) {
        currentRank = i + 1
      }
    }
    sorted[i]._rank = currentRank
    sorted[i]._rankLabel = ordinalSuffixOf(currentRank)
  }

  return sorted
}

