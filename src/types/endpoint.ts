/**
 * Signature d'un endpoint déclaré sans corps de méthode.
 *
 * @example
 * ```ts
 * @Get('/v1/users/:id')
 * getUser!: Endpoint<[id: string], User>;
 * ```
 */
export type Endpoint<TArgs extends any[] = [], TResult = any> = (
  ...args: [...TArgs, any?]
) => Promise<TResult>;

/**
 * Type d'un décorateur applicable aussi bien sur une méthode que sur une
 * déclaration de propriété (endpoint sans corps).
 */
export type EndpointDecorator = (
  target: any,
  propertyKey: string | symbol,
  descriptor?: any,
) => void;
