// Main application logic

// Global variables
let createProjectDialog;
let uploadCSVDialog;
let generateVideosDialog;
let projectNameField;
let currentUploadProjectId = null;

// Initialize application
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Video Project Manager initializing...');
    
    // Initialize Material Design Components
    initializeMDCComponents();
    
    // Load templates
    await loadTemplates();
    
    // Load and display projects
    loadProjects();
    
    // Set up event listeners
    setupEventListeners();
    
    console.log('Application initialized successfully');
});

// Initialize Material Design Components
function initializeMDCComponents() {
    // Initialize dialogs
    createProjectDialog = new mdc.dialog.MDCDialog(document.getElementById('create-project-dialog'));
    uploadCSVDialog = new mdc.dialog.MDCDialog(document.getElementById('upload-csv-dialog'));
    generateVideosDialog = new mdc.dialog.MDCDialog(document.getElementById('generate-videos-dialog'));
    
    // Initialize text field
    projectNameField = new mdc.textField.MDCTextField(document.querySelector('.project-name-field'));
    
    // Initialize FAB
    const fab = new mdc.ripple.MDCRipple(document.getElementById('refresh-fab'));
    
    // Initialize top app bar
    const topAppBar = new mdc.topAppBar.MDCTopAppBar(document.querySelector('.mdc-top-app-bar'));
}

// Load templates from server
async function loadTemplates() {
    try {
        await window.projectManager.loadTemplates();
        console.log('Templates loaded:', window.projectManager.getTemplates().length);
    } catch (error) {
        console.error('Failed to load templates:', error);
        showSnackbar('Failed to load templates. Please refresh the page.');
    }
}

// Load and display projects
function loadProjects() {
    const projects = window.projectManager.getAllProjects();
    displayProjects(projects);
}

// Display projects in the grid
function displayProjects(projects) {
    const projectsGrid = document.getElementById('projects-grid');
    const emptyState = document.getElementById('empty-state');
    
    if (projects.length === 0) {
        projectsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    projectsGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    projectsGrid.innerHTML = projects.map(project => createProjectCard(project)).join('');
    
    // Initialize button ripples
    projectsGrid.querySelectorAll('.mdc-button').forEach(button => {
        new mdc.ripple.MDCRipple(button);
    });
}

// Create project card HTML
function createProjectCard(project) {
    const hasData = project.csvData && project.csvData.length > 0;
    const dataStatusClass = hasData ? 'has-data' : 'no-data';
    const dataStatusIcon = hasData ? 'check_circle' : 'warning';
    const dataStatusText = hasData ? `${project.csvRowCount} rows` : 'No data';
    const lastUpdatedText = project.lastUpdated ? `Last updated: ${formatDate(project.lastUpdated)}` : 'No data uploaded yet';
    
    return `
        <div class="project-card">
            <div class="project-card-content">
                <h3 class="project-card-title">${escapeHtml(project.name)}</h3>
                <p class="project-card-subtitle">Composition: ${escapeHtml(project.composition)}</p>
                <p class="project-card-info">
                    Fields: ${project.dataColumns.join(', ')}<br>
                    Files: ${escapeHtml(project.aepFile)} + ${escapeHtml(project.jsonFile)}<br>
                    ${lastUpdatedText}
                </p>
                <div class="data-status ${dataStatusClass}">
                    <i class="material-icons">${dataStatusIcon}</i>
                    <span>${dataStatusText}</span>
                </div>
            </div>
            <div class="project-card-actions">
                <button class="mdc-button mdc-button--outlined" onclick="downloadDataModel('${project.id}')">
                    <span class="mdc-button__ripple"></span>
                    <span class="mdc-button__label">Download Model</span>
                </button>
                <button class="mdc-button mdc-button--outlined" onclick="openUploadDialog('${project.id}')">
                    <span class="mdc-button__ripple"></span>
                    <span class="mdc-button__label">Upload Data</span>
                </button>
                <button class="mdc-button mdc-button--raised" onclick="generateVideos('${project.id}')" ${!hasData ? 'disabled' : ''}>
                    <span class="mdc-button__ripple"></span>
                    <span class="mdc-button__label">Generate Videos</span>
                </button>
                ${hasData ? `
                <button class="mdc-button mdc-button--outlined clear-data-btn" onclick="clearProjectData('${project.id}')">
                    <span class="mdc-button__ripple"></span>
                    <span class="mdc-button__label">Clear Data</span>
                </button>
                ` : ''}
            </div>
        </div>
    `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Set up event listeners
function setupEventListeners() {
    // File input change
    document.getElementById('csv-file-input').addEventListener('change', handleFileSelect);
    
    // Drag and drop for file upload
    const dropZone = document.querySelector('.file-drop-zone');
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleFileDrop);
    
    // Project events
    window.eventEmitter.on('projectCreated', () => {
        loadProjects();
        createProjectDialog.close();
    });
    
    window.eventEmitter.on('projectUpdated', () => {
        loadProjects();
    });
    
    window.eventEmitter.on('projectDeleted', () => {
        loadProjects();
    });
}

// Note: Project creation functionality removed - projects are now auto-discovered from template pairs

// Download data model
function downloadDataModel(projectId) {
    try {
        window.projectManager.downloadCSVTemplate(projectId);
        showSnackbar('Data model downloaded successfully');
    } catch (error) {
        console.error('Failed to download data model:', error);
        showSnackbar(error.message || 'Failed to download data model');
    }
}

// Open upload CSV dialog
function openUploadDialog(projectId) {
    currentUploadProjectId = projectId;
    
    // Reset file input
    const fileInput = document.getElementById('csv-file-input');
    fileInput.value = '';
    
    // Reset UI
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('upload-csv-btn').disabled = true;
    
    uploadCSVDialog.open();
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        displayFileInfo(file);
    }
}

