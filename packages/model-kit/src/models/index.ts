import { createModels } from '@earendil-works/pi-ai';

import providers from './providers.ts';

export const models = createModels();

for (const provider of providers) {
  models.setProvider(provider);
}
