// Polyfills first: web3.js v1 and Anchor need Buffer and crypto.getRandomValues on Hermes.
import "react-native-get-random-values";
import { Buffer } from "buffer";
global.Buffer = global.Buffer || Buffer;
import "expo-router/entry";
