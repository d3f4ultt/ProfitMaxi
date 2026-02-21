/**
 * Discriminator consistency tests
 *
 * Verifies that every instruction discriminator in INSTRUCTION_DISCRIMINATORS
 * matches the canonical Anchor formula:
 *   sha256("global:<snake_case_instruction_name>")[0..8]
 *
 * If a discriminator is wrong, on-chain transactions will fail silently with
 * an "unknown instruction" error.
 */

import { createHash } from 'crypto';
import { INSTRUCTION_DISCRIMINATORS } from '../instructions';

function anchorDiscriminator(snakeCaseName: string): Buffer {
  return createHash('sha256')
    .update(`global:${snakeCaseName}`)
    .digest()
    .slice(0, 8);
}

describe('INSTRUCTION_DISCRIMINATORS', () => {
  const mapping: Record<keyof typeof INSTRUCTION_DISCRIMINATORS, string> = {
    initialize:     'initialize',
    createOrder:    'create_order',
    executeShard:   'execute_shard',
    cancelOrder:    'cancel_order',
    updateOrder:    'update_order',
    pauseOrder:     'pause_order',
    resumeOrder:    'resume_order',
    updateConfig:   'update_config',
    registerKeeper: 'register_keeper',
    withdrawFees:   'withdraw_fees',
  };

  for (const [sdkKey, anchorName] of Object.entries(mapping)) {
    it(`${sdkKey} == sha256("global:${anchorName}")[0..8]`, () => {
      const expected = anchorDiscriminator(anchorName);
      const actual = INSTRUCTION_DISCRIMINATORS[sdkKey as keyof typeof INSTRUCTION_DISCRIMINATORS];
      expect(actual).toEqual(expected);
    });
  }

  it('all discriminators are exactly 8 bytes', () => {
    for (const [key, disc] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
      expect(disc).toHaveLength(8);
    }
  });

  it('all discriminators are unique (no collisions)', () => {
    const hexValues = Object.values(INSTRUCTION_DISCRIMINATORS).map(d =>
      d.toString('hex')
    );
    const unique = new Set(hexValues);
    expect(unique.size).toBe(hexValues.length);
  });
});
