import {
  DEFAULT_IV_SPIKE_PCT,
  DEFAULT_PRICE_SPIKE_PCT,
  isIvSpike,
  isLtpSpike,
} from './optionChainSpike';

describe('optionChainSpike', () => {
  describe('isLtpSpike', () => {
    it('highlights when day change exceeds threshold in either direction', () => {
      expect(isLtpSpike(125, 120)).toBe(true);
      expect(isLtpSpike(-125, 120)).toBe(true);
      expect(isLtpSpike(119, 120)).toBe(false);
      expect(isLtpSpike(-119, 120)).toBe(false);
    });

    it('returns false for null or invalid values', () => {
      expect(isLtpSpike(null, DEFAULT_PRICE_SPIKE_PCT)).toBe(false);
      expect(isLtpSpike(undefined, 0)).toBe(false);
    });
  });

  describe('isIvSpike', () => {
    it('uses iv_chg_pct when available', () => {
      expect(isIvSpike(12, 1.2, 10)).toBe(true);
      expect(isIvSpike(-12, -1.2, 10)).toBe(true);
      expect(isIvSpike(9, 0.9, 10)).toBe(false);
    });

    it('falls back to absolute iv_chg when pct missing', () => {
      expect(isIvSpike(null, 11, 10)).toBe(true);
      expect(isIvSpike(null, -11, 10)).toBe(true);
      expect(isIvSpike(null, 8, 10)).toBe(false);
    });

    it('returns false below default threshold', () => {
      expect(isIvSpike(9, null, DEFAULT_IV_SPIKE_PCT)).toBe(false);
    });
  });
});
