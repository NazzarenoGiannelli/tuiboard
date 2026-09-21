/**
 * Keys that more than one handler cares about, recognised in one place so the
 * handlers can't disagree about what "+" is.
 *
 * A `+` arrives in several shapes: the main-row key (name "+", or "=" with
 * shift on US layouts), the keypad key (name "kpplus" under the kitty
 * keyboard protocol, a plain "+" sequence elsewhere).
 */

export interface KeyLike {
  name?: string;
  sequence?: string;
  shift?: boolean;
}

export function isPlusKey(key: KeyLike): boolean {
  return key.name === "+" || key.name === "kpplus" || key.sequence === "+" || (key.name === "=" && !!key.shift);
}

export function isMinusKey(key: KeyLike): boolean {
  return key.name === "-" || key.name === "kpminus" || key.sequence === "-";
}
