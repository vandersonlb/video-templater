// Utility functions for the Video Project Manager

// Generate UUID for projects
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Format date for display
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// Show snackbar notification
function showSnackbar(message, timeout = 4000) {
    const snackbar = document.getElementById('snackbar');
    const label = snackbar.querySelector('.mdc-snackbar__label');
    
    label.textContent = message;
    
    // Initialize MDC Snackbar if not already done
    if (!snackbar.mdcSnackbar) {
        snackbar.mdcSnackbar = new mdc.snackbar.MDCSnackbar(snackbar);
    }
    
    snackbar.mdcSnackbar.timeoutMs = timeout;
    snackbar.mdcSnackbar.open();
}

// Validate project name
function validateProjectName(name) {
    if (!name || name.trim().length === 0) {
        return 'Project name is required';
    }
    if (name.trim().length < 3) {
        return 'Project name must be at least 3 characters';
    }
    if (name.trim().length > 50) {
        return 'Project name must be less than 50 characters';
    }
    return null;
}

// Validate data column name
function validateColumnName(name) {
    if (!name || name.trim().length === 0) {
        return 'Column name is required';
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name.trim())) {
        return 'Column name must start with a letter and contain only letters, numbers, and underscores';
    }
    if (name.trim().length > 30) {
        return 'Column name must be less than 30 characters';
    }
    return null;
}

// Sanitize filename
function sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Debounce function for search/input
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Deep clone object
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// Check if object is empty
function isEmpty(obj) {
    return Object.keys(obj).length === 0;
}

// Capitalize first letter
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Truncate text
function truncate(str, length = 50) {
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
}

// API request helper
async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        } else {
            return await response.text();
        }
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// File upload helper
async function uploadFile(file, url, additionalData = {}) {
    const formData = new FormData();
    formData.append('csvFile', file);
    
    // Add additional data
    Object.keys(additionalData).forEach(key => {
        formData.append(key, additionalData[key]);
    });
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Upload failed: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('File upload failed:', error);
        throw error;
    }
}

// Download file helper
function downloadFile(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// CSV validation helper
function validateCSVData(csvData, expectedColumns) {
    if (!csvData || csvData.length === 0) {
        return { valid: false, error: 'CSV file is empty' };
    }
    
    const actualColumns = Object.keys(csvData[0]);
    const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
    const extraColumns = actualColumns.filter(col => !expectedColumns.includes(col));
    
    if (missingColumns.length > 0) {
        return { 
            valid: false, 
            error: `Missing required columns: ${missingColumns.join(', ')}` 
        };
    }
    
    // Check for empty rows
    const emptyRows = csvData.filter(row => 
        expectedColumns.every(col => !row[col] || row[col].toString().trim() === '')
    );
    
    if (emptyRows.length > 0) {
        return { 
            valid: false, 
            error: `Found ${emptyRows.length} empty rows` 
        };
    }
    
    return { 
        valid: true, 
        extraColumns: extraColumns,
        rowCount: csvData.length 
    };
}

// Local storage helpers
const Storage = {
    get: function(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error('Error reading from localStorage:', error);
            return defaultValue;
        }
    },
    
    set: function(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('Error writing to localStorage:', error);
            return false;
        }
    },
    
    remove: function(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error('Error removing from localStorage:', error);
            return false;
        }
    },
    
    clear: function() {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Error clearing localStorage:', error);
            return false;
        }
    }
};

// Event emitter for component communication
class EventEmitter {
    constructor() {
        this.events = {};
    }
    
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }
    
    off(event, callback) {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    }
    
    emit(event, data) {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => callback(data));
    }
}

// Global event emitter instance
window.eventEmitter = new EventEmitter();

// Error handling
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
    showSnackbar('An unexpected error occurred. Please try again.');
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    showSnackbar('An error occurred while processing your request.');
});
