const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { render } = require('@nexrender/core');

const app = express();
const PORT = 8080;

// NexRender configuration
const NEXRENDER_CONFIG = {
  // workpath: path.join(__dirname, 'renders'),
  workpath: "/mnt/d/Adobe/_cache_/Nexrender",
  binary: "/mnt/d/Adobe/Adobe After Effects 2025/Support Files/aerender.exe",
  skipCleanup: true,
  addLicense: false,
  debug: true,
  wslMap: "Z"
};

// In-memory job tracking
const renderJobs = new Map();

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

// Generate videos endpoint (now actually renders videos)
app.post('/api/generate-videos', async (req, res) => {
  const { projectId, templateId, csvData } = req.body;
  
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
    
    // Start rendering each CSV row
    for (let index = 0; index < csvData.length; index++) {
      const row = csvData[index];
      const jobId = `${projectId}_${index + 1}_${uuidv4()}`;
      const renderJob = JSON.parse(JSON.stringify(templateData)); // Deep copy
      
      // Update data assets with CSV values
      renderJob.assets.forEach(asset => {
        if (asset.type === 'data' && asset.layerName && row[asset.layerName]) {
          asset.value = row[asset.layerName];
        }
      });
      
      // Set output filename
      const outputFilename = `${jobId}.${templateData.template.outputExt || 'mp4'}`;
      const outputPath = path.join(projectRenderDir, outputFilename);
      
      // Store job info
      const jobInfo = {
        id: jobId,
        projectId: projectId,
        templateId: templateId,
        rowData: row,
        rowIndex: index + 1,
        status: 'rendering',
        outputPath: outputPath,
        outputFilename: outputFilename,
        startTime: new Date().toISOString(),
        config: renderJob
      };
      
      renderJobs.set(jobId, jobInfo);
      jobs.push({
        id: jobId,
        status: 'rendering',
        rowData: row,
        rowIndex: index + 1
      });
      
      // Start async rendering (don't await - render in background)
      renderVideo(jobId, renderJob, outputPath).catch(error => {
        console.error(`Render failed for job ${jobId}:`, error);
        const job = renderJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
          job.endTime = new Date().toISOString();
        }
      });
    }
    
    res.json({
      success: true,
      jobCount: jobs.length,
      jobs: jobs,
      message: 'Video rendering started. Check status with /api/render-status/:projectId'
    });
    
  } catch (error) {
    console.error('Error starting video generation:', error);
    res.status(500).json({ error: 'Failed to start video generation' });
  }
});

// Async function to render a single video with progress tracking
async function renderVideo(jobId, jobConfig, outputPath) {
  let progressInterval;
  
  try {
    console.log(`Starting render for job ${jobId}`);
    
    // Update job to show 0% progress
    const job = renderJobs.get(jobId);
    if (job) {
      job.progress = 0;
      job.lastProgressUpdate = Date.now();
    }
    
    // Fallback progress tracking if onProgress doesn't work
    let fallbackProgress = 0;
    progressInterval = setInterval(() => {
      const currentJob = renderJobs.get(jobId);
      if (currentJob && currentJob.status === 'rendering') {
        // If no progress update from onProgress callback, use fallback
        const timeSinceStart = Date.now() - new Date(currentJob.startTime).getTime();
        const estimatedDuration = 60000; // Estimate 60 seconds per render
        fallbackProgress = Math.min(95, Math.round((timeSinceStart / estimatedDuration) * 100));
        
        // Only update if we haven't received real progress updates recently
        const timeSinceLastUpdate = Date.now() - (currentJob.lastProgressUpdate || 0);
        if (timeSinceLastUpdate > 5000) { // 5 seconds without real progress
          currentJob.progress = fallbackProgress;
          console.log(`Job ${jobId} fallback progress: ${fallbackProgress}%`);
        }
      }
    }, 2000); // Update every 2 seconds
    
    const result = await render(jobConfig, {
      ...NEXRENDER_CONFIG,
      onProgress: (progress) => {
        const currentJob = renderJobs.get(jobId);
        if (currentJob) {
          currentJob.progress = Math.round(progress * 100);
          currentJob.lastProgressUpdate = Date.now();
          console.log(`Job ${jobId} real progress: ${currentJob.progress}%`);
        }
      }
    });
    
    // Clear progress interval
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    
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
    }
    
  } catch (error) {
    console.error(`Render failed for job ${jobId}:`, error);
    
    // Clear progress interval
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    
    const job = renderJobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.progress = 0;
      job.error = error.message;
      job.errorDetails = error.stack || error.toString();
      job.endTime = new Date().toISOString();
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
        completedJobs.push({
          id: job.id,
          rowIndex: job.rowIndex,
          outputFilename: job.outputFilename,
          downloadUrl: `/api/download-video/${job.id}`,
          rowData: job.rowData,
          fileSize: fs.existsSync(job.outputPath) ? fs.statSync(job.outputPath).size : 0
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
    // Remove all render jobs for this project
    const deletedJobs = [];
    renderJobs.forEach((job, jobId) => {
      if (job.projectId === projectId) {
        deletedJobs.push(job);
        renderJobs.delete(jobId);
      }
    });
    
    res.json({
      success: true,
      projectId: projectId,
      message: `Cleared data for project ${projectId}`,
      deletedJobs: deletedJobs.length
    });
    
  } catch (error) {
    console.error('Error clearing project data:', error);
    res.status(500).json({ error: 'Failed to clear project data' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Video Project Manager running at http://localhost:${PORT}`);
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
});
