import * as path from "path";
import * as Webpack from 'webpack';
import merge from 'webpack-merge';
import common from './webpack.common';

export default merge(common, {
    mode: 'development',

    devtool: 'eval-cheap-module-source-map' as any,

    devServer: {
        contentBase: common.output!.path!,
        host: process.env.APP_HOST,
        public: process.env.APP_PUBLIC_URL,
        historyApiFallback: true
    },

    module: {
        rules: [
            {
                test: /\.js$/,
                enforce: 'pre',
                loader: 'source-map-loader',
                exclude: [
                    path.join(__dirname, '..', 'node_modules', 'monaco-editor'),
                    path.join(__dirname, '..', 'node_modules', 'subscriptions-transport-ws'),
                    path.join(__dirname, '..', '..', 'mockttp', 'node_modules', 'subscriptions-transport-ws'),
                    path.join(__dirname, '..', 'node_modules', 'js-beautify')
                ]
            }
        ]
    }
    ,
    plugins: [
        new Webpack.EnvironmentPlugin({
            "APP_HOST":"0.0.0.0",
            "APP_PUBLIC_URL":"local.httptoolkit.tech:8080",
            "APP_STANDALONE_URL":"0.0.0.0:45456",
            "APP_SERVER_URL":"0.0.0.0:45457",
            "APP_SERVER_PORT":"45457",
            "APP_SERVER_LOCALHOST":"localhost:45457"
        })
    ]
});
