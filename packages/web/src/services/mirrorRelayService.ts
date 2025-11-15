interface RelayResponse {
  success: boolean;
  txHash?: string;
  error?: string;
  message?: string;
}

export async function submitToMirrorRelay(params: {
  orderId: string;
  txHash: string;
  collateralToUnlock: string;
  fullyRepaid: boolean;
  reserveId: string;
  borrower: string;
}): Promise<RelayResponse> {
  try {
    const response = await fetch('/api/mirror/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to submit to mirror relay');
    }

    return { success: true, ...data };
  } catch (error) {
    console.error('Mirror relay error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to process relay request'
    };
  }
}
