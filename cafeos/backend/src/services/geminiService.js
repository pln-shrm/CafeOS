const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function callGemini(systemPrompt, userContent, maxTokens = 500, temperature = 0, options = {}) {
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

module.exports = { callGemini, callGeminiJSON };
