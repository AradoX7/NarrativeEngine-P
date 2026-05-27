/**
 * intimacyDetector.ts
 *
 * Scans the last 4 messages (user + assistant) for explicit intimacy signals.
 * Returns true if any match — used to conditionally inject NSFWProfile in minifyNPC().
 */

import type { ChatMessage } from '../types';

const INTIMACY_TERMS = [
    'kissed', 'kiss', 'embraced', 'embrace', 'naked', 'aroused',
    'cock', 'pussy', 'breast', 'breasts', 'nipple', 'nipples',
    'ass', 'passion', 'lips', 'cum', 'fuck', 'fucked', 'orgasm',
    'buttocks', 'anal', 'vagina', 'pubic', 'suck',
];

export function detectIntimacyContext(history: ChatMessage[]): boolean {
    const recentMessages = history.slice(-4);
    const text = recentMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => (typeof m.content === 'string' ? m.content : ''))
        .join(' ')
        .toLowerCase();

    return INTIMACY_TERMS.some(term => text.includes(term));
}
