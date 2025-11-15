// packages/web/src/services/mirrorAdminService.ts
interface MirrorAdminResponse {
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

export async function submitToMirrorAdmin(
  orderId: string,
  txHash: string,
  collateralToUnlock: string | number | bigint,
  fullyRepaid: boolean,
  reserveId: string,
  borrower: string
): Promise<MirrorAdminResponse> {
  try {
    if (!orderId || !txHash || collateralToUnlock === undefined || fullyRepaid === undefined) {
      throw new Error('Missing required parameters');
    }

    // Ensure collateralToUnlock is a string
    const collateralStr = collateralToUnlock.toString();
    
    const payload = { 
      orderId, 
      txHash,
      collateralToUnlock: collateralStr,
      fullyRepaid,
      reserveId,
      borrower
    };

    console.log('Sending payload to mirror admin:', payload);
    
    const response = await fetch('/api/mirror/relay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: safeStringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to relay transaction');
    }

    return await response.json();
  } catch (error) {
    console.error('Mirror admin submission failed:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}