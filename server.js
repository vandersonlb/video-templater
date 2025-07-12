const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { render } = require('@nexrender/core');
const { createServer } = require('http');
const { Server } = require('socket.io');
const QueueManager = require('./queue-manager');

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = 8080;

// NexRender configuration
const NEXRENDER_CONFIG = {
  // workpath: path.join(__dirname, 'renders'),
  workpath: "/mnt/d/Adobe/_cache_/Nexrender",
  binary: "/mnt/d/Adobe/Adobe After Effects 2025/Support Files/aerender.exe",
  skipCleanup: false,
  addLicense: false,
  debug: true,
  wslMap: "Z",
};

// Initialize Queue Manager with configuration
const queueManager = new QueueManager({
  maxConcurrentRenders: 1, // Start with 1 to prevent crashes
  maxQueueSize: 100,
  jobTimeout: 3600000, // 1 hour
  retryFailedJobs: true,
  maxRetries: 2
});

// In-memory job tracking (legacy - will be replaced by queue)
const renderJobs = new Map();

// Queue event handlers
queueManager.on('jobAdded', (job) => {
  console.log(`Job ${job.id} added to queue`);
  // Emit queue update to project room
  io.to(`project-${job.metadata.projectId}`).emit('queue-update', {
    jobId: job.id,
    status: 'pending',
    queuePosition: queueManager.getJobPosition(job.id),
    queueStatus: queueManager.getQueueStatus()
  });
});

queueManager.on('jobStarted', (job) => {
  console.log(`Job ${job.id} started processing`);
  // Update legacy tracking for compatibility
  renderJobs.set(job.id, {
    id: job.id,
    projectId: job.metadata.projectId,
    templateId: job.metadata.templateId,
    rowData: job.metadata.rowData,
    rowIndex: job.metadata.rowIndex,
    status: 'processing',
    outputPath: job.metadata.outputPath,
    outputFilename: job.metadata.outputFilename,
    startTime: job.metadata.startedAt,
    config: job,
    progress: 0
  });
  
  // Emit status update
  io.to(`project-${job.metadata.projectId}`).emit('job-started', {
    jobId: job.id,
    status: 'processing',
    queueStatus: queueManager.getQueueStatus()
  });
});

queueManager.on('processJob', async (job) => {
  // This is where we actually start the render process
  try {
    await renderVideoFromQueue(job);
  } catch (error) {
    console.error(`Failed to process job ${job.id}:`, error);
    queueManager.failJob(job.id, error);
  }
});

queueManager.on('jobCompleted', (job) => {
  console.log(`Job ${job.id} completed`);
  // Update legacy tracking
  const legacyJob = renderJobs.get(job.id);
  if (legacyJob) {
    legacyJob.status = 'completed';
    legacyJob.progress = 100;
    legacyJob.endTime = job.metadata.completedAt;
    legacyJob.result = job.metadata.result;
    legacyJob.resultPath = job.metadata.result;
  }
  
  // Emit completion event
  io.to(`project-${job.metadata.projectId}`).emit('job-completed', {
    jobId: job.id,
    progress: 100,
    status: 'completed',
    resultPath: job.metadata.result,
    downloadUrl: job.metadata.result && fs.existsSync(job.metadata.result) ? `/api/download-video/${job.id}` : null,
    queueStatus: queueManager.getQueueStatus()
  });
});

queueManager.on('jobFailed', (job) => {
  console.log(`Job ${job.id} failed permanently`);
  // Update legacy tracking
  const legacyJob = renderJobs.get(job.id);
  if (legacyJob) {
    legacyJob.status = 'failed';
    legacyJob.progress = 0;
    legacyJob.error = job.metadata.error;
    legacyJob.errorDetails = job.metadata.errorDetails;
    legacyJob.endTime = job.metadata.failedAt;
  }
  
  // Emit failure event
  io.to(`project-${job.metadata.projectId}`).emit('job-failed', {
    jobId: job.id,
    progress: 0,
    status: 'failed',
    error: job.metadata.error,
    errorDetails: job.metadata.errorDetails,
    queueStatus: queueManager.getQueueStatus()
  });
});

