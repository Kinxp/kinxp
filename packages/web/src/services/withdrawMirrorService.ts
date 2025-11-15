interface WithdrawMirrorResponse {
  success: boolean;
  message: string;
  txHash?: string;
  error?: string;
}

// Helper function to safely serialize BigInt to string
const safeStringify = (obj: any): string => {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
};

export async function submitWithdrawToEthereum(
  orderId: string,
  txHash: string,
  collateralToWithdraw: string | number | bigint,
  reserveId: string,
  receiver: string
): Promise<WithdrawMirrorResponse> {
  try {
    if (!orderId || !txHash || collateralToWithdraw === undefined || !reserveId || !receiver) {
      throw new Error('Missing required parameters');
    }

    // Ensure collateralToWithdraw is a string
    const collateralStr = collateralToWithdraw.toString();
    
    const payload = { 
      orderId, 
      txHash,
      collateralToWithdraw: collateralStr,
      reserveId,
      receiver
    };

    console.log('Sending withdraw payload to mirror service:', payload);
    
    const response = await fetch('/api/mirror/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: safeStringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to process withdrawal');
    }

    return await response.json();
  } catch (error) {
    console.error('Withdraw mirror submission failed:', error);
    return { 
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
