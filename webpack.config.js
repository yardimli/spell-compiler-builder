const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
	entry: './src/index.js',
	output: {
		path: path.resolve(__dirname, 'dist'),
		filename: 'bundle.js',
		clean: true
	},
	resolve: {
		extensions: ['.js']
	},
	module: {
		rules: [
			{
				test: /\.png$/,
				type: 'asset/resource',
				generator: {
					filename: 'assets/cache/[name][ext]'
				}
			},
			{
				test: /\.js$/,
				exclude: /node_modules/,
			},
			{
				test: /\.glb$/,
				type: 'asset/resource',
				generator: {
					// This ensures the file keeps its name in the output folder
					filename: 'assets/nature/[name][ext]'
				}
			}
		]
	},
	plugins: [
		new HtmlWebpackPlugin({
			template: './public/builder.html',
			filename: 'builder.html', // Output filename
			inject: 'body'
		}),
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'assets', to: 'assets' } // Copies your assets folder to dist
			]
		})
	],
	devServer: {
		static: {
			directory: path.join(__dirname, 'dist'),
		},
		compress: true,
		port: 8081,
		hot: true,
		open: ['/builder.html'], // Open builder.html by default
	},
	mode: 'development'
};
