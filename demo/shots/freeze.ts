/**
 * Freezes the clock at 09:41 today. Import this FIRST: imports are evaluated in order, and
 * anything that reads `Date.now()` while it loads (the UI's shared clock does) would otherwise
 * keep the real time.
 */

const RealDate = Date;

export const NOW = (() => {
  const d = new RealDate();
  d.setHours(9, 41, 0, 0);
  return d.getTime();
})();

(globalThis as any).Date = class extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [any]));
  }
  static now() {
    return NOW;
  }
};