queueManager.on('jobRetry', (job) => {
  console.log(`Job ${job.id} will be retried`);
  // Emit retry event
  io.to(`project-${job.metadata.projectId}`).emit('job-retry', {
    jobId: job.id,
    status: 'pending',
    retryCount: job.metadata.retryCount,
    queuePosition: queueManager.getJobPosition(job.id),
    queueStatus: queueManager.getQueueStatus()
  });
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Join project room for targeted updates
  socket.on('join-project', (projectId) => {
    socket.join(`project-${projectId}`);
    console.log(`Client ${socket.id} joined project room: ${projectId}`);
    
    // Send current queue status for this project
    const projectJobs = queueManager.getProjectJobs(projectId);
    socket.emit('project-queue-status', {
      projectId: projectId,
      jobs: projectJobs,
      queueStatus: queueManager.getQueueStatus()
    });
  });
  
  // Leave project room
  socket.on('leave-project', (projectId) => {
    socket.leave(`project-${projectId}`);
    console.log(`Client ${socket.id} left project room: ${projectId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Ensure required directories exist
const requiredDirs = ['public', 'uploads', 'templates', 'renders'];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Routes

// Serve main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get available templates (now based on .aep/.json pairs)
app.get('/api/templates', (req, res) => {
  try {
    const templates = [];
    
    // Read files from templates directory
    const templatesDir = 'templates';
    const files = fs.readdirSync(templatesDir);
    
    // Find .aep files and check for corresponding .json files
    const aepFiles = files.filter(file => file.endsWith('.aep'));
    
    aepFiles.forEach(aepFile => {
      try {
        const baseName = aepFile.replace('.aep', '');
        const jsonFile = `${baseName}.json`;
        const jsonPath = path.join(templatesDir, jsonFile);
        
        // Check if corresponding .json file exists
        if (fs.existsSync(jsonPath)) {
          const templateData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          
          // Extract layerName fields from template assets
          const dataFields = [];
          if (templateData.assets) {
            templateData.assets.forEach(asset => {
              if (asset.type === 'data' && asset.layerName) {
                if (!dataFields.includes(asset.layerName)) {
                  dataFields.push(asset.layerName);
                }
              }
            });
          }
          
          templates.push({
            id: baseName,
            name: baseName,
            composition: templateData.template?.composition || 'Unknown',
            outputExt: templateData.template?.outputExt || 'mp4',
            dataFields: dataFields,
            aepFile: aepFile,
            jsonFile: jsonFile,
            aepPath: path.join(templatesDir, aepFile),
            jsonPath: jsonPath
          });
        } else {
          console.warn(`No corresponding .json file found for ${aepFile}`);
        }
      } catch (error) {
        console.error(`Error processing template pair ${aepFile}:`, error);
      }
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error getting templates:', error);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// Upload CSV file
app.post('/api/upload-csv', upload.single('csvFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const projectId = req.body.projectId;
  const csvData = [];
  
  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', (data) => csvData.push(data))
    .on('end', () => {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        data: csvData,
        rowCount: csvData.length,
        columns: csvData.length > 0 ? Object.keys(csvData[0]) : []
      });
    })
    .on('error', (error) => {
      console.error('Error parsing CSV:', error);
      res.status(500).json({ error: 'Failed to parse CSV file' });
    });
});

// Download CSV template (now dynamically generated from .json file)
app.get('/api/download-csv/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    // Read the corresponding .json file for this project
    const jsonPath = path.join('templates', `${projectId}.json`);
    
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'Template configuration not found' });
    }
    
    const templateData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // Extract layerName fields from template assets
    const columns = [];
    if (templateData.assets) {
      templateData.assets.forEach(asset => {
        if (asset.type === 'data' && asset.layerName) {
          if (!columns.includes(asset.layerName)) {
            columns.push(asset.layerName);
          }
        }
      });
    }
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'No data fields found in template' });
    }
    
    const filename = `${projectId}_data_model.csv`;
    const filepath = path.join(__dirname, 'uploads', filename);
    
    // Create CSV with headers only
    const csvWriter = createCsvWriter({
      path: filepath,
      header: columns.map(col => ({ id: col, title: col }))
    });
    
    csvWriter.writeRecords([])
      .then(() => {
        res.download(filepath, filename, (err) => {
          if (err) {
            console.error('Error downloading file:', err);
          }
          // Clean up file after download
          setTimeout(() => {
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
            }
          }, 5000);
        });
      })
      .catch(error => {
        console.error('Error creating CSV:', error);
        res.status(500).json({ error: 'Failed to create CSV file' });
      });
      
  } catch (error) {
    console.error('Error processing template:', error);
    res.status(500).json({ error: 'Failed to process template configuration' });
  }
});

// Generate videos endpoint (now uses queue system)
app.post('/api/generate-videos', async (req, res) => {
  const { projectId, templateId, csvData, priority } = req.body;
  
  try {
    // Read the template file
    const templateFile = path.join('templates', `${templateId}.json`);
    if (!fs.existsSync(templateFile)) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    const templateData = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
    const jobs = [];
    
    // Create project-specific render directory
    const projectRenderDir = path.join(NEXRENDER_CONFIG.workpath, projectId);
    if (!fs.existsSync(projectRenderDir)) {
      fs.mkdirSync(projectRenderDir, { recursive: true });
    }
    
    // Add each CSV row as a job to the queue
    for (let index = 0; index < csvData.length; index++) {
      const row = csvData[index];
      const jobId = `${projectId}_${index + 1}_${uuidv4()}`;
      const renderJob = JSON.parse(JSON.stringify(templateData)); // Deep copy
      
      // Ensure template.src points to the correct .aep file
      const aepPath = path.join(__dirname, 'templates', `${templateId}.aep`);
      const absoluteAepPath = path.resolve(aepPath);
      renderJob.template.src = `file://${absoluteAepPath}`;
      
      // Update data assets with CSV values
      renderJob.assets.forEach(asset => {
        if (asset.type === 'data' && asset.layerName && row[asset.layerName]) {
          asset.value = row[asset.layerName];
        }
        if (asset.type === 'image' && asset.layerName && row[asset.layerName]) {
          asset.src = row[asset.layerName];
        }
      });
      
      // Set output filename
      const outputFilename = `${jobId}.${templateData.template.outputExt || 'mp4'}`;
      const outputPath = path.join(projectRenderDir, outputFilename);
      
      // Add postrender action to copy files to output directory
      if (!renderJob.actions) {
        renderJob.actions = {};
      }
      if (!renderJob.actions.postrender) {
        renderJob.actions.postrender = [];
      }
      
      // Add copy action to move rendered files to the specified output directory
      renderJob.actions.postrender.push({
        "module": "@nexrender/action-copy",
        "output": "/mnt/c/Users/vande/Downloads/Renderizados/",
        "useJobId": "true"
      });
      
      // Create job configuration for queue
      const jobConfig = {
        id: jobId,
        priority: priority || 0, // Support priority from request
        template: renderJob.template,
        assets: renderJob.assets,
        actions: renderJob.actions,
        projectId: projectId,
        templateId: templateId,
        rowIndex: index + 1,
        rowData: row,
        outputPath: outputPath,
        outputFilename: outputFilename
      };
      
      // Add job to queue
      const queuedJob = queueManager.addJob(jobConfig);
      
      jobs.push({
        id: jobId,
        status: 'pending',
        rowData: row,
        rowIndex: index + 1,
        queuePosition: queueManager.getJobPosition(jobId),
        priority: queuedJob.priority
      });
    }
    
    res.json({
      success: true,
      jobCount: jobs.length,
      jobs: jobs,
      queueStatus: queueManager.getQueueStatus(),
      message: `${jobs.length} jobs added to render queue. Check status with /api/render-status/:projectId`
    });
    
  } catch (error) {
    console.error('Error adding jobs to queue:', error);
    res.status(500).json({ error: 'Failed to add jobs to render queue' });
  }
});

// New function to render video from queue job
async function renderVideoFromQueue(job) {
  try {
    console.log(`Starting render for queued job ${job.id}`);
    
    // Create nexrender job configuration
    const nexrenderJob = {
      template: job.template,
      assets: job.assets,
      actions: job.actions
    };
    
    // Add progress tracking
    nexrenderJob.onRenderProgress = (renderJob, percents) => {
      console.log(`Job ${job.id} render progress: ${percents}%`);
      
      // Update legacy tracking for compatibility
      const legacyJob = renderJobs.get(job.id);
      if (legacyJob) {
        legacyJob.progress = Math.round(percents);
      }
      
      // Emit real-time progress update via WebSocket
      io.to(`project-${job.metadata.projectId}`).emit('progress-update', {
        jobId: job.id,
        progress: Math.round(percents),
        status: 'processing'
      });
    };
    
    console.log(`Rendering job ${job.id} with template: ${job.template.src}`);
    
    const result = await render(nexrenderJob, NEXRENDER_CONFIG);
    
    console.log(`Render completed for job ${job.id}: ${result}`);
    console.log(`Result file exists: ${fs.existsSync(result)}`);
    
    // Complete the job in queue
    queueManager.completeJob(job.id, result);
    
  } catch (error) {
    console.error(`Render failed for job ${job.id}:`, error);
    throw error; // This will be caught by the queue manager
  }
}

// Async function to render a single video with progress tracking (legacy)
async function renderVideo(jobId, jobConfig, outputPath) {
  try {
    console.log(`Starting render for job ${jobId}`);
    
    // Update job to show 0% progress
    const job = renderJobs.get(jobId);
    if (job) {
      job.progress = 0;
    }
    
    // Add onRenderProgress to the job configuration (correct NexRender approach)
    jobConfig.onRenderProgress = (job, percents) => {
      const currentJob = renderJobs.get(jobId);
      if (currentJob) {
        currentJob.progress = Math.round(percents);
        console.log(`Job ${jobId} render progress: ${percents}%`);
        
        // Emit real-time progress update via WebSocket
        io.to(`project-${currentJob.projectId}`).emit('progress-update', {
          jobId: jobId,
          progress: currentJob.progress,
          status: 'rendering'
        });
      }
    };
    
    // Ensure template.src uses file:// protocol for local files
    if (jobConfig.template && jobConfig.template.src && !jobConfig.template.src.startsWith('file://')) {
      // Convert relative path to absolute file:// URL
      const absolutePath = path.resolve(jobConfig.template.src);
      jobConfig.template.src = `file://${absolutePath}`;
    }
    
    console.log(`Rendering job ${jobId} with template: ${jobConfig.template.src}`);
    
    const result = await render(jobConfig, NEXRENDER_CONFIG);
    
    // Update job status
    const finalJob = renderJobs.get(jobId);
    if (finalJob) {
      finalJob.status = 'completed';
      finalJob.progress = 100;
      finalJob.endTime = new Date().toISOString();
      finalJob.result = result;
      finalJob.resultPath = result; // Store the actual result path
      
      console.log(`Render completed for job ${jobId}: ${result}`);
      console.log(`Result file exists: ${fs.existsSync(result)}`);
      
      // Emit completion event via WebSocket
      io.to(`project-${finalJob.projectId}`).emit('job-completed', {
        jobId: jobId,
        progress: 100,
        status: 'completed',
        resultPath: result,
        downloadUrl: fs.existsSync(result) ? `/api/download-video/${jobId}` : null
      });
    }
    
  } catch (error) {
    console.error(`Render failed for job ${jobId}:`, error);
    
    const job = renderJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.progress = 0;
      job.error = error.message;
      job.errorDetails = error.stack || error.toString();
      job.endTime = new Date().toISOString();
      
      // Emit failure event via WebSocket
      io.to(`project-${job.projectId}`).emit('job-failed', {
        jobId: jobId,
        progress: 0,
        status: 'failed',
        error: error.message,
        errorDetails: job.errorDetails
      });
    }
    throw error;
  }
}

