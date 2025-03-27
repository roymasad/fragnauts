const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = {
    entry: './src/index.ts',
    mode: 'development',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                test: /\.wasm$/,
                type: "asset/resource"
            }
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        fallback: {
            "fs": false,
            "path": false
        }
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        assetModuleFilename: '[name][ext]'
    },
    plugins: [
        new Dotenv(),
        new HtmlWebpackPlugin({
            template: 'src/index.html'
        }),
        new CopyWebpackPlugin({
            patterns: [
                // Copy the skybox assets to the dist folder
                { from: path.resolve(__dirname, 'assets/skybox'), to: 'assets/skybox' },
                { from: path.resolve(__dirname, 'assets/3d'), to: 'assets/3d' },
                { from: path.resolve(__dirname, 'assets/textures'), to: 'assets/textures' },
                {
                    from: path.resolve(__dirname, 'node_modules/@babylonjs/havok/lib/umd/HavokPhysics.wasm'),
                    to: '.'
                }
            ]
        })
    ],
    devServer: {
        static: [
            {
                directory: path.join(__dirname, 'assets'),
                publicPath: '/assets',
            },
            {
                directory: path.join(__dirname, 'dist'),
            }
        ],
        compress: true,
        port: 8080
    },
    experiments: {
        asyncWebAssembly: true
    }
};