import { NextRequest, NextResponse } from 'next/server';

// Modal endpoint URL - this will be set after deployment
// Format: https://[username]--terminal-bench-cloud-fastapi-app.modal.run
const MODAL_ENDPOINT = process.env.MODAL_ENDPOINT || 'https://your-username--terminal-bench-cloud-fastapi-app.modal.run';

interface ModalRunRequest {
  task_ids: string[];
  agent_type: string;
  model: string;
  dataset: string;
  parallel: number;
}

interface ModalStatusResponse {
  batch_id: string;
  status: string;
  completed: number;
  total: number;
  passed: number;
  failed: number;
  results?: any;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      taskIds, 
      agentType = 'opencode',
      model = 'gpt-4o-mini',
      dataset = 'terminal-bench-core',
      parallel = 10
    } = body;

    if (!taskIds || taskIds.length === 0) {
      return NextResponse.json(
        { error: 'No tasks specified' },
        { status: 400 }
      );
    }

    // Call Modal endpoint to start batch
    const modalRequest: ModalRunRequest = {
      task_ids: taskIds,
      agent_type: agentType,
      model: model,
      dataset: dataset,
      parallel: Math.min(parallel, 100) // Cap at 100
    };

    console.log('[MODAL-API] Calling Modal endpoint:', MODAL_ENDPOINT);
    console.log('[MODAL-API] Request:', modalRequest);

    const response = await fetch(`${MODAL_ENDPOINT}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(modalRequest)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[MODAL-API] Modal endpoint error:', error);
      return NextResponse.json(
        { error: 'Failed to start Modal batch', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('[MODAL-API] Modal batch started:', data);

    // Register this batch with the runs API so it shows up in the UI
    try {
      await fetch(`http://localhost:3002/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: data.batch_id })
      });
    } catch (error) {
      console.log('Failed to register batch with runs API:', error.message);
    }

    // Return the batch ID and info to dashboard
    return NextResponse.json({
      success: true,
      batchId: data.batch_id,
      runId: data.batch_id, // Use batch_id as runId for compatibility
      message: data.message,
      taskCount: data.task_count,
      platform: 'modal'
    });

  } catch (error) {
    console.error('[MODAL-API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to Modal', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');
  
  if (!batchId) {
    // Health check - verify Modal endpoint is accessible
    try {
      const response = await fetch(`${MODAL_ENDPOINT}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      
      return NextResponse.json({
        status: 'available',
        authenticated: true, // If endpoint responds, Modal is working
        endpoint: MODAL_ENDPOINT,
        service: data.service,
        message: data.message,
        modal_status: data.status // Include the actual Modal status
      });
    } catch (error) {
      return NextResponse.json({
        status: 'unavailable',
        authenticated: false,
        endpoint: MODAL_ENDPOINT,
        error: 'Cannot connect to Modal endpoint'
      });
    }
  }
  
  // Get batch status from Modal
  try {
    const response = await fetch(`${MODAL_ENDPOINT}/status/${batchId}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Batch not found' },
          { status: 404 }
        );
      }
      throw new Error(`Modal status check failed: ${response.statusText}`);
    }

    const data: ModalStatusResponse = await response.json();
    
    // Transform Modal response to match dashboard expectations
    const transformedResponse = {
      batchId: data.batch_id,
      status: data.status,
      completed: data.completed,
      total: data.total,
      passed: data.passed,
      failed: data.failed,
      progress: data.total > 0 ? (data.completed / data.total) * 100 : 0,
      tasks: data.results?.tasks || {},
      isComplete: data.status === 'completed',
      passRate: data.total > 0 ? (data.passed / data.total) * 100 : 0
    };
    
    return NextResponse.json(transformedResponse);
    
  } catch (error) {
    console.error('[MODAL-API] Error checking status:', error);
    return NextResponse.json(
      { error: 'Failed to check batch status', details: error.message },
      { status: 500 }
    );
  }
}