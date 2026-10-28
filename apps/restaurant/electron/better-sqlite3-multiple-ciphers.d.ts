// The part of `better-sqlite3-multiple-ciphers` the main process uses. The package ships its types,
// but its `exports` map does not name them, so NodeNext resolution cannot find them.
declare module 'better-sqlite3-multiple-ciphers' {
  namespace Database {
    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
    }
  }

  class Database {
    constructor(filename: string, options?: Database.Options);
    pragma(source: string): unknown;
    prepare(source: string): { all(...parameters: unknown[]): unknown[] };
    close(): this;
  }

  export = Database;
}
