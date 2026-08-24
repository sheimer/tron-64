import fs from 'node:fs'

if (typeof process.loadEnvFile === 'function' && fs.existsSync('.env')) {
  try {
    process.loadEnvFile('.env')
  } catch (err) {
    console.error('[loadEnv] Error loading .env file:', err)
  }
}
