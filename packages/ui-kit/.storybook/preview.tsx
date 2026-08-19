/**
 * Storybook preview — wraps every story in the parchment surface so
 * components always render against their real background. Toggle light /
 * dark via the Themes panel (@storybook/addon-themes).
 */

import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react';

import '../src/styles.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'parchment',
      values: [
        { name: 'parchment', value: '#F1ECE0' },
        { name: 'parchment-deep', value: '#DED6C2' },
        { name: 'midnight', value: '#1A1614' },
      ],
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },
    layout: 'centered',
  },
  decorators: [
    withThemeByDataAttribute({
      themes: { light: 'light', dark: 'dark' },
      defaultTheme: 'light',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;
