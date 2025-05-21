import { customProvider } from 'ai';
import { createOllama } from 'ollama-ai-provider';

// Ollama API endpoint configuration
const OLLAMA_API_URL = process.env.NEXT_PUBLIC_OLLAMA_API_URL || 'http://192.168.1.168:30068/api';
const TURBOFORGE_MODEL = process.env.NEXT_PUBLIC_TURBOFORGE_MODEL || 'turboforge-llama3';

// Configure the Ollama provider
export const ollamaProvider = createOllama({
  // optional settings, e.g.
  baseURL: OLLAMA_API_URL,
});

// Create a custom provider using the Ollama provider
export const myProvider = customProvider({
  languageModels: {
    'chat-model': ollamaProvider(TURBOFORGE_MODEL),
    'chat-model-reasoning': ollamaProvider(TURBOFORGE_MODEL),
    'title-model': ollamaProvider(TURBOFORGE_MODEL),
    'artifact-model': ollamaProvider(TURBOFORGE_MODEL),
  },
  // For image generation, if needed, we'd need to implement a different solution
  // as Ollama doesn't support image generation directly
});