// Get render status for a project (with progress and error details)
app.get('/api/render-status/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    const projectJobs = [];
    
    renderJobs.forEach((job, jobId) => {
      if (job.projectId === projectId) {
        // Check if file actually exists for download
        const filePath = job.resultPath || job.outputPath;
        const fileExists = filePath && fs.existsSync(filePath);
        
        // Only provide download URL if file exists
        const downloadUrl = (job.status === 'completed' && fileExists) ? `/api/download-video/${job.id}` : null;
        
        projectJobs.push({
          id: job.id,
          rowIndex: job.rowIndex,
          status: job.status,
          progress: job.progress || 0,
          rowData: job.rowData,
          startTime: job.startTime,
          endTime: job.endTime,
          error: job.error,
          errorDetails: job.errorDetails,
          outputFilename: job.outputFilename,
          resultPath: job.resultPath,
          fileExists: fileExists,
          downloadUrl: downloadUrl
        });
      }
    });
    
    // Calculate summary
    const summary = {
      total: projectJobs.length,
      completed: projectJobs.filter(j => j.status === 'completed').length,
      rendering: projectJobs.filter(j => j.status === 'rendering').length,
      failed: projectJobs.filter(j => j.status === 'failed').length
    };
    
    res.json({
      success: true,
      projectId: projectId,
      summary: summary,
      jobs: projectJobs.sort((a, b) => a.rowIndex - b.rowIndex)
    });
    
  } catch (error) {
    console.error('Error getting render status:', error);
    res.status(500).json({ error: 'Failed to get render status' });
  }
});

