import { describe, expect, it } from 'vitest';

import {
  channelForObject,
  extractSocialMessages,
  socialConversationKey,
} from '../../src/lib/social-adapter.js';

describe('channelForObject', () => {
  it('maps Meta object → channel', () => {
    expect(channelForObject('instagram')).toBe('instagram');
    expect(channelForObject('page')).toBe('messenger');
    expect(channelForObject('whatsapp_business_account')).toBeNull();
    expect(channelForObject(undefined)).toBeNull();
  });
});

describe('extractSocialMessages — Facebook Messenger', () => {
  it('translates a Messenger text DM into a unified message', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'PAGE_1',
          messaging: [
            {
              sender: { id: 'PSID_123' },
              recipient: { id: 'PAGE_1' },
              timestamp: 1748520000000,
              message: { mid: 'm_abc', text: 'Habt ihr Goldringe?' },
            },
          ],
        },
      ],
    };
    const msgs = extractSocialMessages(body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: 'messenger',
      senderId: 'PSID_123',
      recipientId: 'PAGE_1',
      text: 'Habt ihr Goldringe?',
      messageId: 'm_abc',
    });
    expect(msgs[0]?.receivedAt.getTime()).toBe(1748520000000);
  });

  it('extracts an attachment URL when there is no text', () => {
    const body = {
      object: 'page',
      entry: [
        {
          messaging: [
            {
              sender: { id: 'PSID_9' },
              recipient: { id: 'PAGE_1' },
              message: {
                mid: 'm_img',
                attachments: [{ type: 'image', payload: { url: 'https://cdn.example/x.jpg' } }],
              },
            },
          ],
        },
      ],
    };
    const msgs = extractSocialMessages(body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.mediaUrl).toBe('https://cdn.example/x.jpg');
    expect(msgs[0]?.text).toBeUndefined();
  });
});

describe('extractSocialMessages — Instagram', () => {
  it('translates an Instagram DM into a unified message', () => {
    const body = {
      object: 'instagram',
      entry: [
        {
          id: 'IG_1',
          messaging: [
            {
              sender: { id: 'IGSID_77' },
              recipient: { id: 'IG_1' },
              timestamp: 1748520050000,
              message: { mid: 'ig_1', text: 'Preis für 10g?' },
            },
          ],
        },
      ],
    };
    const msgs = extractSocialMessages(body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      channel: 'instagram',
      senderId: 'IGSID_77',
      text: 'Preis für 10g?',
    });
  });
});

describe('extractSocialMessages — filtering', () => {
  it('skips echoes, empty messages, and unsupported objects', () => {
    expect(
      extractSocialMessages({
        object: 'page',
        entry: [
          {
            messaging: [
              {
                sender: { id: 'a' },
                recipient: { id: 'p' },
                message: { mid: 'e', text: 'hi', is_echo: true },
              },
              { sender: { id: 'b' }, recipient: { id: 'p' }, message: { mid: 'n' } }, // no text/attachment
              { sender: { id: 'c' }, message: { mid: 'x', text: 'no recipient' } }, // no recipient
            ],
          },
        ],
      }),
    ).toEqual([]);
    expect(extractSocialMessages({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(extractSocialMessages({})).toEqual([]);
  });
});

describe('socialConversationKey', () => {
  it('namespaces the sender id by channel', () => {
    expect(socialConversationKey('instagram', 'IGSID_1')).toBe('instagram:IGSID_1');
    expect(socialConversationKey('messenger', 'PSID_2')).toBe('messenger:PSID_2');
  });
});
