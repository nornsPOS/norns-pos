import type { Meta, StoryObj } from '@storybook/react';

import { Button } from './Button.js';
import { MagnifierIcon } from './MagnifierIcon.js';

const meta: Meta<typeof Button> = {
  title: 'Brand/Button',
  component: Button,
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { children: 'Verkauf abschließen', variant: 'primary' } };
export const Destructive: Story = { args: { children: 'Storno', variant: 'destructive' } };
export const Ghost: Story = { args: { children: 'Abbrechen', variant: 'ghost' } };

export const WithIcon: Story = {
  args: {
    children: 'Suchen',
    variant: 'primary',
    iconLeft: <MagnifierIcon size={16} />,
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button size="sm">Klein</Button>
      <Button size="md">Mittel</Button>
      <Button size="lg">Groß</Button>
    </div>
  ),
};
