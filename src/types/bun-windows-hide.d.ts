// Bun.spawn supports `windowsHide` at runtime (it forwards to libuv's
// CREATE_NO_WINDOW flag), but the Bun @types stub doesn't expose it. Without
// it, every child process from a daemonized Bun parent on Windows pops a
// conhost.exe window. Augment the type so call sites can pass the flag.
declare module "bun" {
  namespace Spawn {
    interface BaseOptions<In extends Writable, Out extends Readable, Err extends Readable> {
      windowsHide?: boolean;
    }
  }
}
export {};
