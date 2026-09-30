import './assets/main.css';
import { createApp } from 'vue';

import App from './App.vue';
import theme from './theme/index.ts';

createApp(App).use(theme).mount('#app');
