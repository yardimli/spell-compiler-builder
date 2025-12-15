const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const fs = require('fs'); // Required for file writing

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
	watchOptions: {
		ignored: /assets\/cache/,
	},
	module: {
		rules: [
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: 'babel-loader'
			},
			{
				test: /\.glb$/,
				type: 'asset/resource',
				generator: { filename: 'assets/nature/[name][ext]' }
			},
			{
				test: /\.png$/,
				type: 'asset/resource',
				generator: { filename: 'assets/cache/[name][ext]' }
			}
		]
	},
	plugins: [
		new HtmlWebpackPlugin({
			template: './public/builder.html',
			filename: 'builder.html',
			inject: 'body'
		}),
		new CopyWebpackPlugin({
			patterns: [
				{ from: 'assets', to: 'assets' },
				{ from: 'public/builder.css', to: 'builder.css' }
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
		open: ['/builder.html'],
		
		watchFiles: {
			paths: ['src/**/*', 'public/**/*'],
			options: {
				ignored: ['**/assets/cache/**'],
			},
		},
		
		
		setupMiddlewares: (middlewares, devServer) => {
			if (!devServer) {
				throw new Error('webpack-dev-server is not defined');
			}
			
			// 1. Enable JSON body parsing (Limit increased for images)
			const express = require('express');
			devServer.app.use(express.json({ limit: '50mb' }));
			
			// 2. Create the Save Endpoint
			devServer.app.post('/save-thumbnail', (req, res) => {
				const { filename, image } = req.body;
				
				if (!filename || !image) {
					return res.status(400).send("Missing filename or image data");
				}
				
				// Strip the Data URL prefix to get raw Base64
				const base64Data = image.replace(/^data:image\/png;base64,/, "");
				
				// Define path (Ensure ./assets/cache exists)
				const filePath = path.join(__dirname, 'assets/cache', filename);
				
				// Write file
				fs.writeFile(filePath, base64Data, 'base64', (err) => {
					if (err) {
						console.error("Error saving file:", err);
						return res.status(500).send("Error saving file");
					}
					console.log(`[Webpack Dev Server] Saved thumbnail: ${filename}`);
					res.sendStatus(200);
				});
			});
			
			return middlewares;
		}
	},
	mode: 'development'
};
