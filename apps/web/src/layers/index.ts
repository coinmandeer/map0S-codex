// Importing the registry through this barrel is what guarantees the built-in layers are in it.
// Consumers ask for `../layers`, never `../layers/registry`, so there is no way to read an
// empty registry by importing the wrong file. (`builtins` imports `./registry` directly, so
// this does not form a cycle.)
import "./builtins";

export * from "./registry";
