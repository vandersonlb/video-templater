// Project management functionality (now based on template discovery)

// Project storage key for CSV data
const PROJECT_DATA_STORAGE_KEY = 'video_project_data';

// Project manager class
class ProjectManager {
    constructor() {
        this.templates = [];
        this.projectData = this.loadProjectData();
        this.currentProjectId = null;
    }

    // Load project data from localStorage (CSV data only)
    loadProjectData() {
        return Storage.get(PROJECT_DATA_STORAGE_KEY, {});
    }

    // Save project data to localStorage
    saveProjectData() {
        return Storage.set(PROJECT_DATA_STORAGE_KEY, this.projectData);
    }

    // Get all projects (now from discovered templates)
    getAllProjects() {
        return this.templates.map(template => {
            const projectData = this.projectData[template.id] || {};
            return {
                id: template.id,
                name: template.name,
                templateId: template.id,
                templateName: template.name,
                dataColumns: template.dataFields,
                csvData: projectData.csvData || null,
                csvRowCount: projectData.csvRowCount || 0,
                csvColumns: projectData.csvColumns || [],
                composition: template.composition,
                outputExt: template.outputExt,
                aepFile: template.aepFile,
                jsonFile: template.jsonFile,
                lastUpdated: projectData.lastUpdated || null
            };
        });
    }

    // Get project by ID
    getProject(id) {
        const template = this.templates.find(t => t.id === id);
        if (!template) return null;
        
        const projectData = this.projectData[id] || {};
        return {
            id: template.id,
            name: template.name,
            templateId: template.id,
            templateName: template.name,
            dataColumns: template.dataFields,
            csvData: projectData.csvData || null,
            csvRowCount: projectData.csvRowCount || 0,
            csvColumns: projectData.csvColumns || [],
            composition: template.composition,
            outputExt: template.outputExt,
            aepFile: template.aepFile,
            jsonFile: template.jsonFile,
            lastUpdated: projectData.lastUpdated || null
        };
    }

    // Update project data (CSV data only)
    updateProjectData(id, updates) {
        if (!this.projectData[id]) {
            this.projectData[id] = {};
        }

        this.projectData[id] = {
            ...this.projectData[id],
            ...updates,
            lastUpdated: new Date().toISOString()
        };

        this.saveProjectData();
        
        // Emit event
        window.eventEmitter.emit('projectUpdated', this.getProject(id));
        
        return this.getProject(id);
    }

    // Clear project data (remove CSV data)
    clearProjectData(id) {
        if (this.projectData[id]) {
            delete this.projectData[id];
            this.saveProjectData();
            
            // Emit event
            window.eventEmitter.emit('projectUpdated', this.getProject(id));
        }
        
        return this.getProject(id);
    }

    // Load templates from server
    async loadTemplates() {
        try {
            this.templates = await apiRequest('/api/templates');
            return this.templates;
        } catch (error) {
            console.error('Failed to load templates:', error);
            showSnackbar('Failed to load templates');
            return [];
        }
    }

    // Get templates
    getTemplates() {
        return this.templates;
    }

    // Set selected template
    setSelectedTemplate(templateId) {
        this.selectedTemplate = this.templates.find(t => t.id === templateId);
        return this.selectedTemplate;
    }

    // Get selected template
    getSelectedTemplate() {
        return this.selectedTemplate;
    }

    // Upload CSV data for project
    async uploadCSVData(projectId, file) {
        try {
            const result = await uploadFile(file, '/api/upload-csv', { projectId });
            
            if (result.success) {
                // Update project data with CSV data
                this.updateProjectData(projectId, {
                    csvData: result.data,
                    csvRowCount: result.rowCount,
                    csvColumns: result.columns
                });
                
                return result;
            } else {
                throw new Error(result.error || 'Upload failed');
            }
        } catch (error) {
            console.error('CSV upload failed:', error);
            throw error;
        }
    }