// Handle drag over
function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
}

// Handle drag leave
function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

// Handle file drop
function handleFileDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
            document.getElementById('csv-file-input').files = files;
            displayFileInfo(file);
        } else {
            showSnackbar('Please select a CSV file');
        }
    }
}

// Display file information
function displayFileInfo(file) {
    const fileInfo = document.getElementById('file-info');
    const fileName = document.querySelector('.file-info-name');
    const fileDetails = document.querySelector('.file-info-details');
    
    if (!fileName) {
        fileInfo.innerHTML = `
            <div class="file-info-name">${escapeHtml(file.name)}</div>
            <div class="file-info-details">Size: ${formatFileSize(file.size)} | Type: ${file.type}</div>
        `;
    } else {
        fileName.textContent = file.name;
        fileDetails.textContent = `Size: ${formatFileSize(file.size)} | Type: ${file.type}`;
    }
    
    fileInfo.style.display = 'block';
    document.getElementById('upload-csv-btn').disabled = false;
}

// Upload CSV
async function uploadCSV() {
    const fileInput = document.getElementById('csv-file-input');
    const file = fileInput.files[0];
    
    if (!file) {
        showSnackbar('Please select a file');
        return;
    }
    
    if (!currentUploadProjectId) {
        showSnackbar('No project selected');
        return;
    }
    
    try {
        // Show loading state
        const uploadBtn = document.getElementById('upload-csv-btn');
        const originalText = uploadBtn.querySelector('.mdc-button__label').textContent;
        uploadBtn.querySelector('.mdc-button__label').textContent = 'Uploading...';
        uploadBtn.disabled = true;
        
        const result = await window.projectManager.uploadCSVData(currentUploadProjectId, file);
        
        showSnackbar(`CSV uploaded successfully. ${result.rowCount} rows processed.`);
        uploadCSVDialog.close();
        
    } catch (error) {
        console.error('Upload failed:', error);
        showSnackbar(error.message || 'Upload failed. Please try again.');
    } finally {
        // Reset button state
        const uploadBtn = document.getElementById('upload-csv-btn');
        uploadBtn.querySelector('.mdc-button__label').textContent = 'Upload';
        uploadBtn.disabled = false;
    }
}

// Generate videos
async function generateVideos(projectId) {
    try {
        const result = await window.projectManager.generateVideos(projectId);
        
        // Display generation results
        displayGenerationResults(result);
        generateVideosDialog.open();
        
    } catch (error) {
        console.error('Video generation failed:', error);
        showSnackbar(error.message || 'Video generation failed');
    }
}

// Display generation results with real-time updates
function displayGenerationResults(result) {
    const content = document.getElementById('generation-content');
    
    content.innerHTML = `
        <div class="generation-summary">
            <h3 class="mdc-typography--headline6">Video Rendering Started</h3>
            <p><strong>Total Videos:</strong> ${result.jobCount}</p>
            <p><strong>Status:</strong> Rendering in progress...</p>
            <div class="progress-summary">
                <span id="progress-completed">0</span> completed, 
                <span id="progress-rendering">${result.jobCount}</span> rendering, 
                <span id="progress-failed">0</span> failed
            </div>
        </div>
        
        <div class="generation-jobs">
            <h4 class="mdc-typography--subtitle1">Render Progress</h4>
            <div id="jobs-container">
                ${result.jobs.map(job => `
                    <div class="generation-job" id="job-${job.id}">
                        <div class="job-info">
                            <div class="job-id">Row ${job.rowIndex}</div>
                            <div class="job-data">${Object.entries(job.rowData).map(([key, value]) => `${key}: ${value}`).join(', ')}</div>
                        </div>
                        <div class="job-status rendering">
                            <span class="status-text">Rendering...</span>
                            <div class="loading-spinner"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        <div class="render-actions" style="margin-top: 16px;">
            <button class="mdc-button mdc-button--outlined" onclick="refreshRenderStatus('${result.jobs[0].id.split('_')[0]}')">
                <span class="mdc-button__label">Refresh Status</span>
            </button>
            <button class="mdc-button mdc-button--raised" onclick="downloadAllVideos('${result.jobs[0].id.split('_')[0]}')" disabled id="download-all-btn">
                <span class="mdc-button__label">Download All Videos</span>
            </button>
        </div>
    `;
    
    // Start polling for status updates
    const projectId = result.jobs[0].id.split('_')[0];
    startStatusPolling(projectId);
}

// Start polling for render status updates
function startStatusPolling(projectId) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/api/render-status/${projectId}`);
            const status = await response.json();
            
            if (status.success) {
                updateRenderStatus(status);
                
                // Stop polling if all jobs are completed or failed
                if (status.summary.rendering === 0) {
                    clearInterval(pollInterval);
                    
                    // Enable download all button if there are completed videos
                    if (status.summary.completed > 0) {
                        document.getElementById('download-all-btn').disabled = false;
                    }
                }
            }
        } catch (error) {
            console.error('Error polling render status:', error);
        }
    }, 3000); // Poll every 3 seconds
    
    // Store interval ID for cleanup
    window.currentPollInterval = pollInterval;
}

