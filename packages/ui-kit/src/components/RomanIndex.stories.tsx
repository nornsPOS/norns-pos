import type { Meta, StoryObj } from '@storybook/react';

import { RomanIndex } from './RomanIndex.js';

const meta: Meta<typeof RomanIndex> = {
  title: 'Brand/RomanIndex',
  component: RomanIndex,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof RomanIndex>;

export const Single: Story = { args: { value: 1 } };
export const CartLineCount: Story = { args: { value: 14 } };
export const DailyReceipt: Story = { args: { value: 47, tone: 'gold' } };

export const Cart: Story = {
  render: () => (
    <ul style={{ listStyle: 'none', padding: 0, lineHeight: 1.9 }}>
      <li>
        <RomanIndex value={1} /> &nbsp; 1oz Krugerrand
      </li>
      <li>
        <RomanIndex value={2} /> &nbsp; Silberbarren 500g
      </li>
      <li>
        <RomanIndex value={3} /> &nbsp; Antike Taschenuhr
      </li>
      <li>
        <RomanIndex value={4} /> &nbsp; Briefmarken-Konvolut
      </li>
    </ul>
  ),
};
