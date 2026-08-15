import { describe, it, expect } from 'vitest';

import { validateCoreAddress } from './address.js';
import { base58CheckEncode } from '../utils/base58.js';
import { TESTNET, MAINNET } from '../config.js';

function makeAddress(prefix: number, fill = 0x42): string {
  const payload = new Uint8Array(21);
  payload[0] = prefix;
  payload.fill(fill, 1);
  return base58CheckEncode(payload);
}

describe('validateCoreAddress', () => {
  it('accepts a testnet P2PKH address', () => {
    const result = validateCoreAddress(makeAddress(TESTNET.addressPrefix), TESTNET);
    expect(result).toEqual({ valid: true, type: 'p2pkh' });
  });

  it('accepts a testnet P2SH address', () => {
    const result = validateCoreAddress(makeAddress(TESTNET.p2shPrefix), TESTNET);
    expect(result).toEqual({ valid: true, type: 'p2sh' });
  });

  it('accepts mainnet P2PKH and P2SH addresses on mainnet', () => {
    expect(validateCoreAddress(makeAddress(MAINNET.addressPrefix), MAINNET).valid).toBe(true);
    expect(validateCoreAddress(makeAddress(MAINNET.p2shPrefix), MAINNET).valid).toBe(true);
  });

  it('rejects a mainnet address on testnet with a wrong-network error', () => {
    const result = validateCoreAddress(makeAddress(MAINNET.addressPrefix), TESTNET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('wrong network');
  });

  it('rejects a bech32m platform address with a targeted error', () => {
    const result = validateCoreAddress(
      'tdash1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      TESTNET
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Platform address');
  });

  it('rejects garbage and bad checksums', () => {
    expect(validateCoreAddress('not-an-address', TESTNET).valid).toBe(false);
    expect(validateCoreAddress('yYyYyYyYyYyYyYyYyYyYyYyYyYyYyYyYyY', TESTNET).valid).toBe(false);
    expect(validateCoreAddress('', TESTNET).valid).toBe(false);
  });

  it('rejects payloads that are not 21 bytes', () => {
    const short = base58CheckEncode(new Uint8Array([TESTNET.addressPrefix, 1, 2, 3]));
    const result = validateCoreAddress(short, TESTNET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('length');
  });

  it('trims surrounding whitespace', () => {
    const addr = makeAddress(TESTNET.addressPrefix);
    expect(validateCoreAddress(`  ${addr}  `, TESTNET).valid).toBe(true);
  });
});
