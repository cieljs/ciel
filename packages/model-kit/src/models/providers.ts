import { createProvider, envApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/compat';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';

const common = {
  provider: 'xiaomi',
  api: 'openai-completions',
  baseUrl: 'https://api.xiaomimimo.com/v1',

  reasoning: true,
  input: ['text', 'image'],

  thinkingLevelMap: {
    off: 'none',
    minimal: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: null,
  },

  contextWindow: 1_048_576,
  maxTokens: 131_072,

  compat: {
    supportsDeveloperRole: false,
  },
} satisfies Omit<Model<'openai-completions'>, 'id' | 'name' | 'cost'>;

const mimoV26Flash: Model<'openai-completions'> = {
  ...common,

  id: 'mimo-v2.6-flash',
  name: 'MiMo-V2.6-Flash',

  cost: {
    input: 0.14,
    output: 0.28,
    cacheRead: 0.0028,
    cacheWrite: 0,
  },
};

const mimoV26Pro: Model<'openai-completions'> = {
  ...common,

  id: 'mimo-v2.6-pro',
  name: 'MiMo-V2.6-Pro',

  cost: {
    input: 0.435,
    output: 0.87,
    cacheRead: 0.0036,
    cacheWrite: 0,
  },
};

const mimoV26ProUltraSpeed: Model<'openai-completions'> = {
  ...common,

  id: 'mimo-v2.6-pro-ultraspeed',
  name: 'MiMo-V2.6-Pro-UltraSpeed',

  cost: {
    input: 4.35,
    output: 8.7,
    cacheRead: 0.036,
    cacheWrite: 0,
  },
};

export const xiaomi = createProvider({
  id: 'xiaomi',
  name: 'Xiaomi',

  baseUrl: 'https://api.xiaomimimo.com/v1',

  auth: {
    apiKey: envApiKeyAuth('Xiaomi API key', ['XIAOMI_API_KEY', 'MIMO_API_KEY']),
  },

  models: [mimoV26Flash, mimoV26Pro, mimoV26ProUltraSpeed],

  api: openAICompletionsApi(),
});

export default [...builtinProviders(), xiaomi];
