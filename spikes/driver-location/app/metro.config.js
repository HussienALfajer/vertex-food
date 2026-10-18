// The queue, time base and wire format are shared with the Node scenarios (../core).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../core')];
module.exports = config;
