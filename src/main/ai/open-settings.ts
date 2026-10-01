// open_settings: Buddy puts the Settings page an ask needs in front of the
// user ("buy this" with no card opens Checkout Forms on the card form), instead of
// telling them where to go.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { openSettingsWindow } from '../windows';
import { toolArgs, type ToolRegistry } from './tools';

/** Settings pages by id, with what the user finds there. */
const PAGES = {
  buy: 'Checkout Forms: payment card, shipping and billing addresses',
  shopping: 'Shopping: how product finds open (one at a time, a rundown, or all at once)',
  agent: 'Computer Use',
  apps: 'Apps to connect (Gmail, Calendar, Notion, …)',
  native: 'Built-in Mac abilities (Messages, Mail, Contacts, browser tabs, …)',
  eyes: 'Eyes: screen awareness',
  summon: 'Controls: hotkeys and draw to point',
  voice: 'Voice',
  ears: 'Ears',
  memory: 'Memory',
  jobs: 'Jobs: scheduled runs',
  suggestions: 'Suggestions: when Buddy offers things to take on, and whether they reach the phone and screen',
  permissions: 'macOS permissions',
  account: 'Account and plan',
} as const;

type PageId = keyof typeof PAGES;

const OPEN_SETTINGS: Tool = {
  name: 'open_settings',
  description:
    'Open a Settings page in front of the user, when what they asked needs something only they can add there ' +
    '(a card, an address, an app to connect, a switch to turn on). Then say in one short sentence what to add.',
  input_schema: {
    type: 'object',
    properties: {
      page: {
        type: 'string',
        enum: Object.keys(PAGES),
        description: Object.entries(PAGES)
          .map(([id, what]) => `${id}: ${what}`)
          .join('; '),
      },
    },
    required: ['page'],
  },
};

export function addOpenSettingsTool(registry: ToolRegistry): void {
  registry.set('open_settings', {
    definition: OPEN_SETTINGS,
    execute: async (input) => {
      const page = toolArgs(input)['page'];
      if (typeof page !== 'string' || !(page in PAGES)) {
        return { content: `open_settings needs one of: ${Object.keys(PAGES).join(', ')}.`, isError: true };
      }
      openSettingsWindow(page);
      return { content: `Settings is open on ${PAGES[page as PageId].split(':')[0]}.` };
    },
  });
}
