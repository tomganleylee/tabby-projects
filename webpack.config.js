const path = require('path')

module.exports = {
    target: 'node',
    entry: './src/index.ts',
    context: __dirname,
    devtool: 'source-map',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js',
        pathinfo: true,
        libraryTarget: 'umd',
        publicPath: 'auto',
    },
    resolve: {
        modules: ['.', 'src', 'node_modules'],
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: 'ts-loader',
                    options: { configFile: path.resolve(__dirname, 'tsconfig.json') },
                },
            },
        ],
    },
    // Everything below is provided by the running Tabby instance.
    externals: [
        'fs',
        'os',
        'path',
        'child_process',
        'electron',
        'russh',
        /^rxjs/,
        /^@angular/,
        /^@ng-bootstrap/,
        /^tabby-/,
        /^zone\.js/,
    ],
}
