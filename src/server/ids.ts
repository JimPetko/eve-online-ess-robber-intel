// Local until the domain PR lands its branded ids; a later PR swaps these for src/domain.
export type RegionId = number & { readonly __brand: "RegionId" };
export type ConstellationId = number & { readonly __brand: "ConstellationId" };
export type SystemId = number & { readonly __brand: "SystemId" };
export type AllianceId = number & { readonly __brand: "AllianceId" };
export type FactionId = number & { readonly __brand: "FactionId" };
