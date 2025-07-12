# Video Render Queue System

This document describes the queue system implemented to prevent nexrender-cli from crashing when rendering multiple videos simultaneously.

## Overview

The queue system replaces the previous approach of rendering all videos at once with a controlled, priority-based queue that processes jobs sequentially or with limited concurrency.

## Key Features

### 🚀 **Prevents System Crashes**
- Controls concurrent renders to prevent resource exhaustion
- Default: 1 concurrent render (configurable)
- Jobs are processed sequentially by default

### 📋 **Priority-Based Queue**
- Jobs can have different priority levels (higher numbers = higher priority)
- Same priority jobs are processed in FIFO order
- Supports the `priority` field from nexrender documentation

### 🔄 **Automatic Retry System**
- Failed jobs are automatically retried (configurable)
- Default: 2 retry attempts
- Exponential backoff between retries

### 📊 **Real-time Monitoring**
- WebSocket events for queue status updates
- Progress tracking for individual jobs
- Queue position tracking for pending jobs

### ⚙️ **Configurable Settings**
- Maximum concurrent renders
- Queue size limits
- Job timeout settings
- Retry behavior

## Architecture

### Core Components

1. **QueueManager** (`queue-manager.js`)
   - Manages job lifecycle (pending → processing → completed/failed)
   - Handles priority sorting and job scheduling
   - Emits events for real-time updates

2. **Enhanced Server** (`server.js`)
   - Integrates queue system with existing API
   - Maintains backward compatibility
   - Provides new queue management endpoints

### Job States

- **pending**: Job is waiting in queue
- **processing**: Job is currently being rendered
- **completed**: Job finished successfully
- **failed**: Job failed permanently (after retries)
- **cancelled**: Job was cancelled before processing

## API Endpoints

### Existing Endpoints (Modified)

#### `POST /api/generate-videos`
Now adds jobs to queue instead of starting all renders immediately.

**New Request Parameters:**
```json
{
  "projectId": "string",
  "templateId": "string", 
  "csvData": "array",
  "priority": "number (optional, default: 0)"
}
```

**Response includes queue information:**
```json
{
  "success": true,
  "jobCount": 5,
  "jobs": [
    {
      "id": "job-id",
      "status": "pending",
      "queuePosition": 3,
      "priority": 0,
      "rowData": {...}
    }
  ],
  "queueStatus": {
    "pending": 5,
    "processing": 1,
    "completed": 0,
    "failed": 0,
    "activeWorkers": 1,
    "maxConcurrentRenders": 1
  }
}
```

### New Queue Management Endpoints

#### `GET /api/queue/status`
Get overall queue statistics.

#### `GET /api/queue/project/:projectId`
Get queue status for a specific project with job positions.

#### `POST /api/queue/priority/:jobId`
Update priority of a pending job.
```json
{
  "priority": 10
}
```

#### `DELETE /api/queue/job/:jobId`
Cancel a pending job.

#### `GET /api/queue/config`
Get current queue configuration.

#### `POST /api/queue/config`
Update queue configuration.
```json
{
  "maxConcurrentRenders": 2
}
```

## WebSocket Events

### New Events

- **queue-update**: Job added to queue
- **job-started**: Job started processing  
- **job-retry**: Job will be retried
- **project-queue-status**: Complete project queue status

### Enhanced Events

- **job-completed**: Now includes queue status
- **job-failed**: Now includes queue status
- **progress-update**: Real-time render progress

## Configuration

### Default Settings

```javascript
{
  maxConcurrentRenders: 1,    // Prevent crashes
  maxQueueSize: 100,          // Queue capacity
  jobTimeout: 3600000,        // 1 hour timeout
  retryFailedJobs: true,      // Enable retries
  maxRetries: 2               // Retry attempts
}
```

### Automatic File Copy

All rendered videos are automatically copied to the output directory using the `@nexrender/action-copy` module:

```javascript
{
  "actions": {
    "postrender": [
      {
        "module": "@nexrender/action-copy",
        "output": "/mnt/c/Users/vande/Downloads/Renderizados/",
        "useJobId": "true"
      }
    ]
  }
}
```

This ensures that completed videos are automatically moved to the specified directory with unique job IDs as filenames.

### Adjusting Concurrency

**Conservative (Recommended):**
```bash
curl -X POST http://localhost:8080/api/queue/config \
  -H "Content-Type: application/json" \
  -d '{"maxConcurrentRenders": 1}'
```

**Moderate (if system can handle it):**
```bash
curl -X POST http://localhost:8080/api/queue/config \
  -H "Content-Type: application/json" \
  -d '{"maxConcurrentRenders": 2}'
```

## Usage Examples

### Basic Usage

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Submit render jobs:**
   ```javascript
   fetch('/api/generate-videos', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       projectId: 'my-project',
       templateId: 'template-01',
       csvData: [...],
       priority: 0  // Optional
     })
   })
   ```

3. **Monitor queue status:**
   ```javascript
   fetch('/api/queue/status')
     .then(r => r.json())
     .then(data => console.log(data.queueStatus))
   ```

### Priority Jobs

```javascript
// High priority job (renders first)
fetch('/api/generate-videos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: 'urgent-project',
    templateId: 'template-01', 
    csvData: [...],
    priority: 10  // Higher priority
  })
})
```

### Cancelling Jobs

```javascript
// Cancel a pending job
fetch('/api/queue/job/job-id-123', {
  method: 'DELETE'
})
```

## Testing

Run the queue system test:

```bash
node test-queue.js
```

This test verifies:
- Job queuing and priority sorting
- Concurrent processing limits
- Retry mechanism
- Event emission
- Queue statistics

## Migration from Previous System

### What Changed

1. **Jobs are queued instead of started immediately**
2. **Sequential processing by default** 
3. **New queue management APIs available**
4. **Enhanced WebSocket events**

### Backward Compatibility

- All existing API endpoints still work
- WebSocket events maintain same structure
- Job tracking and download functionality unchanged
- Frontend requires no changes for basic functionality

### Benefits

- **No more system crashes** from too many concurrent renders
- **Better resource management** and system stability
- **Priority support** for urgent jobs
- **Automatic retry** of failed jobs
- **Real-time monitoring** of render pipeline
- **Scalable architecture** for future enhancements

## Troubleshooting

### Common Issues

1. **Jobs stuck in pending state**
   - Check if queue processing is active
   - Verify maxConcurrentRenders > 0
   - Check server logs for errors

2. **Slow processing**
   - Consider increasing maxConcurrentRenders (carefully)
   - Monitor system resources
   - Check for failed jobs consuming retry attempts

3. **Jobs failing repeatedly**
   - Check nexrender configuration
   - Verify template and asset paths
   - Review error logs in job details

### Monitoring Commands

```bash
# Check queue status
curl http://localhost:8080/api/queue/status

# Check specific project
curl http://localhost:8080/api/queue/project/my-project

# View configuration
curl http://localhost:8080/api/queue/config
```

## Future Enhancements

- **Persistent queue** (survive server restarts)
- **Resource monitoring** (CPU/Memory based throttling)
- **Job scheduling** (time-based execution)
- **Distributed processing** (multiple worker nodes)
- **Advanced retry policies** (exponential backoff)
- **Queue analytics** (processing time metrics)
