const QueueManager = require('./queue-manager');

// Test the queue system
async function testQueue() {
  console.log('Testing Queue System...\n');
  
  // Create a test queue manager
  const testQueue = new QueueManager({
    maxConcurrentRenders: 2,
    maxQueueSize: 10,
    jobTimeout: 30000, // 30 seconds for testing
    retryFailedJobs: true,
    maxRetries: 1
  });
  
  // Set up event listeners
  testQueue.on('jobAdded', (job) => {
    console.log(`✓ Job ${job.id} added to queue (priority: ${job.priority}, position: ${testQueue.getJobPosition(job.id)})`);
  });
  
  testQueue.on('jobStarted', (job) => {
    console.log(`▶ Job ${job.id} started processing`);
  });
  
  testQueue.on('processJob', async (job) => {
    console.log(`🔄 Processing job ${job.id}...`);
    
    // Simulate work with a delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate success or failure
    if (Math.random() > 0.3) { // 70% success rate
      console.log(`✅ Job ${job.id} completed successfully`);
      testQueue.completeJob(job.id, `result-${job.id}.mp4`);
    } else {
      console.log(`❌ Job ${job.id} failed`);
      testQueue.failJob(job.id, new Error('Simulated render failure'));
    }
  });
  
  testQueue.on('jobCompleted', (job) => {
    console.log(`🎉 Job ${job.id} completed! Result: ${job.metadata.result}`);
  });
  
  testQueue.on('jobFailed', (job) => {
    console.log(`💥 Job ${job.id} failed permanently: ${job.metadata.error}`);
  });
  
  testQueue.on('jobRetry', (job) => {
    console.log(`🔄 Job ${job.id} will be retried (attempt ${job.metadata.retryCount})`);
  });
  
  // Add test jobs
  console.log('Adding test jobs to queue...\n');
  
  const testJobs = [
    { id: 'job-1', priority: 0, projectId: 'test-project', templateId: 'test-template', rowIndex: 1 },
    { id: 'job-2', priority: 5, projectId: 'test-project', templateId: 'test-template', rowIndex: 2 }, // Higher priority
    { id: 'job-3', priority: 0, projectId: 'test-project', templateId: 'test-template', rowIndex: 3 },
    { id: 'job-4', priority: 10, projectId: 'urgent-project', templateId: 'test-template', rowIndex: 1 }, // Highest priority
    { id: 'job-5', priority: 0, projectId: 'test-project', templateId: 'test-template', rowIndex: 4 }
  ];
  
  // Add jobs to queue
  testJobs.forEach(jobConfig => {
    testQueue.addJob({
      ...jobConfig,
      template: { src: 'test-template.aep' },
      assets: [],
      actions: {},
      outputPath: `/tmp/${jobConfig.id}.mp4`,
      outputFilename: `${jobConfig.id}.mp4`,
      rowData: { test: 'data' }
    });
  });
  
  // Show initial queue status
  console.log('\nInitial Queue Status:');
  console.log(testQueue.getQueueStatus());
  
  // Wait for jobs to process
  console.log('\nProcessing jobs...\n');
  
  // Monitor queue for 15 seconds
  const monitorInterval = setInterval(() => {
    const status = testQueue.getQueueStatus();
    console.log(`Queue Status - Pending: ${status.pending}, Processing: ${status.processing}, Completed: ${status.completed}, Failed: ${status.failed}`);
    
    if (status.pending === 0 && status.processing === 0) {
      console.log('\n🏁 All jobs processed!');
      clearInterval(monitorInterval);
      
      // Show final status
      console.log('\nFinal Queue Status:');
      console.log(testQueue.getQueueStatus());
      
      // Show project jobs
      console.log('\nProject Jobs:');
      const projectJobs = testQueue.getProjectJobs('test-project');
      projectJobs.forEach(job => {
        console.log(`  ${job.id}: ${job.status} (priority: ${job.priority})`);
      });
      
      // Stop the queue
      testQueue.stopProcessing();
      console.log('\n✅ Queue test completed!');
      process.exit(0);
    }
  }, 1000);
  
  // Timeout after 20 seconds
  setTimeout(() => {
    console.log('\n⏰ Test timeout reached');
    clearInterval(monitorInterval);
    testQueue.stopProcessing();
    process.exit(1);
  }, 20000);
}

// Run the test
testQueue().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
