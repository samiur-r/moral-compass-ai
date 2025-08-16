import fastq from "fastq";
import type { queueAsPromised } from "fastq";

// Queue configuration
const QUEUE_CONFIG = {
  // Main decision processing queue
  DECISION_QUEUE: {
    concurrency: parseInt(process.env.DECISION_QUEUE_CONCURRENCY || "3"), // Max 3 concurrent decision requests
    timeout: parseInt(process.env.DECISION_QUEUE_TIMEOUT || "45000"), // 45 seconds timeout
    intervalCap: parseInt(process.env.DECISION_QUEUE_INTERVAL_CAP || "10"), // Max 10 requests per interval
    interval: parseInt(process.env.DECISION_QUEUE_INTERVAL || "60000"), // 1 minute interval
  },
  
  // PDF generation queue (more resource intensive)
  PDF_QUEUE: {
    concurrency: parseInt(process.env.PDF_QUEUE_CONCURRENCY || "1"), // Max 1 concurrent PDF generation
    timeout: parseInt(process.env.PDF_QUEUE_TIMEOUT || "30000"), // 30 seconds timeout
    intervalCap: parseInt(process.env.PDF_QUEUE_INTERVAL_CAP || "5"), // Max 5 PDFs per interval
    interval: parseInt(process.env.PDF_QUEUE_INTERVAL || "60000"), // 1 minute interval
  },
  
  // Pinecone/vector search queue
  VECTOR_QUEUE: {
    concurrency: parseInt(process.env.VECTOR_QUEUE_CONCURRENCY || "5"), // Max 5 concurrent vector searches
    timeout: parseInt(process.env.VECTOR_QUEUE_TIMEOUT || "10000"), // 10 seconds timeout
    intervalCap: parseInt(process.env.VECTOR_QUEUE_INTERVAL_CAP || "20"), // Max 20 searches per interval
    interval: parseInt(process.env.VECTOR_QUEUE_INTERVAL || "60000"), // 1 minute interval
  },
} as const;

// Queue task types
interface QueueTask<T> {
  operation: () => Promise<T>;
  clientId?: string;
  startTime: number;
}

// Queue instances
let decisionQueue: queueAsPromised<QueueTask<unknown>, QueueResult<unknown>> | null = null;
let pdfQueue: queueAsPromised<QueueTask<unknown>, QueueResult<unknown>> | null = null;
let vectorQueue: queueAsPromised<QueueTask<unknown>, QueueResult<unknown>> | null = null;

/**
 * Generic worker function for processing queue tasks
 */
async function createWorker<T>(
  task: QueueTask<T>,
  timeout: number
): Promise<QueueResult<T>> {
  const queueTime = Date.now() - task.startTime;
  const executionStartTime = Date.now();
  
  try {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Operation timed out")), timeout);
    });
    
    // Race between operation and timeout
    const data = await Promise.race([
      task.operation(),
      timeoutPromise,
    ]);
    
    const executionTime = Date.now() - executionStartTime;
    
    return {
      success: true,
      data,
      queueTime,
      executionTime,
    };
  } catch (error) {
    const executionTime = Date.now() - executionStartTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      queueTime,
      executionTime,
    };
  }
}

/**
 * Initialize queues with configuration
 */
function initializeQueues() {
  if (!decisionQueue) {
    decisionQueue = fastq.promise(
      (task: QueueTask<unknown>) => createWorker(task, QUEUE_CONFIG.DECISION_QUEUE.timeout),
      QUEUE_CONFIG.DECISION_QUEUE.concurrency
    );
  }
  
  if (!pdfQueue) {
    pdfQueue = fastq.promise(
      (task: QueueTask<unknown>) => createWorker(task, QUEUE_CONFIG.PDF_QUEUE.timeout),
      QUEUE_CONFIG.PDF_QUEUE.concurrency
    );
  }
  
  if (!vectorQueue) {
    vectorQueue = fastq.promise(
      (task: QueueTask<unknown>) => createWorker(task, QUEUE_CONFIG.VECTOR_QUEUE.timeout),
      QUEUE_CONFIG.VECTOR_QUEUE.concurrency
    );
  }
}

/**
 * Queue status information
 */
export interface QueueStatus {
  length: number;
  running: number;
  idle: boolean;
  timeout: number;
  concurrency: number;
}

export interface QueueStats {
  decision: QueueStatus;
  pdf: QueueStatus;
  vector: QueueStatus;
}

/**
 * Get current queue statistics
 */
export function getQueueStats(): QueueStats {
  initializeQueues();
  
  return {
    decision: {
      length: decisionQueue!.length(),
      running: decisionQueue!.running(),
      idle: decisionQueue!.idle(),
      timeout: QUEUE_CONFIG.DECISION_QUEUE.timeout,
      concurrency: QUEUE_CONFIG.DECISION_QUEUE.concurrency,
    },
    pdf: {
      length: pdfQueue!.length(),
      running: pdfQueue!.running(),
      idle: pdfQueue!.idle(),
      timeout: QUEUE_CONFIG.PDF_QUEUE.timeout,
      concurrency: QUEUE_CONFIG.PDF_QUEUE.concurrency,
    },
    vector: {
      length: vectorQueue!.length(),
      running: vectorQueue!.running(),
      idle: vectorQueue!.idle(),
      timeout: QUEUE_CONFIG.VECTOR_QUEUE.timeout,
      concurrency: QUEUE_CONFIG.VECTOR_QUEUE.concurrency,
    },
  };
}

/**
 * Queue operation result
 */
