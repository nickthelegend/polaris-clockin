// Polyfills first: web3.js v1 and Anchor need Buffer and crypto.getRandomValues on Hermes.
import "react-native-get-random-values";
import { Buffer } from "buffer";

// Hermes ignores Symbol.species on typed arrays, so Buffer#subarray returns a
// plain Uint8Array without readUIntLE & co., and Anchor's account decoder
// (buffer-layout) throws "undefined is not a function" on u8/u16 fields.
// Keep subarray's result a Buffer.
const subarray = Uint8Array.prototype.subarray;
Buffer.prototype.subarray = function (start, end) {
  const out = subarray.call(this, start, end);
  Object.setPrototypeOf(out, Buffer.prototype);
  return out;
};
global.Buffer = Buffer;

import "expo-router/entry";
