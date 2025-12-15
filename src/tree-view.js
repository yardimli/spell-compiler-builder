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
	
	setupUI () {
		// Toggle Collapse/Expand
		this.header.onclick = () => {
			this.isExpanded = !this.isExpanded;
			if (this.isExpanded) {
				this.container.classList.add('expanded');
				this.toggleIcon.style.transform = 'rotate(180deg)';
			} else {
				this.container.classList.remove('expanded');
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
			
			// FIX: Don't check e.target === this.content strictly.
			// Since groups stop propagation, if the event reaches here,
			// it means it was dropped "outside" any group (i.e., on the root list).
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
		// FIX: Safety check for obj existence
		const ungroupedObjects = this.manager.placedObjects.filter(obj => obj && !groupedIds.includes(obj.id));
		
		// Sort alphabetically
		ungroupedObjects.sort((a, b) => a.name.localeCompare(b.name));
		
		ungroupedObjects.forEach(obj => {
			this.renderObjectItem(obj, this.content);
		});
		
		// Re-apply highlights based on current selection
		// FIX: Robust check to prevent crash if selectedMeshes contains disposed items or placedObjects has issues
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
		item.dataset.id = obj.id;
		item.draggable = true; // Enable drag
		
		// Drag Start
		item.addEventListener('dragstart', (e) => {
			e.dataTransfer.setData('text/plain', JSON.stringify({ id: obj.id }));
			e.dataTransfer.effectAllowed = 'move';
		});
		
		// Icon based on type
		const icon = document.createElement('span');
		icon.className = 'tree-icon';
		icon.innerText = obj.type === 'light' ? '💡' : '📦';
		
		const text = document.createElement('span');
		text.innerText = obj.name + (obj.isLocked ? ' 🔒' : '');
		
		item.appendChild(icon);
		item.appendChild(text);
		
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
