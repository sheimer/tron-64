import assert from 'node:assert/strict'
import http from 'node:http'
import { app } from '../app.js'
import { sortScoreboardPlayers, ordinalSuffixOf } from '../shared/utils.js'

console.log('--- Testing Scoreboard Sorting, Ranking & Table Markup ---')

// 1. Test sortScoreboardPlayers utility
console.log('1. Verifying sortScoreboardPlayers descending sort and tie-breaking...')

// Test case A: Clear descending totals
const testPlayersA = [
  { id: 'p0', name: 'Tron', total: 40, kills: 1, escaped: 0 },
  { id: 'p1', name: 'Sark', total: 100, kills: 3, escaped: 0 },
  { id: 'p2', name: 'Flynn', total: 75, kills: 2, escaped: 1 },
]
const sortedA = sortScoreboardPlayers(testPlayersA)
assert.strictEqual(sortedA.length, 3)
assert.strictEqual(sortedA[0].id, 'p1', '1st place should be Sark (100 pts)')
assert.strictEqual(sortedA[0]._rank, 1)
assert.strictEqual(sortedA[0]._rankLabel, '1st')
assert.strictEqual(sortedA[1].id, 'p2', '2nd place should be Flynn (75 pts)')
assert.strictEqual(sortedA[1]._rank, 2)
assert.strictEqual(sortedA[1]._rankLabel, '2nd')
assert.strictEqual(sortedA[2].id, 'p0', '3rd place should be Tron (40 pts)')
assert.strictEqual(sortedA[2]._rank, 3)
assert.strictEqual(sortedA[2]._rankLabel, '3rd')

// Test case B: Tie-breaking by kills
const testPlayersB = [
  { id: 'p0', name: 'Tron', total: 50, kills: 1, escaped: 0 },
  { id: 'p1', name: 'Sark', total: 50, kills: 2, escaped: 0 },
]
const sortedB = sortScoreboardPlayers(testPlayersB)
assert.strictEqual(sortedB[0].id, 'p1', 'Sark wins tie with higher kills')
assert.strictEqual(sortedB[1].id, 'p0')

// Test case C: Tie-breaking by escaped when kills are equal
const testPlayersC = [
  { id: 'p0', name: 'Tron', total: 50, kills: 1, escaped: 1 },
  { id: 'p1', name: 'Sark', total: 50, kills: 1, escaped: 0 },
]
const sortedC = sortScoreboardPlayers(testPlayersC)
assert.strictEqual(sortedC[0].id, 'p0', 'Tron wins tie with higher escapes')
assert.strictEqual(sortedC[1].id, 'p1')

// Test case D: Shared ranks for identical scores (competition ranking 1st, 1st, 3rd)
const testPlayersD = [
  { id: 'p0', name: 'Tron', total: 50, kills: 1, escaped: 0 },
  { id: 'p1', name: 'Sark', total: 50, kills: 1, escaped: 0 },
  { id: 'p2', name: 'Flynn', total: 20, kills: 0, escaped: 0 },
]
const sortedD = sortScoreboardPlayers(testPlayersD)
assert.strictEqual(sortedD[0]._rank, 1, 'Tied player should be 1st')
assert.strictEqual(sortedD[0]._rankLabel, '1st')
assert.strictEqual(sortedD[1]._rank, 1, 'Tied player should also be 1st')
assert.strictEqual(sortedD[1]._rankLabel, '1st')
assert.strictEqual(sortedD[2]._rank, 3, 'Next player should be 3rd (1224 competition rank)')
assert.strictEqual(sortedD[2]._rankLabel, '3rd')

// Test case E: Initial 0-score start
const testPlayersE = [
  { id: 'p0', name: 'Tron', total: 0, kills: 0, escaped: 0 },
  { id: 'p1', name: 'Sark', total: 0, kills: 0, escaped: 0 },
  { id: 'p2', name: 'Flynn', total: 0, kills: 0, escaped: 0 },
]
const sortedE = sortScoreboardPlayers(testPlayersE)
assert.strictEqual(sortedE.every((p) => p._rank === 1 && p._rankLabel === '1st'), true, 'All 0-score players start tied at 1st')

// Test case F: Empty and edge inputs
assert.deepStrictEqual(sortScoreboardPlayers([]), [])
assert.deepStrictEqual(sortScoreboardPlayers(null), [])
assert.strictEqual(sortScoreboardPlayers([{ id: 'p0', total: 10 }])[0]._rankLabel, '1st')

console.log('✔ sortScoreboardPlayers logic and ranking verified.')

// 2. Test Express Route & HTML Scoretable Columns
console.log('2. Verifying Express route rendering for #scoretable columns...')
const testServer = http.createServer(app)
await new Promise((resolve) => testServer.listen(0, resolve))
const port = testServer.address().port

const html = await new Promise((resolve, reject) => {
  http.get(`http://localhost:${port}/`, (res) => {
    assert.strictEqual(res.statusCode, 200)
    let body = ''
    res.on('data', (chunk) => (body += chunk))
    res.on('end', () => resolve(body))
    res.on('error', reject)
  })
})

await new Promise((resolve) => testServer.close(resolve))

assert.ok(html.includes('id="scoretable"'), 'HTML should contain #scoretable')
assert.ok(html.includes('id="body-scoretable"'), 'HTML should contain tbody#body-scoretable')
assert.ok(html.includes('>Rank</th>'), 'HTML should contain Rank column header')
assert.ok(html.includes('>Name</th>'), 'HTML should contain Name column header')
assert.ok(html.includes('>Total</th>'), 'HTML should contain Total column header')

console.log('✔ #scoretable HTML markup and headers verified.')

console.log('--- ALL SCOREBOARD TESTS PASSED! ---')
