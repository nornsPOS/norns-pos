import type { Meta, StoryObj } from '@storybook/react';

import { Zwischentitel } from './Zwischentitel.js';

const meta: Meta<typeof Zwischentitel> = {
  title: 'Brand/Zwischentitel',
  component: Zwischentitel,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Zwischentitel>;

/** Ohne Text: reiner Atemraum — Trennung durch Luft, nicht durch Striche. */
export const Atemraum: Story = { args: {} };
export const MitText: Story = { args: { label: 'Zahlung' } };
export const Folge: Story = {
  render: () => (
    <div style={{ width: 480 }}>
      <Zwischentitel label="Belegtext" />
      <p style={{ margin: 0 }}>Differenzbesteuerung gemäß § 25a UStG.</p>
      <Zwischentitel label="Zahlung" />
      <p style={{ margin: 0 }}>Bar · €1.420,00</p>
    </div>
  ),
};
