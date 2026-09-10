const path = require('path');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

module.exports = function(config) {
  console.log('webpack config resolve:', JSON.stringify(config.resolve, null, 2));
  
  if (!config.resolve) config.resolve = {};
  if (!config.resolve.alias) config.resolve.alias = {};
  config.resolve.alias['@noppt/core'] = path.resolve(__dirname, '../core/src/index.ts');
  config.resolve.alias['@noppt/ai'] = path.resolve(__dirname, '../ai/src/index.ts');

  if (config.module && config.module.rules) {
    const tsLoaderRule = config.module.rules.find(
      rule => rule && rule.loader && typeof rule.loader === 'string' && rule.loader.includes('ts-loader')
    );
    if (tsLoaderRule) {
      tsLoaderRule.options = {
        ...tsLoaderRule.options,
        transpileOnly: true,
      };
    }
  }

  if (config.plugins) {
    config.plugins = config.plugins.filter(
      plugin => !(plugin instanceof ForkTsCheckerWebpackPlugin)
    );
  }

  return config;
};