export interface QueueResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  queueTime?: number; // Time spent in queue (ms)
  executionTime?: number; // Time spent executing (ms)
}

/**
 * Queue a decision processing operation
 */
export async function queueDecisionOperation<T>(
  operation: () => Promise<T>,
  clientId?: string
): Promise<QueueResult<T>> {
  initializeQueues();
  
  const task: QueueTask<T> = {
    operation,
    clientId,
    startTime: Date.now(),
  };
  
  try {
    const result = await decisionQueue!.push(task);
    
    // Log successful operation
    if (result.success) {
      console.log(`[QUEUE] Decision operation completed`, {
        clientId,
        queueTime: result.queueTime,
        executionTime: result.executionTime,
        queueLength: decisionQueue!.length(),
      });
    } else {
      console.error(`[QUEUE] Decision operation failed`, {
        clientId,
        error: result.error,
        queueTime: result.queueTime,
        executionTime: result.executionTime,
      });
    }
    
    return result;
  } catch (error) {
    const queueTime = Date.now() - task.startTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      queueTime,
    };
  }
}

/**
 * Queue a PDF generation operation
 */
export async function queuePdfOperation<T>(
  operation: () => Promise<T>,
  clientId?: string
): Promise<QueueResult<T>> {
  initializeQueues();
  
  const task: QueueTask<T> = {
    operation,
    clientId,
    startTime: Date.now(),
  };
  
  try {
    const result = await pdfQueue!.push(task);
    
    if (result.success) {
      console.log(`[QUEUE] PDF operation completed`, {
        clientId,
        queueTime: result.queueTime,
        executionTime: result.executionTime,
        queueLength: pdfQueue!.length(),
      });
    } else {
      console.error(`[QUEUE] PDF operation failed`, {
        clientId,
        error: result.error,
        queueTime: result.queueTime,
        executionTime: result.executionTime,
      });
    }
    
    return result;
  } catch (error) {
    const queueTime = Date.now() - task.startTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      queueTime,
    };
  }
}

/**
 * Queue a vector search operation
 */
export async function queueVectorOperation<T>(
  operation: () => Promise<T>,
  clientId?: string
): Promise<QueueResult<T>> {
  initializeQueues();
  
  const task: QueueTask<T> = {
    operation,
    clientId,
    startTime: Date.now(),
  };
  
  try {
    const result = await vectorQueue!.push(task);
    
    if (!result.success) {
      console.error(`[QUEUE] Vector operation failed`, {
        clientId,
        error: result.error,
        queueTime: result.queueTime,
        executionTime: result.executionTime,
      });
    }
    
    return result;
  } catch (error) {
    const queueTime = Date.now() - task.startTime;
    
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      queueTime,
    };
  }
}

/**
 * Check if queues are overloaded
 */
export function areQueuesOverloaded(): {
  overloaded: boolean;
  details: {
    decision: boolean;
    pdf: boolean;
    vector: boolean;
  };
} {
  initializeQueues();
  
  // Consider queue overloaded if queue length + running > 80% of interval cap
  const decisionTotal = decisionQueue!.length() + decisionQueue!.running();
  const pdfTotal = pdfQueue!.length() + pdfQueue!.running();
  const vectorTotal = vectorQueue!.length() + vectorQueue!.running();
  
  const decisionOverloaded = decisionTotal > (QUEUE_CONFIG.DECISION_QUEUE.intervalCap * 0.8);
  const pdfOverloaded = pdfTotal > (QUEUE_CONFIG.PDF_QUEUE.intervalCap * 0.8);
  const vectorOverloaded = vectorTotal > (QUEUE_CONFIG.VECTOR_QUEUE.intervalCap * 0.8);
  
  return {
    overloaded: decisionOverloaded || pdfOverloaded || vectorOverloaded,
    details: {
      decision: decisionOverloaded,
      pdf: pdfOverloaded,
      vector: vectorOverloaded,
    },
  };
}

/**
 * Gracefully shutdown all queues
 */
export async function shutdownQueues(): Promise<void> {
  const shutdownPromises: Promise<void>[] = [];
  
  if (decisionQueue) {
    shutdownPromises.push(
      new Promise<void>((resolve) => {
        if (decisionQueue!.idle()) {
          resolve();
        } else {
          decisionQueue!.drain = resolve;
        }
      })
    );
  }
  
  if (pdfQueue) {
    shutdownPromises.push(
      new Promise<void>((resolve) => {
        if (pdfQueue!.idle()) {
          resolve();
        } else {
          pdfQueue!.drain = resolve;
        }
      })
    );
  }
  
  if (vectorQueue) {
    shutdownPromises.push(
      new Promise<void>((resolve) => {
        if (vectorQueue!.idle()) {
          resolve();
        } else {
          vectorQueue!.drain = resolve;
        }
      })
    );
  }
  
  await Promise.all(shutdownPromises);
  console.log("[QUEUE] All queues shut down gracefully");
}

/**
 * Clear all queues (for emergencies)
 */
export function clearAllQueues(): void {
  if (decisionQueue) {
    decisionQueue.kill();
    decisionQueue = null;
  }
  
  if (pdfQueue) {
    pdfQueue.kill();
    pdfQueue = null;
  }
  
  if (vectorQueue) {
    vectorQueue.kill();
    vectorQueue = null;
  }
  
  console.warn("[QUEUE] All queues cleared and killed");
  
  // Reinitialize queues
  initializeQueues();
}

// Initialize queues when module is loaded
initializeQueues();