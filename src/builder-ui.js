import { PropertyPanel } from './property-panel';
import { TreeView } from './tree-view'; // Import TreeView
import { loadAssets, getAvailableFolders } from './loader';

export class BuilderUI {
	constructor (builderScene) {
		this.scene = builderScene;
		this.manager = builderScene.objectManager;
		this.currentMapName = 'new_map';
		
		// LocalStorage Keys
		this.LS_SETTINGS_KEY = 'builder_global_settings';
		this.LS_SIDEBAR_KEY = 'builder_sidebar_state';
		this.LS_LAST_FOLDER_KEY = 'builder_last_folder';
		// Controls key removed as controls are now in top bar
		
		// Default Global Settings
		this.globalSettings = {
			yOffset: 0,
			gridSize: 2.5,
			gridColor: '#555555',
			bgColor: '#2c3e50',
			autoSave: true // Default enabled
		};
		
		// Auto Save State
		this.lastSaveTime = null;
		this.autoSaveInterval = null;
		this.uiUpdateInterval = null;
		
		// Ensure manager exists before creating panel
		if (this.manager) {
			this.propertyPanel = new PropertyPanel(this.manager);
			this.treeView = new TreeView(this.manager); // Initialize TreeView
		} else {
			console.error('BuilderUI: ObjectManager is null during initialization.');
		}
	}
	
	setup (assets) {
		this.loadSettings(); // Load from LocalStorage
		this.applySettings(); // Apply to Scene/Manager
		
		// Load auto-saved map if enabled and exists
		if (this.globalSettings.autoSave) {
			this.manager.loadFromAutoSave();
		}
		
		// Setup Sidebar Dropdown and Load Button
		this.setupAssetBrowser();
		
		this.setupControls();
		this.setupLeftSidebarToggle();
		this.setupHistoryUI();
		this.setupSettingsModal();
		this.setupSaveModal();
		this.setupContextMenu();
		this.setupAutoSaveTimer(); // Initialize timer
	}
	
