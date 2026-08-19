import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so focus state, portals and the
// scroll-lock side-effects never leak across cases.
afterEach(() => {
  cleanup();
});
