/** Prevent the synthetic click after a long press from selecting the polygon underneath. */
const until = new WeakMap<object, number>();
export function suppressContextClick(map: object) {
  until.set(map, Date.now() + 900);
}
export function contextClickSuppressed(map: object) {
  return Date.now() < (until.get(map) ?? 0);
}
