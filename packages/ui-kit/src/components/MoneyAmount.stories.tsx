import type { Meta, StoryObj } from '@storybook/react';

import { MoneyAmount } from './MoneyAmount.js';

const meta: Meta<typeof MoneyAmount> = {
  title: 'Werkstatt/MoneyAmount',
  component: MoneyAmount,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof MoneyAmount>;

export const Standard: Story = { args: { valueEur: '1234.50' } };
export const Emphasised: Story = { args: { valueEur: '54321.99', emphasis: true } };
export const Negative: Story = { args: { valueEur: '-99.99', signed: true } };
export const Bare: Story = { args: { valueEur: '12.34', bareNumber: true } };
export const Empty: Story = { args: { valueEur: '' } };