	setupAssetBrowser () {
		const folderSelect = document.getElementById('asset-folder-select');
		const btnLoad = document.getElementById('btnLoadAssets');
		const loadArea = document.getElementById('asset-load-area');
		const listContainer = document.getElementById('asset-list');
		const overlay = document.getElementById('loading-overlay');
		
		// 1. Populate Dropdown
		const folders = getAvailableFolders();
		if (folders.length === 0) {
			const opt = document.createElement('option');
			opt.text = "No folders found";
			folderSelect.add(opt);
			folderSelect.disabled = true;
		} else {
			folders.forEach(folder => {
				const opt = document.createElement('option');
				opt.value = folder;
				opt.text = folder.charAt(0).toUpperCase() + folder.slice(1);
				folderSelect.add(opt);
			});
			
			// Restore last selected folder
			const lastFolder = localStorage.getItem(this.LS_LAST_FOLDER_KEY);
			if (lastFolder && folders.includes(lastFolder)) {
				folderSelect.value = lastFolder;
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${lastFolder}`;
			}
		}
		
		// 2. Handle Dropdown Change
		folderSelect.onchange = () => {
			const selectedFolder = folderSelect.value;
			if (selectedFolder) {
				localStorage.setItem(this.LS_LAST_FOLDER_KEY, selectedFolder);
				
				// Reset View
				// Remove existing asset items but keep the load area
				const items = listContainer.querySelectorAll('.category-header, .category-grid');
				items.forEach(el => el.remove());
				
				loadArea.style.display = 'flex';
				btnLoad.disabled = false;
				btnLoad.innerText = `Load ${selectedFolder}`;
			}
		};
		
		// 3. Handle Load Button Click
		btnLoad.onclick = async () => {
			const selectedFolder = folderSelect.value;
			if (!selectedFolder) return;
			
			// Lock UI and Camera
			overlay.style.display = 'flex';
			this.scene.setCameraLocked(true);
			
			// Prepare Scene (Hide grid, hide existing objects)
			this.scene.prepareForThumbnailGeneration();
			
			try {
				// Load Assets for specific folder
				const assets = await loadAssets(this.scene.scene, this.scene.camera, selectedFolder);
				
				// Restore Scene
				this.scene.restoreAfterThumbnailGeneration();
				
				// Update UI
				loadArea.style.display = 'none';
				this.buildSidebar(assets, selectedFolder);
			} catch (e) {
				console.error('Failed to load assets:', e);
				alert('Error loading assets. Check console.');
				this.scene.restoreAfterThumbnailGeneration();
			} finally {
				// Unlock
				this.scene.setCameraLocked(false);
				overlay.style.display = 'none';
			}
		};
	}
	
	// --- Auto Save Logic ---
	setupAutoSaveTimer () {
		const btnSaveNow = document.getElementById('btnSaveNow');
		
		// Define the save action
		const performSave = () => {
			if (this.globalSettings.autoSave) {
				const success = this.manager.saveToAutoSave();
				if (success) {
					this.lastSaveTime = Date.now();
					this.updateAutoSaveUI();
				}
			}
		};
		
		// 1. Timer: Run every 15 seconds
		this.autoSaveInterval = setInterval(performSave, 15000);
		
		// 2. UI Updater: Run every 1 second to update relative time text
		this.uiUpdateInterval = setInterval(() => {
			this.updateAutoSaveUI();
		}, 1000);
		
		// 3. Manual Trigger
		if (btnSaveNow) {
			btnSaveNow.onclick = (e) => {
				e.preventDefault();
				performSave();
				// Reset the interval so we don't double save immediately
				clearInterval(this.autoSaveInterval);
				this.autoSaveInterval = setInterval(performSave, 15000);
			};
		}
	}
	
	updateAutoSaveUI () {
		const saveText = document.getElementById('auto-save-text');
		if (!saveText) return;
		
		if (!this.globalSettings.autoSave) {
			saveText.innerText = 'Auto-save disabled';
			return;
		}
		
		if (!this.lastSaveTime) {
			saveText.innerText = 'Not saved yet.';
		} else {
			const diff = Math.floor((Date.now() - this.lastSaveTime) / 1000);
			if (diff < 60) {
				saveText.innerText = `Saved ${diff} seconds ago`;
			} else {
				const mins = Math.floor(diff / 60);
				saveText.innerText = `Saved ${mins} min ago`;
			}
		}
	}
	
	// --- LocalStorage Logic ---
	loadSettings () {
		const saved = localStorage.getItem(this.LS_SETTINGS_KEY);
		if (saved) {
			try {
				const parsed = JSON.parse(saved);
				this.globalSettings = { ...this.globalSettings, ...parsed };
			} catch (e) {
				console.error('Failed to load settings', e);
			}
		}
	}
	
	saveSettings () {
		localStorage.setItem(this.LS_SETTINGS_KEY, JSON.stringify(this.globalSettings));
	}
	
	applySettings () {
		// Apply to ObjectManager
		this.manager.defaultYOffset = parseFloat(this.globalSettings.yOffset);
		this.manager.gridSize = parseFloat(this.globalSettings.gridSize);
		this.manager.autoSaveEnabled = this.globalSettings.autoSave;
		
		// Apply to Scene
		this.scene.setGridColors(this.globalSettings.gridColor, this.globalSettings.bgColor);
		this.scene.updateGridSize(this.manager.gridSize);
		
		// Update UI text immediately
		this.updateAutoSaveUI();
	}
	
	// --- Sidebar Logic ---
	buildSidebar (assets, categoryName) {
		const listContainer = document.getElementById('asset-list');
		// Note: We don't clear listContainer completely because we want to keep the load area hidden but present
		// Remove previously added headers/grids
		const existingItems = listContainer.querySelectorAll('.category-header, .category-grid');
		existingItems.forEach(el => el.remove());
		
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
		assets.forEach(asset => {
			const div = document.createElement('div');
			div.className = 'asset-item';
			div.dataset.file = asset.file; // Store filename (includes folder) for context menu
			
			const img = document.createElement('img');
			img.className = 'asset-thumb';
			img.src = asset.src;
			
			// Clean label: remove extension and folder prefix
			// asset.file is "folder/filename.glb"
			let cleanName = asset.file.split('/').pop().replace(/\.glb$/i, '');
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
	}
	
	setupLeftSidebarToggle () {
		const sidebar = document.getElementById('left-sidebar');
		const header = document.getElementById('left-sidebar-header');
		
		if (header && sidebar) {
			header.onclick = () => {
				sidebar.classList.toggle('collapsed');
			};
		}
	}
	
	setupControls () {
		// Reset Camera
		document.getElementById('btnResetCam').onclick = () => {
			this.scene.resetCamera();
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
		
		// Clear Scene
		document.getElementById('btnClearScene').onclick = () => {
			if (confirm('Are you sure you want to clear the entire scene? This cannot be undone.')) {
				this.manager.clearScene();
				this.currentMapName = 'new_map';
			}
		};
	}
	
	setupSaveModal () {
		const modal = document.getElementById('saveMapModal');
		const btnSave = document.getElementById('btnSave');
		const btnSaveAs = document.getElementById('btnSaveAs');
		const btnConfirm = document.getElementById('btnConfirmSave');
		const btnCancel = document.getElementById('btnCancelSave');
		const inputName = document.getElementById('saveMapName');
		
		const openModal = () => {
			inputName.value = this.currentMapName;
			modal.style.display = 'flex';
			inputName.focus();
		};
		
		const closeModal = () => {
			modal.style.display = 'none';
		};
		
		// Save Button Logic
		btnSave.onclick = () => {
			if (this.currentMapName === 'new_map') {
				openModal();
			} else {
				// Direct save if name is already set
				const data = this.manager.getMapData(this.currentMapName);
				this.downloadJSON(data, this.currentMapName);
			}
		};
		
		// Save As Button Logic (Always open modal)
		btnSaveAs.onclick = () => {
			openModal();
		};
		
		btnCancel.onclick = closeModal;
		
		btnConfirm.onclick = () => {
			const name = inputName.value.trim();
			if (name) {
				this.currentMapName = name;
				const data = this.manager.getMapData(this.currentMapName);
				this.downloadJSON(data, this.currentMapName);
				closeModal();
			} else {
				alert('Please enter a map name.');
			}
		};
		
		// Close on outside click
		window.onclick = (event) => {
			if (event.target === modal) closeModal();
		};
	}
	
	setupSettingsModal () {
		const modal = document.getElementById('settingsModal');
		const btnOpen = document.getElementById('btnSettings');
		const btnCancel = document.getElementById('btnCancelSettings');
		const btnSave = document.getElementById('btnSaveSettings');
		
		// Inputs
		const inYOffset = document.getElementById('settingYOffset');
		const inGridSize = document.getElementById('settingGridSize');
		const inGridColor = document.getElementById('settingGridColor');
		const inBgColor = document.getElementById('settingBgColor');
		const inAutoSave = document.getElementById('settingAutoSave');
		
		btnOpen.onclick = () => {
			// Populate fields with current settings
			inYOffset.value = this.globalSettings.yOffset;
			inGridSize.value = this.globalSettings.gridSize;
			inGridColor.value = this.globalSettings.gridColor;
			inBgColor.value = this.globalSettings.bgColor;
			inAutoSave.checked = this.globalSettings.autoSave;
			
			modal.style.display = 'flex';
		};
		
		const close = () => { modal.style.display = 'none'; };
		
		btnCancel.onclick = close;
		
		btnSave.onclick = () => {
			// Update Settings Object
			this.globalSettings.yOffset = parseFloat(inYOffset.value);
			this.globalSettings.gridSize = parseFloat(inGridSize.value);
			this.globalSettings.gridColor = inGridColor.value;
			this.globalSettings.bgColor = inBgColor.value;
			this.globalSettings.autoSave = inAutoSave.checked;
			
			this.saveSettings();
			this.applySettings();
			close();
		};
		
		// Close on outside click
		window.onclick = (event) => {
			if (event.target === modal) close();
		};
	}
	
	setupContextMenu () {
		const menu = document.getElementById('context-menu');
		const gridItem = document.getElementById('ctx-add-grid');
		
		// Grid Modal Elements
		const gridModal = document.getElementById('gridModal');
		const btnCreateGrid = document.getElementById('btnCreateGrid');
		const btnCancelGrid = document.getElementById('btnCancelGrid');
		const inRows = document.getElementById('gridRows');
		const inCols = document.getElementById('gridCols');
		
		let targetFile = null;
		
		// Attach event listener to sidebar (delegate)
		const sidebar = document.getElementById('asset-list');
		sidebar.addEventListener('contextmenu', (e) => {
			const assetItem = e.target.closest('.asset-item');
			if (assetItem) {
				e.preventDefault();
				targetFile = assetItem.dataset.file;
				
				// Position menu
				menu.style.display = 'block';
				menu.style.left = e.pageX + 'px';
				menu.style.top = e.pageY + 'px';
			}
		});
		
		// Hide menu on click elsewhere
		window.addEventListener('click', (e) => {
			// Don't hide if clicking inside the modal
			if (e.target.closest('.modal-content')) return;
			menu.style.display = 'none';
		});
		
		// Menu Item Action: Open Modal
		gridItem.onclick = () => {
			if (targetFile) {
				menu.style.display = 'none';
				gridModal.style.display = 'flex';
				// Reset inputs to default
				inRows.value = 3;
				inCols.value = 3;
			}
		};
		
		// Modal Actions
		const closeGridModal = () => {
			gridModal.style.display = 'none';
		};
		
		btnCancelGrid.onclick = closeGridModal;
		
		btnCreateGrid.onclick = () => {
			const r = parseInt(inRows.value);
			const c = parseInt(inCols.value);
			
			if (!isNaN(r) && !isNaN(c) && r > 0 && c > 0 && targetFile) {
				this.manager.addAssetGrid(targetFile, this.scene.selectedCellPosition, r, c);
				closeGridModal();
			} else {
				alert('Please enter valid positive numbers for rows and columns.');
			}
		};
		
		// Close grid modal on outside click
		gridModal.onclick = (event) => {
			if (event.target === gridModal) closeGridModal();
		};
	}
	
	setupHistoryUI () {
		const btnUndo = document.getElementById('btnUndo');
		const btnRedo = document.getElementById('btnRedo');
		
		// Updated to use the new undoRedo manager property
		btnUndo.onclick = () => this.manager.undoRedo.undo();
		btnRedo.onclick = () => this.manager.undoRedo.redo();
		
		this.manager.undoRedo.onHistoryChange = () => {
			btnUndo.disabled = this.manager.undoRedo.historyIndex < 0;
			btnRedo.disabled = this.manager.undoRedo.historyIndex >= this.manager.undoRedo.history.length - 1;
		};
		
		// Keyboard Shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y)
		window.addEventListener('keydown', (e) => {
			// Ignore if user is typing in an input field
			if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
			
			if (e.ctrlKey) {
				if (e.key.toLowerCase() === 'z') {
					e.preventDefault();
					this.manager.undoRedo.undo();
				} else if (e.key.toLowerCase() === 'y') {
					e.preventDefault();
					this.manager.undoRedo.redo();
				}
			}
		});
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
