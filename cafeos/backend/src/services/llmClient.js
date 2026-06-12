const { GoogleGenAI } = require('@google/genai')

let ai = null

if (!process.env.GEMINI_API_KEY) {
  console.warn('[LLM Client] GEMINI_API_KEY is not set. LLM parsing will fall back to regex.')
} else {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
}

module.exports = ai
