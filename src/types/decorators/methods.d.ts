import 'reflect-metadata';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface MethodMetadata {
  method: HttpMethod;
  path: string;
}

/**
 * Type générique pour un décorateur de méthode REST
 */
export type RestMethodDecorator = (path: string) => MethodDecorator;

/**
 * Décorateurs REST disponibles
 */
export declare const Get: RestMethodDecorator;
export declare const Post: RestMethodDecorator;
export declare const Put: RestMethodDecorator;
export declare const Delete: RestMethodDecorator;
