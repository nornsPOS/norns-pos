/**
 * Storybook 8 config — React + Vite, no Tailwind required (ui-kit ships
 * inline CSS via styles.css). Stories live next to the components.
 */

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-themes', '@storybook/addon-a11y'],
  docs: { autodocs: 'tag' },
  typescript: { reactDocgen: 'react-docgen-typescript' },
  staticDirs: ['../public'],
};

export default config;