    // Download CSV template for project (now uses dynamic generation)
    downloadCSVTemplate(projectId) {
        const project = this.getProject(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        if (!project.dataColumns || project.dataColumns.length === 0) {
            throw new Error('No data columns defined for this project');
        }

        const url = `/api/download-csv/${projectId}`;
        const filename = `${sanitizeFilename(project.name)}_data_model.csv`;
        
        downloadFile(url, filename);
    }

    // Generate videos for project
    async generateVideos(projectId) {
        const project = this.getProject(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        if (!project.csvData || project.csvData.length === 0) {
            throw new Error('No CSV data available for this project');
        }

        try {
            const result = await apiRequest('/api/generate-videos', {
                method: 'POST',
                body: JSON.stringify({
                    projectId: projectId,
                    templateId: project.templateId,
                    csvData: project.csvData
                })
            });

            if (result.success) {
                // Update project data with generation info
                this.updateProjectData(projectId, {
                    lastGeneration: {
                        timestamp: new Date().toISOString(),
                        jobCount: result.jobCount,
                        jobs: result.jobs
                    }
                });

                return result;
            } else {
                throw new Error(result.error || 'Video generation failed');
            }
        } catch (error) {
            console.error('Video generation failed:', error);
            throw error;
        }
    }

    // Validate project data
    validateProject(projectData) {
        const errors = [];

        // Validate name
        const nameError = validateProjectName(projectData.name);
        if (nameError) {
            errors.push(nameError);
        }

        // Check for duplicate names
        const existingProject = this.projects.find(p => 
            p.name.toLowerCase() === projectData.name.toLowerCase().trim()
        );
        if (existingProject) {
            errors.push('A project with this name already exists');
        }

        // Validate template selection
        if (!projectData.templateId) {
            errors.push('Please select a template');
        }

        // Validate data columns
        if (!projectData.dataColumns || projectData.dataColumns.length === 0) {
            errors.push('Please define at least one data column');
        } else {
            // Validate each column name
            const columnErrors = [];
            const duplicateColumns = [];
            const seenColumns = new Set();

            projectData.dataColumns.forEach((column, index) => {
                const columnError = validateColumnName(column);
                if (columnError) {
                    columnErrors.push(`Column ${index + 1}: ${columnError}`);
                }

                if (seenColumns.has(column.toLowerCase())) {
                    duplicateColumns.push(column);
                } else {
                    seenColumns.add(column.toLowerCase());
                }
            });

            errors.push(...columnErrors);

            if (duplicateColumns.length > 0) {
                errors.push(`Duplicate column names: ${duplicateColumns.join(', ')}`);
            }
        }

        return errors;
    }

    // Get project statistics
    getProjectStats() {
        const stats = {
            total: this.projects.length,
            withData: 0,
            withoutData: 0,
            totalVideosGenerated: 0
        };

        this.projects.forEach(project => {
            if (project.csvData && project.csvData.length > 0) {
                stats.withData++;
            } else {
                stats.withoutData++;
            }

            if (project.lastGeneration) {
                stats.totalVideosGenerated += project.lastGeneration.jobCount || 0;
            }
        });

        return stats;
    }

    // Search projects
    searchProjects(query) {
        if (!query || query.trim() === '') {
            return this.projects;
        }

        const searchTerm = query.toLowerCase().trim();
        return this.projects.filter(project => 
            project.name.toLowerCase().includes(searchTerm) ||
            project.templateName.toLowerCase().includes(searchTerm) ||
            project.dataColumns.some(col => col.toLowerCase().includes(searchTerm))
        );
    }

    // Export project data
    exportProject(projectId) {
        const project = this.getProject(projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        const exportData = {
            ...project,
            exportedAt: new Date().toISOString(),
            version: '1.0'
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        downloadFile(url, `${sanitizeFilename(project.name)}_export.json`);
        
        // Clean up
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Import project data
    async importProject(file) {
        try {
            const text = await file.text();
            const projectData = JSON.parse(text);

            // Validate imported data
            if (!projectData.name || !projectData.templateId || !projectData.dataColumns) {
                throw new Error('Invalid project file format');
            }

            // Generate new ID to avoid conflicts
            const importedProject = {
                ...projectData,
                id: generateUUID(),
                name: `${projectData.name} (Imported)`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Validate before creating
            const errors = this.validateProject(importedProject);
            if (errors.length > 0) {
                throw new Error(`Import validation failed: ${errors.join(', ')}`);
            }

            this.projects.push(importedProject);
            this.saveProjects();

            window.eventEmitter.emit('projectImported', importedProject);
            
            return importedProject;
        } catch (error) {
            console.error('Project import failed:', error);
            throw error;
        }
    }
}

// Global project manager instance
window.projectManager = new ProjectManager();

// Event listeners for project events
window.eventEmitter.on('projectCreated', (project) => {
    console.log('Project created:', project.name);
    showSnackbar(`Project "${project.name}" created successfully`);
});

window.eventEmitter.on('projectUpdated', (project) => {
    console.log('Project updated:', project.name);
});

window.eventEmitter.on('projectDeleted', (project) => {
    console.log('Project deleted:', project.name);
    showSnackbar(`Project "${project.name}" deleted`);
});

window.eventEmitter.on('projectImported', (project) => {
    console.log('Project imported:', project.name);
    showSnackbar(`Project "${project.name}" imported successfully`);
});
