import { PropertyPanel } from './property-panel';

export class BuilderUI {
	constructor (builderScene) {
		this.scene = builderScene;
		this.manager = builderScene.objectManager;
		this.currentMapName = 'new_map';
		
		// Ensure manager exists before creating panel
		if (this.manager) {
			this.propertyPanel = new PropertyPanel(this.manager);
		} else {
			console.error('BuilderUI: ObjectManager is null during initialization.');
		}
	}
	
	setup (assets) {
		this.buildSidebar(assets);
		this.setupControls();
		this.setupHistoryUI();
	}
	
	buildSidebar (assets) {
		const listContainer = document.getElementById('asset-list');
		listContainer.innerHTML = '';
		
		// 1. Group assets by category (prefix before first underscore)
		const categories = {};
		
		assets.forEach(asset => {
			// Extract category: "nature_rock.glb" -> "nature"
			const parts = asset.file.split('_');
			const category = parts.length > 1 ? parts[0] : 'misc';
			
			if (!categories[category]) {
				categories[category] = [];
			}
			categories[category].push(asset);
		});
		
		// 2. Create UI for each category
		Object.keys(categories).sort().forEach(categoryName => {
			// Create Header
			const header = document.createElement('div');
			header.className = 'category-header';
			header.innerText = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
			
			// Create Grid Container
			const grid = document.createElement('div');
			grid.className = 'category-grid';
			
			// Toggle functionality
			header.addEventListener('click', () => {
				header.classList.toggle('collapsed');
				grid.classList.toggle('hidden');
			});
			
			// Add Assets to Grid
			categories[categoryName].forEach(asset => {
				const div = document.createElement('div');
				div.className = 'asset-item';
				
				const img = document.createElement('img');
				img.className = 'asset-thumb';
				img.src = asset.src;
				
				// Clean label: remove extension and category prefix
				// "nature_rock_large.glb" -> "rock_large"
				let cleanName = asset.file.replace(/\.glb$/i, '');
				if (categoryName !== 'misc' && cleanName.startsWith(categoryName + '_')) {
					cleanName = cleanName.substring(categoryName.length + 1);
				}
				// Replace remaining underscores with spaces for better readability (optional, but good for UI)
				cleanName = cleanName.replace(/_/g, ' ');
				
				const span = document.createElement('span');
				span.className = 'asset-name';
				span.innerText = cleanName;
				
				div.appendChild(img);
				div.appendChild(span);
				
				div.addEventListener('click', () => {
					this.manager.addAsset(asset.file, this.scene.selectedCellPosition);
				});
				
				grid.appendChild(div);
			});
			
			listContainer.appendChild(header);
			listContainer.appendChild(grid);
		});
	}
	
	setupControls () {
		// Grid Size
		const slider = document.getElementById('gridSizeInput');
		const label = document.getElementById('gridSizeLabel');
		slider.oninput = (e) => {
			const size = parseFloat(e.target.value);
			label.innerText = size + ' units';
			this.scene.updateGridSize(size);
		};
		
		// Snapping Toggles
		const chkSnapGrid = document.getElementById('chkSnapGrid');
		const chkSnapObj = document.getElementById('chkSnapObj');
		
		chkSnapGrid.onchange = (e) => { this.manager.snapToGrid = e.target.checked; };
		chkSnapObj.onchange = (e) => { this.manager.snapToObjects = e.target.checked; };
		
		// Map Name
		const mapNameInput = document.getElementById('mapName');
		mapNameInput.oninput = (e) => {
			this.currentMapName = e.target.value;
		};
		
		// Save
		document.getElementById('btnSave').onclick = () => {
			const data = this.manager.getMapData(this.currentMapName);
			this.downloadJSON(data, this.currentMapName);
		};
		
		// Save As
		document.getElementById('btnSaveAs').onclick = () => {
			const newName = prompt('Enter new map name:', this.currentMapName);
			if (newName) {
				this.currentMapName = newName;
				mapNameInput.value = newName;
				const data = this.manager.getMapData(newName);
				this.downloadJSON(data, newName);
			}
		};
		
		// Load
		document.getElementById('btnLoad').onclick = () => document.getElementById('fileInput').click();
		document.getElementById('fileInput').onchange = (e) => {
			const file = e.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (evt) => {
				try {
					const data = JSON.parse(evt.target.result);
					this.currentMapName = data.name || 'loaded_map';
					mapNameInput.value = this.currentMapName;
					this.manager.loadMapData(data);
				} catch (err) {
					console.error(err);
					alert('Invalid map file');
				}
			};
			reader.readAsText(file);
			e.target.value = '';
		};
		
		// Add Light
		document.getElementById('btnAddLight').onclick = () => {
			this.manager.addLight(this.scene.selectedCellPosition);
		};
	}
	
	setupHistoryUI () {
		const btnUndo = document.getElementById('btnUndo');
		const btnRedo = document.getElementById('btnRedo');
		
		btnUndo.onclick = () => this.manager.undo();
		btnRedo.onclick = () => this.manager.redo();
		
		this.manager.onHistoryChange = () => {
			btnUndo.disabled = this.manager.historyIndex < 0;
			btnRedo.disabled = this.manager.historyIndex >= this.manager.history.length - 1;
		};
	}
	
	downloadJSON (data, filename) {
		const json = JSON.stringify(data, null, 2);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename + '.json';
		a.click();
		URL.revokeObjectURL(url);
	}
}
