import type { Meta, StoryObj } from '@storybook/react';

import { Seal } from './Seal.js';

const meta: Meta<typeof Seal> = {
  title: 'Brand/Seal',
  component: Seal,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    tone: { control: 'inline-radio', options: ['ink', 'gold', 'wax-red', 'faded'] },
  },
};
export default meta;

type Story = StoryObj<typeof Seal>;

export const Default: Story = { args: { label: '14', size: 'md' } };

export const Counter: Story = {
  args: { label: 'N° 47', size: 'lg' },
  parameters: { docs: { description: { story: 'Used as the daily counter on receipts.' } } },
};

export const Gold: Story = { args: { label: '14', size: 'lg', tone: 'gold' } };

export const SizeRow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      <Seal size="sm" />
      <Seal size="md" />
      <Seal size="lg" />
    </div>
  ),
};
