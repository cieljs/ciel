import { createThemePlugin } from '@vuetify/v0';
export default createThemePlugin({
  default: 'dark',
  themes: {
    dark: {
      dark: true,
      colors: {
        primary: '#fb7299',
        surface: '#18181b',
        'on-primary': '#362432',
        'on-surface': '#e4e4e7',
      },
    },
  },
});