// Download rendered video
app.get('/api/download-video/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  
  try {
    const job = renderJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Video not ready for download' });
    }
    
    // Use the actual result path from NexRender
    const filePath = job.resultPath || job.outputPath;
    
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`Video file not found at: ${filePath}`);
      return res.status(404).json({ error: 'Video file not found' });
    }
    
    // Extract filename from the actual path
    const actualFilename = path.basename(filePath);
    
    console.log(`Downloading video: ${filePath}`);
    
    res.download(filePath, actualFilename, (err) => {
      if (err) {
        console.error('Error downloading video:', err);
        res.status(500).json({ error: 'Failed to download video' });
      }
    });
    
  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ error: 'Failed to download video' });
  }
});

// Get all videos for a project (bulk download info)
app.get('/api/project-videos/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    const completedJobs = [];
    
    renderJobs.forEach((job, jobId) => {
      if (job.projectId === projectId && job.status === 'completed') {
        // Use the actual result path for file size calculation
        const filePath = job.resultPath || job.outputPath;
        const fileSize = (filePath && fs.existsSync(filePath)) ? fs.statSync(filePath).size : 0;
        
        completedJobs.push({
          id: job.id,
          rowIndex: job.rowIndex,
          outputFilename: job.outputFilename,
          downloadUrl: `/api/download-video/${job.id}`,
          rowData: job.rowData,
          fileSize: fileSize
        });
      }
    });
    
    res.json({
      success: true,
      projectId: projectId,
      videoCount: completedJobs.length,
      videos: completedJobs.sort((a, b) => a.rowIndex - b.rowIndex)
    });
    
  } catch (error) {
    console.error('Error getting project videos:', error);
    res.status(500).json({ error: 'Failed to get project videos' });
  }
});

