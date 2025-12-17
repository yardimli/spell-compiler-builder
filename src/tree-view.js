export class TreeView {
	constructor (objectManager) {
		this.manager = objectManager;
		this.container = document.getElementById('tree-view');
		this.header = document.getElementById('tree-header');
		this.content = document.getElementById('tree-content');
		this.toggleIcon = document.getElementById('tree-toggle-icon');
		
		this.isExpanded = false;
		this.lastClickedIndex = -1; // For shift-click logic
		this.collapsedGroups = new Set(); // Track collapsed state of groups
		
		// Local Storage Key
		this.LS_TREE_STATE = 'builder_tree_state';
		
		this.loadState();
		this.setupUI();
		this.setupDragDropRoot(); // Setup drop on root area
		
		// Subscribe to manager events
		if (this.manager) {
			this.manager.onListChange = () => this.render();
			// Hook into selection change to highlight items
			const originalSelectionChange = this.manager.onSelectionChange;
			this.manager.onSelectionChange = (data) => {
				if (originalSelectionChange) originalSelectionChange(data);
				this.highlightSelection(data);
			};
		}
	}
	
	loadState () {
		const savedState = localStorage.getItem(this.LS_TREE_STATE);
		if (savedState) {
			try {
				const parsed = JSON.parse(savedState);
				if (parsed.collapsedGroups) {
					this.collapsedGroups = new Set(parsed.collapsedGroups);
				}
			} catch (e) {
				console.error('Failed to load tree state', e);
			}
		}
	}
	
	saveState () {
		const state = {
			collapsedGroups: Array.from(this.collapsedGroups)
		};
		localStorage.setItem(this.LS_TREE_STATE, JSON.stringify(state));
	}
	
	setupUI () {
		// Toggle Collapse/Expand
		this.header.onclick = () => {
			this.isExpanded = !this.isExpanded;
			if (this.isExpanded) {
				this.container.classList.add('collapsed');
				this.toggleIcon.style.transform = 'rotate(180deg)';
			} else {
				this.container.classList.remove('collapsed');
				this.toggleIcon.style.transform = 'rotate(0deg)';
			}
		};
	}
	
	setupDragDropRoot () {
		// Allow dropping items onto the main content area to ungroup them
		this.content.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			this.content.classList.add('drag-over');
		});
		
		this.content.addEventListener('dragleave', (e) => {
			this.content.classList.remove('drag-over');
		});
		
		this.content.addEventListener('drop', (e) => {
			e.preventDefault();
			this.content.classList.remove('drag-over');
			
			// FIXED: Removed strict check (e.target === this.content) to allow drops from groups to root
			const data = e.dataTransfer.getData('text/plain');
			if (data) {
				try {
					const payload = JSON.parse(data);
					if (payload && payload.id) {
						this.manager.groupManager.ungroupObject(payload.id);
					}
				} catch (err) {
					console.error('Drop error', err);
				}
			}
		});
	}
	
	render () {
		this.content.innerHTML = '';
		
		// 1. Render Groups
		this.manager.groups.forEach(group => {
			this.renderGroup(group);
		});
		
		// 2. Render Ungrouped Objects
		const groupedIds = this.manager.groups.flatMap(g => g.objectIds);
		// FIXED: Safety check for obj existence
		const ungroupedObjects = this.manager.placedObjects.filter(obj => obj && !groupedIds.includes(obj.id));
		
		// Sort alphabetically
		ungroupedObjects.sort((a, b) => a.name.localeCompare(b.name));
		
		ungroupedObjects.forEach(obj => {
			this.renderObjectItem(obj, this.content);
		});
		
		// Re-apply highlights based on current selection
		// FIXED: Robust check to prevent crash if selectedMeshes contains disposed items or placedObjects has issues
		const currentSelection = this.manager.selectedMeshes
			.map(m => {
				if (!m || !m.metadata) return null;
				return this.manager.placedObjects.find(o => o && o.id === m.metadata.id);
			})
			.filter(Boolean);
		
		this.highlightSelection(currentSelection);
	}
	
	renderGroup (group) {
		const groupContainer = document.createElement('div');
		groupContainer.className = 'tree-group';
		groupContainer.dataset.groupId = group.id;
		
		// Apply collapsed state
		if (this.collapsedGroups.has(group.id)) {
			groupContainer.classList.add('collapsed');
		}
		
		// Drag & Drop for Group (Target)
		groupContainer.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.stopPropagation(); // Prevent bubbling to root
			e.dataTransfer.dropEffect = 'move';
			groupContainer.classList.add('drag-over');
		});
		
		groupContainer.addEventListener('dragleave', (e) => {
			groupContainer.classList.remove('drag-over');
		});
		
		groupContainer.addEventListener('drop', (e) => {
			e.preventDefault();
			e.stopPropagation();
			groupContainer.classList.remove('drag-over');
			
			const data = e.dataTransfer.getData('text/plain');
			if (data) {
				try {
					const payload = JSON.parse(data);
					if (payload && payload.id) {
						// Move object to this group
						this.manager.groupManager.moveObjectToGroup(payload.id, group.id);
					}
				} catch (err) { console.error(err); }
			}
		});
		
		// Header
		const header = document.createElement('div');
		header.className = 'tree-group-header';
		
		const titleContainer = document.createElement('div');
		titleContainer.style.display = 'flex';
		titleContainer.style.alignItems = 'center';
		
		// Toggle Icon
		const toggleIcon = document.createElement('span');
		toggleIcon.className = 'group-toggle-icon';
		toggleIcon.innerText = '▼';
		toggleIcon.onclick = (e) => {
			e.stopPropagation();
			if (this.collapsedGroups.has(group.id)) {
				this.collapsedGroups.delete(group.id);
				groupContainer.classList.remove('collapsed');
			} else {
				this.collapsedGroups.add(group.id);
				groupContainer.classList.add('collapsed');
			}
			// Save state on toggle
			this.saveState();
		};
		
		// NEW: Group Visibility Icon
		const visIcon = document.createElement('span');
		visIcon.className = 'tree-vis-icon';
		
		// Determine state: if all hidden -> closed eye, else open eye
		const allHidden = group.objectIds.every(id => {
			const obj = this.manager.placedObjects.find(o => o && o.id === id);
			return obj && (obj.isVisible === false);
		});
		
		visIcon.innerText = allHidden ? '✕' : '👁';
		visIcon.title = 'Toggle Group Visibility';
		visIcon.onclick = (e) => {
			e.stopPropagation();
			this.manager.toggleGroupVisibility(group.id);
		};
		
		const titleSpan = document.createElement('span');
		titleSpan.innerText = group.name;
		
		// Rename Logic
		titleSpan.ondblclick = (e) => {
			e.stopPropagation();
			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'tree-rename-input';
			input.value = group.name;
			
			const saveName = () => {
				const newName = input.value.trim();
				if (newName) {
					this.manager.renameGroup(group.id, newName);
				} else {
					titleSpan.innerText = group.name; // Revert
				}
			};
			
			input.onblur = saveName;
			input.onkeydown = (ev) => { if (ev.key === 'Enter') saveName(); };
			
			titleContainer.replaceChild(input, titleSpan);
			input.focus();
		};
		
		titleContainer.appendChild(toggleIcon);
		titleContainer.appendChild(visIcon); // Added visibility icon
		titleContainer.appendChild(titleSpan);
		
		// Actions (Delete)
		const actions = document.createElement('div');
		actions.className = 'tree-group-actions';
		const btnDelete = document.createElement('button');
		btnDelete.className = 'btn-tree-action delete';
		btnDelete.innerHTML = '×';
		btnDelete.title = 'Ungroup (Delete Group)';
		btnDelete.onclick = (e) => {
			e.stopPropagation();
			if (confirm(`Ungroup "${group.name}"? Objects will not be deleted.`)) {
				this.manager.deleteGroup(group.id);
			}
		};
		actions.appendChild(btnDelete);
		
		header.appendChild(titleContainer);
		header.appendChild(actions);
		
		// Select all in group on click (supports multi-select)
		header.onclick = (e) => {
			if (e.shiftKey || e.ctrlKey || e.metaKey) {
				// Additive selection
				const currentIds = this.manager.selectedMeshes.map(m => m.metadata.id);
				const newIds = [...new Set([...currentIds, ...group.objectIds])];
				this.manager.selectObjectsByIds(newIds);
			} else {
				// Exclusive selection
				this.manager.selectObjectsByIds(group.objectIds);
			}
		};
		
		groupContainer.appendChild(header);
		
		// Items Container
		const itemsContainer = document.createElement('div');
		itemsContainer.className = 'tree-group-items';
		
		// Find objects belonging to this group
		// FIXED: Added null checks inside map and filter
		const groupObjects = group.objectIds
			.map(id => this.manager.placedObjects.find(o => o && o.id === id))
			.filter(Boolean);
		
		groupObjects.sort((a, b) => a.name.localeCompare(b.name));
		
		groupObjects.forEach(obj => {
			this.renderObjectItem(obj, itemsContainer);
		});
		
		groupContainer.appendChild(itemsContainer);
		this.content.appendChild(groupContainer);
	}
	
	renderObjectItem (obj, parentContainer) {
		const item = document.createElement('div');
		item.className = 'tree-item';
		
		// NEW: Hidden State
		if (obj.isVisible === false) {
			item.classList.add('hidden-item');
		}
		
		item.dataset.id = obj.id;
		item.draggable = true; // Enable drag
		
		// Drag Start
		item.addEventListener('dragstart', (e) => {
			e.dataTransfer.setData('text/plain', JSON.stringify({ id: obj.id }));
			e.dataTransfer.effectAllowed = 'move';
		});
		
		// NEW: Visibility Icon
		const visIcon = document.createElement('span');
		visIcon.className = 'tree-vis-icon';
		visIcon.innerText = (obj.isVisible === false) ? '✕' : '👁';
		visIcon.onclick = (e) => {
			e.stopPropagation();
			this.manager.toggleObjectVisibility(obj.id);
		};
		
		// Icon based on type
		const icon = document.createElement('span');
		icon.className = 'tree-icon';
		icon.innerText = obj.type === 'light' ? '💡' : '📦';
		
		const text = document.createElement('span');
		text.innerText = obj.name;
		
		item.appendChild(visIcon);
		item.appendChild(icon);
		item.appendChild(text);
		
		// Lock Icon
		if (obj.isLocked) {
			const lockIcon = document.createElement('span');
			lockIcon.className = 'tree-lock-icon';
			lockIcon.innerText = '🔒';
			item.appendChild(lockIcon);
		}
		
		// Click Selection Logic
		item.onclick = (e) => {
			e.stopPropagation();
			
			const allItems = Array.from(this.content.querySelectorAll('.tree-item'));
			const index = allItems.indexOf(item);
			
			if (e.shiftKey && this.lastClickedIndex !== -1) {
				// Range Selection
				const start = Math.min(this.lastClickedIndex, index);
				const end = Math.max(this.lastClickedIndex, index);
				const rangeItems = allItems.slice(start, end + 1);
				const ids = rangeItems.map(el => el.dataset.id);
				
				// Standard behavior is replace for Shift-Click range
				this.manager.selectObjectsByIds(ids);
			} else if (e.ctrlKey || e.metaKey) {
				// Toggle Selection
				this.manager.selectObject(this.manager.findMeshById(obj.id), true);
			} else {
				// Single Selection
				this.manager.selectObjectsByIds([obj.id]);
			}
			
			this.lastClickedIndex = index;
		};
		
		parentContainer.appendChild(item);
	}
	
	highlightSelection (selectedData) {
		// Clear all highlights
		const allItems = this.content.querySelectorAll('.tree-item');
		allItems.forEach(el => el.classList.remove('selected'));
		
		const allHeaders = this.content.querySelectorAll('.tree-group-header');
		allHeaders.forEach(el => el.classList.remove('selected'));
		
		if (!selectedData || selectedData.length === 0) return;
		
		const selectedIds = selectedData.map(d => d.id);
		
		// Highlight Items
		selectedIds.forEach(id => {
			const el = this.content.querySelector(`.tree-item[data-id="${id}"]`);
			if (el) el.classList.add('selected');
		});
		
		// Check Groups: If all items in a group are selected, highlight header
		this.manager.groups.forEach(group => {
			if (group.objectIds.length > 0) {
				const allSelected = group.objectIds.every(id => selectedIds.includes(id));
				if (allSelected) {
					const groupEl = this.content.querySelector(`.tree-group[data-group-id="${group.id}"] .tree-group-header`);
					if (groupEl) groupEl.classList.add('selected');
				}
			}
		});
	}
}
