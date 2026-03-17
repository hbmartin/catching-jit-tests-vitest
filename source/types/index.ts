export type BrandedId<T extends string> = string & {
  readonly __brand: T;
};
