import { v4 as uuidv4 } from "uuid";

/**
 * Simple in-memory job queue for handling concurrent uploads
 * For production, replace with BullMQ or RabbitMQ
 */
class TranscriptionQueue {
  constructor(concurrencyLimit = 3) {
    this.jobs = new Map();
    this.queue = [];
    this.activeCount = 0;
    this.concurrencyLimit = concurrencyLimit;
  }

  /**
   * Add a job to the queue
   * Returns a job ID immediately
   */
  enqueue(filePath, processFn) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      filePath,
      status: "pending",
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.jobs.set(jobId, job);
    this.queue.push({ jobId, processFn });
    this._processNext();

    return jobId;
  }

  /**
   * Get job status
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Process next job in queue if under concurrency limit
   */
  async _processNext() {
    if (this.activeCount >= this.concurrencyLimit || this.queue.length === 0) {
      return;
    }

    const { jobId, processFn } = this.queue.shift();
    const job = this.jobs.get(jobId);
    job.status = "processing";
    this.activeCount++;

    try {
      const result = await processFn();
      job.status = "completed";
      job.result = result;
      job.completedAt = new Date().toISOString();
    } catch (error) {
      job.status = "failed";
      job.error = error.message;
      job.completedAt = new Date().toISOString();
    } finally {
      this.activeCount--;
      this._processNext();
    }
  }
}

export const transcriptionQueue = new TranscriptionQueue(3);