// Update render status in the UI
function updateRenderStatus(status) {
    // Update summary
    document.getElementById('progress-completed').textContent = status.summary.completed;
    document.getElementById('progress-rendering').textContent = status.summary.rendering;
    document.getElementById('progress-failed').textContent = status.summary.failed;
    
    // Update individual job statuses
    status.jobs.forEach(job => {
        const jobElement = document.getElementById(`job-${job.id}`);
        if (jobElement) {
            const statusElement = jobElement.querySelector('.job-status');
            
            if (job.status === 'completed') {
                statusElement.className = 'job-status completed';
                
                // Only show download button if file exists
                const downloadButton = job.downloadUrl ? `
                    <button class="mdc-button mdc-button--dense" onclick="downloadVideo('${job.id}', '${job.outputFilename}')">
                        <span class="mdc-button__label">Download</span>
                    </button>
                ` : `
                    <span class="file-not-found">File not found</span>
                `;
                
                statusElement.innerHTML = `
                    <span class="status-text">Completed (100%)</span>
                    ${downloadButton}
                `;
            } else if (job.status === 'failed') {
                statusElement.className = 'job-status failed';
                statusElement.innerHTML = `
                    <span class="status-text">Failed</span>
                    <div class="error-details">
                        <span class="error-text">${job.error || 'Unknown error'}</span>
                        ${job.errorDetails ? `<details class="error-details-expand">
                            <summary>Show details</summary>
                            <pre class="error-stack">${escapeHtml(job.errorDetails)}</pre>
                        </details>` : ''}
                    </div>
                `;
            } else {
                // Rendering with progress
                const progress = job.progress || 0;
                statusElement.className = 'job-status rendering';
                statusElement.innerHTML = `
                    <div class="render-progress">
                        <span class="status-text">Rendering... ${progress}%</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                `;
            }
        }
    });
}

// Refresh render status manually
async function refreshRenderStatus(projectId) {
    try {
        const response = await fetch(`/api/render-status/${projectId}`);
        const status = await response.json();
        
        if (status.success) {
            updateRenderStatus(status);
            showSnackbar('Status refreshed');
        }
    } catch (error) {
        console.error('Error refreshing status:', error);
        showSnackbar('Failed to refresh status');
    }
}

// Download a single video
function downloadVideo(jobId, filename) {
    const link = document.createElement('a');
    link.href = `/api/download-video/${jobId}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showSnackbar(`Downloading ${filename}`);
}

// Download all completed videos for a project
async function downloadAllVideos(projectId) {
    try {
        const response = await fetch(`/api/project-videos/${projectId}`);
        const result = await response.json();
        
        if (result.success && result.videos.length > 0) {
            // Download each video with a small delay
            for (let i = 0; i < result.videos.length; i++) {
                const video = result.videos[i];
                setTimeout(() => {
                    downloadVideo(video.id, video.outputFilename);
                }, i * 500); // 500ms delay between downloads
            }
            
            showSnackbar(`Downloading ${result.videos.length} videos`);
        } else {
            showSnackbar('No completed videos found');
        }
    } catch (error) {
        console.error('Error downloading all videos:', error);
        showSnackbar('Failed to download videos');
    }
}

// Clear project data
async function clearProjectData(projectId) {
    if (!confirm('Are you sure you want to clear all data for this project? This will remove uploaded CSV data and any render jobs.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/project-data/${projectId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Clear data from project manager
            window.projectManager.clearProjectData(projectId);
            
            showSnackbar(`Project data cleared successfully`);
        } else {
            throw new Error(result.error || 'Failed to clear project data');
        }
    } catch (error) {
        console.error('Error clearing project data:', error);
        showSnackbar(error.message || 'Failed to clear project data');
    }
}

// Refresh projects
function refreshProjects() {
    loadProjects();
    showSnackbar('Projects refreshed');
}

// Global functions for HTML onclick handlers
window.downloadDataModel = downloadDataModel;
window.openUploadDialog = openUploadDialog;
window.uploadCSV = uploadCSV;
window.generateVideos = generateVideos;
window.clearProjectData = clearProjectData;
window.refreshProjects = refreshProjects;
