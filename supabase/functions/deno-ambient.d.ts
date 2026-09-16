declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    toObject(): Record<string, string>;
  }
  export const env: Env;
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

declare module "npm:postgres@3.4.4" {
  // deno-lint-ignore no-explicit-any
  const postgres: any;
  export default postgres;
}

declare module "npm:exceljs@4.4.0" {
  // deno-lint-ignore no-explicit-any
  const exceljs: any;
  export default exceljs;
}

declare module "npm:@supabase/supabase-js@2" {
  // deno-lint-ignore no-explicit-any
  export const createClient: any;
}
