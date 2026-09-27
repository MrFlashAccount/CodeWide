type ServiceTier = { readonly id: string; readonly name: string };

/** Explicit standard routing request, even when a model defaults to Fast. */
export const STANDARD_SERVICE_TIER = "default";

/** The catalog owns the wire id; Fast currently advertises id `priority`. */
export function fastServiceTier<Tier extends ServiceTier>(
  tiers: readonly Tier[] | undefined,
): Tier | undefined {
  return tiers?.find((tier) => tier.name.toLowerCase() === "fast");
}

/** Config may say `fast` while the model catalog advertises `priority`. */
export function isFastServiceTier(
  selection: string | null | undefined,
  tier: ServiceTier,
): boolean {
  return selection === tier.id || selection === "fast";
}

/** App Server reports the legacy `priority` id for a requested Fast tier. */
export function serviceTiersMatch(
  expected: string | null | undefined,
  authoritative: string | null | undefined,
): boolean {
  const normalizedExpected = expected ?? null;
  const normalizedAuthoritative = authoritative ?? null;
  return (
    normalizedExpected === normalizedAuthoritative ||
    (normalizedExpected === "fast" && normalizedAuthoritative === "priority") ||
    (normalizedExpected === "priority" && normalizedAuthoritative === "fast")
  );
}

/** Keeps only a tier supported by the next model; standard routing is model independent. */
export function retainedServiceTier(
  selection: string | null | undefined,
  tiers: readonly ServiceTier[] | undefined,
): string | undefined {
  if (selection === STANDARD_SERVICE_TIER) {
    return STANDARD_SERVICE_TIER;
  }
  const id = selection === "fast" ? fastServiceTier(tiers)?.id : selection;
  if (id === null || id === undefined) {
    return undefined;
  }
  return tiers?.some((tier) => tier.id === id) === true ? id : undefined;
}
