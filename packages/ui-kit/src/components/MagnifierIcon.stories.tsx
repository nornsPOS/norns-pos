import type { Meta, StoryObj } from '@storybook/react';

import { MagnifierIcon } from './MagnifierIcon.js';

const meta: Meta<typeof MagnifierIcon> = {
  title: 'Brand/MagnifierIcon',
  component: MagnifierIcon,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof MagnifierIcon>;

export const Default: Story = { args: { size: 24 } };
export const Big: Story = { args: { size: 64 } };
export const Gold: Story = { args: { size: 48, tone: 'gold' } };
