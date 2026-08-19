import type { Meta, StoryObj } from '@storybook/react';

import { Zwischentitel } from './Zwischentitel.js';
import { ParchmentCard } from './ParchmentCard.js';
import { Seal } from './Seal.js';

const meta: Meta<typeof ParchmentCard> = {
  title: 'Brand/ParchmentCard',
  component: ParchmentCard,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof ParchmentCard>;

export const Default: Story = {
  args: {
    children: (
      <>
        <h3 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500 }}>
          Werkstatt
        </h3>
        <Zwischentitel label="Übersicht" />
        <p style={{ marginTop: 0 }}>Hier ruhen die offenen Aufgaben des Tages.</p>
      </>
    ),
  },
};

export const WithSeal: Story = {
  args: {
    children: (
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <Seal size="md" />
        <div>
          <h3 style={{ margin: 0 }}>Bewertung N° XLVII</h3>
          <p style={{ margin: 0, opacity: 0.7 }}>3 Posten · €5.420,00</p>
        </div>
      </div>
    ),
  },
};

export const Stacked: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
      <ParchmentCard>
        <strong>Goldmünzen</strong>
        <Zwischentitel />
        <span>12 Stück · Tresor-1 · Fach-3</span>
      </ParchmentCard>
      <ParchmentCard tone="deep">
        <em>Eingelagert · in Bearbeitung</em>
      </ParchmentCard>
    </div>
  ),
};
