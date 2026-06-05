const axios = require('axios')

async function callClaude(systemPrompt, userContent, maxTokens = 500, temperature = 0) {
  const messages = [{ role: 'user', content: userContent }]
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 12000
      }
    )
    return response.data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
  } catch (err) {
    console.error('[Claude API Error]', {
      message: err.message,
      status: err.response?.status,
      data: err.response?.data
    })
    return null
  }
}

async function callClaudeJSON(systemPrompt, userContent, maxTokens = 500) {
  const raw = await callClaude(systemPrompt, userContent, maxTokens, 0)
  if (raw === null) return null
  const clean = raw.replace(/```json\s*|```/g, '').trim()
  try {
    return JSON.parse(clean)
  } catch (firstErr) {
    console.warn('[Claude JSON Parse Fail] Retrying once...', clean.slice(0, 100))
    const fixPrompt = `The following text should be valid JSON but failed to parse. Return ONLY the corrected JSON:\n${clean}`
    const fixed = await callClaude('You are a JSON repair assistant.', fixPrompt, maxTokens, 0)
    if (!fixed) return null
    try {
      return JSON.parse(fixed.replace(/```json\s*|```/g, '').trim())
    } catch {
      console.error('[Claude JSON Parse Fail] Both attempts failed.')
      return null
    }
  }
}

module.exports = { callClaude, callClaudeJSON }
