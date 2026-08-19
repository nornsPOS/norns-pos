import { describe, expect, it } from 'vitest';

import { classifyWatchNotification } from '../../src/lib/calendar-watch.js';

describe('classifyWatchNotification', () => {
  const TOKEN = 'secret-token';

  it('rejects a notification whose channel token does not match', () => {
    expect(classifyWatchNotification('wrong', 'exists', TOKEN)).toEqual({
      authorized: false,
      triggerPull: false,
    });
  });

  it('rejects everything when no expected token is configured', () => {
    expect(classifyWatchNotification('anything', 'exists', '')).toEqual({
      authorized: false,
      triggerPull: false,
    });
  });

  it('authorizes the initial sync handshake but does not trigger a pull', () => {
    expect(classifyWatchNotification(TOKEN, 'sync', TOKEN)).toEqual({
      authorized: true,
      triggerPull: false,
    });
  });

  it('triggers a pull on a real change notification', () => {
    expect(classifyWatchNotification(TOKEN, 'exists', TOKEN)).toEqual({
      authorized: true,
      triggerPull: true,
    });
  });

  it('triggers a pull when the resource-state header is absent (treat as change)', () => {
    expect(classifyWatchNotification(TOKEN, undefined, TOKEN)).toEqual({
      authorized: true,
      triggerPull: true,
    });
  });
});
