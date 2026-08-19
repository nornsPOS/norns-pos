import type { Meta, StoryObj } from '@storybook/react';

import { StatTile } from './StatTile.js';

const meta: Meta<typeof StatTile> = {
  title: 'Werkstatt/StatTile',
  component: StatTile,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof StatTile>;

export const Default: Story = {
  args: { value: 47, label: 'Meine Aufgaben', index: 1 },
};

export const WithAttention: Story = {
  args: {
    value: 3,
    label: 'eBay-Konflikte (7 Tage)',
    index: 6,
    attention: true,
    attentionCaption: 'Sofortige Prüfung empfohlen.',
  },
};

export const Zero: Story = {
  args: { value: 0, label: 'Überfällig', index: 3 },
};

export const Row: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 220px)', gap: 16 }}>
      <StatTile value={47} label="Meine Aufgaben" index={1} />
      <StatTile
        value={2}
        label="Heute fällig"
        index={2}
        attention
        attentionCaption="Sofort fällig."
      />
      <StatTile value={0} label="Überfällig" index={3} />
    </div>
  ),
};