// Clear CSV data for a project
app.delete('/api/project-data/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    // Remove all render jobs for this project from legacy tracking
    const deletedJobs = [];
    renderJobs.forEach((job, jobId) => {
      if (job.projectId === projectId) {
        deletedJobs.push(job);
        renderJobs.delete(jobId);
      }
    });
    
    // Also remove from queue (pending jobs only)
    const queueJobs = queueManager.getProjectJobs(projectId);
    let cancelledJobs = 0;
    queueJobs.forEach(job => {
      if (job.status === 'pending') {
        try {
          queueManager.cancelJob(job.id);
          cancelledJobs++;
        } catch (error) {
          console.warn(`Could not cancel job ${job.id}:`, error.message);
        }
      }
    });
    
    res.json({
      success: true,
      projectId: projectId,
      message: `Cleared data for project ${projectId}`,
      deletedJobs: deletedJobs.length,
      cancelledJobs: cancelledJobs
    });
    
  } catch (error) {
    console.error('Error clearing project data:', error);
    res.status(500).json({ error: 'Failed to clear project data' });
  }
});

// ===== NEW QUEUE MANAGEMENT ENDPOINTS =====

// Get overall queue status
app.get('/api/queue/status', (req, res) => {
  try {
    const queueStatus = queueManager.getQueueStatus();
    res.json({
      success: true,
      queueStatus: queueStatus
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// Get queue status for a specific project
app.get('/api/queue/project/:projectId', (req, res) => {
  const projectId = req.params.projectId;
  
  try {
    const projectJobs = queueManager.getProjectJobs(projectId);
    const queueStatus = queueManager.getQueueStatus();
    
    // Add queue positions for pending jobs
    const jobsWithPositions = projectJobs.map(job => ({
      ...job,
      queuePosition: job.status === 'pending' ? queueManager.getJobPosition(job.id) : null
    }));
    
    res.json({
      success: true,
      projectId: projectId,
      jobs: jobsWithPositions,
      queueStatus: queueStatus
    });
    
  } catch (error) {
    console.error('Error getting project queue status:', error);
    res.status(500).json({ error: 'Failed to get project queue status' });
  }
});

// Update job priority (only for pending jobs)
app.post('/api/queue/priority/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const { priority } = req.body;
  
  if (typeof priority !== 'number') {
    return res.status(400).json({ error: 'Priority must be a number' });
  }
  
  try {
    const updatedJob = queueManager.updateJobPriority(jobId, priority);
    
    res.json({
      success: true,
      jobId: jobId,
      newPriority: updatedJob.priority,
      newQueuePosition: queueManager.getJobPosition(jobId),
      queueStatus: queueManager.getQueueStatus()
    });
    
  } catch (error) {
    console.error('Error updating job priority:', error);
    res.status(400).json({ error: error.message });
  }
});

// Cancel a pending job
app.delete('/api/queue/job/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  
  try {
    const cancelledJob = queueManager.cancelJob(jobId);
    
    // Also remove from legacy tracking if exists
    renderJobs.delete(jobId);
    
    res.json({
      success: true,
      jobId: jobId,
      message: 'Job cancelled successfully',
      queueStatus: queueManager.getQueueStatus()
    });
    
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(400).json({ error: error.message });
  }
});

// Update queue configuration
app.post('/api/queue/config', (req, res) => {
  const { maxConcurrentRenders } = req.body;
  
  try {
    if (maxConcurrentRenders && typeof maxConcurrentRenders === 'number' && maxConcurrentRenders > 0) {
      queueManager.config.maxConcurrentRenders = maxConcurrentRenders;
      console.log(`Queue max concurrent renders updated to: ${maxConcurrentRenders}`);
    }
    
    res.json({
      success: true,
      config: {
        maxConcurrentRenders: queueManager.config.maxConcurrentRenders,
        maxQueueSize: queueManager.config.maxQueueSize,
        jobTimeout: queueManager.config.jobTimeout,
        retryFailedJobs: queueManager.config.retryFailedJobs,
        maxRetries: queueManager.config.maxRetries
      },
      queueStatus: queueManager.getQueueStatus()
    });
    
  } catch (error) {
    console.error('Error updating queue config:', error);
    res.status(500).json({ error: 'Failed to update queue configuration' });
  }
});

// Get queue configuration
app.get('/api/queue/config', (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        maxConcurrentRenders: queueManager.config.maxConcurrentRenders,
        maxQueueSize: queueManager.config.maxQueueSize,
        jobTimeout: queueManager.config.jobTimeout,
        retryFailedJobs: queueManager.config.retryFailedJobs,
        maxRetries: queueManager.config.maxRetries
      },
      queueStatus: queueManager.getQueueStatus()
    });
  } catch (error) {
    console.error('Error getting queue config:', error);
    res.status(500).json({ error: 'Failed to get queue configuration' });
  }
});

