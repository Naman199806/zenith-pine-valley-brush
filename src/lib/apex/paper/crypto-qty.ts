export function floorExitQty(owned: number, increment: number): number {
  if (!(owned > 0) || !(increment > 0)) return 0;
  const steps = Math.floor(owned / increment);
  return steps * increment;
}
