const EventEmitter = require('events');

class QueueManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxConcurrentRenders: config.maxConcurrentRenders || 1,
      maxQueueSize: config.maxQueueSize || 100,
      jobTimeout: config.jobTimeout || 3600000, // 1 hour
      retryFailedJobs: config.retryFailedJobs || true,
      maxRetries: config.maxRetries || 2,
      ...config
    };
    
    // Queue storage
    this.pendingJobs = new Map(); // jobId -> job
    this.processingJobs = new Map(); // jobId -> job
    this.completedJobs = new Map(); // jobId -> job
    this.failedJobs = new Map(); // jobId -> job
    
    // Priority queue (sorted by priority desc, then by createdAt asc)
    this.priorityQueue = [];
    
    // Worker tracking
    this.activeWorkers = 0;
    this.isProcessing = false;
    
    // Start processing
    this.startProcessing();
  }
  
  /**
   * Add a job to the queue
   */
  addJob(jobConfig) {
    if (this.getTotalJobs() >= this.config.maxQueueSize) {
      throw new Error('Queue is full');
    }
    
    const job = {
      id: jobConfig.id,
      priority: jobConfig.priority || 0,
      status: 'pending',
      template: jobConfig.template,
      assets: jobConfig.assets || [],
      actions: jobConfig.actions || {},
      metadata: {
        projectId: jobConfig.projectId,
        templateId: jobConfig.templateId,
        rowIndex: jobConfig.rowIndex,
        rowData: jobConfig.rowData,
        outputPath: jobConfig.outputPath,
        outputFilename: jobConfig.outputFilename,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        ...jobConfig.metadata
      }
    };
    
    // Add to pending jobs
    this.pendingJobs.set(job.id, job);
    
    // Add to priority queue and sort
    this.priorityQueue.push(job.id);
    this.sortPriorityQueue();
    
    console.log(`Job ${job.id} added to queue (priority: ${job.priority}, position: ${this.getJobPosition(job.id)})`);
    
    // Emit event
    this.emit('jobAdded', job);
    
    // Try to process next job
    this.processNext();
    
    return job;
  }
  
  /**
   * Get the next job to process based on priority
   */
  getNextJob() {
    if (this.priorityQueue.length === 0) {
      return null;
    }
    
    // Get the first job in priority queue
    const jobId = this.priorityQueue.shift();
    const job = this.pendingJobs.get(jobId);
    
    if (!job) {
      // Job was removed, try next
      return this.getNextJob();
    }
    
    return job;
  }
  
  /**
   * Start processing a job
   */
  startJob(jobId) {
    const job = this.pendingJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in pending queue`);
    }
    
    // Move from pending to processing
    this.pendingJobs.delete(jobId);
    job.status = 'processing';
    job.metadata.startedAt = new Date().toISOString();
    this.processingJobs.set(jobId, job);
    
    this.activeWorkers++;
    
    console.log(`Job ${jobId} started processing (active workers: ${this.activeWorkers})`);
    
    // Emit event
    this.emit('jobStarted', job);
    
    return job;
  }
  
  /**
   * Complete a job successfully
   */
  completeJob(jobId, result = null) {
    const job = this.processingJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in processing queue`);
    }
    
    // Move from processing to completed
    this.processingJobs.delete(jobId);
    job.status = 'completed';
    job.metadata.completedAt = new Date().toISOString();
    job.metadata.result = result;
    this.completedJobs.set(jobId, job);
    
    this.activeWorkers--;
    
    console.log(`Job ${jobId} completed (active workers: ${this.activeWorkers})`);
    
    // Emit event
    this.emit('jobCompleted', job);
    
    // Process next job
    this.processNext();
    
    return job;
  }
  
  /**
   * Fail a job
   */
  failJob(jobId, error) {
    const job = this.processingJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in processing queue`);
    }
    
    job.metadata.error = error.message || error;
    job.metadata.errorDetails = error.stack || error.toString();
    job.metadata.failedAt = new Date().toISOString();
    
    // Check if we should retry
    if (this.config.retryFailedJobs && job.metadata.retryCount < this.config.maxRetries) {
      job.metadata.retryCount++;
      job.status = 'pending';
      
      // Move back to pending queue
      this.processingJobs.delete(jobId);
      this.pendingJobs.set(jobId, job);
      
      // Add back to priority queue
      this.priorityQueue.push(jobId);
      this.sortPriorityQueue();
      
      console.log(`Job ${jobId} failed, retrying (attempt ${job.metadata.retryCount}/${this.config.maxRetries})`);
      
      this.emit('jobRetry', job);
    } else {
      // Move from processing to failed
      this.processingJobs.delete(jobId);
      job.status = 'failed';
      this.failedJobs.set(jobId, job);
      
      console.log(`Job ${jobId} failed permanently`);
      
      this.emit('jobFailed', job);
    }
    
    this.activeWorkers--;
    
    // Process next job
    this.processNext();
    
    return job;
  }
  
  /**
   * Update job priority
   */
  updateJobPriority(jobId, newPriority) {
    const job = this.pendingJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in pending queue`);
    }
    
    job.priority = newPriority;
    this.sortPriorityQueue();
    
    this.emit('jobPriorityUpdated', job);
    
    return job;
  }
  
  /**
   * Cancel a pending job
   */
  cancelJob(jobId) {
    const job = this.pendingJobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found in pending queue`);
    }
    
    // Remove from pending queue and priority queue
    this.pendingJobs.delete(jobId);
    this.priorityQueue = this.priorityQueue.filter(id => id !== jobId);
    
    job.status = 'cancelled';
    job.metadata.cancelledAt = new Date().toISOString();
    
    console.log(`Job ${jobId} cancelled`);
    
    this.emit('jobCancelled', job);
    
    return job;
  }
  
  /**
   * Get job by ID from any queue
   */
  getJob(jobId) {
    return this.pendingJobs.get(jobId) ||
           this.processingJobs.get(jobId) ||
           this.completedJobs.get(jobId) ||
           this.failedJobs.get(jobId);
  }
  
  /**
   * Get job position in queue (1-based)
   */
  getJobPosition(jobId) {
    const index = this.priorityQueue.indexOf(jobId);
    return index === -1 ? null : index + 1;
  }
  
  /**
   * Get queue statistics
   */
  getQueueStatus() {
    return {
      pending: this.pendingJobs.size,
      processing: this.processingJobs.size,
      completed: this.completedJobs.size,
      failed: this.failedJobs.size,
      total: this.getTotalJobs(),
      activeWorkers: this.activeWorkers,
      maxConcurrentRenders: this.config.maxConcurrentRenders,
      queuePosition: this.priorityQueue.length
    };
  }
  
  /**
   * Get jobs for a specific project
   */
  getProjectJobs(projectId) {
    const jobs = [];
    
    // Collect jobs from all queues
    const allJobs = [
      ...Array.from(this.pendingJobs.values()),
      ...Array.from(this.processingJobs.values()),
      ...Array.from(this.completedJobs.values()),
      ...Array.from(this.failedJobs.values())
    ];
    
    return allJobs
      .filter(job => job.metadata.projectId === projectId)
      .sort((a, b) => a.metadata.rowIndex - b.metadata.rowIndex);
  }
  
  /**
   * Clear completed jobs older than specified time
   */
  cleanupCompletedJobs(olderThanMs = 24 * 60 * 60 * 1000) { // 24 hours default
    const cutoffTime = new Date(Date.now() - olderThanMs);
    const toDelete = [];
    
    this.completedJobs.forEach((job, jobId) => {
      const completedAt = new Date(job.metadata.completedAt);
      if (completedAt < cutoffTime) {
        toDelete.push(jobId);
      }
    });
    
    toDelete.forEach(jobId => {
      this.completedJobs.delete(jobId);
    });
    
    console.log(`Cleaned up ${toDelete.length} old completed jobs`);
    
    return toDelete.length;
  }
  
  /**
   * Sort priority queue by priority (desc) then by createdAt (asc)
   */
  sortPriorityQueue() {
    this.priorityQueue.sort((aId, bId) => {
      const jobA = this.pendingJobs.get(aId);
      const jobB = this.pendingJobs.get(bId);
      
      if (!jobA || !jobB) return 0;
      
      // Higher priority first
      if (jobA.priority !== jobB.priority) {
        return jobB.priority - jobA.priority;
      }
      
      // Same priority, older jobs first
      return new Date(jobA.metadata.createdAt) - new Date(jobB.metadata.createdAt);
    });
  }
  
  /**
   * Get total number of jobs across all queues
   */
  getTotalJobs() {
    return this.pendingJobs.size + this.processingJobs.size + 
           this.completedJobs.size + this.failedJobs.size;
  }
  
  /**
   * Start the queue processing loop
   */
  startProcessing() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('Queue processing started');
    
    // Process jobs every second
    this.processingInterval = setInterval(() => {
      this.processNext();
    }, 1000);
  }
  
  /**
   * Stop the queue processing loop
   */
  stopProcessing() {
    if (!this.isProcessing) return;
    
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    console.log('Queue processing stopped');
  }
  
  /**
   * Process the next job if workers are available
   */
  processNext() {
    if (this.activeWorkers >= this.config.maxConcurrentRenders) {
      return; // All workers busy
    }
    
    if (this.pendingJobs.size === 0) {
      return; // No jobs to process
    }
    
    const nextJob = this.getNextJob();
    if (!nextJob) {
      return; // No valid job found
    }
    
    // Start the job
    this.startJob(nextJob.id);
    
    // Emit event for external processing
    this.emit('processJob', nextJob);
  }
}

module.exports = QueueManager;