// Start server (using HTTP server for WebSocket support)
server.listen(PORT, () => {
  console.log(`Video Project Manager running at http://localhost:${PORT}`);
  console.log('WebSocket server enabled for real-time progress updates');
  console.log('Queue system initialized with configuration:');
  console.log(`  - Max concurrent renders: ${queueManager.config.maxConcurrentRenders}`);
  console.log(`  - Max queue size: ${queueManager.config.maxQueueSize}`);
  console.log(`  - Job timeout: ${queueManager.config.jobTimeout / 1000}s`);
  console.log(`  - Retry failed jobs: ${queueManager.config.retryFailedJobs}`);
  console.log(`  - Max retries: ${queueManager.config.maxRetries}`);
  
  try {
    const files = fs.readdirSync('templates');
    const aepFiles = files.filter(f => f.endsWith('.aep'));
    const templatePairs = aepFiles.filter(aepFile => {
      const baseName = aepFile.replace('.aep', '');
      return fs.existsSync(path.join('templates', `${baseName}.json`));
    });
    console.log('Available template pairs:', templatePairs.map(f => f.replace('.aep', '')));
  } catch (error) {
    console.log('Templates directory not found or empty');
  }
  
  console.log('\n=== QUEUE SYSTEM ACTIVE ===');
  console.log('Videos will now render sequentially to prevent system crashes.');
  console.log('Use /api/queue/config to adjust concurrent render limit.');
  console.log('Monitor queue status at /api/queue/status');
});
