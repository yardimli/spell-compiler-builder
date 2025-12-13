export class BuilderUI {
	constructor (sceneManager) {
		this.sceneManager = sceneManager;
		this.currentMapName = 'new_map';
	}
	
	setup (assets) {
		this.buildSidebar(assets);
		this.setupControls();
	}
	
	buildSidebar (assets) {
		const grid = document.getElementById('asset-grid');
		grid.innerHTML = '';
		
		assets.forEach(asset => {
			const div = document.createElement('div');
			div.className = 'asset-item';
			// Removed draggable=true
			
			const img = document.createElement('img');
			img.className = 'asset-thumb';
			img.src = asset.src;
			
			const span = document.createElement('span');
			span.className = 'asset-name';
			span.innerText = asset.file;
			
			div.appendChild(img);
			div.appendChild(span);
			
			// Click to Add
			div.addEventListener('click', () => {
				this.sceneManager.addAssetAtCursor(asset.file);
			});
			
			grid.appendChild(div);
		});
	}
	
	setupControls () {
		// Grid Size
		const slider = document.getElementById('gridSizeInput');
		const label = document.getElementById('gridSizeLabel');
		slider.oninput = (e) => {
			const size = parseInt(e.target.value);
			label.innerText = size + ' units';
			this.sceneManager.updateGridSize(size);
		};
		
		// Map Name
		const mapNameInput = document.getElementById('mapName');
		mapNameInput.oninput = (e) => {
			this.currentMapName = e.target.value;
		};
		
		// Save
		document.getElementById('btnSave').onclick = () => {
			const data = this.sceneManager.getMapData(this.currentMapName);
			this.downloadJSON(data, this.currentMapName);
		};
		
		// Save As
		document.getElementById('btnSaveAs').onclick = () => {
			const newName = prompt('Enter new map name:', this.currentMapName);
			if (newName) {
				this.currentMapName = newName;
				mapNameInput.value = newName;
				const data = this.sceneManager.getMapData(newName);
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
					this.sceneManager.loadMapData(data);
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
			this.sceneManager.addLightAtCursor();
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
