const { GoogleGenAI } = require('@google/genai');

let ai = null;
if (!process.env.GEMINI_API_KEY) {
  console.warn('[Gemini Service] GEMINI_API_KEY is not set. AI features will fallback or fail.');
} else {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

/**
 * Calls the Gemini API with a system prompt and user content.
 * @param {string} systemPrompt - The system instruction/persona.
 * @param {string|Array} userContent - The user's input message or multimodal content.
 * @param {number} [maxTokens=500] - Maximum output tokens.
 * @param {number} [temperature=0] - Model temperature (0 for deterministic, 1 for creative).
 * @param {Object} [options={}] - Additional config options (e.g., responseMimeType).
 * @returns {Promise<string|null>} The trimmed response text, or null if it fails.
 */
async function callGemini(systemPrompt, userContent, maxTokens = 500, temperature = 0, options = {}) {
  if (!ai) return null;
  try {
    const config = {
      systemInstruction: systemPrompt,
      temperature: temperature,
      maxOutputTokens: maxTokens,
    };
    if (options.responseMimeType) {
      config.responseMimeType = options.responseMimeType;
    }
    if (options.responseSchema) {
      config.responseSchema = options.responseSchema;
    }

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      contents: userContent,
      config
    });
    return response.text.trim();
  } catch (err) {
    console.error('[Gemini API Error]', err);
    return null;
  }
}

/**
 * Calls the Gemini API and parses the response as JSON.
 * @param {string} systemPrompt - The system instruction.
 * @param {string} userContent - The user's input message.
 * @param {number} [maxTokens=500] - Maximum output tokens.
 * @param {Object} [schema=null] - Optional JSON schema for structured output.
 * @returns {Promise<Object|null>} The parsed JSON object, or null if it fails to parse.
 */
async function callGeminiJSON(systemPrompt, userContent, maxTokens = 500, schema = null) {
  const options = { responseMimeType: 'application/json' };
  if (schema) {
    options.responseSchema = schema;
  }

  const raw = await callGemini(systemPrompt, userContent, maxTokens, 0, options);
  if (raw === null) return null;
  
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Gemini JSON Parse Fail]', raw.slice(0, 100));
    return null;
  }
}

module.exports = { callGemini, callGeminiJSON, aiClient: ai };
