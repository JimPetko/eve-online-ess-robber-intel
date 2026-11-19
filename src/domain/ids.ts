declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type SystemId = Brand<number, "SystemId">;
export type ConstellationId = Brand<number, "ConstellationId">;
export type RegionId = Brand<number, "RegionId">;
/** An amount of ISK, always rounded to whole ISK. */
export type Isk = Brand<number, "Isk">;

export const systemId = (id: number): SystemId => id as SystemId;
export const constellationId = (id: number): ConstellationId => id as ConstellationId;
export const regionId = (id: number): RegionId => id as RegionId;
export const isk = (amount: number): Isk => Math.round(amount) as Isk;
